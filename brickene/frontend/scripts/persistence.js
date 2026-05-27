(() => {
  const frontend = window.BrickeneFrontend;
  const { config, dom } = frontend;
  const FILE_EXTENSION = ".brickene";
  const PASTE_NUDGE_PX = 32;
  const history = {
    snapshots: [],
    index: -1,
    isApplying: false,
    isQueued: false,
  };

  function buildTimestampedFilename() {
    const now = new Date();
    const timestamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "-",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");

    return `canvas-${timestamp}${FILE_EXTENSION}`;
  }

  function getNodeStates() {
    return frontend.getGraphState().nodes.map((node) => ({
      id: node.id,
      title: node.title,
      type: node.type,
      nodeTypeId: node.brickId,
      periodNumber: node.periodNumber,
      customConfigText: node.customConfigText || "",
      position: {
        x: node.x,
        y: node.y,
      },
      portConfiguration: node.portSlots.map((slot) => ({
        slotId: slot.id,
        side: slot.side,
        actualPortId: slot.actualPortId,
      })),
    }));
  }

  function getEdgeStates() {
    return frontend.getGraphState().edges.map((edge) => ({
      id: edge.id,
      startNode: edge.from.nodeId,
      startPort: edge.from.slotId,
      endNode: edge.to.nodeId,
      endPort: edge.to.slotId,
    }));
  }

  function exportGraphState() {
    return {
      version: 1,
      nodes: getNodeStates(),
      edges: getEdgeStates(),
    };
  }

  function serializeGraphState(snapshot = exportGraphState()) {
    return JSON.stringify(snapshot);
  }

  function formatGraphState(snapshot = exportGraphState()) {
    return `${JSON.stringify(snapshot, null, 2)}\n`;
  }

  function pushHistorySnapshot(snapshot = exportGraphState()) {
    const serialized = typeof snapshot === "string" ? snapshot : serializeGraphState(snapshot);

    if (history.index >= 0 && history.snapshots[history.index] === serialized) {
      return false;
    }

    history.snapshots = history.snapshots.slice(0, history.index + 1);
    history.snapshots.push(serialized);
    history.index = history.snapshots.length - 1;
    return true;
  }

  function queueHistorySnapshot() {
    if (history.isApplying || history.isQueued) {
      return;
    }

    history.isQueued = true;
    queueMicrotask(() => {
      history.isQueued = false;
      if (history.isApplying) {
        return;
      }

      pushHistorySnapshot();
    });
  }

  function clearGraphSelections() {
    const ui = frontend.getUiState();

    ui.selectedNodeIds = new Set();
    ui.selectedEdgeIds = new Set();
    ui.activeNodeContextId = null;
    ui.activeEdgeContextId = null;
    ui.componentInteraction = null;
  }

  function buildSelectionGraphState() {
    const ui = frontend.getUiState();
    const explicitNodeIds = new Set(ui.selectedNodeIds);
    const explicitEdgeIds = new Set(ui.selectedEdgeIds);
    const selectedNodeIds = new Set(explicitNodeIds);
    const edgeStates = getEdgeStates();

    edgeStates.forEach((edge) => {
      if (explicitEdgeIds.has(edge.id)) {
        selectedNodeIds.add(edge.startNode);
        selectedNodeIds.add(edge.endNode);
      }
    });

    const nodeStates = getNodeStates().filter((node) => selectedNodeIds.has(node.id));
    const selectedEdges = edgeStates.filter((edge) => (
      explicitEdgeIds.has(edge.id)
      || (
        selectedNodeIds.has(edge.startNode)
        && selectedNodeIds.has(edge.endNode)
        && explicitNodeIds.size > 0
      )
    ));

    if (!nodeStates.length && !selectedEdges.length) {
      return null;
    }

    return {
      version: 1,
      nodes: nodeStates,
      edges: selectedEdges,
    };
  }

  async function writeClipboardText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }

  async function writeClipboardTextFromPromise(textPromise) {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": Promise.resolve(textPromise).then((text) => new Blob([
            text,
          ], {
            type: "text/plain",
          })),
        }),
      ]);
      return true;
    }

    return writeClipboardText(await textPromise);
  }

  async function readClipboardText() {
    if (!navigator.clipboard?.readText) {
      throw new Error("Clipboard paste is not available in this browser.");
    }

    return navigator.clipboard.readText();
  }

  async function copySelection() {
    const selectionSnapshot = buildSelectionGraphState();
    if (!selectionSnapshot) {
      return { copied: false, nodeCount: 0, edgeCount: 0 };
    }

    await writeClipboardText(JSON.stringify(selectionSnapshot));
    return {
      copied: true,
      nodeCount: selectionSnapshot.nodes.length,
      edgeCount: selectionSnapshot.edges.length,
    };
  }

  async function fetchGraphSmilesText() {
    const response = await fetch(config.smilesApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(exportGraphState()),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "Failed to export SMILES.");
    }

    const smiles = String(payload.smiles || "").trim();
    if (!smiles) {
      throw new Error("SMILES export returned an empty result.");
    }

    return `${smiles}\n`;
  }

  async function copyGraphAsSmiles() {
    const textPromise = fetchGraphSmilesText();

    await writeClipboardTextFromPromise(textPromise);
    return (await textPromise).trim();
  }

  async function copyGraphAsBrickene() {
    const text = serializeGraphState();

    await writeClipboardTextFromPromise(text);
    return text;
  }

  function buildNodePositionBounds(nodes) {
    if (!nodes.length) {
      return null;
    }

    return nodes.reduce((bounds, node) => ({
      left: Math.min(bounds.left, node.x),
      top: Math.min(bounds.top, node.y),
      right: Math.max(bounds.right, node.x),
      bottom: Math.max(bounds.bottom, node.y),
    }), {
      left: nodes[0].x,
      top: nodes[0].y,
      right: nodes[0].x,
      bottom: nodes[0].y,
    });
  }

  function normalizeSnapshotPayload(payload) {
    const snapshot = typeof payload === "string" ? JSON.parse(payload) : payload;

    if (!snapshot || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) {
      throw new Error("Clipboard does not contain a valid .brickene selection.");
    }

    return snapshot;
  }

  function pasteSelectionSnapshot(snapshot, options = {}) {
    const graph = frontend.getGraphState();
    const ui = frontend.getUiState();
    const normalizedSnapshot = normalizeSnapshotPayload(snapshot);
    const importedNodes = normalizedSnapshot.nodes
      .map((nodeState) => normalizeImportedNodeState(nodeState))
      .filter((node) => Number.isFinite(node.id));

    if (!importedNodes.length) {
      throw new Error("Clipboard selection does not contain any nodes to paste.");
    }

    const anchorPoint = options.atPoint || getCanvasViewportCenter();
    const importedBounds = buildNodePositionBounds(importedNodes);
    const importedCenter = importedBounds
      ? {
        x: (importedBounds.left + importedBounds.right) / 2,
        y: (importedBounds.top + importedBounds.bottom) / 2,
      }
      : { x: 0, y: 0 };
    const pasteNudge = options.atPoint ? 0 : PASTE_NUDGE_PX / Math.max(ui.canvasScale || 1, 0.01);
    const offset = anchorPoint
      ? {
        x: anchorPoint.x - importedCenter.x + pasteNudge,
        y: anchorPoint.y - importedCenter.y + pasteNudge,
      }
      : { x: pasteNudge, y: pasteNudge };
    const nodeIdMap = new Map();
    const pastedNodes = importedNodes.map((node) => {
      const nextNodeId = graph.nextNodeId;

      graph.nextNodeId += 1;
      nodeIdMap.set(node.id, nextNodeId);
      return {
        ...node,
        id: nextNodeId,
        x: node.x + offset.x,
        y: node.y + offset.y,
        portSlots: node.portSlots.map((slot) => ({ ...slot, edgeId: null })),
      };
    });
    const pastedNodesById = new Map(pastedNodes.map((node) => [node.id, node]));
    const remappedEdges = normalizedSnapshot.edges.map((edgeState) => {
      const nextEdgeId = graph.nextEdgeId;

      graph.nextEdgeId += 1;
      return {
        id: nextEdgeId,
        startNode: nodeIdMap.get(Number(edgeState.startNode ?? edgeState.from?.nodeId)),
        startPort: Number(edgeState.startPort ?? edgeState.from?.slotId),
        endNode: nodeIdMap.get(Number(edgeState.endNode ?? edgeState.to?.nodeId)),
        endPort: Number(edgeState.endPort ?? edgeState.to?.slotId),
      };
    });
    const pastedEdges = normalizeImportedEdges(remappedEdges, pastedNodesById);

    graph.nodes = [...graph.nodes, ...pastedNodes];
    graph.edges = [...graph.edges, ...pastedEdges];
    ui.selectedNodeIds = new Set(pastedNodes.map((node) => node.id));
    ui.selectedEdgeIds = new Set(pastedEdges.map((edge) => edge.id));
    frontend.closeAllContextMenus();
    frontend.renderNodes();
    frontend.notifyGraphChanged({ reason: "graph-pasted" });
    return {
      pasted: true,
      nodeCount: pastedNodes.length,
      edgeCount: pastedEdges.length,
    };
  }

  async function pasteSelection() {
    const clipboardText = await readClipboardText();

    if (!clipboardText.trim()) {
      throw new Error("Clipboard is empty.");
    }

    return pasteSelectionSnapshot(clipboardText);
  }

  function restoreHistorySnapshot(snapshotIndex) {
    if (snapshotIndex < 0 || snapshotIndex >= history.snapshots.length) {
      return false;
    }

    history.isApplying = true;
    try {
      importGraphState(history.snapshots[snapshotIndex]);
      history.index = snapshotIndex;
    } finally {
      history.isApplying = false;
    }

    return true;
  }

  function undo() {
    if (history.index <= 0) {
      return false;
    }

    return restoreHistorySnapshot(history.index - 1);
  }

  function redo() {
    if (history.index >= history.snapshots.length - 1) {
      return false;
    }

    return restoreHistorySnapshot(history.index + 1);
  }

  function normalizeImportedNodeState(nodeState) {
    const position = nodeState.position || {};
    const portConfiguration = Array.isArray(nodeState.portConfiguration)
      ? nodeState.portConfiguration
      : Array.isArray(nodeState.portSlots)
        ? nodeState.portSlots
        : [];

    return frontend.buildNode({
      id: Number(nodeState.id),
      title: nodeState.title,
      type: nodeState.type || "rectangular",
      brickId: nodeState.nodeTypeId || nodeState.brickId,
      periodNumber: nodeState.periodNumber,
      customConfigText: typeof nodeState.customConfigText === "string" ? nodeState.customConfigText : "",
      x: Number(position.x ?? nodeState.x ?? 0),
      y: Number(position.y ?? nodeState.y ?? 0),
      portSlots: portConfiguration.map((slot, index) => ({
        id: Number(slot.slotId ?? slot.id ?? index),
        label: `P${Number(slot.slotId ?? slot.id ?? index) + 1}`,
        side: slot.side || null,
        actualPortId: slot.actualPortId === null || typeof slot.actualPortId === "undefined"
          ? null
          : String(slot.actualPortId),
        edgeId: null,
      })),
    });
  }

  function normalizeImportedEdges(edgeStates, nodesById) {
    const occupiedPorts = new Set();
    const normalizedEdges = [];

    edgeStates.forEach((edgeState, index) => {
      const startNodeId = Number(edgeState.startNode ?? edgeState.from?.nodeId);
      const startPortId = Number(edgeState.startPort ?? edgeState.from?.slotId);
      const endNodeId = Number(edgeState.endNode ?? edgeState.to?.nodeId);
      const endPortId = Number(edgeState.endPort ?? edgeState.to?.slotId);
      const edgeId = Number(edgeState.id ?? index + 1);
      const startNode = nodesById.get(startNodeId);
      const endNode = nodesById.get(endNodeId);

      if (!startNode || !endNode) {
        return;
      }

      const startSlot = startNode.portSlots.find((slot) => slot.id === startPortId);
      const endSlot = endNode.portSlots.find((slot) => slot.id === endPortId);
      if (!startSlot || !endSlot) {
        return;
      }

      const startKey = `${startNodeId}:${startPortId}`;
      const endKey = `${endNodeId}:${endPortId}`;
      if (occupiedPorts.has(startKey) || occupiedPorts.has(endKey)) {
        return;
      }

      occupiedPorts.add(startKey);
      occupiedPorts.add(endKey);
      startSlot.edgeId = edgeId;
      endSlot.edgeId = edgeId;
      normalizedEdges.push({
        id: edgeId,
        from: { nodeId: startNodeId, slotId: startPortId },
        to: { nodeId: endNodeId, slotId: endPortId },
      });
    });

    return normalizedEdges;
  }

  function importGraphState(payload) {
    const graph = frontend.getGraphState();
    const snapshot = typeof payload === "string" ? JSON.parse(payload) : payload;

    if (!snapshot || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) {
      throw new Error("Invalid .brickene configuration.");
    }

    const importedNodes = snapshot.nodes
      .map((nodeState) => normalizeImportedNodeState(nodeState))
      .filter((node) => Number.isFinite(node.id));
    const nodesById = new Map(importedNodes.map((node) => [node.id, node]));
    const importedEdges = normalizeImportedEdges(snapshot.edges, nodesById);

    graph.nodes = importedNodes;
    graph.edges = importedEdges;
    graph.nextNodeId = importedNodes.length ? Math.max(...importedNodes.map((node) => node.id)) + 1 : 1;
    graph.nextEdgeId = importedEdges.length ? Math.max(...importedEdges.map((edge) => edge.id)) + 1 : 1;

    clearGraphSelections();
    frontend.closeAllContextMenus();
    frontend.renderNodes();
    frontend.notifyGraphChanged({ reason: "graph-imported" });
    frontend.setCanvasMessage(`Loaded ${importedNodes.length} node(s) and ${importedEdges.length} edge(s).`);

    return exportGraphState();
  }

  function createNewCanvas() {
    const graph = frontend.getGraphState();

    graph.nodes = [];
    graph.edges = [];
    graph.nextNodeId = 1;
    graph.nextEdgeId = 1;

    clearGraphSelections();
    frontend.closeAllContextMenus();
    frontend.renderNodes();
    frontend.notifyGraphChanged({ reason: "graph-new" });
    frontend.setCanvasMessage("New canvas created.");
    return exportGraphState();
  }

  function save() {
    const blob = new Blob([formatGraphState()], {
      type: "application/json",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = buildTimestampedFilename();
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
    frontend.setCanvasMessage("Graph configuration saved.");
    return exportGraphState();
  }

  function open() {
    if (!dom.graphFileInput) {
      return false;
    }

    dom.graphFileInput.value = "";
    dom.graphFileInput.click();
    frontend.setCanvasMessage("Select a .brickene configuration to open.");
    return true;
  }

  function getCanvasViewportCenter() {
    const viewportRect = dom.canvasViewport?.getBoundingClientRect();

    if (!viewportRect) {
      return null;
    }

    return frontend.clientToWorldPoint(
      viewportRect.left + viewportRect.width / 2,
      viewportRect.top + viewportRect.height / 2,
    );
  }

  function createNodeAtViewportCenter() {
    const centerPoint = getCanvasViewportCenter();

    if (!centerPoint) {
      return null;
    }

    return frontend.createNodeAt(centerPoint.x, centerPoint.y);
  }

  function openNodeWizard() {
    const wizardWindow = window.open(
      frontend.config.nodeWizardUrl,
      "_blank",
      "popup=yes,width=1520,height=960",
    );

    if (!wizardWindow) {
      frontend.setCanvasMessage("Allow pop-ups to open the node wizard.");
      return true;
    }

    frontend.setCanvasMessage("Node wizard opened in a separate window.");
    return true;
  }

  function openNodeManager() {
    const managerWindow = window.open(
      frontend.config.nodeManagerUrl,
      "brickene-node-manager",
      "width=1360,height=860,resizable=yes,scrollbars=yes",
    );

    if (!managerWindow) {
      frontend.setCanvasMessage("Allow pop-ups to open the node manager.");
      return true;
    }

    frontend.setCanvasMessage("Node manager opened in a separate window.");
    return true;
  }

  function openTemplateWizard() {
    const wizardWindow = window.open(
      frontend.config.templateWizardUrl,
      "brickene-template-wizard",
      "popup=yes,width=1520,height=960",
    );

    if (!wizardWindow) {
      frontend.setCanvasMessage("Allow pop-ups to open the template wizard.");
      return true;
    }

    frontend.setCanvasMessage("Template wizard opened in a separate window.");
    return true;
  }

  async function handleMenuAction(menuKey, actionKey) {
    if (menuKey === "file") {
      if (actionKey === "new") {
        createNewCanvas();
        return true;
      }

      if (actionKey === "save") {
        save();
        return true;
      }

      if (actionKey === "open") {
        return open();
      }

      if (actionKey === "copy-as-brickene") {
        try {
          await copyGraphAsBrickene();
          frontend.setCanvasMessage("Copied graph as BRICKENE.");
        } catch (error) {
          frontend.setCanvasMessage(error instanceof Error ? error.message : "BRICKENE export failed.");
        }
        return true;
      }

      if (actionKey === "copy-as-smiles") {
        try {
          await copyGraphAsSmiles();
          frontend.setCanvasMessage("Copied graph as SMILES.");
        } catch (error) {
          frontend.setCanvasMessage(error instanceof Error ? error.message : "SMILES export failed.");
        }
        return true;
      }

      return false;
    }

    if (menuKey === "edit") {
      if (actionKey === "undo") {
        frontend.setCanvasMessage(frontend.undo() ? "Undo applied." : "Nothing to undo.");
        return true;
      }

      if (actionKey === "redo") {
        frontend.setCanvasMessage(frontend.redo() ? "Redo applied." : "Nothing to redo.");
        return true;
      }

      if (actionKey === "copy") {
        const result = await frontend.copySelection();
        if (!result.copied) {
          frontend.setCanvasMessage("Select nodes or edges to copy.");
          return true;
        }

        frontend.setCanvasMessage(`Copied ${result.nodeCount} node(s) and ${result.edgeCount} edge(s).`);
        return true;
      }

      if (actionKey === "paste") {
        try {
          const result = await frontend.pasteSelection();
          frontend.setCanvasMessage(`Pasted ${result.nodeCount} node(s) and ${result.edgeCount} edge(s).`);
        } catch (error) {
          frontend.setCanvasMessage(error instanceof Error ? error.message : "Paste failed.");
        }
        return true;
      }

      if (actionKey === "delete") {
        const deleted = frontend.deleteSelectedGraphItems?.();
        if (!deleted) {
          frontend.setCanvasMessage("Select nodes or edges to delete.");
        }
        return true;
      }

      return false;
    }

    if (menuKey === "node") {
      if (actionKey === "create-node") {
        const node = createNodeAtViewportCenter();
        if (!node) {
          return false;
        }

        frontend.setCanvasMessage(
          `Node ${node.id} created at (${Math.round(node.x)}, ${Math.round(node.y)}).`,
        );
        return true;
      }

      if (actionKey === "open-node-wizard") {
        return openNodeWizard();
      }

      if (actionKey === "template-wizard") {
        return openTemplateWizard();
      }

      if (actionKey === "node-manager") {
        return openNodeManager();
      }

      return false;
    }

    if (menuKey === "view") {
      if (actionKey === "center-canvas") {
        frontend.resetCanvasTranslation?.();
        return true;
      }

      if (actionKey === "reset-zoom") {
        frontend.resetCanvasZoomAtViewportCenter?.();
        return true;
      }

      if (actionKey === "zoom-in") {
        frontend.zoomCanvasFromViewportCenter?.(1);
        return true;
      }

      if (actionKey === "zoom-out") {
        frontend.zoomCanvasFromViewportCenter?.(-1);
        return true;
      }

      return false;
    }

    return false;
  }

  function bindPersistenceEvents() {
    if (!dom.graphFileInput) {
      return;
    }

    dom.graphFileInput.addEventListener("change", async (event) => {
      const input = event.target;
      const file = input.files?.[0];
      if (!file) {
        return;
      }

      try {
        const text = await file.text();
        importGraphState(text);
      } catch (error) {
        frontend.setCanvasMessage(error instanceof Error ? error.message : "Failed to open .brickene configuration.");
      }
    });
  }

  function bindHistoryEvents() {
    if (!dom.canvasViewport) {
      return;
    }

    dom.canvasViewport.addEventListener(frontend.GRAPH_CHANGE_EVENT, () => {
      queueHistorySnapshot();
    });
  }

  frontend.getNodeStates = getNodeStates;
  frontend.getEdgeStates = getEdgeStates;
  frontend.exportGraphState = exportGraphState;
  frontend.importGraphState = importGraphState;
  frontend.createNewCanvas = createNewCanvas;
  frontend.handleMenuAction = handleMenuAction;
  frontend.bindPersistenceEvents = bindPersistenceEvents;
  frontend.save = save;
  frontend.open = open;
  frontend.copySelection = copySelection;
  frontend.fetchGraphSmilesText = fetchGraphSmilesText;
  frontend.copyGraphAsSmiles = copyGraphAsSmiles;
  frontend.pasteSelection = pasteSelection;
  frontend.pasteSelectionSnapshot = pasteSelectionSnapshot;
  frontend.undo = undo;
  frontend.redo = redo;

  bindHistoryEvents();
  bindPersistenceEvents();
})();
