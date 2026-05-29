(() => {
  const frontend = window.BrickeneFrontend;

  /** @type {{ id: string, keys: string[], metaOrCtrl: boolean|null, alt: boolean|null, shift: boolean|null, customMatch: Function|null, description: string, handler: Function }[]} */
  let shortcutRegistry = [];
  let nextShortcutId = 1;

  // ── Guard helpers ────────────────────────────────────────────────────────

  /**
   * Whether the primary modifier (Cmd on macOS, Ctrl on other platforms) is
   * pressed.  Exposed on ``frontend`` so other modules can reuse it.
   */
  function isPrimaryModifierPressed(event) {
    return frontend.platform?.isMacOS ? event.metaKey : event.ctrlKey;
  }

  /**
   * Whether the keyboard event target is an input-like element where we should
   * suppress canvas shortcuts.  Exposed on ``frontend``.
   */
  function shouldIgnoreKeyboardShortcut(target) {
    return target instanceof Element
      && Boolean(target.closest('input, select, textarea, [contenteditable="true"]'));
  }

  frontend.isPrimaryModifierPressed = isPrimaryModifierPressed;
  frontend.shouldIgnoreKeyboardShortcut = shouldIgnoreKeyboardShortcut;

  // ── Registry API ─────────────────────────────────────────────────────────

  /**
   * Register a keyboard shortcut.
   *
   * @param {Object} config
   * @param {string|string[]} config.keys - Key(s) to match (``event.key``, case-insensitive).
   * @param {boolean|null}  [config.metaOrCtrl] - ``true`` requires primary mod,
   *        ``false`` forbids it, ``null``/omitted means don't care.
   * @param {boolean|null}  [config.alt] - ``true`` requires Alt,
   *        ``false`` forbids it, ``null``/omitted means don't care.
   * @param {boolean|null}  [config.shift] - ``true`` requires Shift,
   *        ``false`` forbids it, ``null``/omitted means don't care.
   * @param {Function}      [config.customMatch] - Optional ``(event) => boolean``
   *        for advanced matching (e.g. overriding the default key+modifier check).
   * @param {string}        config.description - Human-readable label.
   * @param {Function}      config.handler - Called when the shortcut fires.
   *        Return ``true`` to preventDefault (done automatically if handler
   *        is called), ``false`` to let the event propagate.
   * @returns {string} A unique id that can be passed to ``unregisterShortcut``.
   */
  function registerShortcut(config) {
    const id = `shortcut-${nextShortcutId++}`;
    const keys = typeof config.keys === "string" ? [config.keys] : (config.keys || []);

    shortcutRegistry.push({
      id,
      keys,
      metaOrCtrl: config.metaOrCtrl ?? null,
      alt: config.alt ?? null,
      shift: config.shift ?? null,
      customMatch: typeof config.customMatch === "function" ? config.customMatch : null,
      description: config.description || "",
      handler: config.handler,
    });

    return id;
  }

  /**
   * Remove a previously registered shortcut by its id.
   *
   * @param {string} id - The id returned by ``registerShortcut``.
   * @returns {boolean} ``true`` if the shortcut was found and removed.
   */
  function unregisterShortcut(id) {
    const index = shortcutRegistry.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return false;
    }
    shortcutRegistry.splice(index, 1);
    return true;
  }

  /**
   * Remove all registered shortcuts (useful for teardown).
   */
  function clearShortcuts() {
    shortcutRegistry = [];
  }

  // ── Matching ─────────────────────────────────────────────────────────────

  /**
   * Check whether ``value`` (boolean|null) matches the required modifier state.
   *   - ``null``  → always matches (don't care)
   *   - ``true``  → ``value`` must be truthy
   *   - ``false`` → ``value`` must be falsy
   */
  function modifierMatches(required, actual) {
    if (required === null) return true;
    return required === !!actual;
  }

  /**
   * Check whether a registered shortcut entry matches a KeyboardEvent.
   */
  function shortcutMatches(entry, event) {
    if (entry.customMatch) {
      return entry.customMatch(event);
    }

    if (!entry.keys.includes(event.key.toLowerCase())) {
      return false;
    }

    return (
      modifierMatches(entry.metaOrCtrl, isPrimaryModifierPressed(event))
      && modifierMatches(entry.alt, event.altKey)
      && modifierMatches(entry.shift, event.shiftKey)
    );
  }

  // ── Dispatcher ───────────────────────────────────────────────────────────

  /**
   * The central keyboard-event dispatcher for canvas shortcuts.
   * Call this from the document ``keydown`` listener.
   *
   * Iterates through the shortcut registry (most-recently-registered first)
   * and fires the first matching handler.  The handler is expected to call
   * ``event.preventDefault()`` itself when appropriate.
   *
   * @param {KeyboardEvent} event
   * @returns {boolean} ``true`` if a handler was triggered.
   */
  function dispatchShortcut(event) {
    if (shouldIgnoreKeyboardShortcut(event.target)) {
      return false;
    }

    // Walk in reverse so recently-registered shortcuts take priority.
    for (let i = shortcutRegistry.length - 1; i >= 0; i--) {
      const entry = shortcutRegistry[i];

      if (shortcutMatches(entry, event)) {
        entry.handler(event);
        return true;
      }
    }

    return false;
  }

  // ── Action registry (named handlers referenced by shortcuts.json) ─────────

  /** @type {Record<string, Function>} */
  const actionRegistry = {};

  /**
   * Register a named action handler.  Action names are referenced by the
   * ``action`` field in ``shortcuts.json`` entries.
   *
   * @param {string} name - The action name (e.g. ``"copySelection"``).
   * @param {Function} handler - ``function(event, args)`` where ``args`` is
   *        the optional ``args`` value from the config entry.
   */
  function registerShortcutAction(name, handler) {
    actionRegistry[name] = handler;
  }

  /**
   * Load a shorthand config array (the parsed contents of ``shortcuts.json``)
   * and register every entry as a shortcut.
   *
   * Each config entry must have at least ``action`` and ``keys``.  Optional
   * fields: ``metaOrCtrl``, ``alt``, ``shift``, ``args``, ``description``.
   *
   * @param {Object[]} configArray
   */
  function loadShortcutConfig(configArray) {
    for (const entry of configArray) {
      const handler = actionRegistry[entry.action];

      if (!handler) {
        console.warn(`[shortcuts] Unknown action "${entry.action}" — shortcut skipped.`);
        continue;
      }

      registerShortcut({
        keys: entry.keys,
        metaOrCtrl: entry.metaOrCtrl ?? null,
        alt: entry.alt ?? null,
        shift: entry.shift ?? null,
        description: entry.description || "",
        handler(event) {
          handler(event, entry.args);
        },
      });
    }
  }

  // ── Exports ──────────────────────────────────────────────────────────────

  frontend.registerShortcut = registerShortcut;
  frontend.unregisterShortcut = unregisterShortcut;
  frontend.clearShortcuts = clearShortcuts;
  frontend.dispatchShortcut = dispatchShortcut;
  frontend.registerShortcutAction = registerShortcutAction;
  frontend.loadShortcutConfig = loadShortcutConfig;
})();
