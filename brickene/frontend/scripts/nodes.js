(() => {
  const frontend = window.BrickeneFrontend;
  const { config, dom } = frontend;
  const rawBrickDefinitions = frontend.brickDefinitions || {};
  const brickCatalog = Object.entries(rawBrickDefinitions)
    .map(([configKey, definition]) => normalizeBrickDefinition(configKey, definition))
    .sort((left, right) => Number(left.id) - Number(right.id));
  const brickDefinitionsById = Object.fromEntries(
    brickCatalog.map((definition) => [definition.id, definition]),
  );
  const brickIdByName = new Map(
    brickCatalog.map((definition) => [definition.name, definition.id]),
  );
  const brickTypeOptions = brickCatalog.map((definition) => ({
    id: definition.id,
    definition,
    label: formatBrickOptionLabel(definition.name, definition.alias || []),
  }));
  const brickTypeGroups = brickTypeOptions.reduce((groups, option) => {
    const groupLabel = option.definition.brick_type || "UNCONFIGURED";

    if (!groups[groupLabel]) {
      groups[groupLabel] = [];
    }

    groups[groupLabel].push(option);
    return groups;
  }, {});
  const defaultBrickId = brickTypeOptions[0]?.id || null;

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

  function normalizeBrickDefinition(configKey, definition) {
    const id = String(definition.id ?? configKey);

    return {
      ...definition,
      id,
      name: definition.name || configKey,
      imageSrc: `../assets/brick_images/${encodeURIComponent(id)}.png`,
    };
  }

  function getBrickDefinition(brickRef) {
    const reference = String(brickRef ?? "");

    if (brickDefinitionsById[reference]) {
      return brickDefinitionsById[reference];
    }

    const resolvedId = brickIdByName.get(reference);
    if (resolvedId) {
      return brickDefinitionsById[resolvedId] || null;
    }

    return brickDefinitionsById[defaultBrickId] || null;
  }

  function getBrickPortNodes(brickRef) {
    const definition = getBrickDefinition(brickRef);
    return definition?.nodes.filter((node) => node.kind === "port") || [];
  }

  function formatPortNotation(portNode) {
    const connectedSymbol = portNode.connected_symbol || "?";
    return `${portNode.index},${connectedSymbol}`;
  }

  function createPortPoolFromBrick(brickRef) {
    return getBrickPortNodes(brickRef).map((portNode) => ({
      id: String(portNode.index),
      index: portNode.index,
      connectedSymbol: portNode.connected_symbol || "?",
      preferredBrickType: portNode.preferred_brick_type || "",
      label: formatPortNotation(portNode),
    }));
  }

  function getSlotSide(index, total) {
    return index === 0 && total > 0 ? "left" : "right";
  }

  function createPortSlots(nport) {
    return Array.from({ length: nport }, (_, index) => ({
      id: index,
      label: `P${index + 1}`,
      side: getSlotSide(index, nport),
      actualPortId: null,
      edgeId: null,
    }));
  }

  function createPortSlotsFromBrick(brickRef) {
    const portPool = createPortPoolFromBrick(brickRef);

    if (!portPool.length) {
      return {
        portPool: [],
        portSlots: createPortSlots(config.defaultPortCount),
      };
    }

    return {
      portPool,
      portSlots: portPool.map((portOption, index) => ({
      id: index,
      label: `P${index + 1}`,
      side: getSlotSide(index, portPool.length),
      actualPortId: portOption.id,
      edgeId: null,
      })),
    };
  }

  function getPortOptionById(node, portId) {
    return node.portPool.find((portOption) => portOption.id === String(portId)) || null;
  }

  function getSlotPortOption(node, slot) {
    return getPortOptionById(node, slot.actualPortId);
  }

  function getEffectiveSlotSide(node, slot) {
    if (node.isStartNode) {
      return "right";
    }

    return slot.side;
  }

  function getSlotPortLabel(node, slot) {
    const portOption = getSlotPortOption(node, slot);
    return portOption?.label || "Unassigned";
  }

  function buildNode(nodeConfig) {
    const brickDefinition = getBrickDefinition(nodeConfig.brickId || nodeConfig.brickName);
    const brickId = brickDefinition?.id || defaultBrickId;
    const defaultPortData = createPortSlotsFromBrick(brickId);
    const portPool = nodeConfig.portPool?.map((portOption) => ({ ...portOption })) ?? defaultPortData.portPool;
    const portSlots = nodeConfig.portSlots?.map((slot) => ({ ...slot })) ?? defaultPortData.portSlots;

    return {
      ...nodeConfig,
      type: nodeConfig.type || "rectangular",
      title: nodeConfig.title || `Node ${nodeConfig.id}`,
      brickId,
      brickName: brickDefinition?.name || "Unknown",
      brickImageSrc: brickDefinition?.imageSrc || "",
      brickType: brickDefinition?.brick_type || "UNCONFIGURED",
      isStartNode: Boolean(nodeConfig.isStartNode),
      portPool,
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
      leftSlots: node.portSlots.filter((slot) => getEffectiveSlotSide(node, slot) === "left"),
      rightSlots: node.portSlots.filter((slot) => getEffectiveSlotSide(node, slot) === "right"),
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

  function renderNodeTypeOptions(selectedBrickId) {
    return Object.entries(brickTypeGroups).map(([groupLabel, options]) => `
      <optgroup label="${escapeHtml(groupLabel)}">
        ${options.map((option) => `
          <option value="${escapeHtml(option.id)}"${option.id === selectedBrickId ? " selected" : ""}>
            ${escapeHtml(option.label)}
          </option>
        `).join("")}
      </optgroup>
    `).join("");
  }

  function renderPortAssignmentOptions(node, selectedPortId) {
    return node.portPool.map((portOption) => `
      <option value="${escapeHtml(portOption.id)}"${portOption.id === String(selectedPortId) ? " selected" : ""}>
        ${escapeHtml(portOption.label)}
      </option>
    `).join("");
  }

  function renderStructurePreview(node) {
    if (!node.brickImageSrc) {
      return '<p class="node-structure-empty">No structure image</p>';
    }

    return `
      <img
        class="node-structure-image"
        src="${escapeHtml(node.brickImageSrc)}"
        alt="${escapeHtml(node.brickName)} structure"
      />
      <div class="node-structure-mask" aria-hidden="true"></div>
    `;
  }

  function setNodeStartState(nodeId, isStartNode) {
    const graph = frontend.getGraphState();
    const node = findNode(nodeId);

    if (!node || node.isStartNode === isStartNode) {
      return { updated: false };
    }

    graph.nodes = graph.nodes.map((graphNode) => (
      graphNode.id === nodeId
        ? { ...graphNode, isStartNode }
        : graphNode
    ));

    renderNodes();
    frontend.notifyGraphChanged({ reason: "node-start-state", nodeId });
    return { updated: true };
  }

  function renderPortEntry(node, slot, side, ui) {
    const isHoverTarget = ui.componentInteraction?.type === "edge-drag"
      && ui.componentInteraction.hoverPort?.nodeId === node.id
      && ui.componentInteraction.hoverPort?.slotId === slot.id;
    const isLeft = side === "left";
    const slotPortLabel = getSlotPortLabel(node, slot);

    return `
      <div class="node-port-entry node-port-entry-${side}">
        ${isLeft ? `
          <button
            type="button"
            class="node-port node-port-left${isHoverTarget ? " is-hover-target" : ""}"
            data-node-id="${node.id}"
            data-slot-id="${slot.id}"
            aria-label="${escapeHtml(node.title)} ${escapeHtml(slotPortLabel)}"
          ></button>
          <div class="node-port-info node-port-info-left">
            <select
              class="node-port-select node-control"
              data-node-id="${node.id}"
              data-slot-id="${slot.id}"
              aria-label="${escapeHtml(node.title)} slot ${slot.id + 1} port assignment"
            >
              ${renderPortAssignmentOptions(node, slot.actualPortId)}
            </select>
          </div>
        ` : `
          <div class="node-port-info node-port-info-right">
            <select
              class="node-port-select node-control"
              data-node-id="${node.id}"
              data-slot-id="${slot.id}"
              aria-label="${escapeHtml(node.title)} slot ${slot.id + 1} port assignment"
            >
              ${renderPortAssignmentOptions(node, slot.actualPortId)}
            </select>
          </div>
          <button
            type="button"
            class="node-port node-port-right${isHoverTarget ? " is-hover-target" : ""}"
            data-node-id="${node.id}"
            data-slot-id="${slot.id}"
            aria-label="${escapeHtml(node.title)} ${escapeHtml(slotPortLabel)}"
          ></button>
        `}
      </div>
    `;
  }

  function swapAssignedPorts(nodeId, sourceSlotId, destinationPortId) {
    const graph = frontend.getGraphState();
    const node = findNode(nodeId);

    if (!node) {
      return { updated: false, portLabel: "" };
    }

    const normalizedPortId = String(destinationPortId);
    const sourceSlot = node.portSlots.find((slot) => slot.id === sourceSlotId);
    const destinationSlot = node.portSlots.find((slot) => slot.actualPortId === normalizedPortId);
    const destinationPort = getPortOptionById(node, normalizedPortId);

    if (!sourceSlot || !destinationPort || sourceSlot.actualPortId === normalizedPortId) {
      return { updated: false, portLabel: destinationPort?.label || "" };
    }

    graph.nodes = graph.nodes.map((graphNode) => {
      if (graphNode.id !== nodeId) {
        return graphNode;
      }

      return {
        ...graphNode,
        portSlots: graphNode.portSlots.map((slot) => {
          if (slot.id === sourceSlotId) {
            return { ...slot, actualPortId: normalizedPortId };
          }

          if (destinationSlot && slot.id === destinationSlot.id) {
            return { ...slot, actualPortId: sourceSlot.actualPortId };
          }

          return slot;
        }),
      };
    });

    renderNodes();
    frontend.notifyGraphChanged({ reason: "node-port-assignment" });
    return { updated: true, portLabel: destinationPort.label };
  }

  function setNodeBrickName(nodeId, brickRef) {
    const graph = frontend.getGraphState();
    const ui = frontend.getUiState();
    const node = findNode(nodeId);
    const brickDefinition = getBrickDefinition(brickRef);

    if (!node || !brickDefinition || node.brickId === brickDefinition.id) {
      return { updated: false, removedEdgeCount: 0, brickName: node?.brickName || "" };
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

      const nextPortData = createPortSlotsFromBrick(brickDefinition.id);
      return {
        ...graphNode,
        brickId: brickDefinition.id,
        brickName: brickDefinition.name,
        brickImageSrc: brickDefinition.imageSrc,
        brickType: brickDefinition.brick_type,
        portPool: nextPortData.portPool,
        nport: nextPortData.portSlots.length,
        portSlots: nextPortData.portSlots,
      };
    });

    ui.selectedNodeIds = new Set([nodeId]);
    renderNodes();
    frontend.notifyGraphChanged({ reason: "node-brick-type" });
    return { updated: true, removedEdgeCount: removedEdgeIds.length, brickName: brickDefinition.name };
  }

  function handleNodeTypeChange(event) {
    const select = event.target.closest(".node-type-select");
    if (!select) {
      return;
    }

    const nodeId = Number(select.dataset.nodeId);
    const brickId = select.value;
    const result = setNodeBrickName(nodeId, brickId);
    if (!result.updated) {
      return;
    }

    const removedEdgeCopy = result.removedEdgeCount > 0
      ? ` ${result.removedEdgeCount} edge(s) cleared.`
      : "";
    frontend.setCanvasMessage(`Node ${nodeId} switched to ${result.brickName}.${removedEdgeCopy}`);
  }

  function handlePortAssignmentChange(event) {
    const select = event.target.closest(".node-port-select");
    if (!select) {
      return;
    }

    const nodeId = Number(select.dataset.nodeId);
    const slotId = Number(select.dataset.slotId);
    const result = swapAssignedPorts(nodeId, slotId, select.value);
    if (!result.updated) {
      return;
    }

    frontend.setCanvasMessage(`Node ${nodeId} slot ${slotId + 1} assigned to ${result.portLabel}.`);
  }

  function handleNodeStartStateChange(event) {
    const checkbox = event.target.closest(".node-start-toggle");
    if (!checkbox) {
      return;
    }

    const nodeId = Number(checkbox.dataset.nodeId);
    const result = setNodeStartState(nodeId, checkbox.checked);
    if (!result.updated) {
      return;
    }

    frontend.setCanvasMessage(
      checkbox.checked
        ? `Node ${nodeId} marked as start node.`
        : `Node ${nodeId} start node cleared.`,
    );
  }

  function bindNodeControlEvents() {
    dom.nodeContainer.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".node-control")) {
        event.stopPropagation();
      }
    });

    dom.nodeContainer.addEventListener("change", (event) => {
      if (event.target.closest(".node-type-select")) {
        handleNodeTypeChange(event);
        return;
      }

      if (event.target.closest(".node-port-select")) {
        handlePortAssignmentChange(event);
        return;
      }

      if (event.target.closest(".node-start-toggle")) {
        handleNodeStartStateChange(event);
      }
    });
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
            </div>
            <div class="node-body">
              <label class="node-type-field">
                <span class="node-type-label">Node type</span>
                <select
                  class="node-type-select node-control"
                  data-node-id="${node.id}"
                  aria-label="${escapeHtml(node.title)} type"
                >
                  ${renderNodeTypeOptions(node.brickId)}
                </select>
              </label>
              <div class="node-structure-preview">
                ${renderStructurePreview(node)}
              </div>
            </div>
          </div>
          <div class="node-port-area">
            <label class="node-start-option">
              <input
                type="checkbox"
                class="node-start-toggle node-control"
                data-node-id="${node.id}"
                ${node.isStartNode ? "checked" : ""}
              />
              <span>Start node</span>
            </label>
            <div class="node-port-area-content${node.isStartNode ? " is-start-node" : ""}">
              ${node.isStartNode ? "" : `
              <div class="node-port-column node-port-column-left">
                ${leftSlots.map((slot) => renderPortEntry(node, slot, "left", ui)).join("")}
              </div>
              `}
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

    if (!hasSelectionChanged(nodeIds) && ui.selectedEdgeIds.size === 0) {
      return;
    }

    ui.selectedNodeIds = new Set(nodeIds);
    ui.selectedEdgeIds = new Set();
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
      brickId: defaultBrickId,
      x: worldX,
      y: worldY,
    });

    graph.nextNodeId += 1;
    graph.nodes = [...graph.nodes, newNode];
    renderNodes();
    selectOnlyNode(newNode.id);
    frontend.notifyGraphChanged({ reason: "node-created", nodeId: newNode.id });
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
    ui.selectedEdgeIds = new Set(
      [...ui.selectedEdgeIds].filter((edgeId) => !removedEdgeIds.includes(edgeId)),
    );
    renderNodes();
    frontend.notifyGraphChanged({ reason: "node-deleted", nodeId });
  }

  frontend.seedGraphState = seedGraphState;
  frontend.createPortSlots = createPortSlots;
  frontend.createPortSlotsFromBrick = createPortSlotsFromBrick;
  frontend.buildNode = buildNode;
  frontend.getEffectiveSlotSide = getEffectiveSlotSide;
  frontend.getPortSlotGroups = getPortSlotGroups;
  frontend.findNode = findNode;
  frontend.findPortSlot = findPortSlot;
  frontend.getSlotPortLabel = getSlotPortLabel;
  frontend.updateNodePortEdge = updateNodePortEdge;
  frontend.setNodeBrickName = setNodeBrickName;
  frontend.setNodeStartState = setNodeStartState;
  frontend.renderNodes = renderNodes;
  frontend.setSelectedNodes = setSelectedNodes;
  frontend.clearSelection = clearSelection;
  frontend.selectOnlyNode = selectOnlyNode;
  frontend.createNodeAt = createNodeAt;
  frontend.deleteNode = deleteNode;

  bindNodeControlEvents();
})();
