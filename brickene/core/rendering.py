"""Render frontend graph state payloads into molecule images."""

from __future__ import annotations

import io
import json
from copy import deepcopy
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
TOOL_BRICK_TYPE = "TOOL"


def load_brick_catalog(catalog_path: Path = DEFAULT_CATALOG_PATH) -> dict[str, dict[str, Any]]:
    """Load the configured brick catalog.

    Args:
        catalog_path: Path to the JSON brick configuration catalog.

    Returns:
        Catalog keyed by brick id.
    """

    return json.loads(catalog_path.read_text(encoding="utf-8"))


def expand_tool_nodes(
    node_states: list[dict[str, Any]],
    edge_states: list[dict[str, Any]],
    catalog: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Expand TOOL nodes into direct graph branches before molecule assembly.

    Args:
        node_states: Frontend node state payloads.
        edge_states: Frontend edge state payloads.
        catalog: Brick catalog keyed by node type id.

    Returns:
        Expanded node and edge payloads with TOOL nodes removed.
    """

    expanded_nodes = deepcopy(node_states)
    expanded_edges = deepcopy(edge_states)

    while True:
        tool_node = next(
            (
                node_state
                for node_state in expanded_nodes
                if _is_tool_node(node_state, catalog)
            ),
            None,
        )
        if tool_node is None:
            return expanded_nodes, expanded_edges

        expanded_nodes, expanded_edges = _expand_single_tool_node(
            tool_node,
            expanded_nodes,
            expanded_edges,
        )


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
    node_states, edge_states = expand_tool_nodes(node_states, edge_states, catalog)
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

        graph.add_edge(
            start_brick,
            end_brick,
            left_port=start_port,
            right_port=end_port,
            bond_type=_read_edge_bond_type(edge_state),
        )

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

    molecule = cap_hanging_ports_with_hydrogen(molecule)

    AllChem.Compute2DCoords(molecule)
    return molecule


def render_state_smiles(
    payload: dict[str, Any],
    catalog_path: Path = DEFAULT_CATALOG_PATH,
) -> str:
    """Render a frontend graph state payload to a SMILES string.

    Args:
        payload: Frontend graph state payload.
        catalog_path: Path to the brick catalog JSON.

    Returns:
        Canonical SMILES string with dangling ports capped by hydrogen.
    """

    molecule = build_molecule_from_state(payload, catalog_path=catalog_path)
    if molecule is None:
        return ""

    return Chem.MolToSmiles(molecule)


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


def cap_hanging_ports_with_hydrogen(molecule: Chem.Mol) -> Chem.Mol:
    """Replace dangling dummy port atoms with implicit hydrogens.

    Args:
        molecule: RDKit molecule that may still contain unconnected dummy atoms.

    Returns:
        Sanitized molecule with dangling dummy atoms removed.

    Raises:
        ValueError: If a dangling dummy atom is connected to multiple neighbors.
    """

    editable_molecule = Chem.RWMol(molecule)
    dummy_atom_indices: list[int] = []

    for atom in editable_molecule.GetAtoms():
        if atom.GetAtomicNum() != 0:
            continue

        neighbors = list(atom.GetNeighbors())
        if len(neighbors) > 1:
            raise ValueError("Dangling ports must connect to at most one neighboring atom.")

        dummy_atom_indices.append(atom.GetIdx())

    for atom_index in sorted(dummy_atom_indices, reverse=True):
        editable_molecule.RemoveAtom(atom_index)

    capped_molecule = editable_molecule.GetMol()
    Chem.SanitizeMol(capped_molecule)
    return capped_molecule


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


def _read_edge_bond_type(edge_state: dict[str, Any]) -> str | None:
    """Read one optional edge bond type from a frontend payload."""

    bond_type = edge_state.get("bondType", edge_state.get("bond_type"))
    if bond_type is None:
        return None

    return str(bond_type).upper()


def _is_tool_node(
    node_state: dict[str, Any],
    catalog: dict[str, dict[str, Any]],
) -> bool:
    """Return whether one frontend node payload references a TOOL definition."""

    node_type_id = str(node_state.get("nodeTypeId") or node_state.get("brickId") or "")
    definition = catalog.get(node_type_id)
    return bool(definition and definition.get("brick_type") == TOOL_BRICK_TYPE)


def _expand_single_tool_node(
    tool_node: dict[str, Any],
    node_states: list[dict[str, Any]],
    edge_states: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Expand one TOOL node into duplicated downstream branches."""

    tool_node_id = int(tool_node["id"])
    port_configuration = tool_node.get("portConfiguration")
    if not isinstance(port_configuration, list):
        raise ValueError("Tool node state must include a portConfiguration list.")

    left_slot_ids = {
        int(port_state.get("slotId", port_state.get("id")))
        for port_state in port_configuration
        if port_state.get("side") == "left"
    }
    right_slot_ids = {
        int(port_state.get("slotId", port_state.get("id")))
        for port_state in port_configuration
        if port_state.get("side") == "right"
    }

    incoming_edges = sorted(
        [
            edge_state
            for edge_state in edge_states
            if int(_read_edge_value(edge_state, "endNode", "to", "nodeId"))
            == tool_node_id
            and int(_read_edge_value(edge_state, "endPort", "to", "slotId"))
            in left_slot_ids
        ],
        key=lambda edge_state: (
            int(_read_edge_value(edge_state, "endPort", "to", "slotId")),
            int(edge_state.get("id", 0)),
        ),
    )
    outgoing_edges = [
        edge_state
        for edge_state in edge_states
        if int(_read_edge_value(edge_state, "startNode", "from", "nodeId"))
        == tool_node_id
        and int(_read_edge_value(edge_state, "startPort", "from", "slotId"))
        in right_slot_ids
    ]

    if len(outgoing_edges) > 1:
        raise ValueError("Tool nodes must define at most one outgoing edge.")

    remaining_nodes = [
        node_state
        for node_state in node_states
        if int(node_state["id"]) != tool_node_id
    ]
    remaining_edges = [
        edge_state
        for edge_state in edge_states
        if int(_read_edge_value(edge_state, "startNode", "from", "nodeId"))
        != tool_node_id
        and int(_read_edge_value(edge_state, "endNode", "to", "nodeId"))
        != tool_node_id
    ]

    if not incoming_edges or not outgoing_edges:
        return remaining_nodes, remaining_edges

    output_edge = outgoing_edges[0]
    root_node_id = int(_read_edge_value(output_edge, "endNode", "to", "nodeId"))
    root_slot_id = int(_read_edge_value(output_edge, "endPort", "to", "slotId"))
    downstream_node_ids, downstream_edge_ids = _collect_downstream_subgraph(
        root_node_id,
        remaining_edges,
    )

    next_node_id = max((int(node_state["id"]) for node_state in remaining_nodes), default=0) + 1
    next_edge_id = max((int(edge_state.get("id", 0)) for edge_state in remaining_edges), default=0) + 1
    additional_nodes: list[dict[str, Any]] = []
    additional_edges: list[dict[str, Any]] = []
    rewritten_incoming_edges: list[dict[str, Any]] = []

    for index, incoming_edge in enumerate(incoming_edges):
        branch_root_id = root_node_id
        if index > 0:
            (
                cloned_nodes,
                cloned_edges,
                node_id_map,
                next_node_id,
                next_edge_id,
            ) = _clone_downstream_subgraph(
                downstream_node_ids,
                downstream_edge_ids,
                remaining_nodes,
                remaining_edges,
                next_node_id,
                next_edge_id,
            )
            additional_nodes.extend(cloned_nodes)
            additional_edges.extend(cloned_edges)
            branch_root_id = node_id_map[root_node_id]

        rewritten_edge = deepcopy(incoming_edge)
        _write_edge_endpoint(rewritten_edge, "end", branch_root_id, root_slot_id)
        rewritten_incoming_edges.append(rewritten_edge)

    return (
        remaining_nodes + additional_nodes,
        remaining_edges + additional_edges + rewritten_incoming_edges,
    )


def _collect_downstream_subgraph(
    root_node_id: int,
    edge_states: list[dict[str, Any]],
) -> tuple[set[int], set[int]]:
    """Collect nodes and edges reachable downstream from one root node."""

    visited_node_ids = {root_node_id}
    visited_edge_ids: set[int] = set()
    pending_node_ids = [root_node_id]

    while pending_node_ids:
        current_node_id = pending_node_ids.pop()
        for edge_state in edge_states:
            if int(_read_edge_value(edge_state, "startNode", "from", "nodeId")) != current_node_id:
                continue

            edge_id = int(edge_state.get("id", 0))
            if edge_id in visited_edge_ids:
                continue

            visited_edge_ids.add(edge_id)
            downstream_node_id = int(
                _read_edge_value(edge_state, "endNode", "to", "nodeId")
            )
            if downstream_node_id not in visited_node_ids:
                visited_node_ids.add(downstream_node_id)
                pending_node_ids.append(downstream_node_id)

    return visited_node_ids, visited_edge_ids


def _clone_downstream_subgraph(
    downstream_node_ids: set[int],
    downstream_edge_ids: set[int],
    node_states: list[dict[str, Any]],
    edge_states: list[dict[str, Any]],
    next_node_id: int,
    next_edge_id: int,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    dict[int, int],
    int,
    int,
]:
    """Clone one downstream directed subgraph and return remapped payloads."""

    node_id_map: dict[int, int] = {}
    cloned_nodes: list[dict[str, Any]] = []

    for node_state in node_states:
        original_node_id = int(node_state["id"])
        if original_node_id not in downstream_node_ids:
            continue

        cloned_node = deepcopy(node_state)
        cloned_node["id"] = next_node_id
        node_id_map[original_node_id] = next_node_id
        next_node_id += 1
        cloned_nodes.append(cloned_node)

    cloned_edges: list[dict[str, Any]] = []
    for edge_state in edge_states:
        original_edge_id = int(edge_state.get("id", 0))
        if original_edge_id not in downstream_edge_ids:
            continue

        original_start_node_id = int(
            _read_edge_value(edge_state, "startNode", "from", "nodeId")
        )
        original_end_node_id = int(
            _read_edge_value(edge_state, "endNode", "to", "nodeId")
        )
        cloned_edge = deepcopy(edge_state)
        cloned_edge["id"] = next_edge_id
        _write_edge_endpoint(
            cloned_edge,
            "start",
            node_id_map[original_start_node_id],
            int(_read_edge_value(edge_state, "startPort", "from", "slotId")),
        )
        _write_edge_endpoint(
            cloned_edge,
            "end",
            node_id_map[original_end_node_id],
            int(_read_edge_value(edge_state, "endPort", "to", "slotId")),
        )
        next_edge_id += 1
        cloned_edges.append(cloned_edge)

    return cloned_nodes, cloned_edges, node_id_map, next_node_id, next_edge_id


def _write_edge_endpoint(
    edge_state: dict[str, Any],
    side: str,
    node_id: int,
    slot_id: int,
) -> None:
    """Write one edge endpoint back into both supported payload shapes."""

    if side == "start":
        edge_state["startNode"] = node_id
        edge_state["startPort"] = slot_id
        if isinstance(edge_state.get("from"), dict):
            edge_state["from"]["nodeId"] = node_id
            edge_state["from"]["slotId"] = slot_id
        return

    if side == "end":
        edge_state["endNode"] = node_id
        edge_state["endPort"] = slot_id
        if isinstance(edge_state.get("to"), dict):
            edge_state["to"]["nodeId"] = node_id
            edge_state["to"]["slotId"] = slot_id
        return

    raise ValueError(f"Unsupported edge side: {side}")