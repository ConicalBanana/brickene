"""Backend interface coverage for rendering utilities and HTTP endpoints."""

from __future__ import annotations

import json
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
from PIL import Image
from rdkit import Chem

from brickene.core.rendering import (
    load_brick_catalog,
    build_graph_from_state,
    build_molecule_from_state,
    expand_tool_nodes,
    render_state_image,
    render_state_image_bytes,
    render_state_smiles,
)
from brickene.render_server import create_handler


def build_simple_payload() -> dict[str, Any]:
    """Build a minimal valid frontend payload for backend rendering tests."""

    return {
        "nodes": [
            {
                "id": 1,
                "nodeTypeId": "4",
                "portConfiguration": [
                    {
                        "slotId": 0,
                        "side": "right",
                        "actualPortId": "1",
                    }
                ],
            },
            {
                "id": 2,
                "nodeTypeId": "5",
                "portConfiguration": [
                    {
                        "slotId": 0,
                        "side": "left",
                        "actualPortId": "1",
                    }
                ],
            },
        ],
        "edges": [
            {
                "id": 1,
                "startNode": 1,
                "startPort": 0,
                "endNode": 2,
                "endPort": 0,
            }
        ],
    }


def build_tool_payload() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Build one graph payload containing a Dulplicator tool node."""

    return (
        [
            {
                "id": 1,
                "nodeTypeId": "2",
                "portConfiguration": [
                    {"slotId": 0, "side": "left", "actualPortId": "1"},
                    {"slotId": 1, "side": "right", "actualPortId": "3"},
                    {"slotId": 2, "side": "right", "actualPortId": "4"},
                    {"slotId": 3, "side": "right", "actualPortId": "2"},
                ],
            },
            {
                "id": 2,
                "nodeTypeId": "2",
                "portConfiguration": [
                    {"slotId": 0, "side": "left", "actualPortId": "1"},
                    {"slotId": 1, "side": "right", "actualPortId": "3"},
                    {"slotId": 2, "side": "right", "actualPortId": "4"},
                    {"slotId": 3, "side": "right", "actualPortId": "2"},
                ],
            },
            {
                "id": 3,
                "nodeTypeId": "900",
                "portConfiguration": [
                    {"slotId": 0, "side": "left", "actualPortId": "1"},
                    {"slotId": 1, "side": "left", "actualPortId": "2"},
                    {"slotId": 2, "side": "right", "actualPortId": "6"},
                    {"slotId": 3, "side": "left", "actualPortId": "3"},
                    {"slotId": 4, "side": "left", "actualPortId": "4"},
                    {"slotId": 5, "side": "left", "actualPortId": "5"},
                ],
            },
            {
                "id": 4,
                "nodeTypeId": "4",
                "portConfiguration": [
                    {"slotId": 0, "side": "left", "actualPortId": "1"}
                ],
            },
            {
                "id": 5,
                "nodeTypeId": "5",
                "portConfiguration": [
                    {"slotId": 0, "side": "left", "actualPortId": "1"}
                ],
            },
        ],
        [
            {"id": 1, "startNode": 1, "startPort": 1, "endNode": 3, "endPort": 0},
            {"id": 2, "startNode": 2, "startPort": 1, "endNode": 3, "endPort": 1},
            {"id": 3, "startNode": 3, "startPort": 2, "endNode": 4, "endPort": 0},
            {"id": 4, "startNode": 4, "startPort": 0, "endNode": 5, "endPort": 0},
        ],
    )


def build_inline_user_defined_payload() -> dict[str, Any]:
    """Build one payload containing a standalone inline-configured custom brick."""

    return {
        "nodes": [
            {
                "id": 1,
                "nodeTypeId": "901",
                "customConfigText": json.dumps(
                    {
                        "name": "Inline aldehyde",
                        "alias": ["IAL"],
                        "brick_type": "BRIDGE",
                        "nodes": [
                            {
                                "kind": "port",
                                "index": 1,
                                "side": "left",
                                "preferred_brick_type": "SKELETON",
                                "connected_symbol": "C",
                            },
                            {
                                "kind": "atom",
                                "index": 2,
                                "symbol": "C",
                            },
                            {
                                "kind": "atom",
                                "index": 3,
                                "symbol": "O",
                            },
                            {
                                "kind": "port",
                                "index": 4,
                                "side": "right",
                                "preferred_brick_type": "SIDE_CHAIN",
                                "connected_symbol": "C",
                            },
                        ],
                        "edges": [
                            [1, 2, "SINGLE"],
                            [2, 3, "DOUBLE"],
                            [2, 4, "SINGLE"],
                        ],
                    },
                    indent=2,
                ),
                "portConfiguration": [
                    {"slotId": 0, "side": "left", "actualPortId": "1"},
                    {"slotId": 1, "side": "right", "actualPortId": "4"},
                ],
            }
        ],
        "edges": [],
    }


def perform_request(
    host: str,
    port: int,
    method: str,
    path: str,
    body: str | bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    """Execute one HTTP request against the in-process render server."""

    connection = HTTPConnection(host, port, timeout=5)
    try:
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        payload = response.read()
        response_headers = {
            key.lower(): value
            for key, value in response.getheaders()
        }
        return response.status, response_headers, payload
    finally:
        connection.close()


@pytest.fixture()
def catalog_path(tmp_path: Path) -> Path:
    """Write a small isolated catalog fixture for backend interface tests."""

    catalog = load_brick_catalog()
    subset = {
        key: catalog[key]
        for key in ["2", "4", "5", "900", "901"]
    }
    output_path = tmp_path / "brick-catalog.json"
    output_path.write_text(json.dumps(subset, indent=2, sort_keys=True), encoding="utf-8")
    return output_path


@pytest.fixture()
def render_server_address(catalog_path: Path) -> tuple[str, int]:
    """Start one temporary render server and yield its listening address."""

    server = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        create_handler(catalog_path=catalog_path, image_size=256),
    )
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()

    try:
        yield server.server_address[0], server.server_address[1]
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)


def test_load_brick_catalog_reads_tool_definition(catalog_path: Path) -> None:
    """The isolated backend catalog should preserve the tool definition."""

    catalog = load_brick_catalog(catalog_path)

    assert catalog["900"]["brick_type"] == "TOOL"
    assert catalog["900"]["name"] == "Dulplicator"


def test_expand_tool_nodes_removes_tool_nodes_and_duplicates_branch(
    catalog_path: Path,
) -> None:
    """Tool expansion should remove the tool node and clone downstream branches."""

    catalog = load_brick_catalog(catalog_path)
    node_states, edge_states = build_tool_payload()

    expanded_nodes, expanded_edges = expand_tool_nodes(
        node_states,
        edge_states,
        catalog,
    )

    assert all(
        str(node.get("nodeTypeId") or node.get("brickId")) != "900"
        for node in expanded_nodes
    )
    assert len(expanded_nodes) == 6
    assert len(expanded_edges) == 4
    downstream_targets = sorted(
        edge["endNode"]
        for edge in expanded_edges
        if edge["startNode"] in {1, 2}
    )
    assert len(set(downstream_targets)) == 2


def test_build_graph_from_state_rejects_unknown_brick(catalog_path: Path) -> None:
    """Graph reconstruction should reject unknown node type ids."""

    payload = {
        "nodes": [
            {
                "id": 1,
                "nodeTypeId": "999",
                "portConfiguration": [],
            }
        ],
        "edges": [],
    }

    with pytest.raises(ValueError, match="Unknown brick id: 999"):
        build_graph_from_state(payload, catalog_path=catalog_path)


def test_render_state_smiles_uses_inline_user_defined_configuration(
    catalog_path: Path,
) -> None:
    """Inline-configured user-defined nodes should render from their pasted definition."""

    smiles = render_state_smiles(
        build_inline_user_defined_payload(),
        catalog_path=catalog_path,
    )

    assert smiles == "C=O"


def test_build_molecule_from_state_returns_none_for_empty_graph(
    catalog_path: Path,
) -> None:
    """Empty frontend graphs should not produce an RDKit molecule."""

    molecule = build_molecule_from_state(
        {"nodes": [], "edges": []},
        catalog_path=catalog_path,
    )

    assert molecule is None


def test_render_state_smiles_returns_valid_smiles(catalog_path: Path) -> None:
    """The SMILES rendering interface should return a valid molecule string."""

    smiles = render_state_smiles(build_simple_payload(), catalog_path=catalog_path)

    assert smiles
    assert Chem.MolFromSmiles(smiles) is not None


def test_render_state_image_and_bytes_return_png_output(catalog_path: Path) -> None:
    """The image rendering interfaces should return non-empty PNG content."""

    image = render_state_image(
        build_simple_payload(),
        image_size=256,
        catalog_path=catalog_path,
    )
    image_bytes = render_state_image_bytes(
        build_simple_payload(),
        image_size=256,
        catalog_path=catalog_path,
    )

    assert isinstance(image, Image.Image)
    assert image.width > 0
    assert image.height > 0
    assert image_bytes.startswith(b"\x89PNG\r\n\x1a\n")


def test_render_server_health_endpoint_reports_configuration(
    render_server_address: tuple[str, int],
    catalog_path: Path,
) -> None:
    """The health endpoint should report the bound backend configuration."""

    status, headers, payload = perform_request(
        render_server_address[0],
        render_server_address[1],
        "GET",
        "/health",
    )
    body = json.loads(payload)

    assert status == 200
    assert headers["content-type"] == "application/json"
    assert headers["access-control-allow-origin"] == "*"
    assert body["status"] == "ok"
    assert body["catalog_path"] == str(catalog_path)


def test_render_server_options_returns_cors_headers(
    render_server_address: tuple[str, int],
) -> None:
    """The HTTP interface should answer CORS preflight requests."""

    status, headers, payload = perform_request(
        render_server_address[0],
        render_server_address[1],
        "OPTIONS",
        "/render",
    )

    assert status == 204
    assert payload == b""
    assert headers["access-control-allow-origin"] == "*"
    assert headers["access-control-allow-methods"] == "GET, POST, OPTIONS"


def test_render_server_smiles_endpoint_returns_smiles(
    render_server_address: tuple[str, int],
) -> None:
    """The SMILES endpoint should return JSON for a valid graph payload."""

    status, headers, payload = perform_request(
        render_server_address[0],
        render_server_address[1],
        "POST",
        "/smiles",
        body=json.dumps(build_simple_payload()),
        headers={"Content-Type": "application/json"},
    )
    body = json.loads(payload)

    assert status == 200
    assert headers["content-type"] == "application/json"
    assert Chem.MolFromSmiles(body["smiles"]) is not None


def test_render_server_render_endpoint_returns_png(
    render_server_address: tuple[str, int],
) -> None:
    """The render endpoint should return PNG bytes for a valid graph payload."""

    status, headers, payload = perform_request(
        render_server_address[0],
        render_server_address[1],
        "POST",
        "/render",
        body=json.dumps(build_simple_payload()),
        headers={"Content-Type": "application/json"},
    )

    assert status == 200
    assert headers["content-type"] == "image/png"
    assert payload.startswith(b"\x89PNG\r\n\x1a\n")


def test_render_server_rejects_invalid_json(
    render_server_address: tuple[str, int],
) -> None:
    """The render server should reject invalid JSON request bodies."""

    status, headers, payload = perform_request(
        render_server_address[0],
        render_server_address[1],
        "POST",
        "/smiles",
        body="{not-json}",
        headers={"Content-Type": "application/json"},
    )
    body = json.loads(payload)

    assert status == 400
    assert headers["content-type"] == "application/json"
    assert body["error"] == "Request body must be valid JSON."


def test_render_server_rejects_non_object_json(
    render_server_address: tuple[str, int],
) -> None:
    """The render server should reject JSON values that are not objects."""

    status, _headers, payload = perform_request(
        render_server_address[0],
        render_server_address[1],
        "POST",
        "/smiles",
        body=json.dumps(["not", "an", "object"]),
        headers={"Content-Type": "application/json"},
    )
    body = json.loads(payload)

    assert status == 400
    assert body["error"] == "Request body must decode to a JSON object."


def test_render_server_returns_not_found_for_unknown_paths(
    render_server_address: tuple[str, int],
) -> None:
    """The HTTP interface should return not found for unsupported paths."""

    status, _headers, payload = perform_request(
        render_server_address[0],
        render_server_address[1],
        "GET",
        "/missing",
    )
    body = json.loads(payload)

    assert status == 404
    assert body["error"] == "Not found."