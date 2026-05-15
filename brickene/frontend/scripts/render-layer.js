(() => {
  const frontend = window.BrickeneFrontend;
  const { dom } = frontend;
  let activeRenderRequestId = 0;
  let activePreviewUrl = null;

  async function requestRenderPreview(detail = {}) {
    if (!dom.renderPreviewWindow || !dom.renderPreviewImage) {
      return;
    }

    const payload = frontend.exportGraphState();
    const requestId = ++activeRenderRequestId;

    try {
      const imageResponse = await fetch(frontend.config.renderApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!imageResponse.ok) {
        const errorPayload = await readRenderError(imageResponse);
        throw new Error(errorPayload);
      }

      const imageBlob = await imageResponse.blob();
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
      if (dom.renderPreviewMeta) {
        dom.renderPreviewMeta.textContent = "";
      }
    } catch (error) {
      if (requestId !== activeRenderRequestId) {
        return;
      }

      dom.renderPreviewImage.hidden = true;
      dom.renderPreviewWindow.dataset.previewState = "error";
      if (dom.renderPreviewMeta) {
        dom.renderPreviewMeta.textContent = error instanceof Error ? error.message : "Render request failed.";
      }
    }
  }

  function refreshRenderPreview(detail = {}) {
    if (!dom.renderPreviewWindow || !dom.renderPreviewImage) {
      return;
    }

    const reason = detail.reason || "graph-updated";
    dom.renderPreviewWindow.dataset.previewState = "pending";
    dom.renderPreviewWindow.dataset.changeReason = reason;
    dom.renderPreviewImage.hidden = true;
    if (dom.renderPreviewMeta) {
      dom.renderPreviewMeta.textContent = "Rendering preview...";
    }
    requestRenderPreview(detail);
  }

  function shouldRefreshRenderPreview(detail = {}) {
    return detail.refreshPreview !== false;
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
      const detail = event.detail || {};
      if (!shouldRefreshRenderPreview(detail)) {
        return;
      }

      refreshRenderPreview(detail);
    });
  }

  frontend.refreshRenderPreview = refreshRenderPreview;
  frontend.shouldRefreshRenderPreview = shouldRefreshRenderPreview;
  frontend.bindRenderLayer = bindRenderLayer;
})();