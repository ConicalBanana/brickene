(() => {
  const frontend = window.BrickeneFrontend;
  const { dom } = frontend;

  function refreshRenderPreview(detail = {}) {
    if (!dom.renderPreviewWindow || !dom.renderPreviewMeta || !dom.renderPreviewImage) {
      return;
    }

    const graph = frontend.getGraphState();
    const reason = detail.reason || "graph-updated";
    dom.renderPreviewWindow.dataset.previewState = "pending";
    dom.renderPreviewWindow.dataset.changeReason = reason;
    dom.renderPreviewImage.hidden = true;
    dom.renderPreviewMeta.textContent = `${reason.replace(/-/g, " ")} | ${graph.nodes.length} node(s) | ${graph.edges.length} edge(s)`;
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