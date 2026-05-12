(() => {
  const frontend = window.BrickeneFrontend;
  const { dom } = frontend;
  const FILE_EXTENSION = ".brickene";

  function getNodeStates() {
    return frontend.getGraphState().nodes.map((node) => ({
      id: node.id,
      title: node.title,
      type: node.type,
      nodeTypeId: node.brickId,
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

  function clearGraphSelections() {
    const ui = frontend.getUiState();

    ui.selectedNodeIds = new Set();
    ui.selectedEdgeIds = new Set();
    ui.activeNodeContextId = null;
    ui.activeEdgeContextId = null;
    ui.componentInteraction = null;
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
      x: Number(position.x ?? nodeState.x ?? 0),
      y: Number(position.y ?? nodeState.y ?? 0),
      portSlots: portConfiguration.map((slot, index) => ({
        id: Number(slot.slotId ?? slot.id ?? index),
        label: `P${Number(slot.slotId ?? slot.id ?? index) + 1}`,
        side: slot.side || "right",
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

  function save() {
    const blob = new Blob([`${JSON.stringify(exportGraphState(), null, 2)}\n`], {
      type: "application/json",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = `graph${FILE_EXTENSION}`;
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

  async function handleMenuAction(menuKey, actionKey) {
    if (menuKey !== "file") {
      return false;
    }

    if (actionKey === "save") {
      save();
      return true;
    }

    if (actionKey === "open") {
      return open();
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

  frontend.getNodeStates = getNodeStates;
  frontend.getEdgeStates = getEdgeStates;
  frontend.exportGraphState = exportGraphState;
  frontend.importGraphState = importGraphState;
  frontend.handleMenuAction = handleMenuAction;
  frontend.bindPersistenceEvents = bindPersistenceEvents;
  frontend.save = save;
  frontend.open = open;

  bindPersistenceEvents();
})();
