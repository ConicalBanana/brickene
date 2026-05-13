(() => {
  const frontend = window.BrickeneFrontend;
  const { dom } = frontend;
  let activeRenderRequestId = 0;
  let activePreviewUrl = null;

  function getSmilesApiUrl() {
    return frontend.config.renderApiUrl.replace(/\/render\/?$/, "/smiles");
  }

  async function requestRenderPreview(detail = {}) {
    if (!dom.renderPreviewWindow || !dom.renderPreviewMeta || !dom.renderPreviewImage) {
      return;
    }

    const payload = frontend.exportGraphState();
    const requestId = ++activeRenderRequestId;

    try {
      const [imageResponse, smilesResponse] = await Promise.all([
        fetch(frontend.config.renderApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }),
        fetch(getSmilesApiUrl(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }),
      ]);

      if (!imageResponse.ok) {
        const errorPayload = await readRenderError(imageResponse);
        throw new Error(errorPayload);
      }

      if (!smilesResponse.ok) {
        const errorPayload = await readRenderError(smilesResponse);
        throw new Error(errorPayload);
      }

      const [imageBlob, smilesPayload] = await Promise.all([
        imageResponse.blob(),
        smilesResponse.json(),
      ]);
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
      dom.renderPreviewMeta.textContent = smilesPayload.smiles || "";
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
    dom.renderPreviewMeta.textContent = "Rendering SMILES...";
    requestRenderPreview(detail);
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