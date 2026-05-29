(() => {
  const frontend = window.BrickeneFrontend;
  const { dom } = frontend;
  const AUTO_PAN_BOUNDARY_RATIO = 0.05;
  const AUTO_PAN_MAX_STEP = 28;
  const PORT_COMMAND_RESULT_LIMIT = 12;
  let activePortCommand = null;
  let activeCanvasNodeMenu = null;
  let lastPointerClientX = 0;
  let lastPointerClientY = 0;

  function isZoomResizeShortcutPressed(event) {
    return frontend.platform?.isMacOS ? event.metaKey : event.ctrlKey;
  }

  function setInteractionGuard(isActive) {
    dom.canvasViewport.classList.toggle("is-interacting", isActive);
  }

  function selectAllGraphItems() {
    const graph = frontend.getGraphState();
    const ui = frontend.getUiState();
    const nextNodeIds = new Set(graph.nodes.map((node) => node.id));
    const nextEdgeIds = new Set(graph.edges.map((edge) => edge.id));
    const hasNodeSelectionChanged = (
      ui.selectedNodeIds.size !== nextNodeIds.size
      || [...nextNodeIds].some((nodeId) => !ui.selectedNodeIds.has(nodeId))
    );
    const hasEdgeSelectionChanged = (
      ui.selectedEdgeIds.size !== nextEdgeIds.size
      || [...nextEdgeIds].some((edgeId) => !ui.selectedEdgeIds.has(edgeId))
    );

    if (!hasNodeSelectionChanged && !hasEdgeSelectionChanged) {
      return false;
    }

    ui.selectedNodeIds = nextNodeIds;
    ui.selectedEdgeIds = nextEdgeIds;
    frontend.renderNodes();
    return true;
  }

  function deleteSelectedGraphItems() {
    const ui = frontend.getUiState();
    const selectedNodeIds = [...ui.selectedNodeIds];
    let deletedNodeCount = 0;
    let deletedEdgeCount = 0;

    if (selectedNodeIds.length) {
      selectedNodeIds.forEach((nodeId) => {
        frontend.deleteNode(nodeId);
      });
      deletedNodeCount = selectedNodeIds.length;
    }

    deletedEdgeCount = frontend.deleteSelectedEdges();
    if (deletedNodeCount > 0 || deletedEdgeCount > 0) {
      const deletedParts = [];
      if (deletedNodeCount > 0) {
        deletedParts.push(`${deletedNodeCount} node(s)`);
      }
      if (deletedEdgeCount > 0) {
        deletedParts.push(`${deletedEdgeCount} edge(s)`);
      }
      frontend.setCanvasMessage(`${deletedParts.join(" and ")} deleted.`);
      return true;
    }

    return false;
  }

  frontend.deleteSelectedGraphItems = deleteSelectedGraphItems;

  function shouldIgnoreWheelPan(eventTarget) {
    return Boolean(
      eventTarget.closest(".canvas-context-menu, .node-context-menu, .submenu-dropdown"),
    );
  }

  function applyCanvasOffset(deltaX, deltaY) {
    const ui = frontend.getUiState();

    ui.canvasOffset = {
      x: ui.canvasOffset.x + deltaX,
      y: ui.canvasOffset.y + deltaY,
    };
    frontend.applyViewportOffset();
    frontend.setCanvasMessage(`Canvas translated to x ${ui.canvasOffset.x}, y ${ui.canvasOffset.y}.`);
  }

  function computeAutoPanAxisDelta(distanceToStart, distanceToEnd, boundarySize) {
    if (distanceToStart <= boundarySize) {
      return Math.ceil(((boundarySize - distanceToStart) / boundarySize) * AUTO_PAN_MAX_STEP);
    }

    if (distanceToEnd <= boundarySize) {
      return -Math.ceil(((boundarySize - distanceToEnd) / boundarySize) * AUTO_PAN_MAX_STEP);
    }

    return 0;
  }

  function applyAutoPanForPointer(clientX, clientY) {
    const viewportRect = dom.canvasViewport?.getBoundingClientRect();
    if (!viewportRect) {
      return { x: 0, y: 0 };
    }

    const boundaryWidth = Math.max(24, viewportRect.width * AUTO_PAN_BOUNDARY_RATIO);
    const boundaryHeight = Math.max(24, viewportRect.height * AUTO_PAN_BOUNDARY_RATIO);
    const localX = clientX - viewportRect.left;
    const localY = clientY - viewportRect.top;
    const deltaX = computeAutoPanAxisDelta(localX, viewportRect.width - localX, boundaryWidth);
    const deltaY = computeAutoPanAxisDelta(localY, viewportRect.height - localY, boundaryHeight);

    if (!deltaX && !deltaY) {
      return { x: 0, y: 0 };
    }

    const ui = frontend.getUiState();
    ui.canvasOffset = {
      x: ui.canvasOffset.x + deltaX,
      y: ui.canvasOffset.y + deltaY,
    };
    frontend.applyViewportOffset();
    return { x: deltaX, y: deltaY };
  }

  function getViewportCenterClientPoint() {
    const viewportRect = dom.canvasViewport?.getBoundingClientRect();
    if (!viewportRect) {
      return null;
    }

    return {
      x: viewportRect.left + viewportRect.width / 2,
      y: viewportRect.top + viewportRect.height / 2,
    };
  }

  function handleZoomButtonClick(direction) {
    const centerPoint = getViewportCenterClientPoint();
    if (!centerPoint) {
      return;
    }

    const zoomed = frontend.zoomCanvasByDirection(direction, centerPoint.x, centerPoint.y);
    if (zoomed) {
      frontend.setCanvasMessage(
        `Canvas scaled to ${Math.round(frontend.getUiState().canvasScale * 100)}%.`,
      );
    }
  }

  function zoomCanvasFromViewportCenter(direction) {
    handleZoomButtonClick(direction);
    return true;
  }

  function resetCanvasZoomAtViewportCenter() {
    const centerPoint = getViewportCenterClientPoint();
    if (!centerPoint) {
      return false;
    }

    const reset = frontend.setCanvasScale(1, centerPoint.x, centerPoint.y);
    if (reset) {
      frontend.setCanvasMessage("Canvas zoom reset to 100%.");
    }
    return reset;
  }

  function handleCanvasWheel(event) {
    if (!(event.target instanceof Element) || shouldIgnoreWheelPan(event.target)) {
      return;
    }

    const ui = frontend.getUiState();
    if (ui.canvasPanState || ui.componentInteraction) {
      return;
    }

    if (isZoomResizeShortcutPressed(event)) {
      if (event.deltaY === 0) {
        return;
      }

      event.preventDefault();
      frontend.closeAllContextMenus();
      const zoomed = frontend.zoomCanvasByDirection(
        event.deltaY < 0 ? 1 : -1,
        event.clientX,
        event.clientY,
      );
      if (zoomed) {
        frontend.setCanvasMessage(
          `Canvas scaled to ${Math.round(frontend.getUiState().canvasScale * 100)}%.`,
        );
      }
      return;
    }

    const wheelDeltaX = event.deltaX + (event.shiftKey ? event.deltaY : 0);
    const wheelDeltaY = event.shiftKey ? 0 : event.deltaY;

    if (!wheelDeltaX && !wheelDeltaY) {
      return;
    }

    event.preventDefault();
    frontend.closeAllContextMenus();
    applyCanvasOffset(-wheelDeltaX, -wheelDeltaY);
  }

  function syncPanShortcutState() {
    const ui = frontend.getUiState();

    dom.canvasViewport.classList.toggle(
      "is-pan-ready",
      ui.isSpacePressed && !ui.canvasPanState && !ui.componentInteraction,
    );

    if (ui.isSpacePressed && !ui.panHandlersBound) {
      dom.canvasViewport.addEventListener("pointerdown", handleCanvasPointerDown);
      dom.canvasViewport.addEventListener("pointermove", handleCanvasPointerMove);
      dom.canvasViewport.addEventListener("pointerup", endCanvasPan);
      dom.canvasViewport.addEventListener("pointercancel", endCanvasPan);
      ui.panHandlersBound = true;
    }

    if (!ui.isSpacePressed && ui.panHandlersBound) {
      dom.canvasViewport.removeEventListener("pointerdown", handleCanvasPointerDown);
      dom.canvasViewport.removeEventListener("pointermove", handleCanvasPointerMove);
      dom.canvasViewport.removeEventListener("pointerup", endCanvasPan);
      dom.canvasViewport.removeEventListener("pointercancel", endCanvasPan);
      ui.panHandlersBound = false;
    }
  }

  function handleCanvasPointerDown(event) {
    if (event.button !== 0 || dom.canvasContextMenu.contains(event.target) || dom.nodeContextMenu.contains(event.target)) {
      return;
    }

    const ui = frontend.getUiState();
    ui.canvasPanState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: ui.canvasOffset.x,
      originY: ui.canvasOffset.y,
    };

    frontend.closeAllContextMenus();
  event.preventDefault();
  setInteractionGuard(true);
    dom.canvasViewport.classList.add("is-dragging");
    dom.canvasViewport.classList.remove("is-pan-ready");
    dom.canvasViewport.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerMove(event) {
    const ui = frontend.getUiState();
    if (!ui.canvasPanState || event.pointerId !== ui.canvasPanState.pointerId) {
      return;
    }

    ui.canvasOffset = {
      x: ui.canvasPanState.originX + event.clientX - ui.canvasPanState.startX,
      y: ui.canvasPanState.originY + event.clientY - ui.canvasPanState.startY,
    };
    frontend.applyViewportOffset();
    frontend.setCanvasMessage(`Canvas translated to x ${ui.canvasOffset.x}, y ${ui.canvasOffset.y}.`);
  }

  function cancelCanvasPan() {
    const ui = frontend.getUiState();

    ui.canvasPanState = null;
    dom.canvasViewport.classList.remove("is-dragging");
    setInteractionGuard(false);
    syncPanShortcutState();
  }

  function endCanvasPan(event) {
    const ui = frontend.getUiState();
    if (!ui.canvasPanState || event.pointerId !== ui.canvasPanState.pointerId) {
      return;
    }

    dom.canvasViewport.classList.remove("is-dragging");
    dom.canvasViewport.releasePointerCapture(event.pointerId);
    ui.canvasPanState = null;
    setInteractionGuard(false);
    syncPanShortcutState();
  }

  function beginNodeDrag(event, nodeId) {
    const node = frontend.findNode(nodeId);
    if (!node) {
      return;
    }

    const ui = frontend.getUiState();
    const graph = frontend.getGraphState();
    const pointerWorld = frontend.clientToWorldPoint(event.clientX, event.clientY);

    // If the dragged node is selected, move all selected nodes as a group.
    const groupNodeIds = ui.selectedNodeIds.has(nodeId)
      ? [...ui.selectedNodeIds]
      : [nodeId];
    const groupStartPositions = Object.fromEntries(
      groupNodeIds.map((id) => {
        const n = graph.nodes.find((g) => g.id === id);
        return [id, n ? { x: n.x, y: n.y } : { x: 0, y: 0 }];
      }),
    );

    frontend.getUiState().componentInteraction = {
      type: "node-drag",
      pointerId: event.pointerId,
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      pointerOffsetX: pointerWorld.x - node.x,
      pointerOffsetY: pointerWorld.y - node.y,
      moved: false,
      groupNodeIds,
      groupStartPositions,
    };
    event.preventDefault();
    setInteractionGuard(true);
    dom.canvasViewport.setPointerCapture(event.pointerId);
    frontend.renderNodes();
  }

  function setEdgeDragSelectionState(isActive) {
    dom.canvasViewport.classList.toggle("is-edge-dragging", isActive);
  }

  function beginMarqueeSelection(event) {
    const point = frontend.clientToLayerPoint(event.clientX, event.clientY);
    const ui = frontend.getUiState();

    ui.componentInteraction = {
      type: "marquee",
      pointerId: event.pointerId,
      startPoint: point,
      endPoint: point,
      moved: false,
      preserveSelection: event.shiftKey,
      baseSelectedNodeIds: [...ui.selectedNodeIds],
    };
    event.preventDefault();
    setInteractionGuard(true);
    frontend.showSelectionBox(frontend.normalizeRect(point, point));
    dom.canvasViewport.setPointerCapture(event.pointerId);
  }

  function clearComponentInteraction(interaction = frontend.getUiState().componentInteraction) {
    const ui = frontend.getUiState();

    if (!interaction || ui.componentInteraction !== interaction) {
      return false;
    }

    ui.componentInteraction = null;
    return true;
  }

  function releaseInteractionPointerCapture(pointerId) {
    if (dom.canvasViewport.hasPointerCapture(pointerId)) {
      dom.canvasViewport.releasePointerCapture(pointerId);
    }
  }

  function moveEdgeDragInteraction(event, interaction) {
    interaction.pointerWorld = frontend.clientToWorldPoint(event.clientX, event.clientY);
    interaction.hoverPort = frontend.findHoveredPort(event.clientX, event.clientY);
    frontend.renderNodes();
  }

  function endEdgeDragInteraction(event, interaction) {
    setEdgeDragSelectionState(false);
    clearComponentInteraction(interaction);
    frontend.renderNodes();

    const targetPort = frontend.findHoveredPort(event.clientX, event.clientY);
    if (!targetPort) {
      frontend.setCanvasMessage("Lining cancelled.");
      return;
    }

    const result = frontend.createEdgeBetweenPorts(
      { nodeId: interaction.sourceNodeId, slotId: interaction.sourceSlotId },
      targetPort,
    );
    frontend.setCanvasMessage(result.message);
  }

  function cancelEdgeDragInteraction(interaction) {
    setEdgeDragSelectionState(false);
    clearComponentInteraction(interaction);
    frontend.renderNodes();
  }

  function moveEdgeRetargetInteraction(event, interaction, autoPanDelta) {
    interaction.pointerWorld = frontend.clientToWorldPoint(event.clientX, event.clientY);
    interaction.hoverPort = frontend.findHoveredPort(event.clientX, event.clientY);
    interaction.moved = (
      Math.abs(event.clientX - interaction.startX) > 2
      || Math.abs(event.clientY - interaction.startY) > 2
      || autoPanDelta.x !== 0
      || autoPanDelta.y !== 0
    );
    frontend.renderNodes();
  }

  function endEdgeRetargetInteraction(event, interaction) {
    setEdgeDragSelectionState(false);
    clearComponentInteraction(interaction);
    frontend.renderNodes();

    if (!interaction.moved) {
      frontend.selectOnlyEdge(interaction.edgeId);
      frontend.setCanvasMessage(`Edge ${interaction.edgeId} selected.`);
      return;
    }

    const targetPort = frontend.findHoveredPort(event.clientX, event.clientY);
    if (!targetPort) {
      frontend.deleteEdge(interaction.edgeId);
      frontend.setCanvasMessage(`Edge ${interaction.edgeId} deleted.`);
      return;
    }

    const result = frontend.retargetEdgeDestination(interaction.edgeId, targetPort);
    frontend.setCanvasMessage(result.message);
  }

  function cancelEdgeRetargetInteraction(interaction) {
    setEdgeDragSelectionState(false);
    clearComponentInteraction(interaction);
    frontend.renderNodes();
  }

  function moveNodeDragInteraction(event, interaction, autoPanDelta) {
    const graph = frontend.getGraphState();
    const pointerWorld = frontend.clientToWorldPoint(event.clientX, event.clientY);
    const nextX = pointerWorld.x - interaction.pointerOffsetX;
    const nextY = pointerWorld.y - interaction.pointerOffsetY;
    const moved = (
      Math.abs(event.clientX - interaction.startX) > 2
      || Math.abs(event.clientY - interaction.startY) > 2
      || autoPanDelta.x !== 0
      || autoPanDelta.y !== 0
    );

    const dragNode = graph.nodes.find((n) => n.id === interaction.nodeId);
    if (!dragNode) {
      return;
    }
    const deltaX = nextX - dragNode.x;
    const deltaY = nextY - dragNode.y;

    const groupNodeIds = interaction.groupNodeIds || [interaction.nodeId];
    graph.nodes = graph.nodes.map((node) => {
      if (!groupNodeIds.includes(node.id)) {
        return node;
      }
      return { ...node, x: node.x + deltaX, y: node.y + deltaY };
    });
    interaction.moved = moved;
    frontend.renderNodes();
  }

  function endNodeDragInteraction(_event, interaction) {
    const didMove = interaction.moved;
    const groupNodeIds = interaction.groupNodeIds || [interaction.nodeId];

    clearComponentInteraction(interaction);
    frontend.renderNodes();
    if (didMove) {
      for (const nodeId of groupNodeIds) {
        frontend.notifyGraphChanged({
          reason: "node-moved",
          nodeId,
          refreshPreview: false,
        });
      }
    }
    const count = groupNodeIds.length;
    frontend.setCanvasMessage(didMove
      ? (count > 1 ? `${count} nodes moved.` : `Node ${groupNodeIds[0]} moved.`)
      : `Node ${interaction.nodeId} selected.`);
  }

  function cancelNodeDragInteraction(interaction) {
    clearComponentInteraction(interaction);
    frontend.renderNodes();
  }

  function moveMarqueeInteraction(event, interaction) {
    const nextPoint = frontend.clientToLayerPoint(event.clientX, event.clientY);
    const rect = frontend.normalizeRect(interaction.startPoint, nextPoint);

    interaction.endPoint = nextPoint;
    interaction.moved = rect.right - rect.left > 2 || rect.bottom - rect.top > 2;
    frontend.showSelectionBox(rect);
    frontend.updateSelectionFromRect(rect, {
      preserveSelection: interaction.preserveSelection,
      baseNodeIds: interaction.baseSelectedNodeIds,
    });
  }

  function endMarqueeInteraction(_event, interaction) {
    frontend.hideSelectionBox();
    clearComponentInteraction(interaction);

    if (!interaction.moved) {
      if (!interaction.preserveSelection) {
        frontend.clearSelection();
      }
      frontend.setCanvasMessage("Selection cleared.");
      return;
    }

    const ui = frontend.getUiState();
    frontend.setCanvasMessage(
      `${ui.selectedNodeIds.size} node(s) and ${ui.selectedEdgeIds.size} edge(s) selected.`,
    );
  }

  function cancelMarqueeInteraction(interaction) {
    frontend.hideSelectionBox();
    clearComponentInteraction(interaction);
    frontend.renderNodes();
  }

  const interactionModeRegistry = {
    "edge-drag": {
      move: moveEdgeDragInteraction,
      end: endEdgeDragInteraction,
      cancel: cancelEdgeDragInteraction,
    },
    "edge-retarget": {
      move: moveEdgeRetargetInteraction,
      end: endEdgeRetargetInteraction,
      cancel: cancelEdgeRetargetInteraction,
    },
    "node-drag": {
      move: moveNodeDragInteraction,
      end: endNodeDragInteraction,
      cancel: cancelNodeDragInteraction,
    },
    marquee: {
      move: moveMarqueeInteraction,
      end: endMarqueeInteraction,
      cancel: cancelMarqueeInteraction,
    },
  };

  function resetCanvasTranslation() {
    const ui = frontend.getUiState();

    ui.canvasOffset = { x: 0, y: 0 };
    frontend.applyViewportOffset();
    frontend.setCanvasMessage("Canvas translation reset to origin.");
  }

  // Create a node at the hovered port (if any) and auto-connect it, or fall
  // back to placing it at the viewport centre.
  function createNodeFromPort(brickId) {
    const hoveredPort = frontend.getUiState().hoveredPort;

    if (hoveredPort) {
      const sourceNode = frontend.findNode(hoveredPort.nodeId);
      const sourceSlot = frontend.findPortSlot(hoveredPort.nodeId, hoveredPort.slotId);

      if (sourceNode && sourceSlot) {
        const sourceSide = frontend.getEffectiveSlotSide(sourceNode, sourceSlot);
        const direction = sourceSide === "left" ? -1 : 1;
        const newNode = frontend.createNodeAt(
          sourceNode.x + direction * frontend.config.nodeSize.width * 0.7,
          sourceNode.y,
          { brickId },
        );

        let connectMessage = "";

        if (sourceSlot.edgeId !== null) {
          connectMessage = " Port already occupied; new node left unconnected.";
        } else {
          const desiredSides = sourceSide === "left"
            ? ["right", null]
            : sourceSide === "right"
              ? ["left", null]
              : [null, "left", "right"];
          const newSlot = desiredSides
            .map((s) => newNode.portSlots.find((slot) => frontend.getEffectiveSlotSide(newNode, slot) === s))
            .find(Boolean) || newNode.portSlots[0] || null;

          if (!newSlot) {
            connectMessage = " No compatible port found on the new node.";
          } else {
            const result = sourceSide === "left"
              ? frontend.createEdgeBetweenPorts(
                { nodeId: newNode.id, slotId: newSlot.id },
                { nodeId: sourceNode.id, slotId: sourceSlot.id },
              )
              : frontend.createEdgeBetweenPorts(
                { nodeId: sourceNode.id, slotId: sourceSlot.id },
                { nodeId: newNode.id, slotId: newSlot.id },
              );

            if (!result.success) {
              connectMessage = ` ${result.message}`;
            }
          }
        }

        schedulePortCommandEdgeRefresh(newNode.id);
        frontend.setCanvasMessage(
          `Node ${newNode.id} (${newNode.brickName}) created from port.${connectMessage}`,
        );
        return;
      }
    }

    // No hovered port — place at viewport centre.
    const center = getViewportCenterClientPoint();
    if (center) {
      const world = frontend.clientToWorldPoint(center.x, center.y);
      const node = frontend.createNodeAt(world.x, world.y, { brickId });
      frontend.setCanvasMessage(`Node ${node.id} (${node.brickName}) created.`);
    }
  }

  function createNodeAtContextTarget(brickId = null) {
    const ui = frontend.getUiState();
    const node = frontend.createNodeAt(
      ui.canvasContextTarget.x,
      ui.canvasContextTarget.y,
      brickId ? { brickId } : {},
    );

    frontend.setCanvasMessage(
      `Node ${node.id} (${node.brickName}) created at (${Math.round(node.x)}, ${Math.round(node.y)}).`,
    );
  }

  function getPortElement(nodeId, slotId) {
    return dom.nodeContainer.querySelector(
      `.node-port[data-node-id="${nodeId}"][data-slot-id="${slotId}"]`,
    );
  }

  function setHoveredPort(portReference) {
    frontend.getUiState().hoveredPort = portReference
      ? { nodeId: portReference.nodeId, slotId: portReference.slotId }
      : null;
  }

  function updateHoveredPortFromTarget(target) {
    if (!(target instanceof Element)) {
      setHoveredPort(null);
      return;
    }

    const portElement = target.closest(".node-port");
    if (!portElement) {
      setHoveredPort(null);
      return;
    }

    setHoveredPort({
      nodeId: Number(portElement.dataset.nodeId),
      slotId: Number(portElement.dataset.slotId),
    });
  }

  function getPortCommandCatalog() {
    const groups = typeof frontend.getBrickTypeGroups === "function"
      ? frontend.getBrickTypeGroups()
      : [];

    return groups.flatMap((group) => group.options.map((option) => ({
      id: option.id,
      label: option.label,
      definition: option.definition,
      groupLabel: group.label,
    })));
  }

  function getPortCommandCandidates(query) {
    const normalizedQuery = normalizeNodeQueryValue(query);
    const catalog = getPortCommandCatalog();

    if (!normalizedQuery) {
      return catalog;
    }

    return catalog
      .filter((option) => matchesNodeQuery(option, normalizedQuery))
      .sort((left, right) => getNodeQueryMatchRank(left, normalizedQuery) - getNodeQueryMatchRank(right, normalizedQuery))
      .slice(0, PORT_COMMAND_RESULT_LIMIT);
  }

  function getSelectedPortCommandCandidate() {
    if (!activePortCommand?.candidates.length) {
      return null;
    }

    return activePortCommand.candidates[activePortCommand.selectedIndex] || null;
  }

  function renderPortCommandCandidates() {
    if (!dom.portCommandList) {
      return;
    }

    const candidates = activePortCommand?.candidates || [];
    if (!candidates.length) {
      dom.portCommandList.replaceChildren(buildContextMenuEmptyState("No matching nodes."));
      return;
    }

    dom.portCommandList.replaceChildren(
      ...candidates.map((candidate, index) => {
        const button = buildContextMenuButton(candidate.definition?.name || candidate.label, "port-command-option");
        const aliasText = Array.isArray(candidate.definition?.alias) && candidate.definition.alias.length
          ? candidate.definition.alias.join(", ")
          : "";
        const meta = [candidate.groupLabel, aliasText].filter(Boolean).join(" • ");

        button.dataset.candidateIndex = String(index);
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", index === activePortCommand.selectedIndex ? "true" : "false");
        if (index === activePortCommand.selectedIndex) {
          button.classList.add("is-selected");
        }
        button.innerHTML = meta
          ? `<span class="port-command-option-title">${candidate.definition?.name || candidate.label}</span><span class="port-command-option-meta">${meta}</span>`
          : `<span class="port-command-option-title">${candidate.definition?.name || candidate.label}</span>`;
        return button;
      }),
    );
  }

  function refreshPortCommandCandidates(options = {}) {
    if (!activePortCommand) {
      return;
    }

    const preserveSelection = Boolean(options.preserveSelection);
    const previousCandidateId = preserveSelection ? getSelectedPortCommandCandidate()?.id : null;
    activePortCommand.candidates = getPortCommandCandidates(dom.portCommandInput?.value || "");

    if (!activePortCommand.candidates.length) {
      activePortCommand.selectedIndex = 0;
      renderPortCommandCandidates();
      return;
    }

    if (previousCandidateId) {
      const nextIndex = activePortCommand.candidates.findIndex((candidate) => candidate.id === previousCandidateId);
      activePortCommand.selectedIndex = nextIndex >= 0 ? nextIndex : 0;
    } else {
      activePortCommand.selectedIndex = Math.min(
        activePortCommand.selectedIndex,
        activePortCommand.candidates.length - 1,
      );
    }

    renderPortCommandCandidates();
  }

  function positionPortCommandPanel(portReference) {
    if (!dom.portCommandPanel) {
      return;
    }

    const portElement = getPortElement(portReference.nodeId, portReference.slotId);
    const viewportRect = dom.canvasViewport?.getBoundingClientRect();
    if (!portElement || !viewportRect) {
      return;
    }

    const portRect = portElement.getBoundingClientRect();
    const panelWidth = dom.portCommandPanel.offsetWidth || 320;
    const panelHeight = dom.portCommandPanel.offsetHeight || 220;
    const preferredLeft = portRect.right - viewportRect.left + 12;
    const fallbackLeft = portRect.left - viewportRect.left - panelWidth - 12;
    const maxLeft = viewportRect.width - panelWidth - 8;
    const left = preferredLeft <= maxLeft ? preferredLeft : Math.max(8, fallbackLeft);
    const top = Math.min(
      Math.max(8, portRect.top - viewportRect.top),
      viewportRect.height - panelHeight - 8,
    );

    dom.portCommandPanel.style.left = `${left}px`;
    dom.portCommandPanel.style.top = `${top}px`;
  }

  function positionPortCommandPanelAtClientPoint(clientX, clientY) {
    if (!dom.portCommandPanel) {
      return;
    }

    const viewportRect = dom.canvasViewport?.getBoundingClientRect();
    if (!viewportRect) {
      return;
    }

    const panelWidth = dom.portCommandPanel.offsetWidth || 320;
    const panelHeight = dom.portCommandPanel.offsetHeight || 220;
    // Anchor the panel's top‑left corner at the cursor, clamped to viewport.
    const left = Math.min(
      Math.max(0, clientX - viewportRect.left),
      viewportRect.width - panelWidth,
    );
    const top = Math.min(
      Math.max(0, clientY - viewportRect.top),
      viewportRect.height - panelHeight,
    );

    dom.portCommandPanel.style.left = `${left}px`;
    dom.portCommandPanel.style.top = `${top}px`;
  }

  function schedulePortCommandEdgeRefresh(nodeId) {
    window.requestAnimationFrame(() => {
      frontend.renderEdges();

      const structureImage = dom.nodeContainer.querySelector(
        `.node-component[data-node-id="${nodeId}"] .node-image`,
      );

      if (!structureImage || structureImage.complete) {
        return;
      }

      structureImage.addEventListener("load", () => {
        frontend.renderEdges();
      }, { once: true });
    });
  }

  function closePortCommandPanel(options = {}) {
    if (!activePortCommand || !dom.portCommandPanel || !dom.portCommandInput || !dom.portCommandList) {
      activePortCommand = null;
      return;
    }

    activePortCommand = null;
    dom.portCommandPanel.hidden = true;
    dom.portCommandInput.value = "";
    dom.portCommandList.replaceChildren();
    if (options.restoreFocus) {
      dom.canvasViewport.focus?.();
    }
  }

  function createNodeFromPortCommand(candidate) {
    if (!candidate || !activePortCommand) {
      return false;
    }

    if (candidate.definition?.brick_type === "TEMPLATE") {
      const templateGraph = candidate.definition?.template_graph;

      if (!templateGraph) {
        frontend.setCanvasMessage("Template has no graph to paste.");
        closePortCommandPanel();
        return false;
      }

      try {
        const targetWorld = activePortCommand.targetWorld || undefined;
        const result = frontend.pasteSelectionSnapshot(
          templateGraph,
          targetWorld ? { atPoint: targetWorld } : {},
        );

        frontend.setCanvasMessage(
          `Template "${candidate.definition.name}" pasted (${result.nodeCount} nodes, ${result.edgeCount} edges).`,
        );
      } catch (_error) {
        frontend.setCanvasMessage("Failed to paste template graph.");
        closePortCommandPanel();
        return false;
      }

      closePortCommandPanel();
      return true;
    }

    const sourcePort = activePortCommand.sourcePort;

    if (!sourcePort) {
      const targetWorld = activePortCommand.targetWorld;
      if (!targetWorld) {
        closePortCommandPanel();
        return false;
      }

      const newNode = frontend.createNodeAt(targetWorld.x, targetWorld.y, { brickId: candidate.id });
      frontend.setCanvasMessage(
        `Node ${newNode.id} (${newNode.brickName}) created at (${Math.round(newNode.x)}, ${Math.round(newNode.y)}).`,
      );
      schedulePortCommandEdgeRefresh(newNode.id);
      closePortCommandPanel();
      return true;
    }

    const sourceNode = frontend.findNode(sourcePort.nodeId);
    const sourceSlot = frontend.findPortSlot(sourcePort.nodeId, sourcePort.slotId);
    if (!sourceNode || !sourceSlot) {
      frontend.setCanvasMessage("Port no longer exists.");
      closePortCommandPanel();
      return false;
    }

    const sourceSide = frontend.getEffectiveSlotSide(sourceNode, sourceSlot);
    const direction = sourceSide === "left" ? -1 : 1;
    const newNode = frontend.createNodeAt(
      sourceNode.x + direction * frontend.config.nodeSize.width * 0.7,
      sourceNode.y,
      { brickId: candidate.id },
    );

    const desiredSides = sourceSide === "left"
      ? ["right", null]
      : sourceSide === "right"
        ? ["left", null]
        : [null, "left", "right"];
    const newSlot = desiredSides
      .map((desiredSide) => newNode.portSlots.find((slot) => frontend.getEffectiveSlotSide(newNode, slot) === desiredSide))
      .find(Boolean) || newNode.portSlots[0] || null;
    let connectMessage = "";

    if (sourceSlot.edgeId !== null) {
      connectMessage = " Port already occupied; new node left unconnected.";
    } else if (!newSlot) {
      connectMessage = " No compatible port found on the new node.";
    } else {
      const result = sourceSide === "left"
        ? frontend.createEdgeBetweenPorts(
          { nodeId: newNode.id, slotId: newSlot.id },
          { nodeId: sourceNode.id, slotId: sourceSlot.id },
        )
        : frontend.createEdgeBetweenPorts(
          { nodeId: sourceNode.id, slotId: sourceSlot.id },
          { nodeId: newNode.id, slotId: newSlot.id },
        );

      if (!result.success) {
        connectMessage = ` ${result.message}`;
      }
    }

    frontend.setCanvasMessage(
      `Node ${newNode.id} (${newNode.brickName}) created from port ${sourceNode.id}:${sourceSlot.id}.${connectMessage}`,
    );
    schedulePortCommandEdgeRefresh(newNode.id);
    closePortCommandPanel();
    return true;
  }

  function openPortCommandPanel(portReference) {
    if (!portReference || !dom.portCommandPanel || !dom.portCommandInput) {
      return false;
    }

    frontend.closeAllContextMenus();
    activePortCommand = {
      sourcePort: { ...portReference },
      candidates: [],
      selectedIndex: 0,
    };
    dom.portCommandPanel.hidden = false;
    positionPortCommandPanel(portReference);
    dom.portCommandInput.value = "";
    refreshPortCommandCandidates();
    dom.portCommandInput.focus();
    dom.portCommandInput.select();
    frontend.setCanvasMessage(`Port command opened for node ${portReference.nodeId}, slot ${portReference.slotId}.`);
    return true;
  }

  function openCanvasNodeCommandPanel() {
    if (!dom.portCommandPanel || !dom.portCommandInput) {
      return false;
    }

    // Use the last known pointer position so the panel and the created node
    // are aligned to the mouse cursor.
    const clientX = lastPointerClientX;
    const clientY = lastPointerClientY;

    frontend.closeAllContextMenus();
    activePortCommand = {
      sourcePort: null,
      targetWorld: frontend.clientToWorldPoint(clientX, clientY),
      candidates: [],
      selectedIndex: 0,
    };
    dom.portCommandPanel.hidden = false;
    positionPortCommandPanelAtClientPoint(clientX, clientY);
    dom.portCommandInput.value = "";
    refreshPortCommandCandidates();
    dom.portCommandInput.focus();
    dom.portCommandInput.select();
    frontend.setCanvasMessage("Canvas node command opened.");
    return true;
  }

  function movePortCommandSelection(direction) {
    if (!activePortCommand?.candidates.length) {
      return;
    }

    const candidateCount = activePortCommand.candidates.length;
    activePortCommand.selectedIndex = (activePortCommand.selectedIndex + direction + candidateCount) % candidateCount;
    renderPortCommandCandidates();
  }

  function buildContextMenuButton(label, className = "context-menu-item") {
    const button = document.createElement("button");

    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.setAttribute("role", "menuitem");
    return button;
  }

  function buildContextMenuEmptyState(message) {
    const element = document.createElement("p");

    element.className = "context-menu-empty-state";
    element.textContent = message;
    return element;
  }

  function normalizeNodeQueryValue(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getNodeQueryMatchRank(option, normalizedQuery) {
    const exactMatchTerms = [
      option.definition?.name,
      ...(Array.isArray(option.definition?.alias) ? option.definition.alias : []),
    ];

    return exactMatchTerms.some((term) => String(term || "").trim().toLowerCase() === normalizedQuery) ? 0 : 1;
  }

  function matchesNodeQuery(option, normalizedQuery) {
    const searchTerms = [
      option.label,
      option.id,
      option.definition?.name,
      option.definition?.brick_type,
      ...(Array.isArray(option.definition?.alias) ? option.definition.alias : []),
    ];

    return searchTerms.some((term) => String(term || "").toLowerCase().includes(normalizedQuery));
  }

  function closePortalDescendants(portal) {
    portal.querySelectorAll(".context-menu-portal.is-open").forEach((nestedPortal) => {
      nestedPortal.classList.remove("is-open");
      const trigger = nestedPortal.querySelector(":scope > .context-menu-portal-trigger");
      trigger?.setAttribute("aria-expanded", "false");
    });
  }

  function closePortal(portal) {
    if (!portal?.classList.contains("is-open")) {
      return;
    }

    closePortalDescendants(portal);
    portal.classList.remove("is-open");
    const trigger = portal.querySelector(":scope > .context-menu-portal-trigger");
    trigger?.setAttribute("aria-expanded", "false");
  }

  function closeSiblingPortals(portal) {
    const parent = portal?.parentElement;

    if (!parent) {
      return;
    }

    [...parent.children]
      .filter((element) => element !== portal && element.classList?.contains("context-menu-portal"))
      .forEach((siblingPortal) => {
        closePortal(siblingPortal);
      });
  }

  function openPortal(portal) {
    if (!portal) {
      return;
    }

    closeSiblingPortals(portal);
    portal.classList.add("is-open");
    const trigger = portal.querySelector(":scope > .context-menu-portal-trigger");
    trigger?.setAttribute("aria-expanded", "true");
  }

  function resetContextMenuPortals(menuRoot) {
    menuRoot?.querySelectorAll(".context-menu-portal.is-open").forEach((portal) => {
      closePortal(portal);
    });
  }

  function registerContextMenuPortal(portal) {
    if (!portal || portal.dataset.portalBound === "true") {
      return;
    }

    portal.dataset.portalBound = "true";

    portal.addEventListener("pointerenter", () => {
      openPortal(portal);
    });

    portal.addEventListener("pointerleave", () => {
      closePortal(portal);
    });

    portal.addEventListener("focusin", () => {
      openPortal(portal);
    });

    portal.addEventListener("focusout", (event) => {
      if (portal.contains(event.relatedTarget)) {
        return;
      }

      closePortal(portal);
    });
  }

  function registerContextMenuPortals(menuRoot) {
    menuRoot?.querySelectorAll(".context-menu-portal").forEach((portal) => {
      registerContextMenuPortal(portal);
    });
  }

  function getSelectedCanvasNodeCandidate() {
    if (!activeCanvasNodeMenu?.candidates.length) {
      return null;
    }

    return activeCanvasNodeMenu.candidates[activeCanvasNodeMenu.selectedIndex] || null;
  }

  function createSelectedCanvasNodeCandidate() {
    const candidate = getSelectedCanvasNodeCandidate();

    if (!candidate) {
      return false;
    }

    createNodeAtContextTarget(candidate.id);
    frontend.closeAllContextMenus();
    return true;
  }

  function renderCanvasNodeMenuCandidates(query = "", options = {}) {
    const nodeList = dom.canvasNodeCategoryMenu?.querySelector(".context-portal-menu-list");

    if (!nodeList) {
      return;
    }

    if (!activeCanvasNodeMenu) {
      activeCanvasNodeMenu = {
        candidates: [],
        selectedIndex: 0,
      };
    }

    const preserveSelection = Boolean(options.preserveSelection);
    const previousCandidateId = preserveSelection ? getSelectedCanvasNodeCandidate()?.id : null;

    activeCanvasNodeMenu.candidates = getPortCommandCandidates(query);
    if (!activeCanvasNodeMenu.candidates.length) {
      activeCanvasNodeMenu.selectedIndex = 0;
      nodeList.replaceChildren(buildContextMenuEmptyState("No matching nodes."));
      return;
    }

    if (previousCandidateId) {
      const nextIndex = activeCanvasNodeMenu.candidates.findIndex((candidate) => candidate.id === previousCandidateId);
      activeCanvasNodeMenu.selectedIndex = nextIndex >= 0 ? nextIndex : 0;
    } else {
      activeCanvasNodeMenu.selectedIndex = Math.min(
        activeCanvasNodeMenu.selectedIndex,
        activeCanvasNodeMenu.candidates.length - 1,
      );
    }

    nodeList.replaceChildren(
      ...activeCanvasNodeMenu.candidates.map((candidate, index) => {
          const button = document.createElement("button");
          const aliasText = Array.isArray(candidate.definition?.alias) && candidate.definition.alias.length
            ? candidate.definition.alias.join(", ")
            : "";
          const meta = [candidate.groupLabel, aliasText].filter(Boolean).join(" • ");

          button.type = "button";
          button.className = "port-command-option context-portal-entry";
          button.dataset.candidateIndex = String(index);
          button.dataset.brickId = candidate.id;
          button.setAttribute("role", "option");
          button.setAttribute("aria-selected", index === activeCanvasNodeMenu.selectedIndex ? "true" : "false");
          if (index === activeCanvasNodeMenu.selectedIndex) {
            button.classList.add("is-selected");
          }
          button.innerHTML = meta
            ? `<span class="port-command-option-title">${candidate.definition?.name || candidate.label}</span><span class="port-command-option-meta">${meta}</span>`
            : `<span class="port-command-option-title">${candidate.definition?.name || candidate.label}</span>`;
          return button;
      }),
    );

    nodeList
      .querySelector(`[data-candidate-index="${activeCanvasNodeMenu.selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function moveCanvasNodeMenuSelection(direction) {
    if (!activeCanvasNodeMenu?.candidates.length) {
      return;
    }

    const candidateCount = activeCanvasNodeMenu.candidates.length;
    activeCanvasNodeMenu.selectedIndex = (
      activeCanvasNodeMenu.selectedIndex + direction + candidateCount
    ) % candidateCount;
    renderCanvasNodeMenuCandidates(
      dom.canvasNodeCategoryMenu?.querySelector(".context-portal-query-input")?.value || "",
      { preserveSelection: true },
    );
  }

  function renderCanvasNodeCategoryMenu() {
    if (!dom.canvasNodeCategoryMenu) {
      return;
    }

    const queryWrap = document.createElement("div");
    const queryLabel = document.createElement("label");
    const queryInput = document.createElement("input");
    const nodeList = document.createElement("div");

    queryWrap.className = "context-portal-query";
    queryLabel.className = "context-portal-query-label";
    queryLabel.textContent = "Query nodes";

    queryInput.className = "context-portal-query-input";
    queryInput.type = "search";
    queryInput.placeholder = "Search nodes by name or alias";
    queryInput.autocomplete = "off";
    queryInput.spellcheck = false;
    queryInput.setAttribute("aria-label", "Canvas node query");

    nodeList.className = "context-portal-menu-list";

    queryLabel.appendChild(queryInput);
    queryWrap.appendChild(queryLabel);
    dom.canvasNodeCategoryMenu.replaceChildren(queryWrap, nodeList);
    activeCanvasNodeMenu = {
      candidates: [],
      selectedIndex: 0,
    };
    renderCanvasNodeMenuCandidates();
  }

  function prepareCanvasContextMenu() {
    renderCanvasNodeCategoryMenu();
    resetContextMenuPortals(dom.canvasContextMenu);
  }

  const contextMenuActionRegistry = {
    canvas: {
      center: resetCanvasTranslation,
      reset: resetCanvasTranslation,
      close: () => {},
    },
    node: {
      delete: () => {
        const { activeNodeContextId } = frontend.getUiState();

        if (activeNodeContextId === null) {
          return;
        }

        frontend.deleteNode(activeNodeContextId);
        frontend.setCanvasMessage(`Node ${activeNodeContextId} deleted.`);
      },
      close: () => {},
    },
    edge: {
      delete: () => {
        const { activeEdgeContextId } = frontend.getUiState();

        if (activeEdgeContextId === null) {
          return;
        }

        frontend.deleteEdge(activeEdgeContextId);
        frontend.setCanvasMessage(`Edge ${activeEdgeContextId} deleted.`);
      },
      close: () => {},
    },
  };

  const contextMenuCloseRegistry = {
    canvas: frontend.closeCanvasContextMenu,
    node: frontend.closeNodeContextMenu,
    edge: frontend.closeEdgeContextMenu,
  };

  function executeContextMenuAction(menuType, actionKey) {
    const actionHandler = contextMenuActionRegistry[menuType]?.[actionKey];

    if (typeof actionHandler === "function") {
      actionHandler();
    }

    contextMenuCloseRegistry[menuType]?.();
  }

  function bindContextMenuActionItems(items, menuType) {
    items.forEach((item) => {
      item.addEventListener("click", () => {
        executeContextMenuAction(menuType, item.dataset.action || "close");
      });
    });
  }

  function bindCanvasNodeMenuActions() {
    dom.canvasNodeCategoryMenu?.addEventListener("input", (event) => {
      const queryInput = event.target.closest(".context-portal-query-input");

      if (!queryInput) {
        return;
      }

      activeCanvasNodeMenu = {
        candidates: activeCanvasNodeMenu?.candidates || [],
        selectedIndex: 0,
      };
      renderCanvasNodeMenuCandidates(queryInput.value);
    });

    dom.canvasNodeCategoryMenu?.addEventListener("keydown", (event) => {
      const queryInput = event.target.closest(".context-portal-query-input");

      if (!queryInput) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveCanvasNodeMenuSelection(1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveCanvasNodeMenuSelection(-1);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        createSelectedCanvasNodeCandidate();
      }
    });

    dom.canvasNodeCategoryMenu?.addEventListener("mousedown", (event) => {
      if (!event.target.closest("[data-brick-id]")) {
        return;
      }

      // Keep the portal open long enough for the subsequent click handler to fire.
      event.preventDefault();
    });

    dom.canvasNodeCategoryMenu?.addEventListener("click", (event) => {
      const nodeEntry = event.target.closest("[data-brick-id]");

      if (!nodeEntry) {
        return;
      }

      if (activeCanvasNodeMenu) {
        activeCanvasNodeMenu.selectedIndex = Number(nodeEntry.dataset.candidateIndex || 0);
      }
      createSelectedCanvasNodeCandidate();
    });
  }

  function bindPortCommandEvents() {
    dom.portCommandInput?.addEventListener("input", () => {
      if (activePortCommand) {
        activePortCommand.selectedIndex = 0;
      }
      refreshPortCommandCandidates();
    });

    dom.portCommandInput?.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        movePortCommandSelection(1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        movePortCommandSelection(-1);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        createNodeFromPortCommand(getSelectedPortCommandCandidate());
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closePortCommandPanel({ restoreFocus: true });
      }
    });

    dom.portCommandList?.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    dom.portCommandList?.addEventListener("click", (event) => {
      const option = event.target.closest("[data-candidate-index]");
      if (!option || !activePortCommand) {
        return;
      }

      activePortCommand.selectedIndex = Number(option.dataset.candidateIndex);
      renderPortCommandCandidates();
      createNodeFromPortCommand(getSelectedPortCommandCandidate());
    });

    document.addEventListener("pointerdown", (event) => {
      if (!activePortCommand || dom.portCommandPanel?.contains(event.target)) {
        return;
      }

      closePortCommandPanel();
    });
  }

  function cancelActiveInteraction() {
    const interaction = frontend.getUiState().componentInteraction;

    if (!interaction) {
      return false;
    }

    releaseInteractionPointerCapture(interaction.pointerId);
    setInteractionGuard(false);
    interactionModeRegistry[interaction.type]?.cancel?.(interaction);

    if (frontend.getUiState().componentInteraction === interaction) {
      clearComponentInteraction(interaction);
      frontend.renderNodes();
    }

    return true;
  }

  function endComponentInteraction(event) {
    const ui = frontend.getUiState();
    if (!ui.componentInteraction || event.pointerId !== ui.componentInteraction.pointerId) {
      return;
    }

    const interaction = ui.componentInteraction;
    const interactionHandler = interactionModeRegistry[interaction.type];

    setInteractionGuard(false);
    releaseInteractionPointerCapture(event.pointerId);
    interactionHandler?.end?.(event, interaction);

    if (frontend.getUiState().componentInteraction === interaction) {
      clearComponentInteraction(interaction);
    }
  }

  function bindMenuEvents() {
    let resizeFrameId = null;

    function openTopMenu(button) {
      const ui = frontend.getUiState();
      const menuKey = button.dataset.menu || "file";

      dom.menuButtons.forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      ui.activeMenuKey = menuKey;
      frontend.renderSubmenu(menuKey, button);
      dom.submenuDropdown.classList.add("is-open");
    }

    function closeTopMenu() {
      const ui = frontend.getUiState();

      dom.submenuDropdown.classList.remove("is-open");
      dom.menuButtons.forEach((item) => item.classList.remove("is-active"));
      ui.activeMenuKey = null;
    }

    function refreshLayoutAfterResize() {
      if (resizeFrameId !== null) {
        window.cancelAnimationFrame(resizeFrameId);
      }

      resizeFrameId = window.requestAnimationFrame(() => {
        resizeFrameId = null;
        frontend.renderEdges();
      });
    }

    dom.menuButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const ui = frontend.getUiState();
        const menuKey = button.dataset.menu || "file";
        const isSameMenu = ui.activeMenuKey === menuKey;
        const isOpen = dom.submenuDropdown.classList.contains("is-open");

        if (isSameMenu && isOpen) {
          closeTopMenu();
          return;
        }

        openTopMenu(button);
      });

      button.addEventListener("pointerenter", (event) => {
        const relatedTarget = event.relatedTarget;
        const fromMenuSurface = relatedTarget instanceof Element
          && Boolean(relatedTarget.closest(".submenu-dropdown, .menu-button"));

        if (!dom.submenuDropdown.classList.contains("is-open") && !fromMenuSurface) {
          return;
        }

        openTopMenu(button);
      });
    });

    dom.submenuDropdown.addEventListener("pointerleave", (event) => {
      const relatedTarget = event.relatedTarget;

      if (relatedTarget instanceof Element && relatedTarget.closest(".menu-button, .submenu-dropdown")) {
        return;
      }

      closeTopMenu();
    });

    document.addEventListener("click", (event) => {
      if (!dom.submenuDropdown.contains(event.target) && !event.target.closest(".menu-button")) {
        closeTopMenu();
      }

      if (!dom.canvasContextMenu.contains(event.target) && !dom.nodeContextMenu.contains(event.target)) {
        frontend.closeAllContextMenus();
      }
    });

    window.addEventListener("resize", () => {
      const { activeMenuKey } = frontend.getUiState();
      const activeButton = document.querySelector(`.menu-button[data-menu="${activeMenuKey}"]`);
      if (activeButton) {
        frontend.positionDropdown(activeButton);
      }
      frontend.closeAllContextMenus();
      refreshLayoutAfterResize();
    });

    window.visualViewport?.addEventListener("resize", refreshLayoutAfterResize);
  }

  function bindKeyboardShortcuts() {
    // ── Register named action handlers ────────────────────────────────────
    frontend.registerShortcutAction("selectAll", (event) => {
      if (selectAllGraphItems()) {
        frontend.setCanvasMessage("All nodes and edges selected.");
      }
      event.preventDefault();
    });

    frontend.registerShortcutAction("copySelection", (event) => {
      event.preventDefault();
      void frontend.copySelection()
        .then((result) => {
          if (!result.copied) {
            frontend.setCanvasMessage("Select nodes or edges to copy.");
            return;
          }
          frontend.setCanvasMessage(`Copied ${result.nodeCount} node(s) and ${result.edgeCount} edge(s).`);
        })
        .catch(() => { frontend.setCanvasMessage("Copy failed."); });
    });

    frontend.registerShortcutAction("pasteSelection", (event) => {
      event.preventDefault();
      void frontend.pasteSelection()
        .then((result) => {
          frontend.setCanvasMessage(`Pasted ${result.nodeCount} node(s) and ${result.edgeCount} edge(s).`);
        })
        .catch((error) => {
          frontend.setCanvasMessage(error instanceof Error ? error.message : "Paste failed.");
        });
    });

    frontend.registerShortcutAction("undo", (event) => {
      event.preventDefault();
      frontend.setCanvasMessage(frontend.undo() ? "Undo applied." : "Nothing to undo.");
    });

    frontend.registerShortcutAction("redo", (event) => {
      event.preventDefault();
      frontend.setCanvasMessage(frontend.redo() ? "Redo applied." : "Nothing to redo.");
    });

    frontend.registerShortcutAction("deleteSelected", (event) => {
      if (deleteSelectedGraphItems()) {
        event.preventDefault();
      }
    });

    frontend.registerShortcutAction("openPortCommand", (event) => {
      if (frontend.getUiState().componentInteraction || frontend.getUiState().canvasPanState) {
        return;
      }
      if (openPortCommandPanel(frontend.getUiState().hoveredPort)) {
        event.preventDefault();
      }
    });

    frontend.registerShortcutAction("openCanvasNodeCommand", (event) => {
      if (frontend.getUiState().componentInteraction || frontend.getUiState().canvasPanState) {
        return;
      }
      if (openCanvasNodeCommandPanel()) {
        event.preventDefault();
      }
    });

    frontend.registerShortcutAction("copySmiles", (event) => {
      event.preventDefault();
      void frontend.copyGraphAsSmiles()
        .then(() => { frontend.setCanvasMessage("Copied graph as SMILES."); })
        .catch((error) => {
          frontend.setCanvasMessage(error instanceof Error ? error.message : "SMILES export failed.");
        });
    });

    frontend.registerShortcutAction("createNode", (event, brickId) => {
      event.preventDefault();
      createNodeFromPort(String(brickId));
    });

    // ── Load shortcut definitions from the external config ────────────────
    fetch("./shortcuts.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load shortcuts.json (${response.status})`);
        }
        return response.json();
      })
      .then((config) => { frontend.loadShortcutConfig(config); })
      .catch((error) => {
        console.warn("[canvas] Could not load shortcut config:", error);
      });

    // ── Space (stateful hold — not suitable for pure registry dispatch) ──
    document.addEventListener("keydown", (event) => {
      if (frontend.shouldIgnoreKeyboardShortcut(event.target)) {
        return;
      }
      if (!frontend.dispatchShortcut(event) && event.code === "Space") {
        frontend.getUiState().isSpacePressed = true;
        syncPanShortcutState();
      }
    });

    document.addEventListener("keyup", (event) => {
      // Always release the space lock, even when focus moved to an input.
      if (event.code === "Space") {
        frontend.getUiState().isSpacePressed = false;
        syncPanShortcutState();
        return;
      }
      if (frontend.shouldIgnoreKeyboardShortcut(event.target)) {
        return;
      }
    });

    window.addEventListener("blur", () => {
      const ui = frontend.getUiState();
      ui.isSpacePressed = false;
      closePortCommandPanel();
      cancelCanvasPan();
      cancelActiveInteraction();
      syncPanShortcutState();
    });
  }

  function bindViewportEvents() {
    dom.canvasZoomInButton?.addEventListener("click", () => {
      handleZoomButtonClick(1);
    });

    dom.canvasZoomOutButton?.addEventListener("click", () => {
      handleZoomButtonClick(-1);
    });

    dom.canvasZoomResetButton?.addEventListener("click", () => {
      resetCanvasZoomAtViewportCenter();
    });

    dom.canvasViewport.addEventListener("wheel", handleCanvasWheel, { passive: false });

    dom.canvasViewport.addEventListener("pointerdown", (event) => {
      const ui = frontend.getUiState();
      if (
        ui.isSpacePressed
        || event.target.closest(".canvas-zoom-controls")
        || dom.canvasContextMenu.contains(event.target)
        || dom.portCommandPanel?.contains(event.target)
        || dom.nodeContextMenu.contains(event.target)
        || dom.edgeContextMenu.contains(event.target)
      ) {
        return;
      }

      const edgeId = frontend.findEdgeAtClientPoint(event.clientX, event.clientY);

      if (event.button === 2) {
        event.preventDefault();
        cancelCanvasPan();
        setInteractionGuard(false);
        frontend.hideSelectionBox();
        ui.componentInteraction = null;

        if (edgeId !== null) {
          frontend.selectOnlyEdge(edgeId);
          frontend.openEdgeContextMenu(event.clientX, event.clientY, edgeId);
          frontend.setCanvasMessage(`Edge ${edgeId} context menu opened.`);
          return;
        }

        const nodeElement = event.target.closest(".node-component");
        if (nodeElement) {
          const nodeId = Number(nodeElement.dataset.nodeId);
          frontend.selectOnlyNode(nodeId);
          frontend.openNodeContextMenu(event.clientX, event.clientY, nodeId);
          frontend.setCanvasMessage(`Node ${nodeId} context menu opened.`);
          return;
        }

        frontend.openCanvasContextMenu(event.clientX, event.clientY);
        frontend.setCanvasMessage("Canvas context menu opened.");
        return;
      }

      if (event.button !== 0) {
        return;
      }

      frontend.closeAllContextMenus();
      const portElement = event.target.closest(".node-port");
      const nodeElement = event.target.closest(".node-selection-surface");

      if (portElement) {
        const nodeId = Number(portElement.dataset.nodeId);
        const slotId = Number(portElement.dataset.slotId);
        frontend.selectOnlyNode(nodeId);
        event.preventDefault();
        setInteractionGuard(true);
        frontend.beginEdgeDrag(event, nodeId, slotId);
        return;
      }

      if (edgeId !== null) {
        event.preventDefault();
        if (event.shiftKey) {
          const isSelected = frontend.toggleEdgeSelection(edgeId);
          frontend.setCanvasMessage(`Edge ${edgeId} ${isSelected ? "selected" : "deselected"}.`);
          return;
        }

        setInteractionGuard(true);
        frontend.beginEdgeRetarget(event, edgeId);
        return;
      }

      if (nodeElement) {
        const nodeId = Number(nodeElement.dataset.nodeId);
        event.preventDefault();
        if (event.shiftKey) {
          const isSelected = frontend.toggleNodeSelection(nodeId);
          frontend.setCanvasMessage(`Node ${nodeId} ${isSelected ? "selected" : "deselected"}.`);
          return;
        }

        frontend.selectOnlyNode(nodeId);
        beginNodeDrag(event, nodeId);
        return;
      }

      if (!event.shiftKey) {
        frontend.clearSelection();
      }
      beginMarqueeSelection(event);
    });

    // Use document-level listeners for pointermove / pointerup so marquee
    // and drag interactions continue to work when the pointer moves outside
    // an iframe boundary.
    document.addEventListener("pointermove", (event) => {
      lastPointerClientX = event.clientX;
      lastPointerClientY = event.clientY;
      updateHoveredPortFromTarget(event.target);

      const ui = frontend.getUiState();
      if (!ui.componentInteraction || event.pointerId !== ui.componentInteraction.pointerId) {
        return;
      }

      const autoPanDelta = applyAutoPanForPointer(event.clientX, event.clientY);
      interactionModeRegistry[ui.componentInteraction.type]?.move?.(
        event,
        ui.componentInteraction,
        autoPanDelta,
      );
    });

    document.addEventListener("pointerup", endComponentInteraction);
    document.addEventListener("pointercancel", endComponentInteraction);
    dom.canvasViewport.addEventListener("pointerleave", () => {
      setHoveredPort(null);
    });
    dom.canvasViewport.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });
    dom.canvasViewport.addEventListener("dragstart", (event) => {
      if (event.target instanceof Element && event.target.closest(".node-selection-surface, .edge-layer")) {
        event.preventDefault();
      }
    });
    dom.canvasViewport.addEventListener("selectstart", (event) => {
      const ui = frontend.getUiState();
      if (
        ui.canvasPanState
        || ui.componentInteraction
        || (event.target instanceof Element && event.target.closest(".node-selection-surface, .edge-layer"))
      ) {
        event.preventDefault();
      }
    });

    bindContextMenuActionItems(dom.canvasContextItems, "canvas");
    bindContextMenuActionItems(dom.nodeContextItems, "node");
    bindContextMenuActionItems(dom.edgeContextItems, "edge");
    registerContextMenuPortals(dom.canvasContextMenu);
    bindCanvasNodeMenuActions();
    bindPortCommandEvents();
  }

  function bootstrap() {
    frontend.seedGraphState();
    frontend.renderSubmenu("file", document.querySelector('.menu-button[data-menu="file"]'));
    dom.submenuDropdown.classList.add("is-open");
    frontend.bindRenderLayer();
    frontend.renderNodes();
    frontend.notifyGraphChanged({ reason: "bootstrap" });
    frontend.applyViewportOffset();
    syncPanShortcutState();
    bindMenuEvents();
    bindKeyboardShortcuts();
    bindViewportEvents();
  }

  frontend.syncPanShortcutState = syncPanShortcutState;
  frontend.beginNodeDrag = beginNodeDrag;
  frontend.beginMarqueeSelection = beginMarqueeSelection;
  frontend.endComponentInteraction = endComponentInteraction;
  frontend.cancelCanvasPan = cancelCanvasPan;
  frontend.handleCanvasWheel = handleCanvasWheel;
  frontend.zoomCanvasFromViewportCenter = zoomCanvasFromViewportCenter;
  frontend.resetCanvasZoomAtViewportCenter = resetCanvasZoomAtViewportCenter;
  frontend.resetCanvasTranslation = resetCanvasTranslation;
  frontend.setEdgeDragSelectionState = setEdgeDragSelectionState;
  frontend.setInteractionGuard = setInteractionGuard;
  frontend.prepareCanvasContextMenu = prepareCanvasContextMenu;
  frontend.resetContextMenuPortals = resetContextMenuPortals;
  frontend.bootstrap = bootstrap;
})();
