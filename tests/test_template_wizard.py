"""Playwright debug tests for the Template Wizard page.

Run after starting the dev servers with ./start.sh (or the equivalent
background processes):

    conda activate brick
    pytest tests/test_template_wizard.py -v

Connects to:
  - Frontend (http-server):  http://127.0.0.1:8081
  - Render backend (Python): http://127.0.0.1:8765
"""

from __future__ import annotations

import re

import pytest
from playwright.sync_api import Page, expect

FRONTEND_BASE = "http://127.0.0.1:8081"
WIZARD_PAGE = (
    f"{FRONTEND_BASE}/template_wizard.html"
    "?renderApiUrl=http://127.0.0.1:8765/render"
    "&brickApiUrl=http://127.0.0.1:8765/bricks"
)
EDITOR_PAGE = f"{FRONTEND_BASE}/index.html"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_wizard(page: Page, timeout: int = 15_000) -> None:
    """Navigate to the template wizard and wait until the canvas is ready."""
    page.goto(WIZARD_PAGE, wait_until="networkidle", timeout=timeout)


# ---------------------------------------------------------------------------
# 1. Page load & DOM structure
# ---------------------------------------------------------------------------

class TestTemplateWizardLoad:
    """The page must load and expose all expected DOM elements."""

    def test_page_title(self, page: Page):
        load_wizard(page)
        assert "Template Wizard" in page.title(), (
            f"Unexpected page title: {page.title()!r}"
        )

    def test_name_input_present(self, page: Page):
        load_wizard(page)
        inp = page.locator("#template-name")
        expect(inp).to_be_visible()
        # Default value set in the HTML
        assert inp.input_value() == "New Template"

    def test_alias_input_present(self, page: Page):
        load_wizard(page)
        expect(page.locator("#template-alias")).to_be_visible()

    def test_save_button_present(self, page: Page):
        load_wizard(page)
        btn = page.locator("#template-wizard-save")
        expect(btn).to_be_visible()
        expect(btn).to_be_enabled()

    def test_send_button_present(self, page: Page):
        load_wizard(page)
        btn = page.locator("#template-wizard-send")
        expect(btn).to_be_visible()
        expect(btn).to_be_enabled()

    def test_status_bar_present(self, page: Page):
        load_wizard(page)
        status = page.locator("#template-wizard-status")
        expect(status).to_be_visible()

    def test_menu_buttons_present(self, page: Page):
        load_wizard(page)
        for label in ("File", "Edit", "View"):
            btn = page.locator(f".menu-button:has-text('{label}')")
            expect(btn).to_be_visible()

    def test_node_menu_button_absent(self, page: Page):
        """The Node menu must be stripped from the template wizard."""
        load_wizard(page)
        node_btn = page.locator(".menu-button:has-text('Node')")
        expect(node_btn).to_have_count(0)

    def test_canvas_viewport_present(self, page: Page):
        load_wizard(page)
        expect(page.locator("#canvas-viewport")).to_be_visible()


# ---------------------------------------------------------------------------
# 2. Canvas bootstrap
# ---------------------------------------------------------------------------

class TestTemplateWizardBootstrap:
    """The full canvas engine must bootstrap successfully on the wizard page."""

    def test_frontend_global_exists(self, page: Page):
        load_wizard(page)
        has_global = page.evaluate(
            "() => typeof window.BrickeneFrontend !== 'undefined'"
        )
        assert has_global, "window.BrickeneFrontend is not defined after bootstrap"

    def test_export_graph_state_returns_object(self, page: Page):
        load_wizard(page)
        graph = page.evaluate(
            "() => window.BrickeneFrontend.exportGraphState()"
        )
        assert isinstance(graph, dict), (
            f"exportGraphState() should return a dict, got {type(graph)}"
        )
        assert "nodes" in graph and "edges" in graph, (
            f"Graph state missing nodes/edges keys: {list(graph.keys())}"
        )

    def test_canvas_is_empty_on_fresh_load(self, page: Page):
        load_wizard(page)
        graph = page.evaluate(
            "() => window.BrickeneFrontend.exportGraphState()"
        )
        assert graph["nodes"] == [], (
            f"Fresh wizard canvas should have no nodes, got: {graph['nodes']}"
        )

    def test_container_scale_is_one(self, page: Page):
        load_wizard(page)
        cs = page.evaluate(
            "() => window.BrickeneFrontend.getContainerScale()"
        )
        assert abs(cs - 1.0) < 0.05, f"Expected containerScale ≈ 1.0, got {cs}"


