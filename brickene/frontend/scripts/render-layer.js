(() => {
  const frontend = window.BrickeneFrontend;
  const { dom } = frontend;
  let activeRenderRequestId = 0;
  let activePreviewUrl = null;

  async function requestRenderPreview(detail = {}) {
    if (!dom.renderPreviewWindow || !dom.renderPreviewMeta || !dom.renderPreviewImage) {
      return;
    }

    const payload = frontend.exportGraphState();
    const requestId = ++activeRenderRequestId;

    try {
      const response = await fetch(frontend.config.renderApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorPayload = await readRenderError(response);
        throw new Error(errorPayload);
      }

      const imageBlob = await response.blob();
      if (requestId !== activeRenderRequestId) {
        return;
      }

      if (activePreviewUrl) {
        URL.revokeObjectURL(activePreviewUrl);
      }

      activePreviewUrl = URL.createObjectURL(imageBlob);
      dom.renderPreviewImage.src = activePreviewUrl;
      dom.renderPreviewImage.hidden = false;
      dom.renderPreviewWindow.dataset.previewState = "ready";
      dom.renderPreviewMeta.textContent = formatPreviewStatus(detail.reason || "graph-updated", payload);
    } catch (error) {
      if (requestId !== activeRenderRequestId) {
        return;
      }

      dom.renderPreviewImage.hidden = true;
      dom.renderPreviewWindow.dataset.previewState = "error";
      dom.renderPreviewMeta.textContent = error instanceof Error ? error.message : "Render request failed.";
    }
  }

  function refreshRenderPreview(detail = {}) {
    if (!dom.renderPreviewWindow || !dom.renderPreviewMeta || !dom.renderPreviewImage) {
      return;
    }

    const reason = detail.reason || "graph-updated";
    dom.renderPreviewWindow.dataset.previewState = "pending";
    dom.renderPreviewWindow.dataset.changeReason = reason;
    dom.renderPreviewImage.hidden = true;
    dom.renderPreviewMeta.textContent = `Rendering ${reason.replace(/-/g, " ")}...`;
    requestRenderPreview(detail);
  }

  function formatPreviewStatus(reason, payload) {
    return `${reason.replace(/-/g, " ")} | ${payload.nodes.length} node(s) | ${payload.edges.length} edge(s)`;
  }

  async function readRenderError(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      return payload.error || `Render request failed with status ${response.status}.`;
    }

    const text = await response.text();
    return text || `Render request failed with status ${response.status}.`;
  }

  function bindRenderLayer() {
    if (!dom.canvasViewport) {
      return;
    }

    dom.canvasViewport.addEventListener(frontend.GRAPH_CHANGE_EVENT, (event) => {
      refreshRenderPreview(event.detail || {});
    });
  }

  frontend.refreshRenderPreview = refreshRenderPreview;
  frontend.bindRenderLayer = bindRenderLayer;
})();