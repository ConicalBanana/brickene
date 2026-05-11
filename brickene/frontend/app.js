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

const submenuDropdown = document.getElementById("submenu-dropdown");
const submenuContent = document.getElementById("submenu-content");
const stateCopy = document.getElementById("menu-state-copy");
const menuButtons = document.querySelectorAll(".menu-button");
const canvasViewport = document.getElementById("canvas-viewport");
const canvasLayer = document.getElementById("canvas-layer");
const canvasContextMenu = document.getElementById("canvas-context-menu");
const contextMenuItems = document.querySelectorAll(".context-menu-item");
let activeMenuKey = "file";
let canvasOffset = { x: 0, y: 0 };
let dragState = null;
let isSpacePressed = false;
let panHandlersBound = false;

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

function applyCanvasOffset() {
  canvasLayer.style.transform = `translate(${canvasOffset.x}px, ${canvasOffset.y}px)`;
}

function closeCanvasContextMenu() {
  canvasContextMenu.classList.remove("is-open");
}

function openCanvasContextMenu(clientX, clientY) {
  const viewportRect = canvasViewport.getBoundingClientRect();
  const menuWidth = canvasContextMenu.offsetWidth || 192;
  const menuHeight = canvasContextMenu.offsetHeight || 152;
  const left = Math.min(clientX - viewportRect.left, viewportRect.width - menuWidth - 8);
  const top = Math.min(clientY - viewportRect.top, viewportRect.height - menuHeight - 8);

  canvasContextMenu.style.left = `${Math.max(8, left)}px`;
  canvasContextMenu.style.top = `${Math.max(8, top)}px`;
  canvasContextMenu.classList.add("is-open");
}

function setCanvasMessage(message) {
  stateCopy.textContent = message;
}

function syncPanShortcutState() {
  canvasViewport.classList.toggle("is-pan-ready", isSpacePressed && !dragState);

  if (isSpacePressed && !panHandlersBound) {
    canvasViewport.addEventListener("pointerdown", handleCanvasPointerDown);
    canvasViewport.addEventListener("pointermove", handleCanvasPointerMove);
    canvasViewport.addEventListener("pointerup", endCanvasDrag);
    canvasViewport.addEventListener("pointercancel", endCanvasDrag);
    panHandlersBound = true;
  }

  if (!isSpacePressed && panHandlersBound) {
    canvasViewport.removeEventListener("pointerdown", handleCanvasPointerDown);
    canvasViewport.removeEventListener("pointermove", handleCanvasPointerMove);
    canvasViewport.removeEventListener("pointerup", endCanvasDrag);
    canvasViewport.removeEventListener("pointercancel", endCanvasDrag);
    panHandlersBound = false;
  }
}

function handleCanvasPointerDown(event) {
  if (event.button !== 0 || canvasContextMenu.contains(event.target)) {
    return;
  }

  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: canvasOffset.x,
    originY: canvasOffset.y,
  };

  closeCanvasContextMenu();
  canvasViewport.classList.add("is-dragging");
  canvasViewport.classList.remove("is-pan-ready");
  canvasViewport.setPointerCapture(event.pointerId);
}

function handleCanvasPointerMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  canvasOffset = {
    x: dragState.originX + event.clientX - dragState.startX,
    y: dragState.originY + event.clientY - dragState.startY,
  };
  applyCanvasOffset();
  setCanvasMessage(`Canvas translated to x ${canvasOffset.x}, y ${canvasOffset.y}.`);
}

function cancelCanvasDrag() {
  dragState = null;
  canvasViewport.classList.remove("is-dragging");
  syncPanShortcutState();
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

  if (!canvasContextMenu.contains(event.target) && !event.target.closest("#canvas-viewport")) {
    closeCanvasContextMenu();
  }
});

window.addEventListener("resize", () => {
  const activeButton = document.querySelector(`.menu-button[data-menu="${activeMenuKey}"]`);
  if (activeButton) {
    positionDropdown(activeButton);
  }
  closeCanvasContextMenu();
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
  cancelCanvasDrag();
  syncPanShortcutState();
});

function endCanvasDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  canvasViewport.classList.remove("is-dragging");
  canvasViewport.releasePointerCapture(event.pointerId);
  dragState = null;
  syncPanShortcutState();
}

canvasViewport.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  cancelCanvasDrag();
  openCanvasContextMenu(event.clientX, event.clientY);
  setCanvasMessage("Canvas context menu opened.");
});

contextMenuItems.forEach((item) => {
  item.addEventListener("click", () => {
    const action = item.dataset.action;

    if (action === "center" || action === "reset") {
      canvasOffset = { x: 0, y: 0 };
      applyCanvasOffset();
      setCanvasMessage("Canvas translation reset to origin.");
    } else if (action === "node") {
      setCanvasMessage("Node creation is reserved for the front component layer.");
    }

    closeCanvasContextMenu();
  });
});

renderSubmenu("file", document.querySelector('.menu-button[data-menu="file"]'));
submenuDropdown.classList.add("is-open");
applyCanvasOffset();
syncPanShortcutState();