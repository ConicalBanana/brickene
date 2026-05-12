(() => {
  const frontend = window.BrickeneFrontend;
  const { dom } = frontend;

  function getPortWorldPoint(nodeId, slotId) {
    const portElement = dom.nodeContainer.querySelector(
      `.node-port[data-node-id="${nodeId}"][data-slot-id="${slotId}"]`,
    );
    if (!portElement) {
      return null;
    }

    const worldRect = dom.componentWorld.getBoundingClientRect();
    const portRect = portElement.getBoundingClientRect();

    return {
      x: portRect.left - worldRect.left + portRect.width / 2,
      y: portRect.top - worldRect.top + portRect.height / 2,
    };
  }

  function findHoveredPort(clientX, clientY) {
    const port = document.elementFromPoint(clientX, clientY)?.closest(".node-port");
    if (!port) {
      return null;
    }

    return {
      nodeId: Number(port.dataset.nodeId),
      slotId: Number(port.dataset.slotId),
    };
  }

  function renderEdges() {
    const graph = frontend.getGraphState();
    const ui = frontend.getUiState();
    const edgeMarkup = graph.edges.map((edge) => {
      const from = getPortWorldPoint(edge.from.nodeId, edge.from.slotId);
      const to = getPortWorldPoint(edge.to.nodeId, edge.to.slotId);

      if (!from || !to) {
        return "";
      }

      return `
        <line
          class="edge-line"
          x1="${from.x}"
          y1="${from.y}"
          x2="${to.x}"
          y2="${to.y}"
          data-edge-id="${edge.id}"
        ></line>
      `;
    }).join("");

    let draftMarkup = "";
    if (ui.componentInteraction?.type === "edge-drag") {
      const from = getPortWorldPoint(ui.componentInteraction.sourceNodeId, ui.componentInteraction.sourceSlotId);
      if (from) {
        draftMarkup = `
          <line
            class="edge-line-draft"
            x1="${from.x}"
            y1="${from.y}"
            x2="${ui.componentInteraction.pointerWorld.x}"
            y2="${ui.componentInteraction.pointerWorld.y}"
          ></line>
        `;
      }
    }

    dom.edgeLayer.innerHTML = `${edgeMarkup}${draftMarkup}`;
  }

  function beginEdgeDrag(event, nodeId, slotId) {
    const slot = frontend.findPortSlot(nodeId, slotId);
    if (!slot) {
      return;
    }

    if (slot.edgeId !== null) {
      frontend.setCanvasMessage(`${slot.label} is already occupied.`);
      return;
    }

    frontend.getUiState().componentInteraction = {
      type: "edge-drag",
      pointerId: event.pointerId,
      sourceNodeId: nodeId,
      sourceSlotId: slotId,
      pointerWorld: frontend.clientToWorldPoint(event.clientX, event.clientY),
      hoverPort: null,
    };
    dom.canvasViewport.setPointerCapture(event.pointerId);
    frontend.renderNodes();
    frontend.setCanvasMessage(`Lining from ${slot.label}.`);
  }

  function createEdgeBetweenPorts(sourcePort, targetPort) {
    const graph = frontend.getGraphState();

    if (sourcePort.nodeId === targetPort.nodeId && sourcePort.slotId === targetPort.slotId) {
      return { success: false, message: "Choose a different port." };
    }

    const sourceSlot = frontend.findPortSlot(sourcePort.nodeId, sourcePort.slotId);
    const targetSlot = frontend.findPortSlot(targetPort.nodeId, targetPort.slotId);
    if (!sourceSlot || !targetSlot) {
      return { success: false, message: "Port not found." };
    }

    if (sourceSlot.edgeId !== null || targetSlot.edgeId !== null) {
      return { success: false, message: "Each port can only hold one line." };
    }

    const edge = {
      id: graph.nextEdgeId,
      from: { ...sourcePort },
      to: { ...targetPort },
    };

    graph.nextEdgeId += 1;
    graph.edges = [...graph.edges, edge];
    frontend.updateNodePortEdge(sourcePort.nodeId, sourcePort.slotId, edge.id);
    frontend.updateNodePortEdge(targetPort.nodeId, targetPort.slotId, edge.id);
    frontend.renderNodes();
    return { success: true, message: "Line created." };
  }

  frontend.getPortWorldPoint = getPortWorldPoint;
  frontend.findHoveredPort = findHoveredPort;
  frontend.renderEdges = renderEdges;
  frontend.beginEdgeDrag = beginEdgeDrag;
  frontend.createEdgeBetweenPorts = createEdgeBetweenPorts;
})();
