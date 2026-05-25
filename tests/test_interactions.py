"""Playwright interaction tests – click position and action result accuracy.

Verifies that every geometrical calculation uses the container coordinate
system correctly, so clicks land where the user intends at any scale.

Run after starting the servers with ./start.sh:

    conda activate brick
    pytest tests/test_interactions.py -v

The tests connect to the http-server instance on port 8081 and the Python
render server on port 8765 (started by start.sh).
"""

from __future__ import annotations

import re

import pytest
from playwright.sync_api import Frame, Page, expect

FRONTEND_BASE = "http://127.0.0.1:8081"
SMALL_PAGE = f"{FRONTEND_BASE}/iframe-example-small.html"
EDITOR_PAGE = f"{FRONTEND_BASE}/index.html"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def get_editor_frame(page: Page, timeout: int = 10_000) -> Frame:
    """Return the Frame object for the embedded Brickene editor iframe."""
    page.wait_for_load_state("networkidle", timeout=timeout)
    frame = next((f for f in page.frames if "index.html" in f.url), None)
    assert frame is not None, "Brickene editor iframe not found in page frames"
    return frame


# ---------------------------------------------------------------------------
# Tests — getContainerScale()
# ---------------------------------------------------------------------------


class TestContainerScale:
    """getContainerScale() must reflect the #editor-root transform ratio."""

    def test_scale_is_half_when_embedded(self, page: Page):
        """Editor embedded at scale=0.5 should report containerScale ≈ 0.5."""
        page.goto(SMALL_PAGE, wait_until="networkidle")
        frame = get_editor_frame(page)
        cs = frame.evaluate("() => window.BrickeneFrontend.getContainerScale()")
        assert abs(cs - 0.5) < 0.05, f"Expected containerScale ≈ 0.5, got {cs}"

    def test_scale_is_one_when_loaded_directly(self, page: Page):
        """Editor loaded without ?scale should report containerScale = 1."""
        page.goto(EDITOR_PAGE, wait_until="networkidle")
        cs = page.evaluate("() => window.BrickeneFrontend.getContainerScale()")
        assert abs(cs - 1.0) < 0.05, f"Expected containerScale ≈ 1.0, got {cs}"

    def test_scale_is_half_when_url_param_set(self, page: Page):
        """Editor loaded with ?scale=0.5 should report containerScale ≈ 0.5."""
        page.goto(f"{EDITOR_PAGE}?scale=0.5", wait_until="networkidle")
        cs = page.evaluate("() => window.BrickeneFrontend.getContainerScale()")
        assert abs(cs - 0.5) < 0.05, f"Expected containerScale ≈ 0.5, got {cs}"


# ---------------------------------------------------------------------------
# Tests — context menu position
# ---------------------------------------------------------------------------


