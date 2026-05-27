(() => {
  const frontend = window.BrickeneFrontend;
  const { config, dom } = frontend;
  const DEFAULT_NAME = "New Template";
  const editTemplateId = new URL(window.location.href).searchParams.get("editTemplateId") || null;

  const wizardDom = {
    nameInput: document.getElementById("template-name"),
    aliasInput: document.getElementById("template-alias"),
    saveButton: document.getElementById("template-wizard-save"),
    sendButton: document.getElementById("template-wizard-send"),
    status: document.getElementById("template-wizard-status"),
  };

  // Narrow the menu to Edit + View only; File is kept as a placeholder so
  // bootstrap() has a valid initial submenu key to render (it renders empty).
  config.submenuMap.file = [];
  delete config.submenuMap.node;
  config.stateMap.file = "Template wizard canvas.";

  function parseAliases(value) {
    return String(value || "")
      .split(",")
      .map((alias) => alias.trim())
      .filter(Boolean);
  }

  function setStatus(message, options = {}) {
    if (!wizardDom.status) {
      return;
    }

    wizardDom.status.textContent = message;
    wizardDom.status.classList.toggle("is-error", Boolean(options.error));
    wizardDom.status.classList.toggle("is-success", Boolean(options.success));
  }

  function setBusy(isBusy) {
    if (wizardDom.saveButton) {
      wizardDom.saveButton.disabled = isBusy;
    }

    if (wizardDom.sendButton) {
      wizardDom.sendButton.disabled = isBusy;
    }
  }

  function buildTemplateDefinition() {
    const name = String(wizardDom.nameInput?.value || "").trim() || DEFAULT_NAME;
    const aliases = parseAliases(wizardDom.aliasInput?.value || "");
    const graphState = frontend.exportGraphState();

    return {
      name,
      alias: aliases,
      brick_type: "TEMPLATE",
      nodes: [],
      edges: [],
      template_graph: graphState,
    };
  }

  async function saveTemplateToDatabase(definition) {
    const isUpdate = Boolean(editTemplateId);
    const baseUrl = String(config.brickApiUrl || "http://127.0.0.1:8765/bricks").replace(/\/?$/, "/");
    const url = isUpdate
      ? `${baseUrl}${encodeURIComponent(editTemplateId)}`
      : config.brickApiUrl;
    const method = isUpdate ? "PUT" : "POST";

    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ definition }),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.error || "Failed to save the template.");
    }

    return body.definition;
  }

  async function handleSave() {
    const name = String(wizardDom.nameInput?.value || "").trim();

    if (!name) {
      setStatus("Enter a name before saving.", { error: true });
      return;
    }

    setBusy(true);
    setStatus("Saving template…");

    try {
      const definition = buildTemplateDefinition();
      const stored = await saveTemplateToDatabase(definition);
      const messageType = editTemplateId ? "template-definition-updated" : "template-definition-saved";
      const actionLabel = editTemplateId ? "Updated" : "Saved";

      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          {
            source: "brickene-template-wizard",
            type: messageType,
            definition: stored,
          },
          window.location.origin,
        );
      }

      setStatus(`${actionLabel} template as ${stored.id}.`, { success: true });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Failed to save the template.",
        { error: true },
      );
    } finally {
      setBusy(false);
    }
  }

  function handleSend() {
    const name = String(wizardDom.nameInput?.value || "").trim();

    if (!name) {
      setStatus("Enter a name before sending.", { error: true });
      return;
    }

    if (!window.opener || window.opener.closed) {
      setStatus(
        "No canvas window is open. Open the template wizard from the canvas to send the template.",
        { error: true },
      );
      return;
    }

    const definition = buildTemplateDefinition();

    window.opener.postMessage(
      {
        source: "brickene-template-wizard",
        type: "apply-template-definition",
        definition,
      },
      window.location.origin,
    );
    setStatus("Template graph sent to canvas.", { success: true });
  }

  async function loadEditTemplate(templateId) {
    setBusy(true);
    setStatus(`Loading template ${templateId}…`);

    try {
      const baseUrl = String(config.brickApiUrl || "http://127.0.0.1:8765/bricks").replace(/\/?$/, "/");
      const response = await fetch(`${baseUrl}${encodeURIComponent(templateId)}`, {
        headers: { Accept: "application/json" },
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.error || `Failed to load template ${templateId}.`);
      }

      const definition = body.definition || body;

      if (wizardDom.nameInput) {
        wizardDom.nameInput.value = String(definition.name || DEFAULT_NAME);
      }

      if (wizardDom.aliasInput) {
        wizardDom.aliasInput.value = Array.isArray(definition.alias)
          ? definition.alias.join(", ")
          : String(definition.alias || "");
      }

      if (definition.template_graph) {
        frontend.importGraphState(definition.template_graph);
      }

      if (wizardDom.saveButton) {
        wizardDom.saveButton.textContent = "Update in database";
      }

      setStatus(`Editing template ${templateId}: ${definition.name}. Modify the graph, then update.`, { success: true });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : `Failed to load template ${templateId}.`,
        { error: true },
      );
    } finally {
      setBusy(false);
    }
  }

  // Bootstrap the canvas engine (loads brick catalog, wires events, etc.).
  frontend.bootstrap();

  // Close the empty File submenu that bootstrap() opens by default.
  dom.submenuDropdown.classList.remove("is-open");

  // Bind wizard controls.
  wizardDom.saveButton?.addEventListener("click", () => {
    void handleSave();
  });

  wizardDom.sendButton?.addEventListener("click", () => {
    handleSend();
  });

  // If opened for editing, load the existing template definition.
  if (editTemplateId) {
    void loadEditTemplate(editTemplateId);
  }
})();
