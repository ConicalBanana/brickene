(() => {
  const frontend = window.BrickeneFrontend;
  const { dom } = frontend;
  const EDGE_OUTLINE_WIDTH = 6;
  const EDGE_VISIBLE_WIDTH = 2;
  const EDGE_HIT_RADIUS = EDGE_OUTLINE_WIDTH / 2;

  function findEdge(edgeId) {
    return frontend.getGraphState().edges.find((edge) => edge.id === edgeId) || null;
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

  function getEdgeWorldSegment(edge) {
    const from = getPortWorldPoint(edge.from.nodeId, edge.from.slotId);
    const to = getPortWorldPoint(edge.to.nodeId, edge.to.slotId);

    if (!from || !to) {
      return null;
    }

    return { from, to };
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
      const segment = getEdgeWorldSegment(edge);
      if (!segment) {
        return;
      }

      const distance = distanceToSegment(point, segment.from, segment.to);
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

    const worldRect = dom.componentWorld.getBoundingClientRect();
    const portRect = portElement.getBoundingClientRect();

    return {
      x: portRect.left - worldRect.left + portRect.width / 2,
      y: portRect.top - worldRect.top + portRect.height / 2,
    };
  }

  function findHoveredPort(clientX, clientY) {
    const port = document.elementFromPoint(clientX, clientY)?.closest(".node-port");
    if (!port) {
      return null;
    }

    return {
      nodeId: Number(port.dataset.nodeId),
      slotId: Number(port.dataset.slotId),
    };
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

      const segment = getEdgeWorldSegment(edge);

      if (!segment) {
        return "";
      }

      const isSelected = ui.selectedEdgeIds.has(edge.id);

      return `
        <g class="edge-group${isSelected ? " is-selected" : ""}" data-edge-id="${edge.id}">
          <line
            class="edge-line-outline"
            x1="${segment.from.x}"
            y1="${segment.from.y}"
            x2="${segment.to.x}"
            y2="${segment.to.y}"
            data-edge-id="${edge.id}"
          ></line>
          <line
            class="edge-line${isSelected ? " is-selected" : ""}"
            x1="${segment.from.x}"
            y1="${segment.from.y}"
            x2="${segment.to.x}"
            y2="${segment.to.y}"
            data-edge-id="${edge.id}"
          ></line>
        </g>
      `;
    }).join("");

    let draftMarkup = "";
    if (ui.componentInteraction?.type === "edge-drag") {
      const from = getPortWorldPoint(ui.componentInteraction.sourceNodeId, ui.componentInteraction.sourceSlotId);
      if (from) {
        draftMarkup = `
          <line
            class="edge-line-draft"
            x1="${from.x}"
            y1="${from.y}"
            x2="${ui.componentInteraction.pointerWorld.x}"
            y2="${ui.componentInteraction.pointerWorld.y}"
          ></line>
        `;
      }
    } else if (ui.componentInteraction?.type === "edge-retarget" && ui.componentInteraction.moved) {
      const from = getPortWorldPoint(ui.componentInteraction.sourceNodeId, ui.componentInteraction.sourceSlotId);
      if (from) {
        draftMarkup = `
          <line
            class="edge-line-draft"
            x1="${from.x}"
            y1="${from.y}"
            x2="${ui.componentInteraction.pointerWorld.x}"
            y2="${ui.componentInteraction.pointerWorld.y}"
          ></line>
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

    if (
      frontend.getEffectiveSlotSide(sourceNode, sourceSlot) !== "right"
      || frontend.getEffectiveSlotSide(targetNode, targetSlot) !== "left"
    ) {
      return { success: false, message: "Only right-side to left-side connections are allowed." };
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