class TestContextMenuPosition:
    """Context menu must appear at the visual click position for any scale."""

    def test_right_click_opens_context_menu(self, page: Page):
        """Right-clicking the canvas inside the iframe must open the menu."""
        page.goto(SMALL_PAGE, wait_until="networkidle")
        frame = get_editor_frame(page)

        canvas = frame.locator("#canvas-viewport")
        canvas.wait_for(state="visible", timeout=5000)

        canvas.click(button="right")
        menu = frame.locator("#canvas-context-menu")
        expect(menu).to_have_class(re.compile(r"is-open"), timeout=3000)

    def test_context_menu_position_within_canvas_bounds(self, page: Page):
        """Menu CSS left/top must be inside the canvas viewport bounds."""
        page.goto(SMALL_PAGE, wait_until="networkidle")
        frame = get_editor_frame(page)

        canvas = frame.locator("#canvas-viewport")
        canvas.wait_for(state="visible", timeout=5000)

        canvas.click(button="right")
        expect(frame.locator("#canvas-context-menu")).to_have_class(
            re.compile(r"is-open"), timeout=3000
        )

        style_left = frame.evaluate(
            "() => parseFloat("
            "document.getElementById('canvas-context-menu').style.left)"
        )
        style_top = frame.evaluate(
            "() => parseFloat("
            "document.getElementById('canvas-context-menu').style.top)"
        )
        canvas_w = frame.evaluate(
            "() => document.getElementById('canvas-viewport').offsetWidth"
        )
        canvas_h = frame.evaluate(
            "() => document.getElementById('canvas-viewport').offsetHeight"
        )

        assert 0 <= style_left <= canvas_w, (
            f"Menu left {style_left}px outside canvas width {canvas_w}px"
        )
        assert 0 <= style_top <= canvas_h, (
            f"Menu top {style_top}px outside canvas height {canvas_h}px"
        )

    def test_context_menu_position_near_click_at_scale_half(self, page: Page):
        """At scale=0.5 menu left/top should be near the logical click position.

        The menu's CSS left value lives in the canvas viewport's logical
        coordinate space.  At containerScale=0.5, a visual click at position
        (visual_cx, visual_cy) inside the canvas maps to logical position
        ≈ visual_cx / cs inside the canvas's own coordinate space.
        """
        page.goto(SMALL_PAGE, wait_until="networkidle")
        frame = get_editor_frame(page)

        canvas = frame.locator("#canvas-viewport")
        canvas.wait_for(state="visible", timeout=5000)

        # Click at the centre of the canvas (position relative to element).
        canvas_box = canvas.bounding_box()
        assert canvas_box is not None
        visual_cx = canvas_box["width"] / 2
        visual_cy = canvas_box["height"] / 2

        canvas.click(button="right", position={"x": visual_cx, "y": visual_cy})
        expect(frame.locator("#canvas-context-menu")).to_have_class(
            re.compile(r"is-open"), timeout=3000
        )

        cs = frame.evaluate("() => window.BrickeneFrontend.getContainerScale()")
        style_left = frame.evaluate(
            "() => parseFloat("
            "document.getElementById('canvas-context-menu').style.left)"
        )
        canvas_logical_w = frame.evaluate(
            "() => document.getElementById('canvas-viewport').offsetWidth"
        )

        # Expected: the menu appears near the logical centre of the canvas.
        expected_logical_x = canvas_logical_w / 2
        # Allow ±20 % of canvas logical width as tolerance.
        tolerance = canvas_logical_w * 0.20
        assert abs(style_left - expected_logical_x) < tolerance, (
            f"Menu left {style_left:.0f}px not near canvas logical centre "
            f"{expected_logical_x:.0f}px (cs={cs:.2f}, tol={tolerance:.0f}px)"
        )


# ---------------------------------------------------------------------------
# Tests — canvas pan accuracy
# ---------------------------------------------------------------------------


class TestCanvasPan:
    """Canvas offset change must equal drag distance / containerScale."""

    def test_pan_offset_accounts_for_scale(self, page: Page):
        """At scale=0.5 a 100 visual-px drag must move the canvas 200 logical px.

        This test loads the editor directly (not inside an iframe) so that
        mouse drag coordinates map 1-to-1 with the page viewport pixels.
        """
        page.goto(f"{EDITOR_PAGE}?scale=0.5", wait_until="networkidle")

        canvas = page.locator("#canvas-viewport")
        canvas.wait_for(state="visible", timeout=5000)

        cs = page.evaluate("() => window.BrickeneFrontend.getContainerScale()")
        assert abs(cs - 0.5) < 0.05, f"Expected cs ≈ 0.5, got {cs}"

        initial_offset = page.evaluate(
            "() => { const ui = window.BrickeneFrontend.getUiState();"
            " return { x: ui.canvasOffset.x, y: ui.canvasOffset.y }; }"
        )

        canvas_box = canvas.bounding_box()
        assert canvas_box is not None
        cx = canvas_box["x"] + canvas_box["width"] / 2
        cy = canvas_box["y"] + canvas_box["height"] / 2

        drag_px = 100  # visual pixels to drag

        # Activate pan mode with Space, drag, release.
        page.keyboard.down("Space")
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + drag_px, cy)
        page.mouse.up()
        page.keyboard.up("Space")

        final_offset = page.evaluate(
            "() => { const ui = window.BrickeneFrontend.getUiState();"
            " return { x: ui.canvasOffset.x, y: ui.canvasOffset.y }; }"
        )

        expected_dx = drag_px / cs  # 100 / 0.5 = 200 logical px
        actual_dx = final_offset["x"] - initial_offset["x"]

        assert abs(actual_dx - expected_dx) < 15, (
            f"Canvas x-offset changed by {actual_dx:.1f}px, "
            f"expected {expected_dx:.1f}px "
            f"(drag={drag_px}px, cs={cs:.2f})"
        )

    def test_pan_offset_at_scale_one(self, page: Page):
        """At scale=1 (no transform) a 100 visual-px drag must move 100 logical px."""
        page.goto(EDITOR_PAGE, wait_until="networkidle")

        canvas = page.locator("#canvas-viewport")
        canvas.wait_for(state="visible", timeout=5000)

        initial_offset = page.evaluate(
            "() => { const ui = window.BrickeneFrontend.getUiState();"
            " return { x: ui.canvasOffset.x, y: ui.canvasOffset.y }; }"
        )

        canvas_box = canvas.bounding_box()
        assert canvas_box is not None
        cx = canvas_box["x"] + canvas_box["width"] / 2
        cy = canvas_box["y"] + canvas_box["height"] / 2

        drag_px = 100

        page.keyboard.down("Space")
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + drag_px, cy)
        page.mouse.up()
        page.keyboard.up("Space")

        final_offset = page.evaluate(
            "() => { const ui = window.BrickeneFrontend.getUiState();"
            " return { x: ui.canvasOffset.x, y: ui.canvasOffset.y }; }"
        )

        actual_dx = final_offset["x"] - initial_offset["x"]
        assert abs(actual_dx - drag_px) < 10, (
            f"At scale=1: canvas x-offset changed by {actual_dx:.1f}px, "
            f"expected {drag_px}px"
        )


