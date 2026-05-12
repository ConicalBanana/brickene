(() => {
  const frontend = window.BrickeneFrontend;
  const { config, dom } = frontend;
  const brickDefinitions = frontend.brickDefinitions || {};
  const brickTypeOptions = Object.entries(brickDefinitions).map(([name, definition]) => ({
    name,
    definition,
    label: formatBrickOptionLabel(name, definition.alias || []),
  }));
  const defaultBrickName = brickTypeOptions[0]?.name || null;

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatBrickOptionLabel(name, aliases) {
    return aliases.length ? `${name}(${aliases.join(",")})` : name;
  }

  function getBrickDefinition(brickName) {
    return brickDefinitions[brickName] || brickDefinitions[defaultBrickName] || null;
  }

  function getBrickPortNodes(brickName) {
    const definition = getBrickDefinition(brickName);
    return definition?.nodes.filter((node) => node.kind === "port") || [];
  }

  function getSlotSide(index, total) {
    return index === 0 && total > 0 ? "left" : "right";
  }

  function createPortSlots(nport) {
    return Array.from({ length: nport }, (_, index) => ({
      id: index,
      label: `P${index + 1}`,
      side: getSlotSide(index, nport),
      actualPortName: "Unassigned",
      edgeId: null,
    }));
  }

  function createPortSlotsFromBrick(brickName) {
    const portNodes = getBrickPortNodes(brickName);

    if (!portNodes.length) {
      return createPortSlots(config.defaultPortCount);
    }

    return portNodes.map((portNode, index) => ({
      id: index,
      label: `P${index + 1}`,
      side: getSlotSide(index, portNodes.length),
      actualPortName: `Port ${portNode.index}`,
      actualPortIndex: portNode.index,
      preferredBrickType: portNode.preferred_brick_type || "",
      edgeId: null,
    }));
  }

  function buildNode(nodeConfig) {
    const brickName = getBrickDefinition(nodeConfig.brickName) ? nodeConfig.brickName : defaultBrickName;
    const brickDefinition = getBrickDefinition(brickName);
    const portSlots = nodeConfig.portSlots?.map((slot) => ({ ...slot })) ?? createPortSlotsFromBrick(brickName);

    return {
      ...nodeConfig,
      type: nodeConfig.type || "rectangular",
      title: nodeConfig.title || `Node ${nodeConfig.id}`,
      brickName,
      brickType: brickDefinition?.brick_type || "UNCONFIGURED",
      nport: portSlots.length,
      portSlots,
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
      leftSlots: node.portSlots.filter((slot) => slot.side === "left"),
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

  function renderNodeTypeOptions(selectedBrickName) {
    return brickTypeOptions.map((option) => `
      <option value="${escapeHtml(option.name)}"${option.name === selectedBrickName ? " selected" : ""}>
        ${escapeHtml(option.label)}
      </option>
    `).join("");
  }

  function renderPortEntry(node, slot, side, ui) {
    const isHoverTarget = ui.componentInteraction?.type === "edge-drag"
      && ui.componentInteraction.hoverPort?.nodeId === node.id
      && ui.componentInteraction.hoverPort?.slotId === slot.id;
    const isLeft = side === "left";

    return `
      <div class="node-port-entry node-port-entry-${side}">
        ${isLeft ? `
          <button
            type="button"
            class="node-port node-port-left${isHoverTarget ? " is-hover-target" : ""}"
            data-node-id="${node.id}"
            data-slot-id="${slot.id}"
            aria-label="${escapeHtml(node.title)} ${escapeHtml(slot.actualPortName)}"
          ></button>
          <div class="node-port-info node-port-info-left">
            <p class="node-port-name">${escapeHtml(slot.actualPortName)}</p>
          </div>
        ` : `
          <div class="node-port-info node-port-info-right">
            <p class="node-port-name">${escapeHtml(slot.actualPortName)}</p>
          </div>
          <button
            type="button"
            class="node-port node-port-right${isHoverTarget ? " is-hover-target" : ""}"
            data-node-id="${node.id}"
            data-slot-id="${slot.id}"
            aria-label="${escapeHtml(node.title)} ${escapeHtml(slot.actualPortName)}"
          ></button>
        `}
      </div>
    `;
  }

  function setNodeBrickName(nodeId, brickName) {
    const graph = frontend.getGraphState();
    const ui = frontend.getUiState();
    const node = findNode(nodeId);
    const brickDefinition = getBrickDefinition(brickName);

    if (!node || !brickDefinition || node.brickName === brickName) {
      return { updated: false, removedEdgeCount: 0 };
    }

    const removedEdgeIds = graph.edges
      .filter((edge) => edge.from.nodeId === nodeId || edge.to.nodeId === nodeId)
      .map((edge) => edge.id);

    graph.edges = graph.edges.filter((edge) => !removedEdgeIds.includes(edge.id));
    graph.nodes = graph.nodes.map((graphNode) => {
      const clearedPortSlots = removedEdgeIds.length
        ? graphNode.portSlots.map((slot) => (
          removedEdgeIds.includes(slot.edgeId) ? { ...slot, edgeId: null } : slot
        ))
        : graphNode.portSlots;

      if (graphNode.id !== nodeId) {
        return removedEdgeIds.length ? { ...graphNode, portSlots: clearedPortSlots } : graphNode;
      }

      const nextPortSlots = createPortSlotsFromBrick(brickName);
      return {
        ...graphNode,
        brickName,
        brickType: brickDefinition.brick_type,
        nport: nextPortSlots.length,
        portSlots: nextPortSlots,
      };
    });

    ui.selectedNodeIds = new Set([nodeId]);
    renderNodes();
    return { updated: true, removedEdgeCount: removedEdgeIds.length };
  }

  function handleNodeTypeChange(event) {
    const select = event.target.closest(".node-type-select");
    if (!select) {
      return;
    }

    const nodeId = Number(select.dataset.nodeId);
    const brickName = select.value;
    const result = setNodeBrickName(nodeId, brickName);
    if (!result.updated) {
      return;
    }

    const removedEdgeCopy = result.removedEdgeCount > 0
      ? ` ${result.removedEdgeCount} edge(s) cleared.`
      : "";
    frontend.setCanvasMessage(`Node ${nodeId} switched to ${brickName}.${removedEdgeCopy}`);
  }

  function bindNodeControlEvents() {
    dom.nodeContainer.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".node-control")) {
        event.stopPropagation();
      }
    });

    dom.nodeContainer.addEventListener("change", handleNodeTypeChange);
  }

  function renderRectangularNode(node) {
    const ui = frontend.getUiState();
    const isSelected = ui.selectedNodeIds.has(node.id);
    const isDragging = ui.componentInteraction?.type === "node-drag" && ui.componentInteraction.nodeId === node.id;
    const { leftSlots, rightSlots } = getPortSlotGroups(node);

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
              <p class="overlay-label">${escapeHtml(node.brickType)}</p>
              <p class="node-title">${escapeHtml(node.title)}</p>
              <p class="node-subtitle">${node.nport} mapped port${node.nport === 1 ? "" : "s"}</p>
            </div>
            <div class="node-body">
              <label class="node-type-field">
                <span class="node-type-label">Node type</span>
                <select
                  class="node-type-select node-control"
                  data-node-id="${node.id}"
                  aria-label="${escapeHtml(node.title)} type"
                >
                  ${renderNodeTypeOptions(node.brickName)}
                </select>
              </label>
              <div class="node-structure-preview" aria-hidden="true">
                <p class="node-structure-preview-label">Structure preview reserved</p>
              </div>
            </div>
          </div>
          <div class="node-port-area" aria-hidden="true">
            <p class="node-port-area-label">Port components</p>
            <div class="node-port-area-content">
              <div class="node-port-column node-port-column-left">
                ${leftSlots.map((slot) => renderPortEntry(node, slot, "left", ui)).join("")}
              </div>
              <div class="node-port-column node-port-column-right">
                ${rightSlots.map((slot) => renderPortEntry(node, slot, "right", ui)).join("")}
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
      brickName: defaultBrickName,
      x: worldX,
      y: worldY,
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
  frontend.createPortSlotsFromBrick = createPortSlotsFromBrick;
  frontend.buildNode = buildNode;
  frontend.getPortSlotGroups = getPortSlotGroups;
  frontend.findNode = findNode;
  frontend.findPortSlot = findPortSlot;
  frontend.updateNodePortEdge = updateNodePortEdge;
  frontend.setNodeBrickName = setNodeBrickName;
  frontend.renderNodes = renderNodes;
  frontend.setSelectedNodes = setSelectedNodes;
  frontend.clearSelection = clearSelection;
  frontend.selectOnlyNode = selectOnlyNode;
  frontend.createNodeAt = createNodeAt;
  frontend.deleteNode = deleteNode;

  bindNodeControlEvents();
})();
