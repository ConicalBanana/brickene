"""Playwright tests for iframe-example-small.html and the ?scale= parameter.

Run after starting the servers with ./start.sh:

    conda activate brick
    pytest tests/test_iframe_scale.py -v

The tests connect to the http-server instance that start.sh launches on
port 8080 (frontend) and the Python render server on port 8765.
"""

import re
import time

import pytest
from playwright.sync_api import Page, expect

FRONTEND_BASE = "http://127.0.0.1:8081"
SMALL_PAGE = f"{FRONTEND_BASE}/iframe-example-small.html"
NORMAL_PAGE = f"{FRONTEND_BASE}/iframe-example.html"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def browser_instance():
    """Launch a single Chromium browser for the whole test session."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture()
def page(browser_instance):
    """Fresh browser page (tab) for each test."""
    context = browser_instance.new_context(viewport={"width": 1280, "height": 800})
    pg = context.new_page()
    yield pg
    context.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def wait_for_editor(page: Page, timeout: int = 8000) -> None:
    """Wait until the embedded Brickene iframe's inner document is accessible."""
    page.wait_for_load_state("networkidle", timeout=timeout)


# ---------------------------------------------------------------------------
# Tests — iframe-example-small.html
# ---------------------------------------------------------------------------


class TestSmallPage:
    """Basic structural and visual tests for the half-width embedding page."""

    def test_page_loads(self, page: Page):
        """The page should load without a network error."""
        response = page.goto(SMALL_PAGE, wait_until="domcontentloaded")
        assert response is not None
        assert response.status == 200, f"Expected 200, got {response.status}"

    def test_title(self, page: Page):
        """Page title should mention 'Small'."""
        page.goto(SMALL_PAGE, wait_until="domcontentloaded")
        assert "Small" in page.title()

    def test_scale_badge_shows_default(self, page: Page):
        """Scale badge should display '0.5×' when no ?scale param is given."""
        page.goto(SMALL_PAGE, wait_until="domcontentloaded")
        badge = page.locator("#scale-badge")
        expect(badge).to_be_visible()
        expect(badge).to_contain_text("0.5")

    def test_editor_container_width_is_half(self, page: Page):
        """Editor container should occupy roughly half the viewport width."""
        page.goto(SMALL_PAGE, wait_until="domcontentloaded")
        viewport_width = page.viewport_size["width"]  # type: ignore[index]
        # bounding_box() returns visual (post-transform) pixels.  Because the
        # default scale=0.5 is applied to the body, all children are visually
        # halved.  Use offsetWidth instead — it reports layout-space dimensions
        # which are unaffected by CSS transform on an ancestor element.
        logical_width = page.evaluate(
            "() => document.getElementById('editor-container').offsetWidth"
        )
        # Allow ±5 % tolerance around the 50 vw target.
        assert abs(logical_width - viewport_width * 0.5) <= viewport_width * 0.05, (
            f"Editor container logical width {logical_width} px is not ~50 % of "
            f"viewport {viewport_width} px"
        )

    def test_iframe_present(self, page: Page):
        """An iframe element for the Brickene editor must exist."""
        page.goto(SMALL_PAGE, wait_until="domcontentloaded")
        frame_elem = page.locator("#brickene-frame")
        expect(frame_elem).to_be_visible()

    def test_iframe_src_contains_scale(self, page: Page):
        """The iframe src should include ?scale=0.5 (default)."""
        page.goto(SMALL_PAGE, wait_until="domcontentloaded")
        src = page.locator("#brickene-frame").get_attribute("src")
        assert src is not None
        assert "scale=0.5" in src, f"Expected scale=0.5 in iframe src, got: {src}"

    def test_result_panel_visible(self, page: Page):
        """Result panel and both output <pre> elements should be present."""
        page.goto(SMALL_PAGE, wait_until="domcontentloaded")
        expect(page.locator(".result-panel")).to_be_visible()
        expect(page.locator("#graph-output")).to_be_visible()
        expect(page.locator("#smiles-output")).to_be_visible()

    def test_toolbar_buttons_visible(self, page: Page):
        """Both host toolbar buttons must be present."""
        page.goto(SMALL_PAGE, wait_until="domcontentloaded")
        expect(page.locator("#btn-get-graph")).to_be_visible()
        expect(page.locator("#btn-get-smiles")).to_be_visible()


