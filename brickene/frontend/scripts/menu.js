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

  function buildSubmenuActionItem(menuKey, itemConfig, className = "submenu-pill") {
    const label = typeof itemConfig === "string" ? itemConfig : itemConfig.label || "";
    const item = document.createElement("button");

    item.type = "button";
    item.className = className;
    item.textContent = label;
    item.dataset.menuKey = menuKey;
    item.dataset.actionKey = typeof itemConfig === "object" && itemConfig.actionKey
      ? itemConfig.actionKey
      : toActionKey(label);
    item.setAttribute("role", "menuitem");
    return item;
  }

  function buildSubmenuEntry(menuKey, itemConfig) {
    if (itemConfig === "|") {
      const divider = document.createElement("div");
      divider.className = "menu-separator submenu-separator";
      divider.setAttribute("role", "separator");
      return divider;
    }

    if (typeof itemConfig === "object" && itemConfig && Array.isArray(itemConfig.children)) {
      const portal = document.createElement("div");
      const trigger = buildSubmenuActionItem(
        menuKey,
        { label: itemConfig.label || "", actionKey: itemConfig.actionKey || "" },
        "submenu-pill submenu-portal-trigger",
      );
      const portalMenu = document.createElement("div");
      const portalContent = document.createElement("div");

      portal.className = "submenu-portal";
      trigger.dataset.hasChildren = "true";
      trigger.setAttribute("aria-haspopup", "true");
      portalMenu.className = "submenu-tertiary-menu";
      portalMenu.setAttribute("role", "menu");
      portalContent.className = "submenu-content";
      portalContent.replaceChildren(...itemConfig.children.map((child) => buildSubmenuEntry(menuKey, child)));
      portalMenu.appendChild(portalContent);
      portal.append(trigger, portalMenu);
      return portal;
    }

    return buildSubmenuActionItem(menuKey, itemConfig);
  }

  function renderSubmenu(menuKey, button) {
    const items = config.submenuMap[menuKey] || [];

    dom.submenuContent.replaceChildren(
      ...items.map((itemConfig) => buildSubmenuEntry(menuKey, itemConfig)),
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
    frontend.resetContextMenuPortals?.(dom.canvasContextMenu);
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
    closeEdgeContextMenu();
    dom.canvasContextMenu.classList.add("is-open");
    frontend.prepareCanvasContextMenu?.();
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
      if (!item || item.dataset.hasChildren === "true") {
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

  if (dom.menuVersion) {
    dom.menuVersion.textContent = `v${config.appVersion}`;
  }

  bindSubmenuEvents();
})();
