(() => {
  const frontend = window.BrickeneFrontend;
  const { config, dom } = frontend;
  const USER_DEFINED_BRICK_ID = "901";
  const PERIOD_BRICK_ID = "902";
  const DEFAULT_NODE_IMAGE_SOURCE_WIDTH = 512;
  const DEFAULT_NODE_IMAGE_SOURCE_HEIGHT = 268;
  const NODE_IMAGE_DISPLAY_SCALE = 0.75;
  const DUPLICATOR_IMAGE_SRC = "../assets/images/duplicator.svg";
  const DUPLICATOR_IMAGE_SOURCE_WIDTH = 465;
  const DUPLICATOR_IMAGE_SOURCE_HEIGHT = 255;
  const NODE_IMAGE_DISPLAY_WIDTH = 320;
  const NODE_IMAGE_FRAME_MARGIN = 10;
  const DUPLICATOR_SURFACE_WIDTH = (NODE_IMAGE_DISPLAY_WIDTH + NODE_IMAGE_FRAME_MARGIN * 2) / 3;
  const DUPLICATOR_IMAGE_DISPLAY_WIDTH = Math.max(1, DUPLICATOR_SURFACE_WIDTH - NODE_IMAGE_FRAME_MARGIN * 2);
  const DUPLICATOR_IMAGE_DISPLAY_HEIGHT = DUPLICATOR_IMAGE_SOURCE_HEIGHT
    * (NODE_IMAGE_DISPLAY_WIDTH / DUPLICATOR_IMAGE_SOURCE_WIDTH);
  const NODE_PORT_OUTSIDE_EXTENSION = 16;
  const NODE_PORT_OVERLAP_DISTANCE = 18;
  const NODE_PORT_OVERLAP_EXTENSION = 14;
  const brickImageSizeCache = new Map();
  const brickImageSizeRequests = new Map();
  const brickImageLayoutCache = new Map();
  const brickImageLayoutRequests = new Map();
  let brickCatalog = [];
  let brickDefinitionsById = {};
  let brickIdByName = new Map();
  let brickTypeOptions = [];
  let brickTypeGroups = {};
  let defaultBrickId = null;

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

  function getBrickSortKey(brickId) {
    const normalizedId = String(brickId ?? "");
    const numericMatch = normalizedId.match(/^\d+$/);
    if (numericMatch) {
      return { bucket: 0, value: Number(normalizedId) };
    }

    const storedMatch = normalizedId.match(/^user-(\d+)$/i);
    if (storedMatch) {
      return { bucket: 1, value: Number(storedMatch[1]) };
    }

    return { bucket: 2, value: Number.POSITIVE_INFINITY };
  }

  function buildBrickAssetUrl(brickId, assetName) {
    const brickApiBaseUrl = String(
      config?.brickApiUrl || "http://127.0.0.1:8765/bricks",
    ).replace(/\/?$/, "/");
    return new URL(
      `${encodeURIComponent(String(brickId))}/${assetName}`,
      brickApiBaseUrl,
    ).toString();
  }

  function compareBrickDefinitions(left, right) {
    const leftKey = getBrickSortKey(left.id);
    const rightKey = getBrickSortKey(right.id);

    if (leftKey.bucket !== rightKey.bucket) {
      return leftKey.bucket - rightKey.bucket;
    }

    if (leftKey.value !== rightKey.value) {
      return leftKey.value - rightKey.value;
    }

    return String(left.name || left.id).localeCompare(String(right.name || right.id));
  }

  function rebuildBrickCatalog(rawDefinitions = frontend.brickDefinitions || {}) {
    brickCatalog = Object.entries(rawDefinitions)
      .map(([configKey, definition]) => normalizeBrickDefinition(configKey, definition))
      .sort(compareBrickDefinitions);
    brickDefinitionsById = Object.fromEntries(
      brickCatalog.map((definition) => [definition.id, definition]),
    );
    brickIdByName = new Map(
      brickCatalog.map((definition) => [definition.name, definition.id]),
    );
    brickTypeOptions = brickCatalog.map((definition) => ({
      id: definition.id,
      definition,
      label: formatBrickOptionLabel(definition.name, definition.alias || []),
    }));
    brickTypeGroups = brickTypeOptions.reduce((groups, option) => {
      const groupLabel = option.definition.brick_type || "UNCONFIGURED";

      if (!groups[groupLabel]) {
        groups[groupLabel] = [];
      }

      groups[groupLabel].push(option);
      return groups;
    }, {});
    defaultBrickId = brickTypeOptions[0]?.id || null;
  }

  function registerBrickDefinition(definition) {
    const nextDefinitions = {
      ...(frontend.brickDefinitions || {}),
      [String(definition.id)]: definition,
    };

    frontend.brickDefinitions = nextDefinitions;
    rebuildBrickCatalog(nextDefinitions);
    return getBrickDefinition(definition.id, { allowDefault: false });
  }

  rebuildBrickCatalog();

  function normalizeBrickDefinition(configKey, definition) {
    const id = String(definition.id ?? configKey);
    const isToolNode = definition.brick_type === "TOOL";
    const supportsInlineConfiguration = Boolean(definition.inline_configuration);
    const hasStaticImage = (/^\d+$/.test(id) || /^user-\d+$/i.test(id)) && !isToolNode && !supportsInlineConfiguration;
    const isDuplicator = id === "900";
    const isPeriodNode = id === PERIOD_BRICK_ID;
    const isCompactTool = isDuplicator || isPeriodNode;

    return {
      ...definition,
      id,
      name: definition.name || configKey,
      imageSrc: hasStaticImage
        ? buildBrickAssetUrl(id, "image")
        : isDuplicator
          ? DUPLICATOR_IMAGE_SRC
          : "",
      imageLayoutSrc: hasStaticImage
        ? buildBrickAssetUrl(id, "layout")
        : "",
      hideStructurePreview: (isToolNode && !isCompactTool) || supportsInlineConfiguration || (!hasStaticImage && !isCompactTool),
      lockPortAssignments: isToolNode || supportsInlineConfiguration,
      supportsInlineConfiguration,
    };
  }

  function normalizeBrickImageLayout(payload) {
    if (!payload || typeof payload !== "object" || typeof payload.ports !== "object") {
      return null;
    }

    const imageWidth = Number(payload.image_width);
    const imageHeight = Number(payload.image_height);

    const portEntries = Object.entries(payload.ports)
      .map(([portId, portLayout]) => {
        const start = Array.isArray(portLayout?.port_start_pos)
          ? portLayout.port_start_pos.map((value) => Number(value))
          : null;
        const vector = Array.isArray(portLayout?.port_vec)
          ? portLayout.port_vec.map((value) => Number(value))
          : null;

        if (
          !start
          || !vector
          || start.length !== 2
          || vector.length !== 2
          || !start.every(Number.isFinite)
          || !vector.every(Number.isFinite)
        ) {
          return null;
        }

        return {
          portId: String(portId),
          startX: start[0],
          startY: start[1],
          vectorX: vector[0],
          vectorY: vector[1],
        };
      })
      .filter(Boolean);

    if (!portEntries.length) {
      return null;
    }

    const xValues = portEntries.flatMap((entry) => [entry.startX, entry.startX + entry.vectorX]);
    const yValues = portEntries.flatMap((entry) => [entry.startY, entry.startY + entry.vectorY]);
    const minX = Math.min(0, ...xValues);
    const minY = Math.min(0, ...yValues);
    const maxX = Math.max(DEFAULT_NODE_IMAGE_SOURCE_WIDTH, ...xValues);
    const maxY = Math.max(DEFAULT_NODE_IMAGE_SOURCE_HEIGHT, ...yValues);

    return {
      minX,
      minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      imageWidth: Number.isFinite(imageWidth) && imageWidth > 0 ? imageWidth : null,
      imageHeight: Number.isFinite(imageHeight) && imageHeight > 0 ? imageHeight : null,
      ports: Object.fromEntries(portEntries.map((entry) => [entry.portId, entry])),
    };
  }

  function cacheBrickImageLayout(imageLayoutSrc, layout) {
    brickImageLayoutCache.set(imageLayoutSrc, layout);
    window.requestAnimationFrame(() => {
      frontend.renderNodes?.();
    });
  }

  function cacheBrickImageSize(imageSrc, size) {
    brickImageSizeCache.set(imageSrc, size);
    window.requestAnimationFrame(() => {
      frontend.renderNodes?.();
    });
  }

  function ensureBrickImageSize(imageSrc) {
    if (!imageSrc || brickImageSizeCache.has(imageSrc) || brickImageSizeRequests.has(imageSrc)) {
      return;
    }

    const image = new Image();
    const request = new Promise((resolve) => {
      image.addEventListener("load", () => {
        resolve({
          width: image.naturalWidth || DEFAULT_NODE_IMAGE_SOURCE_WIDTH,
          height: image.naturalHeight || DEFAULT_NODE_IMAGE_SOURCE_HEIGHT,
        });
      }, { once: true });
      image.addEventListener("error", () => {
        resolve({
          width: DEFAULT_NODE_IMAGE_SOURCE_WIDTH,
          height: DEFAULT_NODE_IMAGE_SOURCE_HEIGHT,
        });
      }, { once: true });
    })
      .then((size) => {
        cacheBrickImageSize(imageSrc, size);
      })
      .finally(() => {
        brickImageSizeRequests.delete(imageSrc);
      });

    brickImageSizeRequests.set(imageSrc, request);
    image.src = imageSrc;
  }

  function getBrickImageSize(imageSrc) {
    if (!imageSrc) {
      return null;
    }

    if (!brickImageSizeCache.has(imageSrc)) {
      ensureBrickImageSize(imageSrc);
      return null;
    }

    return brickImageSizeCache.get(imageSrc);
  }

  function ensureBrickImageLayout(imageLayoutSrc) {
    if (!imageLayoutSrc || brickImageLayoutCache.has(imageLayoutSrc) || brickImageLayoutRequests.has(imageLayoutSrc)) {
      return;
    }

    const request = fetch(imageLayoutSrc)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => normalizeBrickImageLayout(payload))
      .catch(() => null)
      .then((layout) => {
        cacheBrickImageLayout(imageLayoutSrc, layout);
      })
      .finally(() => {
        brickImageLayoutRequests.delete(imageLayoutSrc);
      });

    brickImageLayoutRequests.set(imageLayoutSrc, request);
  }

  function getBrickImageLayout(imageLayoutSrc) {
    if (!imageLayoutSrc) {
      return null;
    }

    if (!brickImageLayoutCache.has(imageLayoutSrc)) {
      ensureBrickImageLayout(imageLayoutSrc);
      return null;
    }

    return brickImageLayoutCache.get(imageLayoutSrc);
  }

  function buildInlineConfigurationTemplate(sourceDefinition) {
    const templateSource = sourceDefinition || getBrickDefinition(defaultBrickId);
    return JSON.stringify({
      name: templateSource?.name || "User defined",
      alias: Array.isArray(templateSource?.alias) ? templateSource.alias : [],
      brick_type: templateSource?.brick_type && templateSource.brick_type !== "TOOL"
        ? templateSource.brick_type
        : "BRIDGE",
      nodes: Array.isArray(templateSource?.nodes)
        ? templateSource.nodes.map((node) => ({ ...node }))
        : [],
      edges: Array.isArray(templateSource?.edges)
        ? templateSource.edges.map((edge) => (Array.isArray(edge) ? [...edge] : edge))
        : [],
    }, null, 2);
  }

  function parseInlineBrickDefinitionText(customConfigText, fallbackId = USER_DEFINED_BRICK_ID) {
    if (typeof customConfigText !== "string" || !customConfigText.trim()) {
      return { brickDefinition: null, error: "" };
    }

    let payload;
    try {
      payload = JSON.parse(customConfigText);
    } catch (error) {
      return {
        brickDefinition: null,
        error: "Node configuration must be valid JSON.",
      };
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {
        brickDefinition: null,
        error: "Node configuration must decode to a JSON object.",
      };
    }

    if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
      return {
        brickDefinition: null,
        error: "Node configuration must include node and edge arrays.",
      };
    }

    return {
      brickDefinition: normalizeBrickDefinition(fallbackId, {
        ...payload,
        id: fallbackId,
        name: String(payload.name || "User defined"),
        alias: Array.isArray(payload.alias)
          ? payload.alias
            .filter((alias) => typeof alias === "string" && alias.trim())
            .map((alias) => alias.trim())
          : [],
        brick_type: String(payload.brick_type || "UNCONFIGURED").toUpperCase(),
        nodes: payload.nodes.map((node) => ({ ...node })),
        edges: payload.edges.map((edge) => (Array.isArray(edge) ? [...edge] : edge)),
        inline_configuration: true,
      }),
      error: "",
    };
  }

  function resolveBrickDefinition(nodeConfig) {
    const brickReference = String(nodeConfig.brickId || nodeConfig.brickName || "");
    const catalogDefinition = getBrickDefinition(brickReference, { allowDefault: false });
    const customConfigText = typeof nodeConfig.customConfigText === "string" ? nodeConfig.customConfigText : "";

    if (!catalogDefinition) {
      const parsed = parseInlineBrickDefinitionText(
        customConfigText,
        brickReference || USER_DEFINED_BRICK_ID,
      );

      if (parsed.error) {
        return {
          brickDefinition: getBrickDefinition(defaultBrickId, { allowDefault: false }),
          customConfigText,
          customConfigError: parsed.error,
        };
      }

      if (parsed.brickDefinition) {
        const fallbackDefinition = registerBrickDefinition(parsed.brickDefinition);

        return {
          brickDefinition: fallbackDefinition || parsed.brickDefinition,
          customConfigText,
          customConfigError: "",
        };
      }

      return {
        brickDefinition: getBrickDefinition(defaultBrickId, { allowDefault: false }),
        customConfigText,
        customConfigError: brickReference ? `Unknown brick id: ${brickReference}.` : "",
      };
    }

    if (!catalogDefinition.supportsInlineConfiguration) {
      return {
        brickDefinition: catalogDefinition,
        customConfigText: "",
        customConfigError: "",
      };
    }

    const parsed = parseInlineBrickDefinitionText(customConfigText);
    if (parsed.error) {
      return {
        brickDefinition: catalogDefinition,
        customConfigText,
        customConfigError: parsed.error,
      };
    }

    return {
      brickDefinition: parsed.brickDefinition || catalogDefinition,
      customConfigText,
      customConfigError: "",
    };
  }

  function getBrickDefinition(brickRef, options = {}) {
    const reference = String(brickRef ?? "");

    if (brickDefinitionsById[reference]) {
      return brickDefinitionsById[reference];
    }

    const resolvedId = brickIdByName.get(reference);
    if (resolvedId) {
      return brickDefinitionsById[resolvedId] || null;
    }

    if (options.allowDefault === false) {
      return null;
    }

    return brickDefinitionsById[defaultBrickId] || null;
  }

  function getDefinitionPortNodes(brickDefinition) {
    return (brickDefinition?.nodes || [])
      .filter((node) => node.kind === "port")
      .slice()
      .sort((left, right) => Number(left.index) - Number(right.index));
  }

  function formatPortNotation(portNode) {
    const connectedSymbol = portNode.connected_symbol || "?";
    return connectedSymbol === "?" ? String(portNode.index) : `${portNode.index},${connectedSymbol}`;
  }

  function createPortPoolFromDefinition(brickDefinition) {
    return getDefinitionPortNodes(brickDefinition).map((portNode) => ({
      id: String(portNode.index),
      index: portNode.index,
      connectedSymbol: portNode.connected_symbol || "?",
      preferredBrickType: portNode.preferred_brick_type || "",
      side: portNode.side || null,
      label: formatPortNotation(portNode),
    }));
  }

  function createPortPoolFromBrick(brickRef) {
    return createPortPoolFromDefinition(getBrickDefinition(brickRef));
  }

  function isPeriodBrickDefinition(brickDefinition) {
    return String(brickDefinition?.id || "") === PERIOD_BRICK_ID;
  }

  function isPeriodNode(node) {
    return String(node?.brickId || "") === PERIOD_BRICK_ID;
  }

  function isDirectionalBrickDefinition(brickDefinition) {
    return brickDefinition?.brick_type === "TOOL" && String(brickDefinition?.id) !== PERIOD_BRICK_ID;
  }

  function isDirectionalNode(node) {
    return node?.brickType === "TOOL" && String(node?.brickId) !== PERIOD_BRICK_ID;
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

  function createPortSlotsFromDefinition(brickDefinition) {
    const portPool = createPortPoolFromDefinition(brickDefinition);

    if (!portPool.length) {
      return {
        portPool: [],
        portSlots: brickDefinition?.supportsInlineConfiguration
          ? []
          : createPortSlots(config.defaultPortCount),
      };
    }

    return {
      portPool,
      portSlots: portPool.map((portOption, index) => ({
        id: index,
        label: `P${index + 1}`,
        side: isDirectionalBrickDefinition(brickDefinition)
          ? (portOption.side || getSlotSide(index, portPool.length))
          : null,
        actualPortId: portOption.id,
        edgeId: null,
      })),
    };
  }

  function createPortSlotsFromBrick(brickRef) {
    return createPortSlotsFromDefinition(getBrickDefinition(brickRef));
  }

  function getPortSortValue(node, slot) {
    const portOption = getSlotPortOption(node, slot);
    return Number(portOption?.index ?? slot.actualPortId ?? slot.id);
  }

  function getPortOptionById(node, portId) {
    return node.portPool.find((portOption) => portOption.id === String(portId)) || null;
  }

  function getSlotPortOption(node, slot) {
    return getPortOptionById(node, slot.actualPortId);
  }

  function getEffectiveSlotSide(node, slot) {
    return isDirectionalNode(node) ? slot.side : null;
  }

  function getSlotPortLabel(node, slot) {
    const portOption = getSlotPortOption(node, slot);
    return portOption?.label || "Unassigned";
  }

  function normalizePeriodNumber(value) {
    const normalized = String(value ?? "").trim();

    if (!/^\d+$/.test(normalized) || Number(normalized) <= 0) {
      return null;
    }

    return normalized;
  }

  function buildNode(nodeConfig) {
    const { brickDefinition, customConfigText, customConfigError } = resolveBrickDefinition(nodeConfig);
    const brickId = brickDefinition?.id || defaultBrickId;
    const defaultPortData = createPortSlotsFromDefinition(brickDefinition);
    const portPool = nodeConfig.portPool?.map((portOption) => ({ ...portOption })) ?? defaultPortData.portPool;
    const portSlots = nodeConfig.portSlots?.map((slot) => ({
      ...slot,
      side: isDirectionalBrickDefinition(brickDefinition) ? slot.side || null : null,
    })) ?? defaultPortData.portSlots;

    return {
      ...nodeConfig,
      type: nodeConfig.type || "rectangular",
      title: nodeConfig.title || `Node ${nodeConfig.id}`,
      brickId,
      brickName: brickDefinition?.name || "Unknown",
      brickImageSrc: brickDefinition?.imageSrc || "",
      brickImageLayoutSrc: brickDefinition?.imageLayoutSrc || "",
      brickType: brickDefinition?.brick_type || "UNCONFIGURED",
      hideStructurePreview: Boolean(brickDefinition?.hideStructurePreview),
      lockPortAssignments: Boolean(brickDefinition?.lockPortAssignments),
      supportsInlineConfiguration: Boolean(brickDefinition?.supportsInlineConfiguration),
      periodNumber: isPeriodBrickDefinition(brickDefinition)
        ? normalizePeriodNumber(nodeConfig.periodNumber ?? brickDefinition?.default_period_number) || "1"
        : null,
      customConfigText,
      customConfigError,
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
      leftSlots: node.portSlots
        .filter((slot) => getEffectiveSlotSide(node, slot) === "left")
        .slice()
        .sort((left, right) => getPortSortValue(node, left) - getPortSortValue(node, right)),
      neutralSlots: node.portSlots
        .filter((slot) => getEffectiveSlotSide(node, slot) === null)
        .slice()
        .sort((left, right) => getPortSortValue(node, left) - getPortSortValue(node, right)),
      rightSlots: node.portSlots
        .filter((slot) => getEffectiveSlotSide(node, slot) === "right")
        .slice()
        .sort((left, right) => getPortSortValue(node, left) - getPortSortValue(node, right)),
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

  function getBrickTypeGroups() {
    return Object.entries(brickTypeGroups).map(([label, options]) => ({
      label,
      options: options.map((option) => ({
        id: option.id,
        label: option.label,
        definition: { ...option.definition },
      })),
    }));
  }

  function renderPortAssignmentOptions(node, selectedPortId) {
    return node.portPool.map((portOption) => `
      <option value="${escapeHtml(portOption.id)}"${portOption.id === String(selectedPortId) ? " selected" : ""}>
        ${escapeHtml(portOption.label)}
      </option>
    `).join("");
  }

  function renderInlineConfigurationEditor(node) {
    const helperCopy = node.customConfigError
      ? node.customConfigError
      : "Paste a node definition JSON generated by the wizard, then click outside the box to apply it.";

    return `
      <label class="node-inline-config-field">
        <span class="node-type-label">Configuration</span>
        <textarea
          class="node-inline-config-input node-control"
          data-node-id="${node.id}"
          aria-label="Configuration"
          placeholder="Paste a wizard-generated node definition JSON here."
        >${escapeHtml(node.customConfigText || "")}</textarea>
      </label>
      <p class="node-inline-config-feedback${node.customConfigError ? " is-error" : ""}">${escapeHtml(helperCopy)}</p>
    `;
  }

  function getNodeImageMetrics(node) {
    const layout = getBrickImageLayout(node.brickImageLayoutSrc);
    const imageSize = getBrickImageSize(node.brickImageSrc);
    const isCompactTool = node.brickId === "900" || node.brickId === PERIOD_BRICK_ID;
    const fallbackWidth = isCompactTool
      ? DUPLICATOR_IMAGE_SOURCE_WIDTH
      : DEFAULT_NODE_IMAGE_SOURCE_WIDTH;
    const fallbackHeight = isCompactTool
      ? DUPLICATOR_IMAGE_SOURCE_HEIGHT
      : DEFAULT_NODE_IMAGE_SOURCE_HEIGHT;
    const sourceWidth = Math.max(
      1,
      Number(imageSize?.width) || Number(layout?.imageWidth) || fallbackWidth,
    );
    const sourceHeight = Math.max(
      1,
      Number(imageSize?.height) || Number(layout?.imageHeight) || fallbackHeight,
    );
    const imageWidth = isCompactTool ? DUPLICATOR_IMAGE_DISPLAY_WIDTH : sourceWidth * NODE_IMAGE_DISPLAY_SCALE;
    const scale = imageWidth / sourceWidth;
    const imageHeight = isCompactTool
      ? DUPLICATOR_IMAGE_DISPLAY_HEIGHT
      : sourceHeight * NODE_IMAGE_DISPLAY_SCALE;

    return {
      layout,
      scale,
      imageRect: {
        left: NODE_IMAGE_FRAME_MARGIN,
        top: NODE_IMAGE_FRAME_MARGIN,
        right: NODE_IMAGE_FRAME_MARGIN + imageWidth,
        bottom: NODE_IMAGE_FRAME_MARGIN + imageHeight,
      },
      surfaceWidth: imageWidth + NODE_IMAGE_FRAME_MARGIN * 2,
      surfaceHeight: imageHeight + NODE_IMAGE_FRAME_MARGIN * 2,
    };
  }

  function getPortDisplayId(slot) {
    return String(slot.actualPortId ?? slot.id + 1);
  }

  function getPortNumericId(slot) {
    const numericId = Number(getPortDisplayId(slot));
    return Number.isFinite(numericId) ? numericId : Number.MAX_SAFE_INTEGER;
  }

  function normalizeVector(vectorX, vectorY, side) {
    const length = Math.hypot(vectorX, vectorY);

    if (length > 0.001) {
      return {
        unitX: vectorX / length,
        unitY: vectorY / length,
        length,
      };
    }

    return {
      unitX: side === "left" ? -1 : 1,
      unitY: 0,
      length: NODE_PORT_OUTSIDE_EXTENSION,
    };
  }

  function pointIsInsideRect(point, rect) {
    return (
      point.x >= rect.left
      && point.x <= rect.right
      && point.y >= rect.top
      && point.y <= rect.bottom
    );
  }

  function getRayExitDistance(startPoint, direction, rect) {
    const distances = [];

    if (Math.abs(direction.unitX) > 0.0001) {
      [rect.left, rect.right].forEach((targetX) => {
        const distance = (targetX - startPoint.x) / direction.unitX;
        const targetY = startPoint.y + distance * direction.unitY;

        if (distance >= 0 && targetY >= rect.top - 0.1 && targetY <= rect.bottom + 0.1) {
          distances.push(distance);
        }
      });
    }

    if (Math.abs(direction.unitY) > 0.0001) {
      [rect.top, rect.bottom].forEach((targetY) => {
        const distance = (targetY - startPoint.y) / direction.unitY;
        const targetX = startPoint.x + distance * direction.unitX;

        if (distance >= 0 && targetX >= rect.left - 0.1 && targetX <= rect.right + 0.1) {
          distances.push(distance);
        }
      });
    }

    const positiveDistances = distances.filter((distance) => distance >= 0);
    return positiveDistances.length ? Math.min(...positiveDistances) : 0;
  }

  function buildFallbackPortLayout(side, index, total, metrics) {
    const positionY = metrics.imageRect.top
      + ((index + 1) / (Math.max(1, total) + 1)) * (metrics.imageRect.bottom - metrics.imageRect.top);

    return {
      startX: side === "left" ? metrics.imageRect.left : metrics.imageRect.right,
      startY: positionY,
      vectorX: side === "left" ? -NODE_PORT_OUTSIDE_EXTENSION : NODE_PORT_OUTSIDE_EXTENSION,
      vectorY: 0,
    };
  }

  function buildPortVisual(slot, node, sideIndex, sideTotal, metrics, ui) {
    const connectionSide = getEffectiveSlotSide(node, slot);
    const layoutEntry = metrics.layout?.ports?.[getPortDisplayId(slot)] || null;
    const visualSide = layoutEntry
      ? (layoutEntry.vectorX < 0 ? "left" : "right")
      : (connectionSide || slot.side || getSlotSide(sideIndex, sideTotal));
    const fallbackLayout = buildFallbackPortLayout(visualSide, sideIndex, sideTotal, metrics);
    const startX = layoutEntry
      ? metrics.imageRect.left + layoutEntry.startX * metrics.scale
      : fallbackLayout.startX;
    const startY = layoutEntry
      ? metrics.imageRect.top + layoutEntry.startY * metrics.scale
      : fallbackLayout.startY;
    const direction = normalizeVector(
      layoutEntry ? layoutEntry.vectorX * metrics.scale : fallbackLayout.vectorX,
      layoutEntry ? layoutEntry.vectorY * metrics.scale : fallbackLayout.vectorY,
      visualSide,
    );
    const exitDistance = getRayExitDistance({ x: startX, y: startY }, direction, metrics.imageRect);
    let portDistance = Math.max(direction.length, exitDistance + NODE_PORT_OUTSIDE_EXTENSION);
    let dotPoint = {
      x: startX + direction.unitX * portDistance,
      y: startY + direction.unitY * portDistance,
    };

    if (pointIsInsideRect(dotPoint, metrics.imageRect)) {
      portDistance = exitDistance + NODE_PORT_OUTSIDE_EXTENSION;
      dotPoint = {
        x: startX + direction.unitX * portDistance,
        y: startY + direction.unitY * portDistance,
      };
    }

    const isHoverTarget = ui.componentInteraction?.type === "edge-drag"
      && ui.componentInteraction.hoverPort?.nodeId === node.id
      && ui.componentInteraction.hoverPort?.slotId === slot.id;
    const isConnectedToSelectedEdge = slot.edgeId !== null && ui.selectedEdgeIds.has(slot.edgeId);

    return {
      slot,
      side: connectionSide || "neutral",
      labelSide: direction.unitX < 0 ? "left" : "right",
      portId: getPortDisplayId(slot),
      numericPortId: getPortNumericId(slot),
      startX,
      startY,
      unitX: direction.unitX,
      unitY: direction.unitY,
      distance: portDistance,
      dotX: dotPoint.x,
      dotY: dotPoint.y,
      isHoverTarget,
      isConnectedToSelectedEdge,
    };
  }

  function resolvePortOverlayCollisions(portVisuals) {
    const sortedVisuals = portVisuals.slice().sort((left, right) => left.numericPortId - right.numericPortId);

    sortedVisuals.forEach((currentVisual, currentIndex) => {
      for (let passIndex = 0; passIndex < 8; passIndex += 1) {
        const overlappingVisual = sortedVisuals.slice(0, currentIndex).find((previousVisual) => (
          Math.hypot(
            currentVisual.dotX - previousVisual.dotX,
            currentVisual.dotY - previousVisual.dotY,
          ) < NODE_PORT_OVERLAP_DISTANCE
        ));

        if (!overlappingVisual) {
          break;
        }

        currentVisual.distance += NODE_PORT_OVERLAP_EXTENSION;
        currentVisual.dotX = currentVisual.startX + currentVisual.unitX * currentVisual.distance;
        currentVisual.dotY = currentVisual.startY + currentVisual.unitY * currentVisual.distance;
      }
    });

    return portVisuals;
  }

  function resolvePortLabelCollisions(portVisuals) {
    const sortedVisuals = portVisuals.slice().sort((left, right) => left.numericPortId - right.numericPortId);

    sortedVisuals.forEach((currentVisual, currentIndex) => {
      currentVisual.labelOffsetY = 0;

      for (let passIndex = 0; passIndex < 8; passIndex += 1) {
        const overlappingVisual = sortedVisuals.slice(0, currentIndex).find((previousVisual) => (
          Math.abs(currentVisual.dotY + currentVisual.labelOffsetY - (previousVisual.dotY + (previousVisual.labelOffsetY || 0))) < 14
          && currentVisual.labelSide === previousVisual.labelSide
          && Math.abs(currentVisual.dotX - previousVisual.dotX) < 28
        ));

        if (!overlappingVisual) {
          break;
        }

        currentVisual.labelOffsetY += 14;
      }
    });

    return portVisuals;
  }

  function buildNodePortVisuals(node, metrics, ui) {
    const { leftSlots, neutralSlots, rightSlots } = getPortSlotGroups(node);
    const leftVisuals = leftSlots.map((slot, index) => buildPortVisual(slot, node, index, leftSlots.length, metrics, ui));
    const neutralVisuals = neutralSlots.map((slot, index) => buildPortVisual(slot, node, index, neutralSlots.length, metrics, ui));
    const rightVisuals = rightSlots.map((slot, index) => buildPortVisual(slot, node, index, rightSlots.length, metrics, ui));

    return resolvePortLabelCollisions(
      resolvePortOverlayCollisions([...leftVisuals, ...neutralVisuals, ...rightVisuals]),
    );
  }

  function renderCompactPortAssignments(node, leftSlots) {
    if (node.lockPortAssignments || !leftSlots.length) {
      return "";
    }

    return `
      <div class="node-port-assignment-strip">
        ${leftSlots.map((slot) => `
          <label class="node-port-chip">
            <span class="node-port-chip-label">Port ${escapeHtml(getPortDisplayId(slot))}</span>
            <select
              class="node-port-select node-control"
              data-node-id="${node.id}"
              data-slot-id="${slot.id}"
              aria-label="${escapeHtml(node.title)} port ${escapeHtml(getPortDisplayId(slot))} assignment"
            >
              ${renderPortAssignmentOptions(node, slot.actualPortId)}
            </select>
          </label>
        `).join("")}
      </div>
    `;
  }

  function renderNodeFooter(node, leftSlots) {
    const hasControls = isPeriodNode(node) || (node.supportsInlineConfiguration) || (!node.lockPortAssignments && leftSlots.length);

    return hasControls ? `
      <div class="node-editor-panel">
        ${isPeriodNode(node) ? renderPeriodNumberEditor(node) : ""}
        ${renderCompactPortAssignments(node, leftSlots)}
        ${node.supportsInlineConfiguration ? renderInlineConfigurationEditor(node) : ""}
      </div>
    ` : "";
  }

  function renderPeriodNumberEditor(node) {
    return `
      <label class="node-type-field node-type-field-compact">
        <span class="node-type-label">Period number</span>
        <input
          class="node-period-number-input node-control"
          data-node-id="${node.id}"
          type="text"
          inputmode="numeric"
          aria-label="${escapeHtml(node.title)} period number"
          value="${escapeHtml(node.periodNumber || "1")}"
        />
      </label>
    `;
  }

  function renderNodeIllustration(node, imageMetrics) {
    if (isPeriodNode(node)) {
      return `
        <div class="node-tool-illustration node-tool-illustration-period" aria-label="period marker">
          <span class="node-tool-period-token">[W:${escapeHtml(node.periodNumber || "1")}]</span>
          <span class="node-tool-period-name">period</span>
        </div>
      `;
    }

    if (node.brickImageSrc) {
      return `
        <img
          class="node-image"
          src="${escapeHtml(node.brickImageSrc)}"
          alt="${escapeHtml(node.brickName)} structure"
          width="${Math.round(imageMetrics.imageRect.right - imageMetrics.imageRect.left)}"
          height="${Math.round(imageMetrics.imageRect.bottom - imageMetrics.imageRect.top)}"
        />
      `;
    }

    return '<div class="node-image-empty">No structure image</div>';
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

      const currentDefinition = resolveBrickDefinition(graphNode).brickDefinition || getBrickDefinition(graphNode.brickId);
      const templateSource = brickDefinition.supportsInlineConfiguration
        ? brickDefinition
        : currentDefinition;
      const nextCustomConfigText = brickDefinition.supportsInlineConfiguration
        ? (graphNode.customConfigText?.trim() || buildInlineConfigurationTemplate(templateSource))
        : "";
      const resolvedDefinition = resolveBrickDefinition({
        ...graphNode,
        brickId: brickDefinition.id,
        brickName: brickDefinition.name,
        customConfigText: nextCustomConfigText,
      });
      const nextDefinition = resolvedDefinition.brickDefinition || brickDefinition;
      const nextPortData = createPortSlotsFromDefinition(nextDefinition);
      return {
        ...graphNode,
        brickId: brickDefinition.id,
        brickName: nextDefinition.name,
        brickImageSrc: nextDefinition.imageSrc,
        brickImageLayoutSrc: nextDefinition.imageLayoutSrc,
        brickType: nextDefinition.brick_type,
        hideStructurePreview: Boolean(nextDefinition.hideStructurePreview),
        lockPortAssignments: Boolean(nextDefinition.lockPortAssignments),
        supportsInlineConfiguration: Boolean(nextDefinition.supportsInlineConfiguration),
        periodNumber: isPeriodBrickDefinition(nextDefinition)
          ? normalizePeriodNumber(graphNode.periodNumber ?? nextDefinition.default_period_number) || "1"
          : null,
        customConfigText: nextCustomConfigText,
        customConfigError: resolvedDefinition.customConfigError,
        portPool: nextPortData.portPool,
        nport: nextPortData.portSlots.length,
        portSlots: nextPortData.portSlots,
      };
    });

    ui.selectedEdgeIds = new Set(
      [...ui.selectedEdgeIds].filter((edgeId) => !removedEdgeIds.includes(edgeId)),
    );
    ui.selectedNodeIds = new Set([nodeId]);
    renderNodes();
    frontend.notifyGraphChanged({ reason: "node-brick-type" });
    return { updated: true, removedEdgeCount: removedEdgeIds.length, brickName: brickDefinition.name };
  }

  function setNodeCustomConfiguration(nodeId, customConfigText) {
    const graph = frontend.getGraphState();
    const ui = frontend.getUiState();
    const node = findNode(nodeId);

    if (!node || !node.supportsInlineConfiguration || node.customConfigText === customConfigText) {
      return { updated: false, error: "", removedEdgeCount: 0, brickName: node?.brickName || "" };
    }

    const resolvedDefinition = resolveBrickDefinition({
      ...node,
      customConfigText,
    });

    if (resolvedDefinition.customConfigError) {
      graph.nodes = graph.nodes.map((graphNode) => (
        graphNode.id === nodeId
          ? {
            ...graphNode,
            customConfigText,
            customConfigError: resolvedDefinition.customConfigError,
          }
          : graphNode
      ));

      renderNodes();
      frontend.notifyGraphChanged({ reason: "node-custom-configuration", nodeId, invalid: true });
      return {
        updated: true,
        error: resolvedDefinition.customConfigError,
        removedEdgeCount: 0,
        brickName: node.brickName,
      };
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

      const nextDefinition = resolvedDefinition.brickDefinition;
      const nextPortData = createPortSlotsFromDefinition(nextDefinition);
      return {
        ...graphNode,
        brickId: USER_DEFINED_BRICK_ID,
        brickName: nextDefinition.name,
        brickImageSrc: nextDefinition.imageSrc,
        brickImageLayoutSrc: nextDefinition.imageLayoutSrc,
        brickType: nextDefinition.brick_type,
        hideStructurePreview: Boolean(nextDefinition.hideStructurePreview),
        lockPortAssignments: Boolean(nextDefinition.lockPortAssignments),
        supportsInlineConfiguration: Boolean(nextDefinition.supportsInlineConfiguration),
        customConfigText,
        customConfigError: "",
        portPool: nextPortData.portPool,
        nport: nextPortData.portSlots.length,
        portSlots: nextPortData.portSlots,
      };
    });

    ui.selectedEdgeIds = new Set(
      [...ui.selectedEdgeIds].filter((edgeId) => !removedEdgeIds.includes(edgeId)),
    );
    ui.selectedNodeIds = new Set([nodeId]);
    renderNodes();
    frontend.notifyGraphChanged({ reason: "node-custom-configuration", nodeId });
    return {
      updated: true,
      error: "",
      removedEdgeCount: removedEdgeIds.length,
      brickName: resolvedDefinition.brickDefinition.name,
    };
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

  function setNodePeriodNumber(nodeId, periodNumberValue) {
    const graph = frontend.getGraphState();
    const node = findNode(nodeId);

    if (!node || !isPeriodNode(node)) {
      return { updated: false, error: "", periodNumber: node?.periodNumber || "" };
    }

    const normalizedPeriodNumber = normalizePeriodNumber(periodNumberValue);
    if (!normalizedPeriodNumber) {
      return {
        updated: false,
        error: "Period number must be a positive integer.",
        periodNumber: node.periodNumber || "1",
      };
    }

    if (normalizedPeriodNumber === node.periodNumber) {
      return { updated: false, error: "", periodNumber: normalizedPeriodNumber };
    }

    graph.nodes = graph.nodes.map((graphNode) => (
      graphNode.id === nodeId
        ? { ...graphNode, periodNumber: normalizedPeriodNumber }
        : graphNode
    ));

    renderNodes();
    frontend.notifyGraphChanged({ reason: "node-period-number", nodeId });
    return { updated: true, error: "", periodNumber: normalizedPeriodNumber };
  }

  function handleNodeCustomConfigurationChange(event) {
    const textarea = event.target.closest(".node-inline-config-input");
    if (!textarea) {
      return;
    }

    const nodeId = Number(textarea.dataset.nodeId);
    const result = setNodeCustomConfiguration(nodeId, textarea.value);
    if (!result.updated) {
      return;
    }

    if (result.error) {
      frontend.setCanvasMessage(result.error);
      return;
    }

    const removedEdgeCopy = result.removedEdgeCount > 0
      ? ` ${result.removedEdgeCount} edge(s) cleared.`
      : "";
    frontend.setCanvasMessage(`Node ${nodeId} definition applied as ${result.brickName}.${removedEdgeCopy}`);
  }

  function handleNodePeriodNumberChange(event) {
    const input = event.target.closest(".node-period-number-input");
    if (!input) {
      return;
    }

    const nodeId = Number(input.dataset.nodeId);
    const result = setNodePeriodNumber(nodeId, input.value);
    if (!result.updated) {
      input.value = result.periodNumber || "1";
      if (result.error) {
        frontend.setCanvasMessage(result.error);
      }
      return;
    }

    input.value = result.periodNumber;
    frontend.setCanvasMessage(`Node ${nodeId} period number set to ${result.periodNumber}.`);
  }

  function bindNodeControlEvents() {
    dom.nodeContainer.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".node-control")) {
        event.stopPropagation();
      }
    });

    dom.nodeContainer.addEventListener("change", (event) => {
      if (event.target.closest(".node-port-select")) {
        handlePortAssignmentChange(event);
        return;
      }

      if (event.target.closest(".node-period-number-input")) {
        handleNodePeriodNumberChange(event);
        return;
      }

      if (event.target.closest(".node-inline-config-input")) {
        handleNodeCustomConfigurationChange(event);
      }
    });
  }

  function renderRectangularNode(node) {
    const ui = frontend.getUiState();
    const isSelected = ui.selectedNodeIds.has(node.id);
    const isDragging = ui.componentInteraction?.type === "node-drag" && ui.componentInteraction.nodeId === node.id;
    const { leftSlots } = getPortSlotGroups(node);
    const imageMetrics = getNodeImageMetrics(node);
    const portVisuals = buildNodePortVisuals(node, imageMetrics, ui);

    return `
      <article
        class="node-component${isSelected ? " is-selected" : ""}${isDragging ? " is-dragging" : ""}"
        data-node-id="${node.id}"
        style="left: ${node.x}px; top: ${node.y}px; --node-surface-width: ${imageMetrics.surfaceWidth}px"
        aria-selected="${String(isSelected)}"
      >
        <span class="node-name-label">${escapeHtml(node.brickName)}</span>
        <div
          class="node-selection-surface${isSelected ? " is-selected" : ""}${isDragging ? " is-dragging" : ""}"
          data-node-id="${node.id}"
          style="width: ${imageMetrics.surfaceWidth}px; height: ${imageMetrics.surfaceHeight}px"
        >
          <div class="node-image-frame">
            ${renderNodeIllustration(node, imageMetrics)}
          </div>
          <svg
            class="node-port-bond-layer"
            viewBox="0 0 ${imageMetrics.surfaceWidth} ${imageMetrics.surfaceHeight}"
            aria-hidden="true"
          >
            ${portVisuals.map((visual) => `
              <line
                class="node-port-bond"
                x1="${visual.startX}"
                y1="${visual.startY}"
                x2="${visual.dotX}"
                y2="${visual.dotY}"
              ></line>
            `).join("")}
          </svg>
          <div class="node-port-site-layer">
            ${portVisuals.map((visual) => `
              <button
                type="button"
                class="node-port node-port-${visual.side}${visual.isHoverTarget ? " is-hover-target" : ""}${visual.isConnectedToSelectedEdge ? " is-edge-selected" : ""}"
                data-node-id="${node.id}"
                data-slot-id="${visual.slot.id}"
                data-tangent-x="${visual.unitX}"
                data-tangent-y="${visual.unitY}"
                aria-label="${escapeHtml(node.title)} port ${escapeHtml(visual.portId)}"
                style="left: ${visual.dotX}px; top: ${visual.dotY}px"
              ></button>
              <span
                class="node-port-label node-port-label-${visual.labelSide}${visual.isConnectedToSelectedEdge ? " is-edge-selected" : ""}"
                style="left: ${visual.dotX}px; top: ${visual.dotY + (visual.labelOffsetY || 0)}px"
              >${escapeHtml(visual.portId)}</span>
            `).join("")}
          </div>
        </div>
        ${renderNodeFooter(node, leftSlots)}
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

  function setSelectedNodes(nodeIds, options = {}) {
    const ui = frontend.getUiState();
    const preserveEdges = Boolean(options.preserveEdges);

    if (!hasSelectionChanged(nodeIds) && (preserveEdges || ui.selectedEdgeIds.size === 0)) {
      return;
    }

    ui.selectedNodeIds = new Set(nodeIds);
    if (!preserveEdges) {
      ui.selectedEdgeIds = new Set();
    }
    renderNodes();
  }

  function clearSelection() {
    const ui = frontend.getUiState();

    if (ui.selectedNodeIds.size === 0 && ui.selectedEdgeIds.size === 0) {
      return;
    }

    ui.selectedNodeIds = new Set();
    ui.selectedEdgeIds = new Set();
    renderNodes();
  }

  function selectOnlyNode(nodeId) {
    setSelectedNodes([nodeId]);
  }

  function toggleNodeSelection(nodeId) {
    const ui = frontend.getUiState();
    const nextSelection = new Set(ui.selectedNodeIds);

    if (nextSelection.has(nodeId)) {
      nextSelection.delete(nodeId);
    } else {
      nextSelection.add(nodeId);
    }

    setSelectedNodes([...nextSelection], { preserveEdges: true });
    return nextSelection.has(nodeId);
  }

  function createNode(nodeConfig) {
    const graph = frontend.getGraphState();
    const newNode = buildNode({
      id: graph.nextNodeId,
      type: nodeConfig.type || "rectangular",
      title: nodeConfig.title || `Node ${graph.nextNodeId}`,
      brickId: nodeConfig.brickId || defaultBrickId,
      periodNumber: nodeConfig.periodNumber,
      customConfigText: nodeConfig.customConfigText || "",
      x: nodeConfig.x,
      y: nodeConfig.y,
    });

    graph.nextNodeId += 1;
    graph.nodes = [...graph.nodes, newNode];
    renderNodes();
    selectOnlyNode(newNode.id);
    frontend.notifyGraphChanged({ reason: "node-created", nodeId: newNode.id });
    return newNode;
  }

  function createNodeAt(worldX, worldY, nodeConfig = {}) {
    return createNode({
      ...nodeConfig,
      x: worldX,
      y: worldY,
    });
  }

  function buildDefinitionFallbackText(definitionPayload) {
    return JSON.stringify({
      name: String(definitionPayload?.name || "User defined"),
      alias: Array.isArray(definitionPayload?.alias) ? definitionPayload.alias : [],
      brick_type: String(definitionPayload?.brick_type || "BRIDGE").toUpperCase(),
      nodes: Array.isArray(definitionPayload?.nodes)
        ? definitionPayload.nodes.map((node) => ({ ...node }))
        : [],
      edges: Array.isArray(definitionPayload?.edges)
        ? definitionPayload.edges.map((edge) => (Array.isArray(edge) ? [...edge] : { ...edge }))
        : [],
    }, null, 2);
  }

  async function createUserDefinedNodeAt(worldX, worldY, definitionPayload) {
    return createNode({
      title: String(definitionPayload?.name || "User defined"),
      brickId: USER_DEFINED_BRICK_ID,
      customConfigText: buildDefinitionFallbackText(definitionPayload),
      x: worldX,
      y: worldY,
    });
  }

  async function createUserDefinedNodeAtViewportCenter(definitionPayload) {
    const viewportRect = dom.canvasViewport?.getBoundingClientRect();

    if (!viewportRect) {
      throw new Error("Canvas viewport is unavailable.");
    }

    const centerPoint = frontend.clientToWorldPoint(
      viewportRect.left + viewportRect.width / 2,
      viewportRect.top + viewportRect.height / 2,
    );

    return createUserDefinedNodeAt(centerPoint.x, centerPoint.y, definitionPayload);
  }

  async function applyWizardDefinition(definitionPayload) {
    try {
      return {
        node: await createUserDefinedNodeAtViewportCenter(definitionPayload),
        error: "",
      };
    } catch (error) {
      return {
        node: null,
        error: error instanceof Error ? error.message : "Failed to apply the node definition.",
      };
    }
  }

  function handleWizardMessage(event) {
    if (event.origin !== window.location.origin) {
      return;
    }

    const payload = event.data;
    if (
      !payload
      || payload.source !== "brickene-node-wizard"
    ) {
      return;
    }

    if (payload.type === "brick-definition-saved") {
      if (payload.definition) {
        registerBrickDefinition(payload.definition);
        renderNodes();
        frontend.setCanvasMessage(`Stored user brick ${payload.definition.id} is ready to use.`);
      }
      return;
    }

    if (payload.type !== "apply-node-definition") {
      return;
    }

    void (async () => {
      const result = await applyWizardDefinition(payload.definition);
      if (result.error) {
        frontend.setCanvasMessage(result.error);
        return;
      }

      frontend.setCanvasMessage(`Temporary user-defined node ${result.node.id} created from the node wizard.`);
    })();
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
  frontend.setNodeCustomConfiguration = setNodeCustomConfiguration;
  frontend.renderNodes = renderNodes;
  frontend.getBrickTypeGroups = getBrickTypeGroups;
  frontend.setSelectedNodes = setSelectedNodes;
  frontend.clearSelection = clearSelection;
  frontend.selectOnlyNode = selectOnlyNode;
  frontend.toggleNodeSelection = toggleNodeSelection;
  frontend.createNode = createNode;
  frontend.createNodeAt = createNodeAt;
  frontend.registerBrickDefinition = registerBrickDefinition;
  frontend.createUserDefinedNodeAtViewportCenter = createUserDefinedNodeAtViewportCenter;
  frontend.deleteNode = deleteNode;

  window.addEventListener("message", handleWizardMessage);
  bindNodeControlEvents();
})();
