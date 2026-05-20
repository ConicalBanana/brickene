(() => {
  const frontend = window.BrickeneFrontend = window.BrickeneFrontend || {};
  const brickApiUrl = frontend.config?.brickApiUrl || (() => {
    const runtimeUrl = new URL(window.location.href);
    const renderApiUrl = runtimeUrl.searchParams.get("renderApiUrl") || "http://127.0.0.1:8765/graph/render";

    return runtimeUrl.searchParams.get("brickApiUrl")
      || (/\/graph\/render\/?$/.test(renderApiUrl)
        ? renderApiUrl.replace(/\/graph\/render\/?$/, "/bricks")
        : "http://127.0.0.1:8765/bricks");
  })();

  function readJsonSync(url) {
    const request = new XMLHttpRequest();

    request.open("GET", url, false);
    request.send();

    if (request.status !== 0 && (request.status < 200 || request.status >= 300)) {
      throw new Error(`Failed to load JSON from ${url}.`);
    }

    return JSON.parse(request.responseText);
  }

  function normalizeBrickPayload(payload) {
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.bricks)) {
      return [];
    }

    return payload.bricks.filter((definition) => definition && typeof definition === "object");
  }

  function indexBrickDefinitions(definitions) {
    return definitions.reduce((indexedDefinitions, definition) => {
      indexedDefinitions[String(definition.id)] = definition;
      return indexedDefinitions;
    }, {});
  }

  function loadBrickDefinitions() {
    try {
      return indexBrickDefinitions(normalizeBrickPayload(readJsonSync(brickApiUrl)));
    } catch (error) {
      frontend.brickDefinitionsError = error instanceof Error
        ? error.message
        : "Failed to load brick definitions.";
      return {};
    }
  }

  async function refreshBrickDefinitions() {
    const response = await fetch(brickApiUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load brick definitions.");
    }

    const definitions = indexBrickDefinitions(normalizeBrickPayload(payload));
    frontend.brickDefinitions = definitions;
    return definitions;
  }

  async function storeBrickDefinition(definitionPayload) {
    const response = await fetch(brickApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ definition: definitionPayload }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "Failed to store the brick definition.");
    }

    return payload.definition;
  }

  try {
    frontend.brickDefinitions = loadBrickDefinitions();
    frontend.refreshBrickDefinitions = refreshBrickDefinitions;
    frontend.storeBrickDefinition = storeBrickDefinition;
  } catch (error) {
    console.error("Failed to load brick definitions.", error);
    frontend.brickDefinitions = {};
    frontend.brickDefinitionsError = error instanceof Error
      ? error.message
      : "Failed to load brick definitions.";
  }
})();