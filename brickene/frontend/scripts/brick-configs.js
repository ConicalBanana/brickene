(() => {
  const frontend = window.BrickeneFrontend = window.BrickeneFrontend || {};
  
  const catalogUrl = new URL("../assets/brick_configs.json", window.location.href);

  function loadBrickDefinitions() {
    const request = new XMLHttpRequest();

    request.open("GET", catalogUrl.href, false);
    request.send();

    if (request.status !== 0 && (request.status < 200 || request.status >= 300)) {
      throw new Error(`Failed to load brick catalog from ${catalogUrl.href}.`);
    }

    return JSON.parse(request.responseText);
  }

  try {
    frontend.brickDefinitions = loadBrickDefinitions();
  } catch (error) {
    console.error("Failed to load brick definitions.", error);
    frontend.brickDefinitions = {};
    frontend.brickDefinitionsError = error instanceof Error
      ? error.message
      : "Failed to load brick definitions.";
  }
})();