# ---------------------------------------------------------------------------
# 3. Metadata inputs
# ---------------------------------------------------------------------------

class TestTemplateWizardInputs:
    """Name and alias inputs must accept and reflect user input."""

    def test_name_input_accepts_text(self, page: Page):
        load_wizard(page)
        inp = page.locator("#template-name")
        inp.fill("My Template")
        assert inp.input_value() == "My Template"

    def test_alias_input_accepts_text(self, page: Page):
        load_wizard(page)
        inp = page.locator("#template-alias")
        inp.fill("tmpl, my-tmpl")
        assert inp.input_value() == "tmpl, my-tmpl"

    def test_save_requires_name(self, page: Page):
        """Clicking Save with an empty name shows an error status."""
        load_wizard(page)
        page.locator("#template-name").fill("")
        page.locator("#template-wizard-save").click()
        status = page.locator("#template-wizard-status")
        expect(status).to_have_class(re.compile(r"is-error"), timeout=2000)

    def test_send_requires_name(self, page: Page):
        """Clicking Send with an empty name shows an error status."""
        load_wizard(page)
        page.locator("#template-name").fill("")
        page.locator("#template-wizard-send").click()
        status = page.locator("#template-wizard-status")
        expect(status).to_have_class(re.compile(r"is-error"), timeout=2000)

    def test_send_without_opener_shows_error(self, page: Page):
        """Sending when no opener window exists shows an error status message."""
        load_wizard(page)
        page.locator("#template-name").fill("Test Template")
        page.locator("#template-wizard-send").click()
        status = page.locator("#template-wizard-status")
        expect(status).to_have_class(re.compile(r"is-error"), timeout=2000)


# ---------------------------------------------------------------------------
# 4. Save to database (end-to-end)
# ---------------------------------------------------------------------------

class TestTemplateWizardSave:
    """Save must POST a TEMPLATE brick to the backend and show a success status."""

    def test_save_posts_template_brick(self, page: Page):
        load_wizard(page)
        page.locator("#template-name").fill("Playwright Test Template")
        page.locator("#template-alias").fill("pw-test")

        with page.expect_request("**/bricks**") as req_info:
            page.locator("#template-wizard-save").click()

        req = req_info.value
        body = req.post_data_json
        assert body is not None, "POST body was empty"
        defn = body.get("definition", {})
        assert defn.get("brick_type") == "TEMPLATE", (
            f"brick_type should be TEMPLATE, got {defn.get('brick_type')!r}"
        )
        assert defn.get("name") == "Playwright Test Template", (
            f"name mismatch: {defn.get('name')!r}"
        )
        assert "pw-test" in defn.get("alias", []), (
            f"alias missing pw-test: {defn.get('alias')}"
        )
        assert "template_graph" in defn, "definition must include template_graph"

    def test_save_shows_success_status(self, page: Page):
        load_wizard(page)
        page.locator("#template-name").fill("Playwright Test Template 2")

        page.locator("#template-wizard-save").click()

        status = page.locator("#template-wizard-status")
        expect(status).to_have_class(re.compile(r"is-success"), timeout=8000)

    def test_save_sets_busy_then_re_enables_buttons(self, page: Page):
        load_wizard(page)
        page.locator("#template-name").fill("Playwright Busy Test")

        # Verify buttons become enabled again after save completes.
        page.locator("#template-wizard-save").click()
        expect(page.locator("#template-wizard-save")).to_be_enabled(timeout=8000)
        expect(page.locator("#template-wizard-send")).to_be_enabled(timeout=8000)


# ---------------------------------------------------------------------------
# 5. Canvas interaction (right-click context menu)
# ---------------------------------------------------------------------------