# ---------------------------------------------------------------------------
# Tests — ?scale= parameter (applied to iframe-example-small.html)
# ---------------------------------------------------------------------------


class TestScaleParameter:
    """Verify that the ?scale= URL parameter is honoured correctly."""

    def test_scale_badge_reflects_custom_scale(self, page: Page):
        """Passing ?scale=0.4 should update the badge text."""
        page.goto(f"{SMALL_PAGE}?scale=0.4", wait_until="domcontentloaded")
        badge = page.locator("#scale-badge")
        expect(badge).to_contain_text("0.4")

    def test_iframe_src_reflects_custom_scale(self, page: Page):
        """The iframe src must forward the custom scale value."""
        page.goto(f"{SMALL_PAGE}?scale=0.4", wait_until="domcontentloaded")
        src = page.locator("#brickene-frame").get_attribute("src")
        assert src is not None
        assert "scale=0.4" in src, f"Expected scale=0.4 in iframe src, got: {src}"

    def test_body_transform_applied(self, page: Page):
        """The body transform should encode the requested scale."""
        page.goto(f"{SMALL_PAGE}?scale=0.5", wait_until="domcontentloaded")
        transform = page.evaluate("() => document.body.style.transform")
        assert "scale(0.5)" in transform, (
            f"Expected scale(0.5) in body transform, got: {transform!r}"
        )

    def test_editor_width_override(self, page: Page):
        """?editorWidth=400 should constrain the editor column to ~400 px."""
        page.goto(f"{SMALL_PAGE}?editorWidth=400", wait_until="domcontentloaded")
        container = page.locator("#editor-container")
        box = container.bounding_box()
        assert box is not None
        # The transform: scale(0.5) shrinks reported bounding box by 0.5.
        # Logical width is 400 px; scaled visual width ≈ 200 px.
        # We check the inline style instead to avoid transform ambiguity.
        style = page.evaluate(
            "() => document.getElementById('editor-container').style.width"
        )
        assert "400px" in style, f"Expected 400px width, got: {style!r}"


# ---------------------------------------------------------------------------
# Tests — normal iframe-example.html with ?scale=
# ---------------------------------------------------------------------------


class TestNormalPageScale:
    """Verify that the original iframe-example.html also honours ?scale=."""

    def test_normal_page_loads(self, page: Page):
        response = page.goto(NORMAL_PAGE, wait_until="domcontentloaded")
        assert response is not None
        assert response.status == 200

    def test_scale_applied_to_body(self, page: Page):
        """?scale=0.5 should add is-scaled class and set body transform."""
        page.goto(f"{NORMAL_PAGE}?scale=0.5", wait_until="domcontentloaded")
        has_class = page.evaluate(
            "() => document.body.classList.contains('is-scaled')"
        )
        assert has_class, "body should have is-scaled class when ?scale=0.5"
        transform = page.evaluate("() => document.body.style.transform")
        assert "scale(0.5)" in transform

    def test_no_scale_leaves_body_untouched(self, page: Page):
        """Without ?scale= the body transform should be empty."""
        page.goto(NORMAL_PAGE, wait_until="domcontentloaded")
        transform = page.evaluate("() => document.body.style.transform")
        assert transform == "", f"Expected empty transform, got: {transform!r}"

    def test_scale_one_leaves_body_untouched(self, page: Page):
        """?scale=1 is a no-op; body transform should remain empty."""
        page.goto(f"{NORMAL_PAGE}?scale=1", wait_until="domcontentloaded")
        transform = page.evaluate("() => document.body.style.transform")
        assert transform == "", f"Expected empty transform, got: {transform!r}"

    def test_screenshot_small(self, page: Page, tmp_path):
        """Capture a debug screenshot of the scaled small page."""
        page.goto(f"{SMALL_PAGE}?scale=0.5", wait_until="domcontentloaded")
        # Give the iframe a moment to begin loading.
        time.sleep(1)
        shot = tmp_path / "iframe_small_scale05.png"
        page.screenshot(path=str(shot), full_page=False)
        assert shot.exists(), "Screenshot was not written"
        print(f"\nScreenshot saved to: {shot}")