# ---------------------------------------------------------------------------
# Tests — world coordinate at right-click matches node creation target
# ---------------------------------------------------------------------------


class TestNodeCreationTarget:
    """canvasContextTarget must encode the world point under the right-click."""

    def test_context_target_set_on_right_click(self, page: Page):
        """Right-clicking canvas must record a valid world-coordinate target."""
        page.goto(SMALL_PAGE, wait_until="networkidle")
        frame = get_editor_frame(page)

        canvas = frame.locator("#canvas-viewport")
        canvas.wait_for(state="visible", timeout=5000)

        canvas.click(button="right")
        expect(frame.locator("#canvas-context-menu")).to_have_class(
            re.compile(r"is-open"), timeout=3000
        )

        target = frame.evaluate(
            "() => { const ui = window.BrickeneFrontend.getUiState();"
            " return ui.canvasContextTarget; }"
        )
        assert target is not None, "canvasContextTarget was not set after right-click"
        assert "x" in target and "y" in target, (
            f"canvasContextTarget missing x/y: {target}"
        )

    def test_context_target_near_canvas_centre_at_scale_half(self, page: Page):
        """At scale=0.5 a right-click at canvas centre should land near world (0,0).

        The initial canvas state has offset=(0,0) and canvasScale=1, so the
        world coordinate under the visual centre of the canvas component layer
        is approximately (0, 0).  We verify that the target is within a
        reasonable range of the component-layer centre.
        """
        page.goto(SMALL_PAGE, wait_until="networkidle")
        frame = get_editor_frame(page)

        canvas = frame.locator("#canvas-viewport")
        canvas.wait_for(state="visible", timeout=5000)

        canvas_box = canvas.bounding_box()
        assert canvas_box is not None

        canvas.click(
            button="right",
            position={"x": canvas_box["width"] / 2, "y": canvas_box["height"] / 2},
        )
        expect(frame.locator("#canvas-context-menu")).to_have_class(
            re.compile(r"is-open"), timeout=3000
        )

        target = frame.evaluate(
            "() => window.BrickeneFrontend.getUiState().canvasContextTarget"
        )
        # The component layer has a finite size; world coords should be
        # a real number (not NaN/Infinity) within a broad range.
        assert isinstance(target["x"], (int, float)), "target.x is not a number"
        assert isinstance(target["y"], (int, float)), "target.y is not a number"
        assert not (target["x"] != target["x"]), "target.x is NaN"  # NaN check
        # At initial state the canvas origin is visible; x and y should be
        # within the logical component-layer dimensions (≤ ±2000 px).
        assert abs(target["x"]) < 2000, f"target.x={target['x']:.1f} out of range"
        assert abs(target["y"]) < 2000, f"target.y={target['y']:.1f} out of range"


