"""Render frontend graph state payloads into molecule images."""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops
from rdkit import Chem
from rdkit.Chem import AllChem
from rdkit.Chem.Draw import rdMolDraw2D

from .network import BrickGraph
from .node import BrickNode

DEFAULT_CATALOG_PATH = (
    Path(__file__).resolve().parent.parent / "frontend" / "assets" / "brick_configs.json"
)
DEFAULT_IMAGE_SIZE = 1024


def load_brick_catalog(catalog_path: Path = DEFAULT_CATALOG_PATH) -> dict[str, dict[str, Any]]:
    """Load the configured brick catalog.

    Args:
        catalog_path: Path to the JSON brick configuration catalog.

    Returns:
        Catalog keyed by brick id.
    """

    return json.loads(catalog_path.read_text(encoding="utf-8"))


def build_graph_from_state(
    payload: dict[str, Any],
    catalog_path: Path = DEFAULT_CATALOG_PATH,
) -> BrickGraph:
    """Reconstruct a ``BrickGraph`` from a frontend graph payload.

    Args:
        payload: Frontend graph state payload.
        catalog_path: Path to the brick catalog JSON.

    Returns:
        Reconstructed molecular brick graph.

    Raises:
        ValueError: If the payload references missing nodes, ports, or bricks.
    """

    node_states = payload.get("nodes")
    edge_states = payload.get("edges")
    if not isinstance(node_states, list) or not isinstance(edge_states, list):
        raise ValueError("State payload must include node and edge lists.")

    catalog = load_brick_catalog(catalog_path)
    graph = BrickGraph()
    bricks_by_frontend_id: dict[int, BrickNode] = {}
    port_assignments: dict[int, dict[int, int]] = {}

    for node_state in node_states:
        frontend_node_id = int(node_state["id"])
        node_type_id = str(node_state.get("nodeTypeId") or node_state.get("brickId") or "")
        if node_type_id not in catalog:
            raise ValueError(f"Unknown brick id: {node_type_id}")

        brick = BrickNode.from_dict(catalog[node_type_id])
        graph.add_node(brick)
        bricks_by_frontend_id[frontend_node_id] = brick
        port_assignments[frontend_node_id] = _resolve_port_assignments(node_state)

    for edge_state in edge_states:
        start_node_id = int(_read_edge_value(edge_state, "startNode", "from", "nodeId"))
        start_slot_id = int(_read_edge_value(edge_state, "startPort", "from", "slotId"))
        end_node_id = int(_read_edge_value(edge_state, "endNode", "to", "nodeId"))
        end_slot_id = int(_read_edge_value(edge_state, "endPort", "to", "slotId"))

        start_brick = bricks_by_frontend_id.get(start_node_id)
        end_brick = bricks_by_frontend_id.get(end_node_id)
        if start_brick is None or end_brick is None:
            raise ValueError("Edge references a node that is not present in the state payload.")

        try:
            start_port = port_assignments[start_node_id][start_slot_id]
            end_port = port_assignments[end_node_id][end_slot_id]
        except KeyError as exc:
            raise ValueError("Edge references a slot that is not present in the node state.") from exc

        graph.add_edge(start_brick, end_brick, left_port=start_port, right_port=end_port)

    return graph


def build_molecule_from_state(
    payload: dict[str, Any],
    catalog_path: Path = DEFAULT_CATALOG_PATH,
) -> Chem.Mol | None:
    """Build an RDKit molecule from a frontend graph payload.

    Args:
        payload: Frontend graph state payload.
        catalog_path: Path to the brick catalog JSON.

    Returns:
        RDKit molecule with 2D coordinates, or ``None`` if the graph is empty.
    """

    graph = build_graph_from_state(payload, catalog_path=catalog_path)
    smiles = graph.to_smiles()
    if not smiles:
        return None

    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        raise ValueError("Failed to construct an RDKit molecule from the graph state.")

    AllChem.Compute2DCoords(molecule)
    return molecule


