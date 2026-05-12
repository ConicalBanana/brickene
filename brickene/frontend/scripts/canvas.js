(() => {
  const frontend = window.BrickeneFrontend;
  const { dom } = frontend;

  function shouldIgnoreKeyboardShortcut(target) {
    return target instanceof Element
      && Boolean(target.closest('input, select, textarea, [contenteditable="true"]'));
  }

  function deleteSelectedGraphItems() {
    const ui = frontend.getUiState();
    const selectedNodeIds = [...ui.selectedNodeIds];

    if (selectedNodeIds.length) {
      selectedNodeIds.forEach((nodeId) => {
        frontend.deleteNode(nodeId);
      });
      frontend.setCanvasMessage(`${selectedNodeIds.length} node(s) deleted.`);
      return true;
    }

    const deletedEdgeCount = frontend.deleteSelectedEdges();
    if (deletedEdgeCount > 0) {
      frontend.setCanvasMessage(`${deletedEdgeCount} edge(s) deleted.`);
      return true;
    }

    return false;
  }

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

  function handleCanvasWheel(event) {
    if (!(event.target instanceof Element) || shouldIgnoreWheelPan(event.target)) {
      return;
    }

    const ui = frontend.getUiState();
    if (ui.canvasPanState || ui.componentInteraction) {
      return;
    }

    if (event.ctrlKey) {
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
      originX: node.x,
      originY: node.y,
      moved: false,
    };
    event.preventDefault();
    dom.canvasViewport.setPointerCapture(event.pointerId);
    frontend.renderNodes();
  }

  function setEdgeDragSelectionState(isActive) {
    dom.canvasViewport.classList.toggle("is-edge-dragging", isActive);
  }

  function beginMarqueeSelection(event) {
    const point = frontend.clientToLayerPoint(event.clientX, event.clientY);

    frontend.getUiState().componentInteraction = {
      type: "marquee",
      pointerId: event.pointerId,
      startPoint: point,
      endPoint: point,
      moved: false,
    };
    event.preventDefault();
    frontend.showSelectionBox(frontend.normalizeRect(point, point));
    dom.canvasViewport.setPointerCapture(event.pointerId);
  }

  function endComponentInteraction(event) {
    const ui = frontend.getUiState();
    if (!ui.componentInteraction || event.pointerId !== ui.componentInteraction.pointerId) {
      return;
    }

    if (ui.componentInteraction.type === "edge-drag") {
      if (dom.canvasViewport.hasPointerCapture(event.pointerId)) {
        dom.canvasViewport.releasePointerCapture(event.pointerId);
      }

      const interaction = ui.componentInteraction;
      setEdgeDragSelectionState(false);
      ui.componentInteraction = null;
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
      return;
    }

    if (dom.canvasViewport.hasPointerCapture(event.pointerId)) {
      dom.canvasViewport.releasePointerCapture(event.pointerId);
    }

    if (ui.componentInteraction.type === "marquee") {
      frontend.hideSelectionBox();
      if (!ui.componentInteraction.moved) {
        frontend.clearSelection();
        frontend.setCanvasMessage("Selection cleared.");
      } else {
        frontend.setCanvasMessage(`${ui.selectedNodeIds.size} node(s) selected.`);
      }
    }

    if (ui.componentInteraction.type === "node-drag") {
      const movedNodeId = ui.componentInteraction.nodeId;
      const didMove = ui.componentInteraction.moved;
      ui.componentInteraction = null;
      frontend.renderNodes();
      if (didMove) {
        frontend.notifyGraphChanged({ reason: "node-moved", nodeId: movedNodeId });
      }
      frontend.setCanvasMessage(didMove ? `Node ${movedNodeId} moved.` : `Node ${movedNodeId} selected.`);
      return;
    }

    ui.componentInteraction = null;
  }

  function bindMenuEvents() {
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
    });
  }

  function bindKeyboardEvents() {
    document.addEventListener("keydown", (event) => {
      if (shouldIgnoreKeyboardShortcut(event.target)) {
        return;
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
      setEdgeDragSelectionState(false);
      ui.componentInteraction = null;
      frontend.hideSelectionBox();
      frontend.renderNodes();
      syncPanShortcutState();
    });
  }

  function bindViewportEvents() {
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
        frontend.beginEdgeDrag(event, nodeId, slotId);
        return;
      }

      if (edgeId !== null) {
        frontend.selectOnlyEdge(edgeId);
        frontend.setCanvasMessage(`Edge ${edgeId} selected.`);
        return;
      }

      if (nodeElement) {
        const nodeId = Number(nodeElement.dataset.nodeId);
        frontend.selectOnlyNode(nodeId);
        beginNodeDrag(event, nodeId);
        return;
      }

      frontend.clearSelection();
      beginMarqueeSelection(event);
    });

    dom.canvasViewport.addEventListener("pointermove", (event) => {
      const ui = frontend.getUiState();
      if (!ui.componentInteraction || event.pointerId !== ui.componentInteraction.pointerId) {
        return;
      }

      if (ui.componentInteraction.type === "edge-drag") {
        ui.componentInteraction.pointerWorld = frontend.clientToWorldPoint(event.clientX, event.clientY);
        ui.componentInteraction.hoverPort = frontend.findHoveredPort(event.clientX, event.clientY);
        frontend.renderNodes();
        return;
      }

      if (ui.componentInteraction.type === "node-drag") {
        const graph = frontend.getGraphState();
        const nextX = ui.componentInteraction.originX + event.clientX - ui.componentInteraction.startX;
        const nextY = ui.componentInteraction.originY + event.clientY - ui.componentInteraction.startY;
        const moved = Math.abs(event.clientX - ui.componentInteraction.startX) > 2 || Math.abs(event.clientY - ui.componentInteraction.startY) > 2;

        graph.nodes = graph.nodes.map((node) => (
          node.id === ui.componentInteraction.nodeId
            ? { ...node, x: nextX, y: nextY }
            : node
        ));
        ui.componentInteraction.moved = moved;
        frontend.renderNodes();
        return;
      }

      if (ui.componentInteraction.type === "marquee") {
        const nextPoint = frontend.clientToLayerPoint(event.clientX, event.clientY);
        const rect = frontend.normalizeRect(ui.componentInteraction.startPoint, nextPoint);
        ui.componentInteraction.endPoint = nextPoint;
        ui.componentInteraction.moved = rect.right - rect.left > 2 || rect.bottom - rect.top > 2;
        frontend.showSelectionBox(rect);
        frontend.updateSelectionFromRect(rect);
      }
    });

    dom.canvasViewport.addEventListener("pointerup", endComponentInteraction);
    dom.canvasViewport.addEventListener("pointercancel", endComponentInteraction);
    dom.canvasViewport.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });

    dom.canvasContextItems.forEach((item) => {
      item.addEventListener("click", () => {
        const action = item.dataset.action;
        const ui = frontend.getUiState();

        if (action === "center" || action === "reset") {
          ui.canvasOffset = { x: 0, y: 0 };
          frontend.applyViewportOffset();
          frontend.setCanvasMessage("Canvas translation reset to origin.");
        } else if (action === "node") {
          const node = frontend.createNodeAt(ui.canvasContextTarget.x, ui.canvasContextTarget.y);
          frontend.setCanvasMessage(`Node ${node.id} created at (${Math.round(node.x)}, ${Math.round(node.y)}).`);
        }

        frontend.closeCanvasContextMenu();
      });
    });

    dom.nodeContextItems.forEach((item) => {
      item.addEventListener("click", () => {
        const action = item.dataset.action;
        const { activeNodeContextId } = frontend.getUiState();

        if (action === "delete" && activeNodeContextId !== null) {
          frontend.deleteNode(activeNodeContextId);
          frontend.setCanvasMessage(`Node ${activeNodeContextId} deleted.`);
        }

        frontend.closeNodeContextMenu();
      });
    });

    dom.edgeContextItems.forEach((item) => {
      item.addEventListener("click", () => {
        const action = item.dataset.action;
        const { activeEdgeContextId } = frontend.getUiState();

        if (action === "delete" && activeEdgeContextId !== null) {
          frontend.deleteEdge(activeEdgeContextId);
          frontend.setCanvasMessage(`Edge ${activeEdgeContextId} deleted.`);
        }

        frontend.closeEdgeContextMenu();
      });
    });
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
  frontend.bootstrap = bootstrap;
})();
