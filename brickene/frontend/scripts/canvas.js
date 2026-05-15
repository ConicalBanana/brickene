(() => {
  const frontend = window.BrickeneFrontend;
  const { dom } = frontend;
  const AUTO_PAN_BOUNDARY_RATIO = 0.05;
  const AUTO_PAN_MAX_STEP = 28;

  function isPrimaryShortcutPressed(event) {
    return frontend.platform?.isMacOS ? event.metaKey : event.ctrlKey;
  }

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

  function shouldIgnoreKeyboardShortcut(target) {
    return target instanceof Element
      && Boolean(target.closest('input, select, textarea, [contenteditable="true"]'));
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

    frontend.getUiState().componentInteraction = {
      type: "node-drag",
      pointerId: event.pointerId,
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      pointerOffsetX: frontend.clientToWorldPoint(event.clientX, event.clientY).x - node.x,
      pointerOffsetY: frontend.clientToWorldPoint(event.clientX, event.clientY).y - node.y,
      moved: false,
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

    graph.nodes = graph.nodes.map((node) => (
      node.id === interaction.nodeId
        ? { ...node, x: nextX, y: nextY }
        : node
    ));
    interaction.moved = moved;
    frontend.renderNodes();
  }

  function endNodeDragInteraction(_event, interaction) {
    const movedNodeId = interaction.nodeId;
    const didMove = interaction.moved;

    clearComponentInteraction(interaction);
    frontend.renderNodes();
    if (didMove) {
      frontend.notifyGraphChanged({
        reason: "node-moved",
        nodeId: movedNodeId,
        refreshPreview: false,
      });
    }
    frontend.setCanvasMessage(didMove ? `Node ${movedNodeId} moved.` : `Node ${movedNodeId} selected.`);
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

  function createNodeAtContextTarget() {
    const ui = frontend.getUiState();
    const node = frontend.createNodeAt(ui.canvasContextTarget.x, ui.canvasContextTarget.y);

    frontend.setCanvasMessage(`Node ${node.id} created at (${Math.round(node.x)}, ${Math.round(node.y)}).`);
  }

  const contextMenuActionRegistry = {
    canvas: {
      center: resetCanvasTranslation,
      reset: resetCanvasTranslation,
      node: createNodeAtContextTarget,
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

        dom.menuButtons.forEach((item) => item.classList.remove("is-active"));
        button.classList.add("is-active");
        ui.activeMenuKey = menuKey;
        frontend.renderSubmenu(menuKey, button);

        if (isSameMenu && isOpen) {
          dom.submenuDropdown.classList.remove("is-open");
          return;
        }

        dom.submenuDropdown.classList.add("is-open");
      });
    });

    document.addEventListener("click", (event) => {
      if (!dom.submenuDropdown.contains(event.target) && !event.target.closest(".menu-button")) {
        dom.submenuDropdown.classList.remove("is-open");
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

  function bindKeyboardEvents() {
    document.addEventListener("keydown", (event) => {
      if (shouldIgnoreKeyboardShortcut(event.target)) {
        return;
      }

      if (isPrimaryShortcutPressed(event) && !event.altKey) {
        const lowerKey = event.key.toLowerCase();

        if (lowerKey === "a") {
          if (selectAllGraphItems()) {
            frontend.setCanvasMessage("All nodes and edges selected.");
          }
          event.preventDefault();
          return;
        }

        if (lowerKey === "c") {
          event.preventDefault();
          void frontend.copySelection()
            .then((result) => {
              if (!result.copied) {
                frontend.setCanvasMessage("Select nodes or edges to copy.");
                return;
              }

              frontend.setCanvasMessage(`Copied ${result.nodeCount} node(s) and ${result.edgeCount} edge(s).`);
            })
            .catch(() => {
              frontend.setCanvasMessage("Copy failed.");
            });
          return;
        }

        if (lowerKey === "v") {
          event.preventDefault();
          void frontend.pasteSelection()
            .then((result) => {
              frontend.setCanvasMessage(`Pasted ${result.nodeCount} node(s) and ${result.edgeCount} edge(s).`);
            })
            .catch((error) => {
              frontend.setCanvasMessage(error instanceof Error ? error.message : "Paste failed.");
            });
          return;
        }

        if (lowerKey === "z" && !event.shiftKey) {
          event.preventDefault();
          frontend.setCanvasMessage(frontend.undo() ? "Undo applied." : "Nothing to undo.");
          return;
        }

        if (lowerKey === "y" || (lowerKey === "z" && event.shiftKey)) {
          event.preventDefault();
          frontend.setCanvasMessage(frontend.redo() ? "Redo applied." : "Nothing to redo.");
          return;
        }
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (deleteSelectedGraphItems()) {
          event.preventDefault();
        }
        return;
      }

      if (event.code !== "Space") {
        return;
      }

      frontend.getUiState().isSpacePressed = true;
      syncPanShortcutState();
    });

    document.addEventListener("keyup", (event) => {
      if (shouldIgnoreKeyboardShortcut(event.target)) {
        return;
      }

      if (event.code !== "Space") {
        return;
      }

      frontend.getUiState().isSpacePressed = false;
      syncPanShortcutState();
    });

    window.addEventListener("blur", () => {
      const ui = frontend.getUiState();

      ui.isSpacePressed = false;
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

    dom.canvasViewport.addEventListener("wheel", handleCanvasWheel, { passive: false });

    dom.canvasViewport.addEventListener("pointerdown", (event) => {
      const ui = frontend.getUiState();
      if (
        ui.isSpacePressed
        || dom.canvasContextMenu.contains(event.target)
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
      const nodeElement = event.target.closest(".node-component");

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

    dom.canvasViewport.addEventListener("pointermove", (event) => {
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

    dom.canvasViewport.addEventListener("pointerup", endComponentInteraction);
    dom.canvasViewport.addEventListener("pointercancel", endComponentInteraction);
    dom.canvasViewport.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });
    dom.canvasViewport.addEventListener("dragstart", (event) => {
      if (event.target instanceof Element && event.target.closest(".node-component, .edge-layer")) {
        event.preventDefault();
      }
    });
    dom.canvasViewport.addEventListener("selectstart", (event) => {
      const ui = frontend.getUiState();
      if (
        ui.canvasPanState
        || ui.componentInteraction
        || (event.target instanceof Element && event.target.closest(".node-component, .edge-layer"))
      ) {
        event.preventDefault();
      }
    });

    bindContextMenuActionItems(dom.canvasContextItems, "canvas");
    bindContextMenuActionItems(dom.nodeContextItems, "node");
    bindContextMenuActionItems(dom.edgeContextItems, "edge");
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
    bindKeyboardEvents();
    bindViewportEvents();
  }

  frontend.syncPanShortcutState = syncPanShortcutState;
  frontend.beginNodeDrag = beginNodeDrag;
  frontend.beginMarqueeSelection = beginMarqueeSelection;
  frontend.endComponentInteraction = endComponentInteraction;
  frontend.cancelCanvasPan = cancelCanvasPan;
  frontend.handleCanvasWheel = handleCanvasWheel;
  frontend.setEdgeDragSelectionState = setEdgeDragSelectionState;
  frontend.setInteractionGuard = setInteractionGuard;
  frontend.bootstrap = bootstrap;
})();