def render_state_image(
    payload: dict[str, Any],
    image_size: int = DEFAULT_IMAGE_SIZE,
    catalog_path: Path = DEFAULT_CATALOG_PATH,
) -> Image.Image:
    """Render a frontend state payload to a cropped PIL image.

    Args:
        payload: Frontend graph state payload.
        image_size: Width and height of the base render canvas in pixels.
        catalog_path: Path to the brick catalog JSON.

    Returns:
        Rendered PIL image.
    """

    molecule = build_molecule_from_state(payload, catalog_path=catalog_path)
    if molecule is None:
        return Image.new("RGB", (image_size, image_size), (255, 255, 255))

    return render_molecule_image(molecule, image_size=image_size)


def render_state_image_bytes(
    payload: dict[str, Any],
    image_size: int = DEFAULT_IMAGE_SIZE,
    catalog_path: Path = DEFAULT_CATALOG_PATH,
) -> bytes:
    """Render a frontend state payload into PNG bytes.

    Args:
        payload: Frontend graph state payload.
        image_size: Width and height of the base render canvas in pixels.
        catalog_path: Path to the brick catalog JSON.

    Returns:
        PNG-encoded image bytes.
    """

    image = render_state_image(payload, image_size=image_size, catalog_path=catalog_path)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def render_molecule_image(molecule: Chem.Mol, image_size: int) -> Image.Image:
    """Render one molecule to a cropped PIL image.

    Args:
        molecule: RDKit molecule with 2D coordinates.
        image_size: Width and height of the base render canvas in pixels.

    Returns:
        Cropped PIL image containing the molecule drawing.
    """

    drawer = rdMolDraw2D.MolDraw2DCairo(image_size, image_size)
    draw_options = drawer.drawOptions()
    draw_options.padding = 0.02
    drawer.DrawMolecule(molecule)
    drawer.FinishDrawing()

    png_bytes = drawer.GetDrawingText()
    with Image.open(io.BytesIO(png_bytes)) as rendered_image:
        return trim_white_padding(rendered_image)


def trim_white_padding(image: Image.Image) -> Image.Image:
    """Crop away uniform white padding around a rendered image.

    Args:
        image: Rendered PIL image.

    Returns:
        Cropped image with outer white borders removed.
    """

    rgb_image = image.convert("RGB")
    background = Image.new("RGB", rgb_image.size, (255, 255, 255))
    diff = ImageChops.difference(rgb_image, background)
    bounds = diff.getbbox()

    if bounds is None:
        return rgb_image

    return rgb_image.crop(bounds)


def _resolve_port_assignments(node_state: dict[str, Any]) -> dict[int, int]:
    """Map frontend slot ids to actual brick port indices.

    Args:
        node_state: Frontend node state payload.

    Returns:
        Mapping from slot id to actual brick port id.
    """

    port_configuration = node_state.get("portConfiguration")
    if not isinstance(port_configuration, list):
        raise ValueError("Node state must include a portConfiguration list.")

    assignments: dict[int, int] = {}
    for port_state in port_configuration:
        slot_id = int(port_state.get("slotId", port_state.get("id")))
        actual_port_id = port_state.get("actualPortId")
        if actual_port_id is None:
            raise ValueError("Each slot must map to an actual port id for rendering.")

        assignments[slot_id] = int(actual_port_id)

    return assignments


def _read_edge_value(
    edge_state: dict[str, Any],
    direct_key: str,
    nested_key: str,
    nested_value_key: str,
) -> Any:
    """Read one edge payload value without treating zero as missing.

    Args:
        edge_state: Frontend edge state payload.
        direct_key: Top-level key to check first.
        nested_key: Nested object key to use as a fallback.
        nested_value_key: Key inside the nested fallback object.

    Returns:
        The located payload value.

    Raises:
        ValueError: If the value is missing in both supported payload shapes.
    """

    if direct_key in edge_state:
        return edge_state[direct_key]

    nested_payload = edge_state.get(nested_key)
    if isinstance(nested_payload, dict) and nested_value_key in nested_payload:
        return nested_payload[nested_value_key]

    raise ValueError(f"Edge state is missing {direct_key}.")