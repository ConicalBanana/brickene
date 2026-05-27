(() => {
  const config = window.BrickeneNodeManagerConfig || {};
  const brickApiUrl = String(config.brickApiUrl || "http://127.0.0.1:8765/bricks").replace(/\/?$/, "");

  // ── Runtime state ──────────────────────────────────────────────────────────
  const state = {
    allBricks: [],
    filteredBricks: [],
    activeFilter: "all",
    searchQuery: "",
    isBusy: false,
    pendingDeleteId: null,
    wizardWindow: null,
    templateWizardWindow: null,
  };

  // ── DOM references ─────────────────────────────────────────────────────────
  const dom = {
    status: document.getElementById("manager-status"),
    search: document.getElementById("manager-search"),
    tableBody: document.getElementById("manager-table-body"),
    rowCount: document.getElementById("manager-row-count"),
    filterButtons: document.querySelectorAll(".node-manager-filter-button"),
    addButton: document.getElementById("manager-add-button"),
    refreshButton: document.getElementById("manager-refresh-button"),
    confirmDialog: document.getElementById("manager-confirm-dialog"),
    dialogBody: document.getElementById("dialog-body"),
    dialogConfirm: document.getElementById("dialog-confirm"),
    dialogCancel: document.getElementById("dialog-cancel"),
  };

  // ── Status helpers ─────────────────────────────────────────────────────────

  function setStatus(message, options = {}) {
    if (!dom.status) {
      return;
    }

    dom.status.textContent = message;
    dom.status.classList.toggle("is-error", Boolean(options.error));
    dom.status.classList.toggle("is-success", Boolean(options.success));
  }

  function setBusy(isBusy) {
    state.isBusy = isBusy;

    if (dom.addButton) {
      dom.addButton.disabled = isBusy;
    }

    if (dom.refreshButton) {
      dom.refreshButton.disabled = isBusy;
    }
  }

  // ── Escaping ───────────────────────────────────────────────────────────────

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // ── Data loading ───────────────────────────────────────────────────────────

  async function loadBricks() {
    setBusy(true);
    setStatus("Loading catalog…");

    try {
      const response = await fetch(`${brickApiUrl}`, {
        headers: { Accept: "application/json" },
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.error || "Failed to load brick catalog.");
      }

      state.allBricks = Array.isArray(body.bricks) ? body.bricks : [];
      applyFilters();
      setStatus(`Loaded ${state.allBricks.length} brick(s).`, { success: true });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load catalog.", { error: true });
      renderEmptyState("Failed to load the brick catalog. Is the render server running?");
    } finally {
      setBusy(false);
    }
  }

  // ── Filtering ──────────────────────────────────────────────────────────────

  function isUserBrick(brick) {
    return String(brick.id || "").startsWith("user-");
  }

  function applyFilters() {
    const query = state.searchQuery.toLowerCase().trim();
    const filter = state.activeFilter;

    state.filteredBricks = state.allBricks.filter((brick) => {
      if (filter === "system" && isUserBrick(brick)) {
        return false;
      }

      if (filter === "user" && !isUserBrick(brick)) {
        return false;
      }

      if (!query) {
        return true;
      }

      const id = String(brick.id || "").toLowerCase();
      const name = String(brick.name || "").toLowerCase();
      const aliases = (Array.isArray(brick.alias) ? brick.alias : [])
        .map((a) => String(a).toLowerCase())
        .join(" ");

      return id.includes(query) || name.includes(query) || aliases.includes(query);
    });

    renderTable();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function formatDate(dateString) {
    if (!dateString) {
      return "—";
    }

    try {
      return new Date(dateString).toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(dateString);
    }
  }

  function countPorts(brick) {
    const nodes = Array.isArray(brick.nodes) ? brick.nodes : [];
    return nodes.filter((n) => n.kind === "port").length;
  }

  function renderEmptyState(message) {
    if (!dom.tableBody) {
      return;
    }

    dom.tableBody.innerHTML = `
      <tr class="node-manager-table-placeholder">
        <td colspan="8">${escapeHtml(message)}</td>
      </tr>
    `;

    if (dom.rowCount) {
      dom.rowCount.textContent = "";
    }
  }

  function buildRowActions(brick) {
    const id = String(brick.id || "");
    const isUser = isUserBrick(brick);

    if (!isUser) {
      return `<span class="node-manager-source-note" aria-label="System bricks are read-only">—</span>`;
    }

    return `
      <div class="node-manager-row-actions">
        <button
          type="button"
          class="node-manager-row-button"
          data-action="edit"
          data-brick-id="${escapeHtml(id)}"
          data-brick-type="${escapeHtml(String(brick.brick_type || ''))}"
          aria-label="Edit ${escapeHtml(String(brick.name || id))}"
        >Edit</button>
        <button
          type="button"
          class="node-manager-row-button node-manager-row-button-danger"
          data-action="delete"
          data-brick-id="${escapeHtml(id)}"
          aria-label="Delete ${escapeHtml(String(brick.name || id))}"
        >Delete</button>
        <button
          type="button"
          class="node-manager-row-button node-manager-row-button-promote"
          data-action="promote"
          data-brick-id="${escapeHtml(id)}"
          aria-label="Register ${escapeHtml(String(brick.name || id))} as system node"
        >Register as system</button>
      </div>
    `;
  }

  function renderTable() {
    if (!dom.tableBody) {
      return;
    }

    const bricks = state.filteredBricks;

    if (!bricks.length) {
      const message = state.allBricks.length
        ? "No nodes match the current search or filter."
        : "No nodes in the catalog yet. Add one using the wizard.";
      renderEmptyState(message);
      return;
    }

    dom.tableBody.innerHTML = bricks.map((brick) => {
      const id = escapeHtml(String(brick.id || ""));
      const name = escapeHtml(String(brick.name || "—"));
      const aliasText = Array.isArray(brick.alias) && brick.alias.length
        ? escapeHtml(brick.alias.join(", "))
        : "—";
      const brickType = escapeHtml(String(brick.brick_type || "—"));
      const portCount = countPorts(brick);
      const isUser = isUserBrick(brick);
      const sourceLabel = isUser ? "User" : "System";
      const sourceCls = isUser ? "is-user" : "is-system";
      const updated = formatDate(brick.updated_at || brick.created_at || "");

      return `
        <tr data-brick-id="${id}">
          <td><span class="node-manager-id-badge">${id}</span></td>
          <td>${name}</td>
          <td>${aliasText}</td>
          <td>${brickType}</td>
          <td class="col-ports">${portCount}</td>
          <td><span class="node-manager-source-badge ${sourceCls}">${sourceLabel}</span></td>
          <td>${escapeHtml(updated)}</td>
          <td>${buildRowActions(brick)}</td>
        </tr>
      `;
    }).join("");

    if (dom.rowCount) {
      dom.rowCount.textContent = `Showing ${bricks.length} of ${state.allBricks.length} node(s).`;
    }
  }

  // ── Wizard window ──────────────────────────────────────────────────────────

  function buildWizardUrl(params = {}) {
    const wizardBase = new URL("./node_wizard.html", window.location.href);

    wizardBase.searchParams.set("brickApiUrl", brickApiUrl);
    wizardBase.searchParams.set("brickConfigApiUrl", config.brickConfigApiUrl || `${brickApiUrl}/preview`);

    if (config.marvinWebUrl) {
      wizardBase.searchParams.set("marvinUrl", config.marvinWebUrl);
    }

    for (const [key, value] of Object.entries(params)) {
      if (value != null) {
        wizardBase.searchParams.set(key, String(value));
      }
    }

    return wizardBase.toString();
  }

  function openWizard(extraParams = {}) {
    if (state.wizardWindow && !state.wizardWindow.closed) {
      state.wizardWindow.focus();
      return;
    }

    const url = buildWizardUrl(extraParams);
    state.wizardWindow = window.open(
      url,
      "brickene-node-wizard",
      "width=1280,height=900,resizable=yes,scrollbars=yes",
    );
  }

  function buildTemplateWizardUrl(brickId) {
    const base = new URL("./template_wizard.html", window.location.href);
    base.searchParams.set("brickApiUrl", brickApiUrl);
    base.searchParams.set("editTemplateId", String(brickId));
    return base.toString();
  }

  function openTemplateWizard(brickId) {
    if (state.templateWizardWindow && !state.templateWizardWindow.closed) {
      state.templateWizardWindow.focus();
      return;
    }

    const url = buildTemplateWizardUrl(brickId);
    state.templateWizardWindow = window.open(
      url,
      "brickene-template-wizard",
      "width=1280,height=900,resizable=yes,scrollbars=yes",
    );
  }

  // ── CRUD operations ────────────────────────────────────────────────────────

  async function deleteBrick(brickId) {
    setBusy(true);
    setStatus(`Deleting ${brickId}…`);

    try {
      const response = await fetch(`${brickApiUrl}/${encodeURIComponent(brickId)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.error || `Failed to delete ${brickId}.`);
      }

      setStatus(`Deleted ${brickId}.`, { success: true });
      await loadBricks();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Delete failed for ${brickId}.`, { error: true });
      setBusy(false);
    }
  }

  async function promoteBrick(brickId) {
    setBusy(true);
    setStatus(`Registering ${brickId} as system node…`);

    try {
      const response = await fetch(
        `${brickApiUrl}/${encodeURIComponent(brickId)}/promote`,
        {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
        },
      );
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.error || `Failed to promote ${brickId}.`);
      }

      const newId = body.definition?.id || "?";
      setStatus(`Registered as system node ${newId}.`, { success: true });
      await loadBricks();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : `Promote failed for ${brickId}.`,
        { error: true },
      );
      setBusy(false);
    }
  }

  // ── Confirm-delete dialog ──────────────────────────────────────────────────

  function showDeleteConfirm(brickId, brickName) {
    if (!dom.confirmDialog) {
      deleteBrick(brickId);
      return;
    }

    state.pendingDeleteId = brickId;

    if (dom.dialogBody) {
      dom.dialogBody.textContent = `Delete "${brickName || brickId}"? This cannot be undone.`;
    }

    dom.confirmDialog.showModal();
  }

  // ── Event bindings ─────────────────────────────────────────────────────────

  function bindFilterButtons() {
    dom.filterButtons.forEach((button) => {
      button.addEventListener("click", () => {
        dom.filterButtons.forEach((b) => b.classList.remove("is-active"));
        button.classList.add("is-active");
        state.activeFilter = button.dataset.filter || "all";
        applyFilters();
      });
    });
  }

  function bindSearch() {
    if (!dom.search) {
      return;
    }

    dom.search.addEventListener("input", () => {
      state.searchQuery = dom.search.value;
      applyFilters();
    });
  }

  function bindToolbarButtons() {
    if (dom.addButton) {
      dom.addButton.addEventListener("click", () => {
        openWizard();
      });
    }

    if (dom.refreshButton) {
      dom.refreshButton.addEventListener("click", () => {
        loadBricks();
      });
    }
  }

  function bindTableActions() {
    if (!dom.tableBody) {
      return;
    }

    dom.tableBody.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) {
        return;
      }

      const action = button.dataset.action;
      const brickId = button.dataset.brickId;

      if (!brickId) {
        return;
      }

      if (action === "edit") {
        if (button.dataset.brickType === "TEMPLATE") {
          openTemplateWizard(brickId);
        } else {
          openWizard({ editBrickId: brickId });
        }
        return;
      }

      if (action === "delete") {
        const row = button.closest("tr");
        const nameCell = row?.querySelector("td:nth-child(2)");
        const brickName = nameCell?.textContent?.trim() || brickId;
        showDeleteConfirm(brickId, brickName);
        return;
      }

      if (action === "promote") {
        promoteBrick(brickId);
      }
    });
  }

  function bindDialog() {
    if (!dom.confirmDialog) {
      return;
    }

    if (dom.dialogConfirm) {
      dom.dialogConfirm.addEventListener("click", () => {
        dom.confirmDialog.close();
        if (state.pendingDeleteId) {
          deleteBrick(state.pendingDeleteId);
          state.pendingDeleteId = null;
        }
      });
    }

    if (dom.dialogCancel) {
      dom.dialogCancel.addEventListener("click", () => {
        dom.confirmDialog.close();
        state.pendingDeleteId = null;
      });
    }

    dom.confirmDialog.addEventListener("cancel", () => {
      state.pendingDeleteId = null;
    });
  }

  function bindWizardMessages() {
    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const data = event.data;
      if (
        !data
        || !["brickene-node-wizard", "brickene-template-wizard"].includes(data.source)
        || !["brick-definition-saved", "brick-definition-updated",
            "template-definition-saved", "template-definition-updated"].includes(data.type)
      ) {
        return;
      }

      const actionLabel = ["brick-definition-updated", "template-definition-updated"].includes(data.type)
        ? "Updated" : "Saved";
      const id = data.definition?.id || "?";
      setStatus(`${actionLabel}: ${id}.`, { success: true });
      loadBricks();
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    bindFilterButtons();
    bindSearch();
    bindToolbarButtons();
    bindTableActions();
    bindDialog();
    bindWizardMessages();
    loadBricks();
  }

  init();
})();
