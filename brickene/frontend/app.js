const submenuMap = {
  file: ["New", "Open", "Open recent", "Save"],
  edit: ["Undo", "Redo", "Copy", "Delete"],
  node: ["Create node", "Ports", "Edges", "Presets"],
  view: ["Center canvas", "Grid", "Legend", "Export"],
};

const stateMap = {
  file: "Menu commands are scaffolded for future integration.",
  edit: "Edit actions will target node and edge operations.",
  node: "Node controls will connect to the canvas layer later.",
  view: "View controls will tune the integral canvas workspace.",
};

const nodeSize = { width: 220, height: 152 };
const initialNodes = [
  {
    id: 1,
    title: "Node 1",
    subtitle: "Main branch",
    description: "Future text, ports, and interaction widgets can be mounted here.",
    x: 96,
    y: 88,
  },
  {
    id: 2,
    title: "Node 2",
    subtitle: "Side branch",
    description: "Node bodies already support selection, drag, and menu actions.",
    x: 388,
    y: 228,
  },
];

const submenuDropdown = document.getElementById("submenu-dropdown");
const submenuContent = document.getElementById("submenu-content");
const stateCopy = document.getElementById("menu-state-copy");
const menuButtons = document.querySelectorAll(".menu-button");
const canvasViewport = document.getElementById("canvas-viewport");
const canvasLayer = document.getElementById("canvas-layer");
const componentLayer = document.getElementById("component-layer");
const componentWorld = document.getElementById("component-world");
const nodeContainer = document.getElementById("node-container");
const selectionRect = document.getElementById("selection-rect");
const canvasContextMenu = document.getElementById("canvas-context-menu");
const nodeContextMenu = document.getElementById("node-context-menu");
const canvasContextItems = document.querySelectorAll("#canvas-context-menu .context-menu-item");
const nodeContextItems = document.querySelectorAll("#node-context-menu .context-menu-item");

let activeMenuKey = "file";
let nodes = initialNodes.map((node) => ({ ...node }));
let nextNodeId = nodes.length + 1;
let selectedNodeIds = new Set();
let canvasOffset = { x: 0, y: 0 };
let canvasPanState = null;
let componentInteraction = null;
let isSpacePressed = false;
let panHandlersBound = false;
let canvasContextTarget = { x: 120, y: 120 };
let activeNodeContextId = null;

function positionDropdown(button) {
  submenuDropdown.style.left = `${button.offsetLeft}px`;
  submenuDropdown.style.minWidth = `${button.offsetWidth + 80}px`;
}

function renderSubmenu(menuKey, button) {
  const items = submenuMap[menuKey] || [];
  submenuContent.replaceChildren(
    ...items.map((label) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "submenu-pill";
      item.textContent = label;
      item.setAttribute("role", "menuitem");
      return item;
    }),
  );
  stateCopy.textContent = stateMap[menuKey] || "Framework ready.";
  if (button) {
    positionDropdown(button);
  }
}

function setCanvasMessage(message) {
  stateCopy.textContent = message;
}

function applyViewportOffset() {
  const transform = `translate(${canvasOffset.x}px, ${canvasOffset.y}px)`;
  canvasLayer.style.transform = transform;
  componentWorld.style.transform = transform;
}

function positionFloatingMenu(menuElement, clientX, clientY) {
  const viewportRect = canvasViewport.getBoundingClientRect();
  const menuWidth = menuElement.offsetWidth || 192;
  const menuHeight = menuElement.offsetHeight || 152;
  const left = Math.min(clientX - viewportRect.left, viewportRect.width - menuWidth - 8);
  const top = Math.min(clientY - viewportRect.top, viewportRect.height - menuHeight - 8);

  menuElement.style.left = `${Math.max(8, left)}px`;
  menuElement.style.top = `${Math.max(8, top)}px`;
}

function closeCanvasContextMenu() {
  canvasContextMenu.classList.remove("is-open");
}

function closeNodeContextMenu() {
  nodeContextMenu.classList.remove("is-open");
  activeNodeContextId = null;
}

function closeAllContextMenus() {
  closeCanvasContextMenu();
  closeNodeContextMenu();
}

function clientToWorldPoint(clientX, clientY) {
  const rect = componentLayer.getBoundingClientRect();
  return {
    x: clientX - rect.left - canvasOffset.x,
    y: clientY - rect.top - canvasOffset.y,
  };
}

