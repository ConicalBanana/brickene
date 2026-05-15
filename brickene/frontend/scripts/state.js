(() => {
  const frontend = window.BrickeneFrontend = window.BrickeneFrontend || {};
  const GRAPH_CHANGE_EVENT = "brickene:graphchange";
  const isMacOS = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  const runtimeUrl = new URL(window.location.href);
  const renderApiUrl = runtimeUrl.searchParams.get("renderApiUrl") || "http://127.0.0.1:8765/render";
  const brickApiUrl = runtimeUrl.searchParams.get("brickApiUrl")
    || (/\/render\/?$/.test(renderApiUrl)
      ? renderApiUrl.replace(/\/render\/?$/, "/bricks")
      : "http://127.0.0.1:8765/bricks");
  const brickRenderApiUrl = runtimeUrl.searchParams.get("brickRenderApiUrl")
    || (/\/render\/?$/.test(renderApiUrl)
      ? renderApiUrl.replace(/\/render\/?$/, "/brick-render")
      : "http://127.0.0.1:8765/brick-render");
  const marvinPort = runtimeUrl.searchParams.get("marvinPort");
  const marvinWebUrl = (
    runtimeUrl.searchParams.get("marvinUrl")
    || (marvinPort ? `http://127.0.0.1:${marvinPort}` : "http://127.0.0.1:8080")
  ).replace(/\/$/, "");
  const brickConfigApiUrl = runtimeUrl.searchParams.get("brickConfigApiUrl")
    || (/\/render\/?$/.test(renderApiUrl)
      ? renderApiUrl.replace(/\/render\/?$/, "/brick-config")
      : "http://127.0.0.1:8765/brick-config");
  const nodeWizardUrl = (() => {
    const wizardUrl = new URL("./node_wizard.html", runtimeUrl);

    wizardUrl.searchParams.set("brickConfigApiUrl", brickConfigApiUrl);
    wizardUrl.searchParams.set("brickApiUrl", brickApiUrl);
    wizardUrl.searchParams.set("marvinUrl", marvinWebUrl);
    return wizardUrl.toString();
  })();

  frontend.config = {
    submenuMap: {
      file: ["New", "|", "Open", "Open recently", "Save"],
      edit: ["Undo", "Redo", "|", "Copy", "Paste", "Delete", "Create new node"],
      node: ["Create node", "Open node wizard", "|", "Ports", "Edges", "Presets"],
      view: ["Center canvas", "Grid", "Legend"],
    },
    stateMap: {
      file: "File actions can open and save .brickene graph configurations.",
      edit: "Edit actions will target node and edge operations.",
      node: "Node controls can create nodes directly or open the external node wizard.",
      view: "View controls will tune the integral canvas workspace.",
    },
    renderApiUrl,
    brickApiUrl,
    brickConfigApiUrl,
    brickRenderApiUrl,
    marvinWebUrl,
    nodeWizardUrl,
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
    graphFileInput: document.getElementById("graph-file-input"),
    edgeLayer: document.getElementById("edge-layer"),
    nodeContainer: document.getElementById("node-container"),
    selectionRect: document.getElementById("selection-rect"),
    canvasZoomInButton: document.getElementById("canvas-zoom-in"),
    canvasZoomOutButton: document.getElementById("canvas-zoom-out"),
    renderLayer: document.getElementById("render-layer"),
    renderPreviewWindow: document.getElementById("render-preview-window"),
    renderPreviewImage: document.getElementById("render-preview-image"),
    renderPreviewMeta: document.getElementById("render-preview-meta"),
    canvasContextMenu: document.getElementById("canvas-context-menu"),
    canvasNodePortal: document.getElementById("canvas-node-portal"),
    canvasNodePortalTrigger: document.getElementById("canvas-node-portal-trigger"),
    canvasNodeCategoryMenu: document.getElementById("canvas-node-category-menu"),
    nodeContextMenu: document.getElementById("node-context-menu"),
    edgeContextMenu: document.getElementById("edge-context-menu"),
    canvasContextItems: document.querySelectorAll("#canvas-context-menu > .context-menu-item"),
    nodeContextItems: document.querySelectorAll("#node-context-menu > .context-menu-item"),
    edgeContextItems: document.querySelectorAll("#edge-context-menu > .context-menu-item"),
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
      selectedEdgeIds: new Set(),
      canvasOffset: { x: 0, y: 0 },
      canvasScale: 1,
      canvasPanState: null,
      componentInteraction: null,
      isSpacePressed: false,
      panHandlersBound: false,
      canvasContextTarget: { x: 120, y: 120 },
      activeNodeContextId: null,
      activeEdgeContextId: null,
    },
  };

  frontend.getGraphState = () => frontend.state.graph;
  frontend.getUiState = () => frontend.state.ui;
  frontend.platform = {
    isMacOS,
  };
  frontend.GRAPH_CHANGE_EVENT = GRAPH_CHANGE_EVENT;
  frontend.notifyGraphChanged = (detail = {}) => {
    if (!frontend.dom.canvasViewport) {
      return;
    }

    frontend.dom.canvasViewport.dispatchEvent(new CustomEvent(GRAPH_CHANGE_EVENT, {
      detail: {
        reason: detail.reason || "graph-updated",
        timestamp: Date.now(),
        ...detail,
      },
    }));
  };
})();
