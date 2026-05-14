(() => {
  const frontend = window.BrickeneFrontend;
  const { config, dom } = frontend;

  function toActionKey(label) {
    return String(label || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function positionDropdown(button) {
    dom.submenuDropdown.style.left = `${button.offsetLeft}px`;
    dom.submenuDropdown.style.minWidth = `${button.offsetWidth + 80}px`;
  }

  function renderSubmenu(menuKey, button) {
    const items = config.submenuMap[menuKey] || [];

    dom.submenuContent.replaceChildren(
      ...items.map((label) => {
        if (label === "|") {
          const divider = document.createElement("div");
          divider.className = "menu-separator submenu-separator";
          divider.setAttribute("role", "separator");
          return divider;
        }

        const item = document.createElement("button");
        item.type = "button";
        item.className = "submenu-pill";
        item.textContent = label;
        item.dataset.menuKey = menuKey;
        item.dataset.actionKey = toActionKey(label);
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

  function closeEdgeContextMenu() {
    dom.edgeContextMenu.classList.remove("is-open");
    frontend.getUiState().activeEdgeContextId = null;
  }

  function closeAllContextMenus() {
    closeCanvasContextMenu();
    closeNodeContextMenu();
    closeEdgeContextMenu();
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
    closeEdgeContextMenu();
    dom.nodeContextMenu.classList.add("is-open");
  }

  function openEdgeContextMenu(clientX, clientY, edgeId) {
    const ui = frontend.getUiState();

    ui.activeEdgeContextId = edgeId;
    frontend.positionFloatingMenu(dom.edgeContextMenu, clientX, clientY);
    closeCanvasContextMenu();
    closeNodeContextMenu();
    dom.edgeContextMenu.classList.add("is-open");
  }

  function bindSubmenuEvents() {
    dom.submenuContent.addEventListener("click", async (event) => {
      const item = event.target.closest(".submenu-pill");
      if (!item) {
        return;
      }

      const handler = frontend.handleMenuAction;
      if (typeof handler !== "function") {
        return;
      }

      const handled = await handler(
        item.dataset.menuKey || "",
        item.dataset.actionKey || "",
        item.textContent || "",
      );

      if (handled) {
        dom.submenuDropdown.classList.remove("is-open");
      }
    });
  }

  frontend.positionDropdown = positionDropdown;
  frontend.renderSubmenu = renderSubmenu;
  frontend.setCanvasMessage = setCanvasMessage;
  frontend.closeCanvasContextMenu = closeCanvasContextMenu;
  frontend.closeNodeContextMenu = closeNodeContextMenu;
  frontend.closeEdgeContextMenu = closeEdgeContextMenu;
  frontend.closeAllContextMenus = closeAllContextMenus;
  frontend.openCanvasContextMenu = openCanvasContextMenu;
  frontend.openNodeContextMenu = openNodeContextMenu;
  frontend.openEdgeContextMenu = openEdgeContextMenu;

  bindSubmenuEvents();
})();