function clientToLayerPoint(clientX, clientY) {
  const rect = componentLayer.getBoundingClientRect();
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

function hasSelectionChanged(nextSelection) {
  if (selectedNodeIds.size !== nextSelection.length) {
    return true;
  }

  return nextSelection.some((nodeId) => !selectedNodeIds.has(nodeId));
}

function renderNodes() {
  nodeContainer.replaceChildren(
    ...nodes.map((node) => {
      const element = document.createElement("article");
      const isSelected = selectedNodeIds.has(node.id);
      const isDragging = componentInteraction?.type === "node-drag" && componentInteraction.nodeId === node.id;

      element.className = `node-component${isSelected ? " is-selected" : ""}${isDragging ? " is-dragging" : ""}`;
      element.dataset.nodeId = String(node.id);
      element.style.left = `${node.x}px`;
      element.style.top = `${node.y}px`;
      element.setAttribute("aria-selected", String(isSelected));
      element.innerHTML = `
        <div class="node-header">
          <p class="overlay-label">Rectangular node</p>
          <p class="node-title">${node.title}</p>
          <p class="node-subtitle">${node.subtitle}</p>
        </div>
        <div class="node-body">
          <p class="node-description">${node.description}</p>
        </div>
        <div class="node-footer" aria-hidden="true">
          <span class="node-slot">Area A</span>
          <span class="node-slot">Area B</span>
          <span class="node-slot">Area C</span>
        </div>
      `;
      return element;
    }),
  );
}

function setSelectedNodes(nodeIds) {
  if (!hasSelectionChanged(nodeIds)) {
    return;
  }

  selectedNodeIds = new Set(nodeIds);
  renderNodes();
}

function clearSelection() {
  setSelectedNodes([]);
}

function selectOnlyNode(nodeId) {
  setSelectedNodes([nodeId]);
}

function findNode(nodeId) {
  return nodes.find((node) => node.id === nodeId) || null;
}

function createNodeAt(worldX, worldY) {
  const newNode = {
    id: nextNodeId,
    title: `Node ${nextNodeId}`,
    subtitle: "New instance",
    description: "Placeholder text and interaction areas can be expanded here later.",
    x: worldX,
    y: worldY,
  };

  nextNodeId += 1;
  nodes = [...nodes, newNode];
  renderNodes();
  selectOnlyNode(newNode.id);
  return newNode;
}

function deleteNode(nodeId) {
  nodes = nodes.filter((node) => node.id !== nodeId);
  selectedNodeIds.delete(nodeId);
  renderNodes();
}

function showSelectionBox(rect) {
  selectionRect.style.left = `${rect.left}px`;
  selectionRect.style.top = `${rect.top}px`;
  selectionRect.style.width = `${rect.right - rect.left}px`;
  selectionRect.style.height = `${rect.bottom - rect.top}px`;
  selectionRect.classList.add("is-visible");
}

function hideSelectionBox() {
  selectionRect.classList.remove("is-visible");
}

function updateSelectionFromRect(localRect) {
  const worldRect = {
    left: localRect.left - canvasOffset.x,
    top: localRect.top - canvasOffset.y,
    right: localRect.right - canvasOffset.x,
    bottom: localRect.bottom - canvasOffset.y,
  };

  const nextSelection = nodes
    .filter((node) => (
      node.x >= worldRect.left
      && node.y >= worldRect.top
      && node.x + nodeSize.width <= worldRect.right
      && node.y + nodeSize.height <= worldRect.bottom
    ))
    .map((node) => node.id);

  setSelectedNodes(nextSelection);
}

function openCanvasContextMenu(clientX, clientY) {
  canvasContextTarget = clientToWorldPoint(clientX, clientY);
  positionFloatingMenu(canvasContextMenu, clientX, clientY);
  closeNodeContextMenu();
  canvasContextMenu.classList.add("is-open");
}

function openNodeContextMenu(clientX, clientY, nodeId) {
  activeNodeContextId = nodeId;
  positionFloatingMenu(nodeContextMenu, clientX, clientY);
  closeCanvasContextMenu();
  nodeContextMenu.classList.add("is-open");
}

function syncPanShortcutState() {
  canvasViewport.classList.toggle(
    "is-pan-ready",
    isSpacePressed && !canvasPanState && !componentInteraction,
  );

  if (isSpacePressed && !panHandlersBound) {
    canvasViewport.addEventListener("pointerdown", handleCanvasPointerDown);
    canvasViewport.addEventListener("pointermove", handleCanvasPointerMove);
    canvasViewport.addEventListener("pointerup", endCanvasPan);
    canvasViewport.addEventListener("pointercancel", endCanvasPan);
    panHandlersBound = true;
  }

  if (!isSpacePressed && panHandlersBound) {
    canvasViewport.removeEventListener("pointerdown", handleCanvasPointerDown);
    canvasViewport.removeEventListener("pointermove", handleCanvasPointerMove);
    canvasViewport.removeEventListener("pointerup", endCanvasPan);
    canvasViewport.removeEventListener("pointercancel", endCanvasPan);
    panHandlersBound = false;
  }
}

function handleCanvasPointerDown(event) {
  if (event.button !== 0 || canvasContextMenu.contains(event.target) || nodeContextMenu.contains(event.target)) {
    return;
  }

  canvasPanState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: canvasOffset.x,
    originY: canvasOffset.y,
  };

  closeAllContextMenus();
  canvasViewport.classList.add("is-dragging");
  canvasViewport.classList.remove("is-pan-ready");
  canvasViewport.setPointerCapture(event.pointerId);
}

