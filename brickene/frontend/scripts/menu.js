(() => {
  const frontend = window.BrickeneFrontend;
  const { config, dom } = frontend;

  function positionDropdown(button) {
    dom.submenuDropdown.style.left = `${button.offsetLeft}px`;
    dom.submenuDropdown.style.minWidth = `${button.offsetWidth + 80}px`;
  }

  function renderSubmenu(menuKey, button) {
    const items = config.submenuMap[menuKey] || [];

    dom.submenuContent.replaceChildren(
      ...items.map((label) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "submenu-pill";
        item.textContent = label;
        item.setAttribute("role", "menuitem");
        return item;
      }),
    );

    dom.stateCopy.textContent = config.stateMap[menuKey] || "Framework ready.";
    if (button) {
      positionDropdown(button);
    }
  }

  function setCanvasMessage(message) {
    dom.stateCopy.textContent = message;
  }

  function closeCanvasContextMenu() {
    dom.canvasContextMenu.classList.remove("is-open");
  }

  function closeNodeContextMenu() {
    dom.nodeContextMenu.classList.remove("is-open");
    frontend.getUiState().activeNodeContextId = null;
  }

  function closeAllContextMenus() {
    closeCanvasContextMenu();
    closeNodeContextMenu();
  }

  function openCanvasContextMenu(clientX, clientY) {
    const ui = frontend.getUiState();

    ui.canvasContextTarget = frontend.clientToWorldPoint(clientX, clientY);
    frontend.positionFloatingMenu(dom.canvasContextMenu, clientX, clientY);
    closeNodeContextMenu();
    dom.canvasContextMenu.classList.add("is-open");
  }

  function openNodeContextMenu(clientX, clientY, nodeId) {
    const ui = frontend.getUiState();

    ui.activeNodeContextId = nodeId;
    frontend.positionFloatingMenu(dom.nodeContextMenu, clientX, clientY);
    closeCanvasContextMenu();
    dom.nodeContextMenu.classList.add("is-open");
  }

  frontend.positionDropdown = positionDropdown;
  frontend.renderSubmenu = renderSubmenu;
  frontend.setCanvasMessage = setCanvasMessage;
  frontend.closeCanvasContextMenu = closeCanvasContextMenu;
  frontend.closeNodeContextMenu = closeNodeContextMenu;
  frontend.closeAllContextMenus = closeAllContextMenus;
  frontend.openCanvasContextMenu = openCanvasContextMenu;
  frontend.openNodeContextMenu = openNodeContextMenu;
})();
