"""Shared Playwright fixtures for all browser-based tests."""

from __future__ import annotations

import pytest


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