function handleCanvasPointerMove(event) {
  if (!canvasPanState || event.pointerId !== canvasPanState.pointerId) {
    return;
  }

  canvasOffset = {
    x: canvasPanState.originX + event.clientX - canvasPanState.startX,
    y: canvasPanState.originY + event.clientY - canvasPanState.startY,
  };
  applyViewportOffset();
  setCanvasMessage(`Canvas translated to x ${canvasOffset.x}, y ${canvasOffset.y}.`);
}

function cancelCanvasPan() {
  canvasPanState = null;
  canvasViewport.classList.remove("is-dragging");
  syncPanShortcutState();
}

function endCanvasPan(event) {
  if (!canvasPanState || event.pointerId !== canvasPanState.pointerId) {
    return;
  }

  canvasViewport.classList.remove("is-dragging");
  canvasViewport.releasePointerCapture(event.pointerId);
  canvasPanState = null;
  syncPanShortcutState();
}

function beginNodeDrag(event, nodeId) {
  const node = findNode(nodeId);
  if (!node) {
    return;
  }

  componentInteraction = {
    type: "node-drag",
    pointerId: event.pointerId,
    nodeId,
    startX: event.clientX,
    startY: event.clientY,
    originX: node.x,
    originY: node.y,
    moved: false,
  };
  canvasViewport.setPointerCapture(event.pointerId);
  renderNodes();
}

function beginMarqueeSelection(event) {
  const point = clientToLayerPoint(event.clientX, event.clientY);
  componentInteraction = {
    type: "marquee",
    pointerId: event.pointerId,
    startPoint: point,
    endPoint: point,
    moved: false,
  };
  showSelectionBox(normalizeRect(point, point));
  canvasViewport.setPointerCapture(event.pointerId);
}

function endComponentInteraction(event) {
  if (!componentInteraction || event.pointerId !== componentInteraction.pointerId) {
    return;
  }

  if (canvasViewport.hasPointerCapture(event.pointerId)) {
    canvasViewport.releasePointerCapture(event.pointerId);
  }

  if (componentInteraction.type === "marquee") {
    hideSelectionBox();
    if (!componentInteraction.moved) {
      clearSelection();
      setCanvasMessage("Selection cleared.");
    } else {
      setCanvasMessage(`${selectedNodeIds.size} node(s) selected.`);
    }
  }

  if (componentInteraction.type === "node-drag") {
    const movedNodeId = componentInteraction.nodeId;
    const didMove = componentInteraction.moved;
    componentInteraction = null;
    renderNodes();
    setCanvasMessage(didMove ? `Node ${movedNodeId} moved.` : `Node ${movedNodeId} selected.`);
    return;
  }

  componentInteraction = null;
}

menuButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const menuKey = button.dataset.menu || "file";
    const isSameMenu = activeMenuKey === menuKey;
    const isOpen = submenuDropdown.classList.contains("is-open");

    menuButtons.forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    activeMenuKey = menuKey;
    renderSubmenu(menuKey, button);

    if (isSameMenu && isOpen) {
      submenuDropdown.classList.remove("is-open");
      return;
    }

    submenuDropdown.classList.add("is-open");
  });
});

document.addEventListener("click", (event) => {
  if (!submenuDropdown.contains(event.target) && !event.target.closest(".menu-button")) {
    submenuDropdown.classList.remove("is-open");
  }

  if (!canvasContextMenu.contains(event.target) && !nodeContextMenu.contains(event.target)) {
    closeAllContextMenus();
  }
});