class TestTemplateWizardCanvas:
    """Basic canvas interactions must work identically to the main editor."""

    def test_right_click_opens_context_menu(self, page: Page):
        load_wizard(page)
        canvas = page.locator("#canvas-viewport")
        canvas.wait_for(state="visible", timeout=5000)
        canvas.click(button="right")
        menu = page.locator("#canvas-context-menu")
        expect(menu).to_have_class(re.compile(r"is-open"), timeout=3000)

    def test_canvas_zoom_controls_present(self, page: Page):
        load_wizard(page)
        expect(page.locator("#canvas-zoom-in")).to_be_visible()
        expect(page.locator("#canvas-zoom-out")).to_be_visible()
        expect(page.locator("#canvas-zoom-reset")).to_be_visible()


# ---------------------------------------------------------------------------
# 6. Node menu on main editor exposes Template wizard action
# ---------------------------------------------------------------------------

class TestMainEditorTemplateWizardEntry:
    """The main editor's Node menu config must include a 'Template wizard' entry."""

    def test_node_submenu_config_has_template_wizard(self, page: Page):
        """config.submenuMap.node must contain a 'Template wizard' entry."""
        page.goto(EDITOR_PAGE, wait_until="networkidle")
        page.wait_for_function(
            "() => typeof window.BrickeneFrontend !== 'undefined'",
            timeout=10_000,
        )
        node_items = page.evaluate(
            "() => window.BrickeneFrontend.config.submenuMap.node || []"
        )
        assert any(
            (isinstance(item, str) and item == "Template wizard")
            or (isinstance(item, dict) and item.get("label") == "Template wizard")
            for item in node_items
        ), f"'Template wizard' not found in node submenu config: {node_items}"

    def test_node_menu_button_opens_submenu(self, page: Page):
        """Clicking the Node menu button must open the submenu dropdown."""
        page.goto(EDITOR_PAGE, wait_until="networkidle")
        page.wait_for_function(
            "() => typeof window.BrickeneFrontend !== 'undefined'",
            timeout=10_000,
        )
        node_btn = page.locator(".menu-button[data-menu='node']")
        # dispatch_event skips Playwright's pointer-move synthesis, which would
        # otherwise trigger pointerenter→openTopMenu("node") before the click,
        # causing isSameMenu==true→closeTopMenu() when the click fires.
        node_btn.dispatch_event("click")
        submenu = page.locator("#submenu-dropdown")
        expect(submenu).to_have_class(re.compile(r"is-open"), timeout=5000)
        item = page.locator("#submenu-content .submenu-pill:has-text('Template wizard')")
        expect(item).to_be_visible(timeout=3000)


class TestTemplateInsertion:
    """TEMPLATE bricks chosen from Shift+Q must paste their full graph."""

    def test_shift_q_pastes_full_template_graph(self, page: Page):
        page.goto(EDITOR_PAGE, wait_until="networkidle")
        page.wait_for_function(
            "() => typeof window.BrickeneFrontend !== 'undefined'",
            timeout=10_000,
        )

        page.evaluate(
            """() => {
                window.BrickeneFrontend.registerBrickDefinition({
                    id: "user-template-shift-q",
                    name: "ShiftQ Paste Template",
                    alias: ["shiftq-template"],
                    brick_type: "TEMPLATE",
                    nodes: [],
                    edges: [],
                    template_graph: {
                        version: 1,
                        nodes: [
                            {
                                id: 1,
                                title: "Node 1",
                                type: "rectangular",
                                nodeTypeId: "39",
                                position: { x: 100, y: 100 },
                                portConfiguration: [
                                    { slotId: 0, side: null, actualPortId: "1" },
                                ],
                            },
                            {
                                id: 2,
                                title: "Node 2",
                                type: "rectangular",
                                nodeTypeId: "39",
                                position: { x: 320, y: 100 },
                                portConfiguration: [
                                    { slotId: 0, side: null, actualPortId: "1" },
                                ],
                            },
                        ],
                        edges: [
                            { id: 1, startNode: 1, startPort: 0, endNode: 2, endPort: 0 },
                        ],
                    },
                });
            }"""
        )

        page.locator("#canvas-viewport").click()
        page.keyboard.press("Shift+Q")
        command_input = page.locator("#port-command-input")
        expect(command_input).to_be_visible(timeout=3000)
        command_input.fill("ShiftQ Paste Template")
        page.keyboard.press("Enter")

        graph = page.evaluate("() => window.BrickeneFrontend.exportGraphState()")
        assert len(graph["nodes"]) == 2, graph
        assert len(graph["edges"]) == 1, graph
