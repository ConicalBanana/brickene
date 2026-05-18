(() => {
  const frontend = window.BrickeneFrontend;
  const { dom } = frontend;
  const MIN_CANVAS_SCALE = 0.4;
  const MAX_CANVAS_SCALE = 2.5;
  const CANVAS_SCALE_STEP = 0.1;

  function positionFloatingMenu(menuElement, clientX, clientY) {
    const viewportRect = dom.canvasViewport.getBoundingClientRect();
    const menuWidth = menuElement.offsetWidth || 192;
    const menuHeight = menuElement.offsetHeight || 152;
    const left = Math.min(clientX - viewportRect.left, viewportRect.width - menuWidth - 8);
    const top = Math.min(clientY - viewportRect.top, viewportRect.height - menuHeight - 8);

    menuElement.style.left = `${Math.max(8, left)}px`;
    menuElement.style.top = `${Math.max(8, top)}px`;
  }

  function applyViewportOffset() {
    const { canvasOffset, canvasScale } = frontend.getUiState();
    const transform = `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${canvasScale})`;

    dom.componentWorld.style.transform = transform;
    if (dom.canvasGrid) {
      dom.canvasGrid.style.backgroundPosition = `${canvasOffset.x}px ${canvasOffset.y}px`;
      dom.canvasGrid.style.backgroundSize = `${24 * canvasScale}px ${24 * canvasScale}px`;
    }
    dom.canvasLayer.style.setProperty("--canvas-offset-x", `${canvasOffset.x}px`);
    dom.canvasLayer.style.setProperty("--canvas-offset-y", `${canvasOffset.y}px`);
    dom.canvasLayer.style.setProperty("--canvas-scale", String(canvasScale));
  }

  function clientToWorldPoint(clientX, clientY) {
    const rect = dom.componentLayer.getBoundingClientRect();
    const { canvasOffset, canvasScale } = frontend.getUiState();

    return {
      x: (clientX - rect.left - canvasOffset.x) / canvasScale,
      y: (clientY - rect.top - canvasOffset.y) / canvasScale,
    };
  }

  function clientToLayerPoint(clientX, clientY) {
    const rect = dom.componentLayer.getBoundingClientRect();

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  function normalizeRect(startPoint, endPoint) {
    return {
      left: Math.min(startPoint.x, endPoint.x),
      top: Math.min(startPoint.y, endPoint.y),
      right: Math.max(startPoint.x, endPoint.x),
      bottom: Math.max(startPoint.y, endPoint.y),
    };
  }

  function showSelectionBox(rect) {
    dom.selectionRect.style.left = `${rect.left}px`;
    dom.selectionRect.style.top = `${rect.top}px`;
    dom.selectionRect.style.width = `${rect.right - rect.left}px`;
    dom.selectionRect.style.height = `${rect.bottom - rect.top}px`;
    dom.selectionRect.classList.add("is-visible");
  }

  function hideSelectionBox() {
    dom.selectionRect.classList.remove("is-visible");
  }

  function updateSelectionFromRect(localRect, options = {}) {
    const { canvasOffset, canvasScale } = frontend.getUiState();
    const { nodes } = frontend.getGraphState();
    const preserveSelection = Boolean(options.preserveSelection);
    const baseNodeIds = Array.isArray(options.baseNodeIds) ? options.baseNodeIds : [];
    const worldRect = {
      left: (localRect.left - canvasOffset.x) / canvasScale,
      top: (localRect.top - canvasOffset.y) / canvasScale,
      right: (localRect.right - canvasOffset.x) / canvasScale,
      bottom: (localRect.bottom - canvasOffset.y) / canvasScale,
    };

    const nextSelection = nodes
      .filter((node) => {
        const nodeElement = dom.nodeContainer.querySelector(`[data-node-id="${node.id}"]`);
        if (!nodeElement) {
          return false;
        }

        const nodeLeft = nodeElement.offsetLeft;
        const nodeTop = nodeElement.offsetTop;
        const nodeRight = nodeLeft + nodeElement.offsetWidth;
        const nodeBottom = nodeTop + nodeElement.offsetHeight;

        return (
          nodeRight >= worldRect.left
          && nodeBottom >= worldRect.top
          && nodeLeft <= worldRect.right
          && nodeTop <= worldRect.bottom
        );
      })
      .map((node) => node.id);

    frontend.setSelectedNodes(
      preserveSelection ? [...new Set([...baseNodeIds, ...nextSelection])] : nextSelection,
      { preserveEdges: preserveSelection },
    );
  }

  function clampCanvasScale(scale) {
    return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, scale));
  }

  function setCanvasScale(nextScale, anchorClientX, anchorClientY) {
    const ui = frontend.getUiState();
    const clampedScale = clampCanvasScale(nextScale);

    if (clampedScale === ui.canvasScale) {
      return false;
    }

    const rect = dom.componentLayer.getBoundingClientRect();
    const anchorLayerX = anchorClientX - rect.left;
    const anchorLayerY = anchorClientY - rect.top;
    const worldX = (anchorLayerX - ui.canvasOffset.x) / ui.canvasScale;
    const worldY = (anchorLayerY - ui.canvasOffset.y) / ui.canvasScale;

    ui.canvasScale = clampedScale;
    ui.canvasOffset = {
      x: anchorLayerX - worldX * clampedScale,
      y: anchorLayerY - worldY * clampedScale,
    };

    applyViewportOffset();
    return true;
  }

  function zoomCanvasByDirection(direction, anchorClientX, anchorClientY) {
    const ui = frontend.getUiState();
    const factor = direction > 0 ? 1 + CANVAS_SCALE_STEP : 1 / (1 + CANVAS_SCALE_STEP);
    return setCanvasScale(ui.canvasScale * factor, anchorClientX, anchorClientY);
  }

  frontend.positionFloatingMenu = positionFloatingMenu;
  frontend.applyViewportOffset = applyViewportOffset;
  frontend.clientToWorldPoint = clientToWorldPoint;
  frontend.clientToLayerPoint = clientToLayerPoint;
  frontend.normalizeRect = normalizeRect;
  frontend.showSelectionBox = showSelectionBox;
  frontend.hideSelectionBox = hideSelectionBox;
  frontend.updateSelectionFromRect = updateSelectionFromRect;
  frontend.setCanvasScale = setCanvasScale;
  frontend.zoomCanvasByDirection = zoomCanvasByDirection;
})();
