(() => {
  const frontend = window.BrickeneFrontend;
  const { dom } = frontend;
  const DUPLICATOR_BRICK_ID = "900";
  const EDGE_OUTLINE_WIDTH = 6;
  const EDGE_VISIBLE_WIDTH = 2;
  const EDGE_HIT_RADIUS = EDGE_OUTLINE_WIDTH / 2;

  function findEdge(edgeId) {
    return frontend.getGraphState().edges.find((edge) => edge.id === edgeId) || null;
  }

  function isDuplicatorNode(node) {
    return String(node?.brickId || "") === DUPLICATOR_BRICK_ID;
  }

  function buildNodeAdjacency(edges) {
    return edges.reduce(
      (maps, edge) => {
        const startNodeId = edge.from.nodeId;
        const endNodeId = edge.to.nodeId;

        if (!maps.outgoing.has(startNodeId)) {
          maps.outgoing.set(startNodeId, []);
        }
        maps.outgoing.get(startNodeId).push(endNodeId);

        if (!maps.incoming.has(endNodeId)) {
          maps.incoming.set(endNodeId, []);
        }
        maps.incoming.get(endNodeId).push(startNodeId);

        return maps;
      },
      { outgoing: new Map(), incoming: new Map() },
    );
  }

  function collectReachableNodeIds(startNodeId, adjacency) {
    const visitedNodeIds = new Set();
    const pendingNodeIds = [startNodeId];

    while (pendingNodeIds.length) {
      const currentNodeId = pendingNodeIds.pop();
      const nextNodeIds = adjacency.get(currentNodeId) || [];

      nextNodeIds.forEach((nextNodeId) => {
        if (visitedNodeIds.has(nextNodeId) || nextNodeId === startNodeId) {
          return;
        }

        visitedNodeIds.add(nextNodeId);
        pendingNodeIds.push(nextNodeId);
      });
    }

    return visitedNodeIds;
  }

  function crossesDuplicatorBoundary(sourceNodeId, targetNodeId) {
    const graph = frontend.getGraphState();
    const duplicatorNodes = graph.nodes.filter(isDuplicatorNode);
    if (!duplicatorNodes.length || !graph.edges.length) {
      return false;
    }

    const adjacency = buildNodeAdjacency(graph.edges);

    return duplicatorNodes.some((duplicatorNode) => {
      const upstreamNodeIds = collectReachableNodeIds(duplicatorNode.id, adjacency.incoming);
      const downstreamNodeIds = collectReachableNodeIds(duplicatorNode.id, adjacency.outgoing);

      return (
        (upstreamNodeIds.has(sourceNodeId) && downstreamNodeIds.has(targetNodeId))
        || (upstreamNodeIds.has(targetNodeId) && downstreamNodeIds.has(sourceNodeId))
      );
    });
  }

  function distanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    if (dx === 0 && dy === 0) {
      return Math.hypot(point.x - start.x, point.y - start.y);
    }

    const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
    const clamped = Math.max(0, Math.min(1, projection));
    const closestPoint = {
      x: start.x + clamped * dx,
      y: start.y + clamped * dy,
    };

    return Math.hypot(point.x - closestPoint.x, point.y - closestPoint.y);
  }

  function cubicBezierPoint(t, start, controlOne, controlTwo, end) {
    const inverse = 1 - t;
    const inverseSquared = inverse * inverse;
    const inverseCubed = inverseSquared * inverse;
    const tSquared = t * t;
    const tCubed = tSquared * t;

    return {
      x: inverseCubed * start.x
        + 3 * inverseSquared * t * controlOne.x
        + 3 * inverse * tSquared * controlTwo.x
        + tCubed * end.x,
      y: inverseCubed * start.y
        + 3 * inverseSquared * t * controlOne.y
        + 3 * inverse * tSquared * controlTwo.y
        + tCubed * end.y,
    };
  }

  function getCurveControlPoints(from, to, startTangent = null, endTangent = null) {
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const direction = deltaX === 0 ? 1 : Math.sign(deltaX);
    const controlOffset = Math.max(48, Math.abs(deltaX) * 0.45, Math.abs(deltaY) * 0.2);
    const normalizedStartTangent = startTangent && Math.hypot(startTangent.x, startTangent.y) > 0.0001
      ? startTangent
      : { x: direction, y: 0 };
    const normalizedEndTangent = endTangent && Math.hypot(endTangent.x, endTangent.y) > 0.0001
      ? endTangent
      : { x: direction, y: 0 };

    return {
      controlOne: {
        x: from.x + controlOffset * normalizedStartTangent.x,
        y: from.y + controlOffset * normalizedStartTangent.y,
      },
      controlTwo: {
        x: to.x + controlOffset * normalizedEndTangent.x,
        y: to.y + controlOffset * normalizedEndTangent.y,
      },
    };
  }

  function buildEdgeCurve(from, to, startTangent = null, endTangent = null) {
    const { controlOne, controlTwo } = getCurveControlPoints(from, to, startTangent, endTangent);

    return {
      from,
      to,
      controlOne,
      controlTwo,
      pathData: `M ${from.x} ${from.y} C ${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${to.x} ${to.y}`,
    };
  }

  function distanceToCurve(point, curve) {
    let bestDistance = Infinity;
    let previousPoint = curve.from;

    for (let sampleIndex = 1; sampleIndex <= 24; sampleIndex += 1) {
      const nextPoint = cubicBezierPoint(
        sampleIndex / 24,
        curve.from,
        curve.controlOne,
        curve.controlTwo,
        curve.to,
      );
      bestDistance = Math.min(bestDistance, distanceToSegment(point, previousPoint, nextPoint));
      previousPoint = nextPoint;
    }

    return bestDistance;
  }

  function getEdgeWorldCurve(edge) {
    const from = getPortWorldPoint(edge.from.nodeId, edge.from.slotId);
    const to = getPortWorldPoint(edge.to.nodeId, edge.to.slotId);
    const startTangent = getPortTangent(edge.from.nodeId, edge.from.slotId);
    const endTangent = getPortTangent(edge.to.nodeId, edge.to.slotId);

    if (!from || !to) {
      return null;
    }

    return buildEdgeCurve(from, to, startTangent, endTangent);
  }

  function findEdgeAtClientPoint(clientX, clientY) {
    const directTarget = document.elementFromPoint(clientX, clientY)?.closest("[data-edge-id]");
    if (directTarget) {
      return Number(directTarget.dataset.edgeId);
    }

    const point = frontend.clientToWorldPoint(clientX, clientY);
    let matchedEdgeId = null;
    let bestDistance = Infinity;

    frontend.getGraphState().edges.forEach((edge) => {
      const curve = getEdgeWorldCurve(edge);
      if (!curve) {
        return;
      }

      const distance = distanceToCurve(point, curve);
      if (distance <= EDGE_HIT_RADIUS && distance < bestDistance) {
        matchedEdgeId = edge.id;
        bestDistance = distance;
      }
    });

    return matchedEdgeId;
  }

  function hasEdgeSelectionChanged(nextSelection) {
    const { selectedEdgeIds } = frontend.getUiState();

    if (selectedEdgeIds.size !== nextSelection.length) {
      return true;
    }

    return nextSelection.some((edgeId) => !selectedEdgeIds.has(edgeId));
  }

  function setSelectedEdges(edgeIds, options = {}) {
    const ui = frontend.getUiState();
    const preserveNodes = Boolean(options.preserveNodes);

    if (!hasEdgeSelectionChanged(edgeIds) && (preserveNodes || ui.selectedNodeIds.size === 0)) {
      return;
    }

    ui.selectedEdgeIds = new Set(edgeIds);
    if (!preserveNodes) {
      ui.selectedNodeIds = new Set();
    }
    frontend.renderNodes();
  }

  function clearEdgeSelection() {
    setSelectedEdges([], { preserveNodes: true });
  }

  function selectOnlyEdge(edgeId) {
    setSelectedEdges([edgeId]);
  }

  function toggleEdgeSelection(edgeId) {
    const ui = frontend.getUiState();
    const nextSelection = new Set(ui.selectedEdgeIds);

    if (nextSelection.has(edgeId)) {
      nextSelection.delete(edgeId);
    } else {
      nextSelection.add(edgeId);
    }

    setSelectedEdges([...nextSelection], { preserveNodes: true });
    return nextSelection.has(edgeId);
  }

  function getPortWorldPoint(nodeId, slotId) {
    const portElement = dom.nodeContainer.querySelector(
      `.node-port[data-node-id="${nodeId}"][data-slot-id="${slotId}"]`,
    );
    if (!portElement) {
      return null;
    }

    const portRect = portElement.getBoundingClientRect();

    return frontend.clientToWorldPoint(
      portRect.left + portRect.width / 2,
      portRect.top + portRect.height / 2,
    );
  }

  function getPortTangent(nodeId, slotId) {
    const portElement = dom.nodeContainer.querySelector(
      `.node-port[data-node-id="${nodeId}"][data-slot-id="${slotId}"]`,
    );
    if (!portElement) {
      return null;
    }

    const tangentX = Number(portElement.dataset.tangentX);
    const tangentY = Number(portElement.dataset.tangentY);
    const tangentLength = Math.hypot(tangentX, tangentY);

    if (!Number.isFinite(tangentX) || !Number.isFinite(tangentY) || tangentLength <= 0.0001) {
      return null;
    }

    return {
      x: tangentX / tangentLength,
      y: tangentY / tangentLength,
    };
  }

  function findHoveredPort(clientX, clientY) {
    const port = document.elementFromPoint(clientX, clientY)?.closest(".node-port");
    if (port) {
      return {
        nodeId: Number(port.dataset.nodeId),
        slotId: Number(port.dataset.slotId),
      };
    }

    // Fallback: if the pointer is over a node body, pick its first idle port.
    const nodeEl = document.elementFromPoint(clientX, clientY)?.closest(".node-component");
    if (!nodeEl) {
      return null;
    }

    const nodeId = Number(nodeEl.dataset.nodeId);
    const node = frontend.findNode(nodeId);
    if (!node) {
      return null;
    }

    const { leftSlots, neutralSlots, rightSlots } = frontend.getPortSlotGroups(node);
    const idleSlot = [...leftSlots, ...neutralSlots, ...rightSlots].find(
      (slot) => slot.edgeId === null,
    );
    if (!idleSlot) {
      return null;
    }

    return { nodeId, slotId: idleSlot.id };
  }

  function renderEdges() {
    const graph = frontend.getGraphState();
    const ui = frontend.getUiState();
    const activeRetargetEdgeId = ui.componentInteraction?.type === "edge-retarget"
      ? ui.componentInteraction.edgeId
      : null;
    const edgeMarkup = graph.edges.map((edge) => {
      if (edge.id === activeRetargetEdgeId) {
        return "";
      }

      const curve = getEdgeWorldCurve(edge);

      if (!curve) {
        return "";
      }

      const isSelected = ui.selectedEdgeIds.has(edge.id);

      return `
        <g class="edge-group${isSelected ? " is-selected" : ""}" data-edge-id="${edge.id}">
          <path
            class="edge-line-outline"
            d="${curve.pathData}"
            data-edge-id="${edge.id}"
          ></path>
          <path
            class="edge-line${isSelected ? " is-selected" : ""}"
            d="${curve.pathData}"
            data-edge-id="${edge.id}"
          ></path>
        </g>
      `;
    }).join("");

    let draftMarkup = "";
    if (ui.componentInteraction?.type === "edge-drag") {
      const from = getPortWorldPoint(ui.componentInteraction.sourceNodeId, ui.componentInteraction.sourceSlotId);
      const startTangent = getPortTangent(ui.componentInteraction.sourceNodeId, ui.componentInteraction.sourceSlotId);
      if (from) {
        const draftCurve = buildEdgeCurve(from, ui.componentInteraction.pointerWorld, startTangent, null);
        draftMarkup = `
          <path
            class="edge-line-draft"
            d="${draftCurve.pathData}"
          ></path>
        `;
      }
    } else if (ui.componentInteraction?.type === "edge-retarget" && ui.componentInteraction.moved) {
      const from = getPortWorldPoint(ui.componentInteraction.sourceNodeId, ui.componentInteraction.sourceSlotId);
      const startTangent = getPortTangent(ui.componentInteraction.sourceNodeId, ui.componentInteraction.sourceSlotId);
      if (from) {
        const draftCurve = buildEdgeCurve(from, ui.componentInteraction.pointerWorld, startTangent, null);
        draftMarkup = `
          <path
            class="edge-line-draft"
            d="${draftCurve.pathData}"
          ></path>
        `;
      }
    }

    dom.edgeLayer.innerHTML = `${edgeMarkup}${draftMarkup}`;
  }

  function beginEdgeDrag(event, nodeId, slotId) {
    const slot = frontend.findPortSlot(nodeId, slotId);
    if (!slot) {
      return;
    }

    const slotPortLabel = frontend.getSlotPortLabel(frontend.findNode(nodeId), slot);

    if (slot.edgeId !== null) {
      frontend.setCanvasMessage(`${slotPortLabel} is already occupied.`);
      return;
    }

    frontend.getUiState().componentInteraction = {
      type: "edge-drag",
      pointerId: event.pointerId,
      sourceNodeId: nodeId,
      sourceSlotId: slotId,
      pointerWorld: frontend.clientToWorldPoint(event.clientX, event.clientY),
      hoverPort: null,
    };
    event.preventDefault();
    frontend.setEdgeDragSelectionState(true);
    dom.canvasViewport.setPointerCapture(event.pointerId);
    frontend.renderNodes();
    frontend.setCanvasMessage(`Lining from ${slotPortLabel}.`);
  }

  function beginEdgeRetarget(event, edgeId) {
    const edge = findEdge(edgeId);
    if (!edge) {
      return;
    }

    frontend.getUiState().componentInteraction = {
      type: "edge-retarget",
      pointerId: event.pointerId,
      edgeId,
      sourceNodeId: edge.from.nodeId,
      sourceSlotId: edge.from.slotId,
      originalTargetNodeId: edge.to.nodeId,
      originalTargetSlotId: edge.to.slotId,
      pointerWorld: frontend.clientToWorldPoint(event.clientX, event.clientY),
      hoverPort: null,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.preventDefault();
    frontend.setEdgeDragSelectionState(true);
    dom.canvasViewport.setPointerCapture(event.pointerId);
  }

  function canConnectPorts(sourcePort, targetPort) {
    if (sourcePort.nodeId === targetPort.nodeId && sourcePort.slotId === targetPort.slotId) {
      return { success: false, message: "Choose a different port." };
    }

    const sourceSlot = frontend.findPortSlot(sourcePort.nodeId, sourcePort.slotId);
    const targetSlot = frontend.findPortSlot(targetPort.nodeId, targetPort.slotId);
    const sourceNode = frontend.findNode(sourcePort.nodeId);
    const targetNode = frontend.findNode(targetPort.nodeId);
    if (!sourceSlot || !targetSlot) {
      return { success: false, message: "Port not found." };
    }

    if (!sourceNode || !targetNode) {
      return { success: false, message: "Node not found." };
    }

    const sourceSide = frontend.getEffectiveSlotSide(sourceNode, sourceSlot);
    const targetSide = frontend.getEffectiveSlotSide(targetNode, targetSlot);

    if (sourceSide === "left") {
      return { success: false, message: "Tool left ports cannot start a connection." };
    }

    if (targetSide === "right") {
      return { success: false, message: "Tool right ports cannot end a connection." };
    }

    if (crossesDuplicatorBoundary(sourcePort.nodeId, targetPort.nodeId)) {
      return {
        success: false,
        message: "Cannot connect ports across an existing duplicator branch.",
      };
    }

    return { success: true, sourceSlot, targetSlot };
  }

  function createEdgeBetweenPorts(sourcePort, targetPort) {
    const graph = frontend.getGraphState();
    const connectionCheck = canConnectPorts(sourcePort, targetPort);
    if (!connectionCheck.success) {
      return connectionCheck;
    }

    const { sourceSlot, targetSlot } = connectionCheck;

    if (sourceSlot.edgeId !== null || targetSlot.edgeId !== null) {
      return { success: false, message: "Each port can only hold one line." };
    }

    const edge = {
      id: graph.nextEdgeId,
      from: { ...sourcePort },
      to: { ...targetPort },
    };

    graph.nextEdgeId += 1;
    graph.edges = [...graph.edges, edge];
    frontend.updateNodePortEdge(sourcePort.nodeId, sourcePort.slotId, edge.id);
    frontend.updateNodePortEdge(targetPort.nodeId, targetPort.slotId, edge.id);
    selectOnlyEdge(edge.id);
    frontend.renderNodes();
    frontend.notifyGraphChanged({ reason: "edge-created", edgeId: edge.id });
    return { success: true, message: "Line created." };
  }

  function retargetEdgeDestination(edgeId, targetPort) {
    const graph = frontend.getGraphState();
    const edge = findEdge(edgeId);
    if (!edge) {
      return { success: false, message: "Edge not found." };
    }

    const sourcePort = { ...edge.from };
    const connectionCheck = canConnectPorts(sourcePort, targetPort);
    if (!connectionCheck.success) {
      return connectionCheck;
    }

    const { targetSlot } = connectionCheck;
    const isSameTarget = edge.to.nodeId === targetPort.nodeId && edge.to.slotId === targetPort.slotId;
    if (isSameTarget) {
      return { success: true, message: `Edge ${edgeId} unchanged.` };
    }

    if (targetSlot.edgeId !== null && targetSlot.edgeId !== edgeId) {
      return { success: false, message: "Each port can only hold one line." };
    }

    const previousTarget = { ...edge.to };
    graph.edges = graph.edges.map((graphEdge) => (
      graphEdge.id === edgeId
        ? {
          ...graphEdge,
          to: { ...targetPort },
        }
        : graphEdge
    ));
    frontend.updateNodePortEdge(previousTarget.nodeId, previousTarget.slotId, null);
    frontend.updateNodePortEdge(targetPort.nodeId, targetPort.slotId, edgeId);
    selectOnlyEdge(edgeId);
    frontend.renderNodes();
    frontend.notifyGraphChanged({ reason: "edge-retargeted", edgeId });
    return { success: true, message: `Edge ${edgeId} destination updated.` };
  }

  function deleteEdge(edgeId) {
    const graph = frontend.getGraphState();
    const ui = frontend.getUiState();
    const edge = findEdge(edgeId);

    if (!edge) {
      return false;
    }

    graph.edges = graph.edges.filter((graphEdge) => graphEdge.id !== edgeId);
    graph.nodes = graph.nodes.map((node) => ({
      ...node,
      portSlots: node.portSlots.map((slot) => (
        slot.edgeId === edgeId ? { ...slot, edgeId: null } : slot
      )),
    }));
    ui.selectedEdgeIds.delete(edgeId);
    if (ui.activeEdgeContextId === edgeId) {
      ui.activeEdgeContextId = null;
    }
    frontend.renderNodes();
    frontend.notifyGraphChanged({ reason: "edge-deleted", edgeId });
    return true;
  }

  function deleteSelectedEdges() {
    const selectedEdgeIds = [...frontend.getUiState().selectedEdgeIds];

    if (!selectedEdgeIds.length) {
      return 0;
    }

    selectedEdgeIds.forEach((edgeId) => {
      deleteEdge(edgeId);
    });
    return selectedEdgeIds.length;
  }

  frontend.getPortWorldPoint = getPortWorldPoint;
  frontend.findEdge = findEdge;
  frontend.findEdgeAtClientPoint = findEdgeAtClientPoint;
  frontend.setSelectedEdges = setSelectedEdges;
  frontend.clearEdgeSelection = clearEdgeSelection;
  frontend.selectOnlyEdge = selectOnlyEdge;
  frontend.toggleEdgeSelection = toggleEdgeSelection;
  frontend.findHoveredPort = findHoveredPort;
  frontend.renderEdges = renderEdges;
  frontend.beginEdgeDrag = beginEdgeDrag;
  frontend.beginEdgeRetarget = beginEdgeRetarget;
  frontend.createEdgeBetweenPorts = createEdgeBetweenPorts;
  frontend.retargetEdgeDestination = retargetEdgeDestination;
  frontend.deleteEdge = deleteEdge;
  frontend.deleteSelectedEdges = deleteSelectedEdges;
})();
