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
let activeMenuKey = "file";

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
});

window.addEventListener("resize", () => {
  const activeButton = document.querySelector(`.menu-button[data-menu="${activeMenuKey}"]`);
  if (activeButton) {
    positionDropdown(activeButton);
  }
});

renderSubmenu("file", document.querySelector('.menu-button[data-menu="file"]'));
submenuDropdown.classList.add("is-open");