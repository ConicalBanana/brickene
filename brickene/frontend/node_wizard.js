(() => {
  const config = window.BrickeneNodeWizardConfig || {};
  const STORAGE_UID = 0;
  const DEFAULT_NAME = "User defined";
  const DEFAULT_PORT_TYPE = "SKELETON";
  const BRICK_TYPE_OPTIONS = ["SKELETON", "SIDE_CHAIN", "SUBSTITUENT", "BRIDGE"];
  const APPEND_IMPORT_OPTIONS = {
    clearCanvas: false,
    select: true,
    throwError: false,
  };
  const runtimeState = {
    marvinRef: null,
    baseDefinition: null,
    isBusy: false,
  };

  const dom = {
    status: document.getElementById("wizard-status"),
    marvinHost: document.getElementById("wizard-marvin-host"),
    form: document.getElementById("wizard-form"),
    nameInput: document.getElementById("wizard-node-name"),
    aliasInput: document.getElementById("wizard-node-alias"),
    brickTypeSelect: document.getElementById("wizard-brick-type"),
    addPortButton: document.getElementById("wizard-add-port"),
    generateButton: document.getElementById("wizard-generate"),
    saveButton: document.getElementById("wizard-save"),
    sendButton: document.getElementById("wizard-send"),
    portConfig: document.getElementById("wizard-port-config"),
    jsonOutput: document.getElementById("wizard-json-output"),
  };

  function setStatus(message, options = {}) {
    dom.status.textContent = message;
    dom.status.classList.toggle("is-error", Boolean(options.error));
    dom.status.classList.toggle("is-success", Boolean(options.success));
  }

  function setBusy(isBusy) {
    runtimeState.isBusy = isBusy;
    dom.addPortButton.disabled = isBusy;
    dom.generateButton.disabled = isBusy;
    dom.saveButton.disabled = isBusy;
    dom.sendButton.disabled = isBusy;
  }

  function renderEmptyPortState(message) {
    dom.portConfig.innerHTML = `
      <p class="node-inline-config-feedback">${message}</p>
    `;
  }

  function parseAliases(value) {
    return String(value || "")
      .split(",")
      .map((alias) => alias.trim())
      .filter(Boolean);
  }

  function sortPortNodes(nodes) {
    return (nodes || [])
      .filter((node) => node.kind === "port")
      .slice()
      .sort((left, right) => Number(left.index) - Number(right.index));
  }

  function renderPortOptions(options, selectedValue) {
    return options.map((option) => `
      <option value="${option}"${option === selectedValue ? " selected" : ""}>${option}</option>
    `).join("");
  }

  function renderPortConfiguration(definition) {
    const ports = sortPortNodes(definition?.nodes);

    if (!ports.length) {
      renderEmptyPortState("No attachment ports were detected in the current structure.");
      return;
    }

    dom.portConfig.innerHTML = ports.map((port, index) => {
      const defaultSide = String(port.side || (index === 0 ? "left" : "right")).toLowerCase();
      const defaultPortType = String(port.preferred_brick_type || DEFAULT_PORT_TYPE).toUpperCase();
      const connectedSymbol = port.connected_symbol || "?";

      return `
        <article class="node-wizard-port-row" data-port-index="${port.index}">
          <div class="node-wizard-port-copy">
            <p class="node-wizard-port-title">Port ${port.index}</p>
            <p class="node-wizard-port-meta">Connected symbol: ${connectedSymbol}</p>
          </div>
          <label class="node-wizard-port-field">
            <span class="node-type-label">Side</span>
            <select class="node-wizard-port-select wizard-port-side">
              ${renderPortOptions(["left", "right"], defaultSide)}
            </select>
          </label>
          <label class="node-wizard-port-field">
            <span class="node-type-label">Preferred type</span>
            <select class="node-wizard-port-select wizard-port-type">
              ${renderPortOptions(BRICK_TYPE_OPTIONS, defaultPortType)}
            </select>
          </label>
        </article>
      `;
    }).join("");
  }

  function readPortOverrides() {
    const overrides = new Map();

    dom.portConfig.querySelectorAll(".node-wizard-port-row").forEach((row) => {
      const portIndex = Number(row.dataset.portIndex);
      const sideSelect = row.querySelector(".wizard-port-side");
      const typeSelect = row.querySelector(".wizard-port-type");

      overrides.set(portIndex, {
        side: sideSelect?.value || "right",
        preferredBrickType: typeSelect?.value || DEFAULT_PORT_TYPE,
      });
    });

    return overrides;
  }

  function cloneNodePayload(nodePayload) {
    return Object.fromEntries(
      Object.entries(nodePayload).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
    );
  }

  function cloneEdgePayload(edgePayload) {
    if (Array.isArray(edgePayload)) {
      return [...edgePayload];
    }

    if (edgePayload && typeof edgePayload === "object") {
      return { ...edgePayload };
    }

    return edgePayload;
  }

  function buildDefinitionOutput() {
    if (!runtimeState.baseDefinition) {
      return null;
    }

    const name = String(dom.nameInput.value || "").trim() || DEFAULT_NAME;
    const aliases = parseAliases(dom.aliasInput.value);
    const portOverrides = readPortOverrides();

    return {
      name,
      alias: aliases,
      brick_type: dom.brickTypeSelect.value,
      nodes: runtimeState.baseDefinition.nodes.map((nodePayload) => {
        const nextNode = cloneNodePayload(nodePayload);
        if (nextNode.kind !== "port") {
          return nextNode;
        }

        const override = portOverrides.get(Number(nextNode.index));
        nextNode.side = override?.side || nextNode.side || "right";
        nextNode.preferred_brick_type = (
          override?.preferredBrickType || nextNode.preferred_brick_type || DEFAULT_PORT_TYPE
        ).toUpperCase();
        return nextNode;
      }),
      edges: runtimeState.baseDefinition.edges.map((edgePayload) => cloneEdgePayload(edgePayload)),
    };
  }

  function syncDefinitionOutput() {
    const definition = buildDefinitionOutput();
    dom.jsonOutput.value = definition ? `${JSON.stringify(definition, null, 2)}\n` : "";
  }

  function getNextPortIndex(smiles) {
    const matches = String(smiles || "").matchAll(/\[\*:(\d+)\]/g);
    let maxPortIndex = 0;

    for (const match of matches) {
      maxPortIndex = Math.max(maxPortIndex, Number(match[1]));
    }

    return maxPortIndex + 1;
  }

  async function readCurrentSmiles() {
    if (!runtimeState.marvinRef || runtimeState.marvinRef.isEmpty()) {
      return "";
    }

    const exportPayload = await runtimeState.marvinRef.exportDocument("SMILES");
    return exportPayload?.content?.trim() || "";
  }

  async function exportSmiles() {
    if (!runtimeState.marvinRef) {
      throw new Error("Marvin editor is still loading.");
    }

    const exportPayload = await runtimeState.marvinRef.exportDocument("SMILES");
    const smiles = exportPayload?.content?.trim();

    if (!smiles) {
      throw new Error("Draw a structure before generating a node definition.");
    }

    return smiles;
  }

  async function requestDefinition(smiles) {
    const response = await fetch(config.brickConfigApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        smiles,
        name: String(dom.nameInput.value || "").trim() || DEFAULT_NAME,
        alias: parseAliases(dom.aliasInput.value),
        brick_type: dom.brickTypeSelect.value,
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.error || "Failed to build a node definition from the current structure.");
    }

    return body.definition;
  }

  async function saveDefinitionToDatabase(definition) {
    const response = await fetch(config.brickApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ definition }),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.error || "Failed to save the node definition.");
    }

    return body.definition;
  }

  async function addDetachedPort() {
    if (!runtimeState.marvinRef) {
      throw new Error("Marvin editor is still loading.");
    }

    setBusy(true);

    try {
      const currentSmiles = await readCurrentSmiles();
      const nextPortIndex = getNextPortIndex(currentSmiles);
      const nextPortSmiles = `[*:${nextPortIndex}]`;

      await runtimeState.marvinRef.importDocument(nextPortSmiles, APPEND_IMPORT_OPTIONS);
      setStatus(
        `Added detached port ${nextPortSmiles}. Attach it to exactly one atom with a single bond before detecting.`,
        { success: true },
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Failed to add a detached port.",
        { error: true },
      );
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function generateDefinition() {
    setBusy(true);

    try {
      const smiles = await exportSmiles();
      runtimeState.baseDefinition = await requestDefinition(smiles);
      renderPortConfiguration(runtimeState.baseDefinition);
      syncDefinitionOutput();
      setStatus(
        `Detected ${sortPortNodes(runtimeState.baseDefinition.nodes).length} port(s) from the current structure.`,
        { success: true },
      );
      return buildDefinitionOutput();
    } catch (error) {
      runtimeState.baseDefinition = null;
      dom.jsonOutput.value = "";
      renderEmptyPortState("No node definition is available yet.");
      setStatus(
        error instanceof Error ? error.message : "Failed to generate the node definition.",
        { error: true },
      );
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function saveDefinition() {
    const definition = runtimeState.baseDefinition || await generateDefinition();
    const nextDefinition = definition ? buildDefinitionOutput() : null;

    if (!nextDefinition) {
      return null;
    }

    setBusy(true);

    try {
      const storedDefinition = await saveDefinitionToDatabase(nextDefinition);

      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          {
            source: "brickene-node-wizard",
            type: "brick-definition-saved",
            definition: storedDefinition,
          },
          window.location.origin,
        );
      }

      setStatus(
        `Saved node definition to the database as ${storedDefinition.id}.`,
        { success: true },
      );
      return storedDefinition;
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Failed to save the node definition.",
        { error: true },
      );
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function sendDefinitionToCanvas() {
    const definition = runtimeState.baseDefinition || await generateDefinition();
    const nextDefinition = definition ? buildDefinitionOutput() : null;

    if (!nextDefinition) {
      return;
    }

    if (!window.opener || window.opener.closed) {
      setStatus("No Brickene canvas is attached. Open the wizard from the canvas to send the definition directly.", { error: true });
      return;
    }

    window.opener.postMessage(
      {
        source: "brickene-node-wizard",
        type: "apply-node-definition",
        definition: nextDefinition,
      },
      window.location.origin,
    );
    setStatus("Node definition sent to the canvas.", { success: true });
  }

  function handleStructureChange() {
    runtimeState.baseDefinition = null;
    dom.jsonOutput.value = "";
    renderEmptyPortState("Structure changed. Detect ports again to refresh the node definition.");

    if (!runtimeState.isBusy) {
      setStatus("Structure changed. Detect ports again to refresh the node definition.");
    }
  }

  async function initializeMarvin() {
    setBusy(true);
    setStatus("Loading Marvin editor.");
    renderEmptyPortState("Loading Marvin editor.");

    try {
      await window.BrickeneNodeWizardMarvinReady;
      const visualizationSettings = window.marvinLocalStorage?.getPersistedSettings?.(
        "marvinVisualizationSettings",
        STORAGE_UID,
      );
      const calculationSettings = window.marvinLocalStorage?.getPersistedSettings?.(
        "marvinCalculationSettings",
        STORAGE_UID,
      );
      const editorSettings = window.marvinLocalStorage?.getPersistedSettings?.(
        "marvinEditorSettings",
        STORAGE_UID,
      );

      runtimeState.marvinRef = await window.marvin.createMarvin(dom.marvinHost, {
        webServiceSettings: window.marvinDefaultSettings.getDefaultWebServiceSettings(config.marvinUrl),
        visualizationSettings,
        editorSettings,
        calculationSettings: {
          ...(calculationSettings || {}),
          ...window.marvinDefaultSettings.getDefaultCalculationSettings(config.marvinUrl),
        },
        checkerSettings: {
          ...window.marvinDefaultSettings.getDefaultCheckerSettings(config.marvinUrl),
        },
        nmrSettings: window.marvinDefaultSettings.getDefaultNmrSettings(config.marvinUrl),
      });
      runtimeState.marvinRef.on("molecule_change", handleStructureChange);

      if (window.marvinLocalStorage) {
        window.marvinLocalStorage.registerSettingPersister(
          "marvinVisualizationSettings",
          STORAGE_UID,
          runtimeState.marvinRef,
        );
        window.marvinLocalStorage.registerSettingPersister(
          "marvinCalculationSettings",
          STORAGE_UID,
          runtimeState.marvinRef,
        );
        window.marvinLocalStorage.registerSettingPersister(
          "marvinEditorSettings",
          STORAGE_UID,
          runtimeState.marvinRef,
        );
        window.marvinLocalStorage.registerAutoSaver(STORAGE_UID, runtimeState.marvinRef);
      }

      renderEmptyPortState("Draw a structure, then attach each port to exactly one atom by a single bond before detecting.");
      setStatus("Draw a structure, then attach each port to exactly one atom by a single bond before detecting.", { success: true });
    } catch (error) {
      renderEmptyPortState("Marvin failed to load.");
      setStatus(
        error instanceof Error ? error.message : "Marvin failed to load.",
        { error: true },
      );
    } finally {
      setBusy(false);
    }
  }

  function bindEvents() {
    dom.addPortButton.addEventListener("click", () => {
      addDetachedPort().catch(() => {});
    });

    dom.generateButton.addEventListener("click", () => {
      generateDefinition().catch(() => {});
    });

    dom.saveButton.addEventListener("click", () => {
      saveDefinition().catch(() => {});
    });

    dom.sendButton.addEventListener("click", () => {
      sendDefinitionToCanvas().catch(() => {});
    });

    dom.brickTypeSelect.addEventListener("change", syncDefinitionOutput);
    dom.nameInput.addEventListener("input", syncDefinitionOutput);
    dom.aliasInput.addEventListener("input", syncDefinitionOutput);
    dom.portConfig.addEventListener("change", syncDefinitionOutput);

    dom.form.addEventListener("submit", (event) => {
      event.preventDefault();
      generateDefinition().catch(() => {});
    });
  }

  bindEvents();
  initializeMarvin();
})();