# ---------------------------------------------------------------------------
# Tests — keyboard shortcuts work after clicking the iframe canvas
# ---------------------------------------------------------------------------


class TestKeyboardShortcuts:
    """Keyboard shortcuts must work after clicking inside the canvas area.

    Before the fix, event.preventDefault() on pointerdown suppressed the
    browser's default focus-transfer behaviour, so the iframe document lost
    keyboard focus and document.addEventListener("keydown") never fired.

    The fix adds tabindex="-1" to #canvas-viewport and explicitly calls
    canvasViewport.focus() at the top of the pointerdown listener.
    """

    def test_canvas_viewport_has_focus_after_click_direct(self, page: Page):
        """canvas-viewport must become document.activeElement after a click.

        The tabindex="-1" + explicit .focus() call ensures the element is
        focusable and receives focus on every pointerdown.
        """
        page.goto(EDITOR_PAGE, wait_until="networkidle")

        canvas = page.locator("#canvas-viewport")
        canvas.wait_for(state="visible", timeout=5000)
        canvas.click()

        has_focus = page.evaluate(
            "() => document.activeElement"
            " === document.getElementById('canvas-viewport')"
        )
        assert has_focus, "canvas-viewport must have focus after clicking the canvas"

    def test_keyboard_shortcut_fires_after_canvas_click_direct(self, page: Page):
        """Cmd/Ctrl+Z (undo) produces a canvas message after clicking the canvas.

        Ctrl+Z always emits either "Undo applied." or "Nothing to undo.",
        so it is a reliable signal that the keydown handler ran.
        Uses Meta (Cmd) on macOS to match the editor's platform detection.
        """
        page.goto(EDITOR_PAGE, wait_until="networkidle")

        canvas = page.locator("#canvas-viewport")
        canvas.wait_for(state="visible", timeout=5000)
        canvas.click()

        is_mac = page.evaluate(
            "() => /Mac/i.test(navigator.platform || navigator.userAgent)"
        )
        modifier = "Meta" if is_mac else "Control"
        page.keyboard.press(f"{modifier}+z")

        msg = page.locator("#menu-state-copy")
        expect(msg).to_have_text(
            re.compile(r"(undo applied|nothing to undo)", re.IGNORECASE),
            timeout=3000,
        )

    def test_canvas_viewport_has_focus_after_click_in_iframe(self, page: Page):
        """canvas-viewport in the embedded iframe gets focus after clicking.

        After the pointerdown fix the iframe's document.activeElement must
        be #canvas-viewport, enabling keyboard events in the iframe document.
        """
        page.goto(SMALL_PAGE, wait_until="networkidle")
        frame = get_editor_frame(page)

        canvas = frame.locator("#canvas-viewport")
        canvas.wait_for(state="visible", timeout=5000)
        canvas.click()

        has_focus = frame.evaluate(
            "() => document.activeElement"
            " === document.getElementById('canvas-viewport')"
        )
        assert has_focus, (
            "canvas-viewport must have focus in the iframe after clicking the canvas"
        )

    def test_keyboard_shortcut_fires_after_canvas_click_in_iframe(self, page: Page):
        """Cmd/Ctrl+Z (undo) produces a canvas message after clicking the iframe canvas.

        Clicking inside the iframe must route subsequent page.keyboard events
        to the iframe document, proving keyboard shortcuts work end-to-end.
        Uses Meta (Cmd) on macOS to match the editor's platform detection.
        """
        page.goto(SMALL_PAGE, wait_until="networkidle")
        frame = get_editor_frame(page)

        canvas = frame.locator("#canvas-viewport")
        canvas.wait_for(state="visible", timeout=5000)
        canvas.click()

        is_mac = frame.evaluate(
            "() => /Mac/i.test(navigator.platform || navigator.userAgent)"
        )
        modifier = "Meta" if is_mac else "Control"
        page.keyboard.press(f"{modifier}+z")

        msg = frame.locator("#menu-state-copy")
        expect(msg).to_have_text(
            re.compile(r"(undo applied|nothing to undo)", re.IGNORECASE),
            timeout=3000,
        )
