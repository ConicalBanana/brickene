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

    // Zoom preview image around the cursor while hovering over the preview frame.
    const frame = dom.renderPreviewWindow?.querySelector(".render-preview-frame");
    const img = dom.renderPreviewImage;

    if (frame && img) {
      frame.addEventListener("mousemove", (event) => {
        const rect = frame.getBoundingClientRect();
        const xPct = ((event.clientX - rect.left) / rect.width) * 100;
        const yPct = ((event.clientY - rect.top) / rect.height) * 100;
        img.style.transformOrigin = `${xPct}% ${yPct}%`;
        img.style.transform = "scale(2.5)";
      });

      frame.addEventListener("mouseleave", () => {
        img.style.transform = "";
        img.style.transformOrigin = "50% 50%";
      });
    }
  }

  frontend.refreshRenderPreview = refreshRenderPreview;
  frontend.shouldRefreshRenderPreview = shouldRefreshRenderPreview;
  frontend.bindRenderLayer = bindRenderLayer;
})();