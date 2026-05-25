(() => {
  const frontend = window.BrickeneFrontend = window.BrickeneFrontend || {};
  const GRAPH_CHANGE_EVENT = "brickene:graphchange";
  const isMacOS = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  const runtimeUrl = new URL(window.location.href);
  const renderApiUrl = runtimeUrl.searchParams.get("renderApiUrl") || "http://127.0.0.1:8765/graph/render";
  const brickApiUrl = runtimeUrl.searchParams.get("brickApiUrl")
    || (/\/graph\/render\/?$/.test(renderApiUrl)
      ? renderApiUrl.replace(/\/graph\/render\/?$/, "/bricks")
      : "http://127.0.0.1:8765/bricks");
  const brickRenderApiUrl = runtimeUrl.searchParams.get("brickRenderApiUrl")
    || (/\/graph\/render\/?$/.test(renderApiUrl)
      ? renderApiUrl.replace(/\/graph\/render\/?$/, "/bricks/render")
      : "http://127.0.0.1:8765/bricks/render");
  const versionApiUrl = runtimeUrl.searchParams.get("versionApiUrl")
    || (/\/graph\/render\/?$/.test(renderApiUrl)
      ? renderApiUrl.replace(/\/graph\/render\/?$/, "/version")
      : "http://127.0.0.1:8765/version");
  const marvinPort = runtimeUrl.searchParams.get("marvinPort");
  const marvinWebUrl = (
    runtimeUrl.searchParams.get("marvinUrl")
    || (marvinPort ? `http://127.0.0.1:${marvinPort}` : "http://127.0.0.1:8080")
  ).replace(/\/$/, "");
  const brickConfigApiUrl = runtimeUrl.searchParams.get("brickConfigApiUrl")
    || (/\/graph\/render\/?$/.test(renderApiUrl)
      ? renderApiUrl.replace(/\/graph\/render\/?$/, "/bricks/preview")
      : "http://127.0.0.1:8765/bricks/preview");
  const smilesApiUrl = runtimeUrl.searchParams.get("smilesApiUrl")
    || (/\/graph\/render\/?$/.test(renderApiUrl)
      ? renderApiUrl.replace(/\/graph\/render\/?$/, "/graph/smiles")
      : "http://127.0.0.1:8765/graph/smiles");
  const nodeWizardUrl = (() => {
    const wizardUrl = new URL("./node_wizard.html", runtimeUrl);

    wizardUrl.searchParams.set("brickConfigApiUrl", brickConfigApiUrl);
    wizardUrl.searchParams.set("brickApiUrl", brickApiUrl);
    wizardUrl.searchParams.set("marvinUrl", marvinWebUrl);
    return wizardUrl.toString();
  })();

  frontend.config = {
    appVersion: "",
    submenuMap: {
      file: [
        "New",
        "|",
        "Open",
        "Open recently",
        "Save",
        "|",
        {
          label: "Copy As",
          children: [
            {
              label: "BRICKENE",
              actionKey: "copy-as-brickene",
            },
            {
              label: "SMILES",
              actionKey: "copy-as-smiles",
            },
          ],
        },
      ],
      edit: ["Undo", "Redo", "|", "Copy", "Paste", "Delete"],
      node: ["Create node", "Open node wizard"],
      view: ["Center canvas", "Grid", "Reset zoom", "Zoom in", "Zoom out"],
    },
    stateMap: {
      file: "File actions can open, save, and export graph configurations.",
      edit: "Edit actions will target node and edge operations.",
      node: "Node controls can create nodes directly or open the external node wizard.",
      view: "View controls will tune the integral canvas workspace.",
    },
    renderApiUrl,
    smilesApiUrl,
    brickApiUrl,
    brickConfigApiUrl,
    brickRenderApiUrl,
    versionApiUrl,
    marvinWebUrl,
    nodeWizardUrl,
    nodeSize: { width: 340, height: 188 },
    defaultPortCount: 3,
    initialNodeConfigs: [],
  };

  frontend.dom = {
    editorRoot: document.getElementById("editor-root"),
    menuRegion: document.querySelector(".menu-region"),
    menuActionsWrap: document.querySelector(".menu-actions-wrap"),
    brandBlock: document.querySelector(".brand-block"),
    menuMeta: document.querySelector(".menu-meta"),
    submenuDropdown: document.getElementById("submenu-dropdown"),
    submenuContent: document.getElementById("submenu-content"),
    menuVersion: document.getElementById("menu-version"),
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
    canvasZoomResetButton: document.getElementById("canvas-zoom-reset"),
    renderLayer: document.getElementById("render-layer"),
    renderPreviewWindow: document.getElementById("render-preview-window"),
    renderPreviewImage: document.getElementById("render-preview-image"),
    renderPreviewMeta: document.getElementById("render-preview-meta"),
    canvasContextMenu: document.getElementById("canvas-context-menu"),
    canvasNodePortal: document.getElementById("canvas-node-portal"),
    canvasNodePortalTrigger: document.getElementById("canvas-node-portal-trigger"),
    canvasNodeCategoryMenu: document.getElementById("canvas-node-category-menu"),
    portCommandPanel: document.getElementById("port-command-panel"),
    portCommandInput: document.getElementById("port-command-input"),
    portCommandList: document.getElementById("port-command-list"),
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
      hoveredPort: null,
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
