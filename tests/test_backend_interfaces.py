"""Backend interface coverage for rendering utilities and HTTP endpoints."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from PIL import Image
from rdkit import Chem

from brickene import get_version
from brickene.controller.render_controller import create_app
from brickene.repository.brick_repository import BrickStore, RuntimeBrickStore
from brickene.service.render_service import (
    build_graph_from_state,
    build_molecule_from_state,
    expand_tool_nodes,
    load_brick_catalog,
    render_state_image,
    render_state_image_bytes,
    render_state_smiles,
)

try:
    from fastapi.testclient import TestClient
except ImportError:
    from starlette.testclient import TestClient


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


def build_period_pair_payload(period_number: int = 1) -> dict[str, Any]:
    """Build one graph payload containing a valid pair of period nodes."""

    period_value = str(period_number)
    return {
        "nodes": [
            {
                "id": 1,
                "nodeTypeId": "4",
                "portConfiguration": [
                    {"slotId": 0, "side": "right", "actualPortId": "1"}
                ],
            },
            {
                "id": 2,
                "nodeTypeId": "902",
                "periodNumber": period_value,
                "portConfiguration": [
                    {"slotId": 0, "side": "left", "actualPortId": "1"},
                    {"slotId": 1, "side": "right", "actualPortId": "2"},
                ],
            },
            {
                "id": 3,
                "nodeTypeId": "5",
                "portConfiguration": [
                    {"slotId": 0, "side": "left", "actualPortId": "1"}
                ],
            },
            {
                "id": 4,
                "nodeTypeId": "4",
                "portConfiguration": [
                    {"slotId": 0, "side": "right", "actualPortId": "1"}
                ],
            },
            {
                "id": 5,
                "nodeTypeId": "902",
                "periodNumber": period_value,
                "portConfiguration": [
                    {"slotId": 0, "side": "left", "actualPortId": "1"},
                    {"slotId": 1, "side": "right", "actualPortId": "2"},
                ],
            },
            {
                "id": 6,
                "nodeTypeId": "5",
                "portConfiguration": [
                    {"slotId": 0, "side": "left", "actualPortId": "1"}
                ],
            },
        ],
        "edges": [
            {"id": 1, "startNode": 1, "startPort": 0, "endNode": 2, "endPort": 0},
            {"id": 2, "startNode": 2, "startPort": 1, "endNode": 3, "endPort": 0},
            {"id": 3, "startNode": 4, "startPort": 0, "endNode": 5, "endPort": 0},
            {"id": 4, "startNode": 5, "startPort": 1, "endNode": 6, "endPort": 0},
        ],
    }


def build_inline_user_defined_payload() -> dict[str, Any]:
    """Build one payload containing a standalone inline-configured custom brick."""

    definition = build_user_defined_definition()

    return {
        "nodes": [
            {
                "id": 1,
                "nodeTypeId": "901",
                "customConfigText": json.dumps(definition, indent=2),
                "portConfiguration": [
                    {"slotId": 0, "side": "left", "actualPortId": "1"},
                    {"slotId": 1, "side": "right", "actualPortId": "4"},
                ],
            }
        ],
        "edges": [],
    }


def build_user_defined_definition() -> dict[str, Any]:
    """Build one standalone user-defined brick definition payload."""

    return {
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
    }


def perform_request(
    client: TestClient,
    method: str,
    path: str,
    body: str | bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    """Execute one HTTP request against the in-process render server."""

    content = body.encode("utf-8") if isinstance(body, str) else body
    response = client.request(
        method, path, content=content, headers=headers or {}
    )
    return (
        response.status_code,
        {k.lower(): v for k, v in response.headers.items()},
        response.content,
    )


@pytest.fixture()
def catalog_path(tmp_path: Path) -> Path:
    """Write a small isolated catalog fixture for backend interface tests."""

    catalog = load_brick_catalog()
    subset = {
        key: catalog[key]
        for key in ["2", "4", "5", "900", "901", "902"]
    }
    output_path = tmp_path / "brick-catalog.json"
    output_path.write_text(
        json.dumps(subset, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    return output_path


@pytest.fixture()
def render_server_address(catalog_path: Path) -> tuple[TestClient, Path, Path]:
    """Yield a TestClient bound to one isolated server configuration."""

    brick_db_path = catalog_path.parent / "brick-store.sqlite3"
    user_brick_db_path = catalog_path.parent / "user.sqlite3"
    seeded_catalog = load_brick_catalog(catalog_path)
    source_store = BrickStore()
    test_store = BrickStore(brick_db_path)

    test_store.sync_system_bricks(seeded_catalog)
    for brick_id in seeded_catalog:
        test_store.save_system_brick_assets(
            brick_id,
            source_store.get_brick_svg_text(brick_id),
            source_store.get_brick_layout(brick_id),
        )

    fastapi_app = create_app(
        image_size=256,
        brick_db_path=brick_db_path,
        user_brick_db_path=user_brick_db_path,
    )
    with TestClient(fastapi_app) as client:
        yield (client, brick_db_path, user_brick_db_path)


def test_load_brick_catalog_reads_tool_definition(catalog_path: Path) -> None:
    """The isolated backend catalog should preserve the tool definition."""

    catalog = load_brick_catalog(catalog_path)

    assert catalog["900"]["brick_type"] == "TOOL"
    assert catalog["900"]["name"] == "Duplicator"
    assert catalog["902"]["brick_type"] == "TOOL"
    assert catalog["902"]["name"] == "period"


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
    """Inline-configured user-defined nodes should render from their pasted definition.
    """

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


def test_render_state_smiles_preserves_period_markers(catalog_path: Path) -> None:
    """Period nodes should render to mapped tungsten markers in SMILES output."""

    smiles = render_state_smiles(
        build_period_pair_payload(period_number=1),
        catalog_path=catalog_path,
    )

    assert smiles.count("[W:1]") == 2


def test_build_graph_from_state_rejects_unpaired_period_markers(
    catalog_path: Path,
) -> None:
    """Each period number should appear exactly twice in one graph payload."""

    payload = build_period_pair_payload(period_number=1)
    payload["nodes"] = [node for node in payload["nodes"] if node["id"] != 5]
    payload["edges"] = [
        edge
        for edge in payload["edges"]
        if edge["startNode"] != 5 and edge["endNode"] != 5
    ]

    with pytest.raises(
        ValueError,
        match="Each period number must appear exactly twice in one molecule.",
    ):
        build_graph_from_state(payload, catalog_path=catalog_path)


def test_build_graph_from_state_rejects_invalid_period_numbers(
    catalog_path: Path,
) -> None:
    """Period nodes should require a positive integer period number."""

    payload = build_period_pair_payload(period_number=1)
    payload["nodes"][1]["periodNumber"] = "abc"

    with pytest.raises(ValueError, match="Period number must be a positive integer."):
        build_graph_from_state(payload, catalog_path=catalog_path)


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
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The health endpoint should report the bound backend configuration."""

    status, headers, payload = perform_request(
        render_server_address[0],
        "GET",
        "/health",
    )
    body = json.loads(payload)

    assert status == 200
    assert headers["content-type"] == "application/json"
    assert headers["access-control-allow-origin"] == "*"
    assert body["status"] == "ok"
    assert body["stored_brick_count"] == 0
    assert body["system_brick_count"] == 6
    assert body["brick_db_path"].endswith("brick-store.sqlite3")
    assert body["user_brick_db_path"].endswith("user.sqlite3")