window.addEventListener("resize", () => {
  const activeButton = document.querySelector(`.menu-button[data-menu="${activeMenuKey}"]`);
  if (activeButton) {
    positionDropdown(activeButton);
  }
  closeAllContextMenus();
});

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space") {
    return;
  }

  isSpacePressed = true;
  syncPanShortcutState();
});

document.addEventListener("keyup", (event) => {
  if (event.code !== "Space") {
    return;
  }

  isSpacePressed = false;
  syncPanShortcutState();
});

window.addEventListener("blur", () => {
  isSpacePressed = false;
  cancelCanvasPan();
  componentInteraction = null;
  hideSelectionBox();
  syncPanShortcutState();
});

canvasViewport.addEventListener("pointerdown", (event) => {
  if (isSpacePressed || canvasContextMenu.contains(event.target) || nodeContextMenu.contains(event.target)) {
    return;
  }

  if (event.button === 2) {
    event.preventDefault();
    cancelCanvasPan();
    hideSelectionBox();
    componentInteraction = null;

    const nodeElement = event.target.closest(".node-component");
    if (nodeElement) {
      const nodeId = Number(nodeElement.dataset.nodeId);
      selectOnlyNode(nodeId);
      openNodeContextMenu(event.clientX, event.clientY, nodeId);
      setCanvasMessage(`Node ${nodeId} context menu opened.`);
      return;
    }

    openCanvasContextMenu(event.clientX, event.clientY);
    setCanvasMessage("Canvas context menu opened.");
    return;
  }

  if (event.button !== 0) {
    return;
  }

  closeAllContextMenus();
  const nodeElement = event.target.closest(".node-component");

  if (nodeElement) {
    const nodeId = Number(nodeElement.dataset.nodeId);
    selectOnlyNode(nodeId);
    beginNodeDrag(event, nodeId);
    return;
  }

  clearSelection();
  beginMarqueeSelection(event);
});

canvasViewport.addEventListener("pointermove", (event) => {
  if (!componentInteraction || event.pointerId !== componentInteraction.pointerId) {
    return;
  }

  if (componentInteraction.type === "node-drag") {
    const nextX = componentInteraction.originX + event.clientX - componentInteraction.startX;
    const nextY = componentInteraction.originY + event.clientY - componentInteraction.startY;
    const moved = Math.abs(event.clientX - componentInteraction.startX) > 2 || Math.abs(event.clientY - componentInteraction.startY) > 2;

    nodes = nodes.map((node) => (
      node.id === componentInteraction.nodeId
        ? { ...node, x: nextX, y: nextY }
        : node
    ));
    componentInteraction.moved = moved;
    renderNodes();
    return;
  }

  if (componentInteraction.type === "marquee") {
    const nextPoint = clientToLayerPoint(event.clientX, event.clientY);
    const rect = normalizeRect(componentInteraction.startPoint, nextPoint);
    componentInteraction.endPoint = nextPoint;
    componentInteraction.moved = rect.right - rect.left > 2 || rect.bottom - rect.top > 2;
    showSelectionBox(rect);
    updateSelectionFromRect(rect);
  }
});

canvasViewport.addEventListener("pointerup", endComponentInteraction);
canvasViewport.addEventListener("pointercancel", endComponentInteraction);

canvasViewport.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

canvasContextItems.forEach((item) => {
  item.addEventListener("click", () => {
    const action = item.dataset.action;

    if (action === "center" || action === "reset") {
      canvasOffset = { x: 0, y: 0 };
      applyViewportOffset();
      setCanvasMessage("Canvas translation reset to origin.");
    } else if (action === "node") {
      const node = createNodeAt(canvasContextTarget.x, canvasContextTarget.y);
      setCanvasMessage(`Node ${node.id} created at (${Math.round(node.x)}, ${Math.round(node.y)}).`);
    }

    closeCanvasContextMenu();
  });
});

nodeContextItems.forEach((item) => {
  item.addEventListener("click", () => {
    const action = item.dataset.action;

    if (action === "delete" && activeNodeContextId !== null) {
      deleteNode(activeNodeContextId);
      setCanvasMessage(`Node ${activeNodeContextId} deleted.`);
    }

    closeNodeContextMenu();
  });
});

renderSubmenu("file", document.querySelector('.menu-button[data-menu="file"]'));
submenuDropdown.classList.add("is-open");
renderNodes();
applyViewportOffset();
syncPanShortcutState();