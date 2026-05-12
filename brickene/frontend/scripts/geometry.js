(() => {
  const frontend = window.BrickeneFrontend;
  const { dom } = frontend;

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
    const { canvasOffset } = frontend.getUiState();
    const transform = `translate(${canvasOffset.x}px, ${canvasOffset.y}px)`;

    dom.componentWorld.style.transform = transform;
    if (dom.canvasGrid) {
      dom.canvasGrid.style.backgroundPosition = `${canvasOffset.x}px ${canvasOffset.y}px`;
    }
    dom.canvasLayer.style.setProperty("--canvas-offset-x", `${canvasOffset.x}px`);
    dom.canvasLayer.style.setProperty("--canvas-offset-y", `${canvasOffset.y}px`);
  }

  function clientToWorldPoint(clientX, clientY) {
    const rect = dom.componentLayer.getBoundingClientRect();
    const { canvasOffset } = frontend.getUiState();

    return {
      x: clientX - rect.left - canvasOffset.x,
      y: clientY - rect.top - canvasOffset.y,
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

  function updateSelectionFromRect(localRect) {
    const { canvasOffset } = frontend.getUiState();
    const { nodes } = frontend.getGraphState();
    const worldRect = {
      left: localRect.left - canvasOffset.x,
      top: localRect.top - canvasOffset.y,
      right: localRect.right - canvasOffset.x,
      bottom: localRect.bottom - canvasOffset.y,
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
          nodeLeft >= worldRect.left
          && nodeTop >= worldRect.top
          && nodeRight <= worldRect.right
          && nodeBottom <= worldRect.bottom
        );
      })
      .map((node) => node.id);

    frontend.setSelectedNodes(nextSelection);
  }

  frontend.positionFloatingMenu = positionFloatingMenu;
  frontend.applyViewportOffset = applyViewportOffset;
  frontend.clientToWorldPoint = clientToWorldPoint;
  frontend.clientToLayerPoint = clientToLayerPoint;
  frontend.normalizeRect = normalizeRect;
  frontend.showSelectionBox = showSelectionBox;
  frontend.hideSelectionBox = hideSelectionBox;
  frontend.updateSelectionFromRect = updateSelectionFromRect;
})();
