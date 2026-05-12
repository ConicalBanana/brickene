(() => {
  const frontend = window.BrickeneFrontend = window.BrickeneFrontend || {};

  frontend.config = {
    submenuMap: {
      file: ["New", "Open", "Open recent", "Save"],
      edit: ["Undo", "Redo", "Copy", "Delete"],
      node: ["Create node", "Ports", "Edges", "Presets"],
      view: ["Center canvas", "Grid", "Legend", "Export"],
    },
    stateMap: {
      file: "Menu commands are scaffolded for future integration.",
      edit: "Edit actions will target node and edge operations.",
      node: "Node controls now map brick definitions into port slots.",
      view: "View controls will tune the integral canvas workspace.",
    },
    nodeSize: { width: 260, height: 196 },
    defaultPortCount: 3,
    initialNodeConfigs: [
      {
        id: 1,
        type: "rectangular",
        title: "Node 1",
        brickId: "2",
        x: 96,
        y: 88,
      },
      {
        id: 2,
        type: "rectangular",
        title: "Node 2",
        brickId: "3",
        x: 388,
        y: 228,
      },
    ],
  };

  frontend.dom = {
    submenuDropdown: document.getElementById("submenu-dropdown"),
    submenuContent: document.getElementById("submenu-content"),
    stateCopy: document.getElementById("menu-state-copy"),
    menuButtons: document.querySelectorAll(".menu-button"),
    canvasViewport: document.getElementById("canvas-viewport"),
    canvasLayer: document.getElementById("canvas-layer"),
    canvasGrid: document.querySelector(".canvas-grid"),
    componentLayer: document.getElementById("component-layer"),
    componentWorld: document.getElementById("component-world"),
    edgeLayer: document.getElementById("edge-layer"),
    nodeContainer: document.getElementById("node-container"),
    selectionRect: document.getElementById("selection-rect"),
    canvasContextMenu: document.getElementById("canvas-context-menu"),
    nodeContextMenu: document.getElementById("node-context-menu"),
    canvasContextItems: document.querySelectorAll("#canvas-context-menu .context-menu-item"),
    nodeContextItems: document.querySelectorAll("#node-context-menu .context-menu-item"),
  };

  frontend.state = {
    graph: {
      nodes: [],
      edges: [],
      nextNodeId: 1,
      nextEdgeId: 1,
    },
    ui: {
      activeMenuKey: "file",
      selectedNodeIds: new Set(),
      canvasOffset: { x: 0, y: 0 },
      canvasPanState: null,
      componentInteraction: null,
      isSpacePressed: false,
      panHandlersBound: false,
      canvasContextTarget: { x: 120, y: 120 },
      activeNodeContextId: null,
    },
  };

  frontend.getGraphState = () => frontend.state.graph;
  frontend.getUiState = () => frontend.state.ui;
})();