def test_render_server_version_endpoint_returns_package_version(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The version endpoint should return the installed package version."""

    status, headers, payload = perform_request(
        render_server_address[0],
        "GET",
        "/version",
    )
    body = json.loads(payload)

    assert status == 200
    assert headers["content-type"] == "application/json"
    assert headers["access-control-allow-origin"] == "*"
    assert body["version"] == get_version()


def test_render_server_bricks_endpoint_lists_seeded_system_definitions(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The bricks endpoint should expose the seeded system definitions."""

    status, headers, payload = perform_request(
        render_server_address[0],
        "GET",
        "/bricks",
    )
    body = json.loads(payload)

    assert status == 200
    assert headers["content-type"] == "application/json"
    assert [brick["id"] for brick in body["bricks"]] == [
        "2",
        "4",
        "5",
        "900",
        "901",
        "902",
    ]


def test_render_server_system_brick_asset_endpoints_return_stored_payloads(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """Built-in SVG and layout JSON should be served from SQLite."""

    svg_status, svg_headers, svg_payload = perform_request(
        render_server_address[0],
        "GET",
        "/bricks/4/image",
    )
    layout_status, layout_headers, layout_payload = perform_request(
        render_server_address[0],
        "GET",
        "/bricks/4/layout",
    )
    layout_body = json.loads(layout_payload)

    assert svg_status == 200
    assert svg_headers["content-type"].startswith("image/svg+xml")
    assert b"<svg" in svg_payload
    assert layout_status == 200
    assert layout_headers["content-type"] == "application/json"
    assert layout_body["image_width"] > 0
    assert layout_body["image_height"] > 0
    assert layout_body["ports"]


def test_render_server_system_brick_asset_endpoint_reports_missing_tool_asset(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """Tool bricks without stored SVG assets should report a clear 404."""

    status, headers, payload = perform_request(
        render_server_address[0],
        "GET",
        "/bricks/900/image",
    )
    body = json.loads(payload)

    assert status == 404
    assert headers["content-type"] == "application/json"
    assert body["error"] == "No stored SVG asset for brick id: 900."


def test_render_server_options_returns_cors_headers(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The HTTP interface should answer CORS preflight requests."""

    status, headers, payload = perform_request(
        render_server_address[0],
        "OPTIONS",
        "/graph/render",
    )

    assert status == 204
    assert payload == b""
    assert headers["access-control-allow-origin"] == "*"
    assert headers["access-control-allow-methods"] == "GET, POST, OPTIONS"


def test_render_server_smiles_endpoint_returns_smiles(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The SMILES endpoint should return JSON for a valid graph payload."""

    status, headers, payload = perform_request(
        render_server_address[0],
        "POST",
        "/graph/smiles",
        body=json.dumps(build_simple_payload()),
        headers={"Content-Type": "application/json"},
    )
    body = json.loads(payload)

    assert status == 200
    assert headers["content-type"] == "application/json"
    assert Chem.MolFromSmiles(body["smiles"]) is not None


def test_render_server_brick_config_endpoint_returns_serialized_definition(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The bricks/preview endpoint should convert one SMILES string to node JSON."""

    status, headers, payload = perform_request(
        render_server_address[0],
        "POST",
        "/bricks/preview",
        body=json.dumps(
            {
                "smiles": "[*:1]C=C([*:2])O",
                "brick_type": "BRIDGE",
                "name": "Vinyl alcohol",
                "alias": ["VA"],
            }
        ),
        headers={"Content-Type": "application/json"},
    )
    body = json.loads(payload)
    definition = body["definition"]
    port_nodes = [node for node in definition["nodes"] if node["kind"] == "port"]

    assert status == 200
    assert headers["content-type"] == "application/json"
    assert definition["name"] == "Vinyl alcohol"
    assert definition["alias"] == ["VA"]
    assert definition["brick_type"] == "BRIDGE"
    assert [node["index"] for node in port_nodes] == [1, 2]
    assert [node["connected_symbol"] for node in port_nodes] == ["C", "C"]


def test_render_server_brick_config_endpoint_requires_at_least_one_port(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The bricks/preview endpoint should reject structures without any ports."""

    status, headers, payload = perform_request(
        render_server_address[0],
        "POST",
        "/bricks/preview",
        body=json.dumps({"smiles": "CC", "brick_type": "BRIDGE"}),
        headers={"Content-Type": "application/json"},
    )
    body = json.loads(payload)

    assert status == 400
    assert headers["content-type"] == "application/json"
    assert body["error"] == "Node definitions must include at least one port."


def test_render_server_brick_config_endpoint_requires_single_atom_per_port(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The bricks/preview endpoint should reject ports attached to multiple atoms."""

    status, _headers, payload = perform_request(
        render_server_address[0],
        "POST",
        "/bricks/preview",
        body=json.dumps({"smiles": "[*:1](C)C", "brick_type": "BRIDGE"}),
        headers={"Content-Type": "application/json"},
    )
    body = json.loads(payload)

    assert status == 400
    assert body["error"] == "Each port must connect to exactly one atom."


def test_render_server_brick_config_endpoint_requires_single_port_bonds(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The bricks/preview endpoint should reject non-single bonds on ports."""

    status, _headers, payload = perform_request(
        render_server_address[0],
        "POST",
        "/bricks/preview",
        body=json.dumps({"smiles": "[*:1]=C", "brick_type": "BRIDGE"}),
        headers={"Content-Type": "application/json"},
    )
    body = json.loads(payload)

    assert status == 400
    assert body["error"] == "Each port must connect to an atom by a single bond."


def test_render_server_render_endpoint_returns_svg(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The graph render endpoint should return SVG for a valid graph payload."""

    status, headers, payload = perform_request(
        render_server_address[0],
        "POST",
        "/graph/render",
        body=json.dumps(build_simple_payload()),
        headers={"Content-Type": "application/json"},
    )

    assert status == 200
    assert headers["content-type"].startswith("image/svg+xml")
    assert b"<svg" in payload


def test_runtime_store_migrates_legacy_user_bricks_to_user_database(
    tmp_path: Path,
) -> None:
    """Legacy user rows in db.sqlite3 should be copied into user.sqlite3."""

    system_db_path = tmp_path / "brick-store.sqlite3"
    user_db_path = tmp_path / "user.sqlite3"
    legacy_svg_text = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"

    legacy_definition = BrickStore(system_db_path).save_brick(
        build_user_defined_definition(),
        svg_text=legacy_svg_text,
    )
    runtime_store = RuntimeBrickStore(system_db_path, user_db_path)
    migrated_definition = BrickStore(user_db_path).get_brick(legacy_definition["id"])
    migrated_svg_text = BrickStore(user_db_path).get_brick_svg_text(
        legacy_definition["id"]
    )

    assert runtime_store.count_bricks() == 1
    assert migrated_definition is not None
    assert migrated_definition["id"] == legacy_definition["id"]
    assert migrated_definition["name"] == legacy_definition["name"]
    assert migrated_svg_text == legacy_svg_text


def test_render_server_bricks_endpoint_stores_and_lists_definitions(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The bricks endpoints should persist user definitions alongside system rows."""

    definition = build_user_defined_definition()

    status, headers, payload = perform_request(
        render_server_address[0],
        "POST",
        "/bricks",
        body=json.dumps({"definition": definition}),
        headers={"Content-Type": "application/json"},
    )
    body = json.loads(payload)
    stored_definition = body["definition"]

    assert status == 201
    assert headers["content-type"] == "application/json"
    assert stored_definition["id"].startswith("user-")
    assert stored_definition["name"] == definition["name"]
    assert stored_definition["alias"] == definition["alias"]
    assert BrickStore(render_server_address[1]).count_bricks() == 0
    assert BrickStore(render_server_address[2]).count_bricks() == 1
    stored_svg_text = BrickStore(render_server_address[2]).get_brick_svg_text(
        stored_definition["id"]
    )
    assert stored_svg_text is not None
    assert "<svg" in stored_svg_text

    image_status, image_headers, image_payload = perform_request(
        render_server_address[0],
        "GET",
        f"/bricks/{stored_definition['id']}/image",
    )
    assert image_status == 200
    assert image_headers["content-type"].startswith("image/svg+xml")
    assert b"<svg" in image_payload

    list_status, list_headers, list_payload = perform_request(
        render_server_address[0],
        "GET",
        "/bricks",
    )
    list_body = json.loads(list_payload)

    assert list_status == 200
    assert list_headers["content-type"] == "application/json"
    assert [brick["id"] for brick in list_body["bricks"]] == [
        "2",
        "4",
        "5",
        "900",
        "901",
        "902",
        stored_definition["id"],
    ]

    get_status, _get_headers, get_payload = perform_request(
        render_server_address[0],
        "GET",
        f"/bricks/{stored_definition['id']}",
    )
    get_body = json.loads(get_payload)

    assert get_status == 200
    assert get_body["definition"]["id"] == stored_definition["id"]
    assert get_body["definition"]["name"] == definition["name"]


def test_render_server_bricks_endpoint_stores_layout_for_user_bricks(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """POST /bricks should persist layout geometry so GET /bricks/{id}/layout works."""

    definition = build_user_defined_definition()
    create_status, _headers, create_payload = perform_request(
        render_server_address[0],
        "POST",
        "/bricks",
        body=json.dumps({"definition": definition}),
        headers={"Content-Type": "application/json"},
    )
    assert create_status == 201
    stored_id = json.loads(create_payload)["definition"]["id"]
    assert stored_id.startswith("user-")

    layout_status, layout_headers, layout_payload = perform_request(
        render_server_address[0],
        "GET",
        f"/bricks/{stored_id}/layout",
    )
    layout_body = json.loads(layout_payload)

    assert layout_status == 200
    assert layout_headers["content-type"] == "application/json"
    assert isinstance(layout_body.get("image_width"), (int, float))
    assert isinstance(layout_body.get("image_height"), (int, float))
    assert isinstance(layout_body.get("ports"), dict)
    # The test definition has SMILES with two port atoms; both should appear.
    assert len(layout_body["ports"]) >= 1
    for port_data in layout_body["ports"].values():
        assert "port_start_pos" in port_data
        assert "port_vec" in port_data
        assert len(port_data["port_start_pos"]) == 2
        assert len(port_data["port_vec"]) == 2


def test_render_server_smiles_endpoint_supports_stored_user_defined_bricks(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """Stored user-defined bricks should be usable by id in render payloads."""

    definition = build_user_defined_definition()
    create_status, _create_headers, create_payload = perform_request(
        render_server_address[0],
        "POST",
        "/bricks",
        body=json.dumps(definition),
        headers={"Content-Type": "application/json"},
    )
    create_body = json.loads(create_payload)
    stored_definition = create_body["definition"]

    status, headers, payload = perform_request(
        render_server_address[0],
        "POST",
        "/graph/smiles",
        body=json.dumps(
            {
                "nodes": [
                    {
                        "id": 1,
                        "nodeTypeId": stored_definition["id"],
                        "portConfiguration": [
                            {"slotId": 0, "side": "left", "actualPortId": "1"},
                            {"slotId": 1, "side": "right", "actualPortId": "4"},
                        ],
                    }
                ],
                "edges": [],
            }
        ),
        headers={"Content-Type": "application/json"},
    )
    body = json.loads(payload)

    assert create_status == 201
    assert status == 200
    assert headers["content-type"] == "application/json"
    assert body["smiles"] == "C=O"


def test_render_server_brick_render_endpoint_returns_svg(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The bricks/render endpoint should render one posted brick definition."""

    status, headers, payload = perform_request(
        render_server_address[0],
        "POST",
        "/bricks/render",
        body=json.dumps(build_user_defined_definition()),
        headers={"Content-Type": "application/json"},
    )

    assert status == 200
    assert headers["content-type"].startswith("image/svg+xml")
    assert b"<svg" in payload


def test_render_server_bricks_endpoint_rejects_invalid_definition_payload(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The bricks endpoint should reject malformed definition payloads."""

    status, headers, payload = perform_request(
        render_server_address[0],
        "POST",
        "/bricks",
        body=json.dumps({"definition": []}),
        headers={"Content-Type": "application/json"},
    )
    body = json.loads(payload)

    assert status == 400
    assert headers["content-type"] == "application/json"
    assert body["error"] == "definition must be a JSON object."


def test_render_server_get_brick_endpoint_returns_not_found_for_unknown_id(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The stored brick query endpoint should report unknown brick ids."""

    status, headers, payload = perform_request(
        render_server_address[0],
        "GET",
        "/bricks/user-999",
    )
    body = json.loads(payload)

    assert status == 404
    assert headers["content-type"] == "application/json"
    assert body["error"] == "Unknown brick id: user-999."


def test_render_server_rejects_invalid_json(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The render server should reject invalid JSON request bodies."""

    status, headers, payload = perform_request(
        render_server_address[0],
        "POST",
        "/graph/smiles",
        body="{not-json}",
        headers={"Content-Type": "application/json"},
    )
    body = json.loads(payload)

    assert status == 400
    assert headers["content-type"] == "application/json"
    assert body["error"] == "Request body must be valid JSON."


def test_render_server_rejects_non_object_json(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The render server should reject JSON values that are not objects."""

    status, _headers, payload = perform_request(
        render_server_address[0],
        "POST",
        "/graph/smiles",
        body=json.dumps(["not", "an", "object"]),
        headers={"Content-Type": "application/json"},
    )
    body = json.loads(payload)

    assert status == 400
    assert body["error"] == "Request body must decode to a JSON object."


def test_render_server_returns_not_found_for_unknown_paths(
    render_server_address: tuple[TestClient, Path, Path],
) -> None:
    """The HTTP interface should return not found for unsupported paths."""

    status, _headers, payload = perform_request(
        render_server_address[0],
        "GET",
        "/missing",
    )
    body = json.loads(payload)

    assert status == 404
    assert body["error"] == "Not found."
