(() => {
  const frontend = window.BrickeneFrontend;
  const { config, dom } = frontend;

  function createPortSlots(nport) {
    return Array.from({ length: nport }, (_, index) => ({
      id: index,
      label: `P${index + 1}`,
      side: index === 0 ? "left" : "right",
      actualPortName: "Unassigned",
      edgeId: null,
    }));
  }

  function buildNode(nodeConfig) {
    const nport = nodeConfig.nport ?? config.defaultPortCount;

    return {
      ...nodeConfig,
      type: nodeConfig.type || "rectangular",
      nport,
      portSlots: nodeConfig.portSlots?.map((slot) => ({ ...slot })) ?? createPortSlots(nport),
    };
  }

  function seedGraphState() {
    const graph = frontend.getGraphState();

    graph.nodes = config.initialNodeConfigs.map((nodeConfig) => buildNode(nodeConfig));
    graph.edges = [];
    graph.nextNodeId = graph.nodes.length + 1;
    graph.nextEdgeId = 1;
  }

  function getPortSlotGroups(node) {
    return {
      leftSlot: node.portSlots.find((slot) => slot.side === "left") || null,
      rightSlots: node.portSlots.filter((slot) => slot.side === "right"),
    };
  }

  function findNode(nodeId) {
    return frontend.getGraphState().nodes.find((node) => node.id === nodeId) || null;
  }

  function findPortSlot(nodeId, slotId) {
    const node = findNode(nodeId);
    return node?.portSlots.find((slot) => slot.id === slotId) || null;
  }

  function updateNodePortEdge(nodeId, slotId, edgeId) {
    const graph = frontend.getGraphState();

    graph.nodes = graph.nodes.map((node) => {
      if (node.id !== nodeId) {
        return node;
      }

      return {
        ...node,
        portSlots: node.portSlots.map((slot) => (
          slot.id === slotId ? { ...slot, edgeId } : slot
        )),
      };
    });
  }

  function renderRectangularNode(node) {
    const ui = frontend.getUiState();
    const isSelected = ui.selectedNodeIds.has(node.id);
    const isDragging = ui.componentInteraction?.type === "node-drag" && ui.componentInteraction.nodeId === node.id;
    const { leftSlot, rightSlots } = getPortSlotGroups(node);

    return `
      <article
        class="node-component${isSelected ? " is-selected" : ""}${isDragging ? " is-dragging" : ""}"
        data-node-id="${node.id}"
        style="left: ${node.x}px; top: ${node.y}px"
        aria-selected="${String(isSelected)}"
      >
        <div class="node-content">
          <div class="node-info-area">
            <div class="node-header">
              <p class="overlay-label">Rectangular node</p>
              <p class="node-title">${node.title}</p>
              <p class="node-subtitle">${node.subtitle}</p>
            </div>
            <div class="node-body">
              <p class="node-description">${node.description}</p>
            </div>
          </div>
          <div class="node-port-area" aria-hidden="true">
            <p class="node-port-area-label">Port components</p>
            <div class="node-port-area-content">
              <div class="node-port-column node-port-column-left">
                ${leftSlot ? `
                  <div class="node-port-entry node-port-entry-left">
                    <button
                      type="button"
                      class="node-port node-port-left${ui.componentInteraction?.type === "edge-drag" && ui.componentInteraction.hoverPort?.nodeId === node.id && ui.componentInteraction.hoverPort?.slotId === leftSlot.id ? " is-hover-target" : ""}"
                      data-node-id="${node.id}"
                      data-slot-id="${leftSlot.id}"
                      aria-label="${node.title} ${leftSlot.label}"
                    ></button>
                    <div class="node-port-info node-port-info-left">
                      <p class="node-port-slot-id">${leftSlot.label}</p>
                      <p class="node-port-name">${leftSlot.actualPortName}</p>
                    </div>
                  </div>
                ` : ""}
              </div>
              <div class="node-port-column node-port-column-right">
                ${rightSlots.map((slot) => `
                  <div class="node-port-entry node-port-entry-right">
                    <div class="node-port-info node-port-info-right">
                      <p class="node-port-slot-id">${slot.label}</p>
                      <p class="node-port-name">${slot.actualPortName}</p>
                    </div>
                    <button
                      type="button"
                      class="node-port node-port-right${ui.componentInteraction?.type === "edge-drag" && ui.componentInteraction.hoverPort?.nodeId === node.id && ui.componentInteraction.hoverPort?.slotId === slot.id ? " is-hover-target" : ""}"
                      data-node-id="${node.id}"
                      data-slot-id="${slot.id}"
                      aria-label="${node.title} ${slot.label}"
                    ></button>
                  </div>
                `).join("")}
              </div>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  frontend.nodeRegistry = {
    rectangular: renderRectangularNode,
  };

  function renderNodeMarkup(node) {
    const renderer = frontend.nodeRegistry[node.type] || frontend.nodeRegistry.rectangular;
    return renderer(node);
  }

  function renderNodes() {
    const { nodes } = frontend.getGraphState();

    dom.nodeContainer.innerHTML = nodes.map((node) => renderNodeMarkup(node)).join("");
    frontend.renderEdges();
  }

  function hasSelectionChanged(nextSelection) {
    const { selectedNodeIds } = frontend.getUiState();

    if (selectedNodeIds.size !== nextSelection.length) {
      return true;
    }

    return nextSelection.some((nodeId) => !selectedNodeIds.has(nodeId));
  }

  function setSelectedNodes(nodeIds) {
    const ui = frontend.getUiState();

    if (!hasSelectionChanged(nodeIds)) {
      return;
    }

    ui.selectedNodeIds = new Set(nodeIds);
    renderNodes();
  }

  function clearSelection() {
    setSelectedNodes([]);
  }

  function selectOnlyNode(nodeId) {
    setSelectedNodes([nodeId]);
  }

  function createNodeAt(worldX, worldY) {
    const graph = frontend.getGraphState();
    const newNode = buildNode({
      id: graph.nextNodeId,
      type: "rectangular",
      title: `Node ${graph.nextNodeId}`,
      subtitle: "New instance",
      description: "Placeholder text and interaction areas can be expanded here later.",
      x: worldX,
      y: worldY,
      nport: config.defaultPortCount,
    });

    graph.nextNodeId += 1;
    graph.nodes = [...graph.nodes, newNode];
    renderNodes();
    selectOnlyNode(newNode.id);
    return newNode;
  }

  function deleteNode(nodeId) {
    const graph = frontend.getGraphState();
    const ui = frontend.getUiState();
    const removedEdgeIds = graph.edges
      .filter((edge) => edge.from.nodeId === nodeId || edge.to.nodeId === nodeId)
      .map((edge) => edge.id);

    graph.edges = graph.edges.filter((edge) => !removedEdgeIds.includes(edge.id));
    graph.nodes = graph.nodes.filter((node) => node.id !== nodeId);
    graph.nodes = graph.nodes.map((node) => ({
      ...node,
      portSlots: node.portSlots.map((slot) => (
        removedEdgeIds.includes(slot.edgeId) ? { ...slot, edgeId: null } : slot
      )),
    }));
    ui.selectedNodeIds.delete(nodeId);
    renderNodes();
  }

  frontend.seedGraphState = seedGraphState;
  frontend.createPortSlots = createPortSlots;
  frontend.buildNode = buildNode;
  frontend.getPortSlotGroups = getPortSlotGroups;
  frontend.findNode = findNode;
  frontend.findPortSlot = findPortSlot;
  frontend.updateNodePortEdge = updateNodePortEdge;
  frontend.renderNodes = renderNodes;
  frontend.setSelectedNodes = setSelectedNodes;
  frontend.clearSelection = clearSelection;
  frontend.selectOnlyNode = selectOnlyNode;
  frontend.createNodeAt = createNodeAt;
  frontend.deleteNode = deleteNode;
})();
