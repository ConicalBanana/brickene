"""Service layer for graph assembly and molecule rendering."""

from __future__ import annotations

import io
import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from PIL import Image
from rdkit import Chem
from rdkit.Chem import AllChem

from brickene.dto.frontend_payload import GraphPayload
from brickene.model.brick import BrickNode
from brickene.model.network import BrickGraph
from brickene.render.rendering import (
    DEFAULT_IMAGE_SIZE,
    cap_hanging_ports_with_hydrogen,
    render_molecule_image,
    render_molecule_svg_text,
)
from brickene.repository.brick_repository import (
    DEFAULT_BRICK_DB_PATH,
    DEFAULT_USER_BRICK_DB_PATH,
    RuntimeBrickStore,
)

TOOL_BRICK_TYPE = "TOOL"
DUPLICATOR_TOOL_ACTION = "duplicate"
PERIOD_TOOL_KIND = "period"


def load_brick_catalog(
    catalog_path: Path | None = None,
    brick_db_path: Path = DEFAULT_BRICK_DB_PATH,
    user_brick_db_path: Path = DEFAULT_USER_BRICK_DB_PATH,
) -> dict[str, dict[str, Any]]:
    """Load the configured brick catalog.

    Args:
        catalog_path: Optional path to an explicit JSON brick catalog.
        brick_db_path: SQLite database used for system bricks when no catalog
            file is supplied.
        user_brick_db_path: SQLite database used for user bricks when no
            catalog file is supplied.

    Returns:
        Catalog keyed by brick id.
    """

    if catalog_path is None:
        return RuntimeBrickStore(brick_db_path, user_brick_db_path).catalog_entries()

    return json.loads(Path(catalog_path).read_text(encoding="utf-8"))


def _resolve_catalog(
    catalog_path: Path | None,
    catalog: dict[str, dict[str, Any]] | None,
    brick_db_path: Path = DEFAULT_BRICK_DB_PATH,
    user_brick_db_path: Path = DEFAULT_USER_BRICK_DB_PATH,
) -> dict[str, dict[str, Any]]:
    """Return one catalog payload from either memory or disk."""

    if catalog is not None:
        return catalog

    return load_brick_catalog(catalog_path, brick_db_path, user_brick_db_path)


def resolve_node_definition(
    node_state: dict[str, Any],
    catalog: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    """Resolve one frontend node payload to the brick definition used for rendering.

    Args:
        node_state: Raw frontend node state dict.
        catalog: Brick catalog keyed by id.

    Returns:
        Resolved brick definition dict, or ``None`` when the brick id is unknown.
    """

    node_type_id = _read_node_type_id(node_state)
    definition = catalog.get(node_type_id)
    if definition is None:
        return None

    if not definition.get("inline_configuration"):
        if definition.get("tool_kind") == PERIOD_TOOL_KIND:
            return _resolve_period_definition(node_state, definition)

        return definition

    custom_config_text = node_state.get("customConfigText")
    if not isinstance(custom_config_text, str) or not custom_config_text.strip():
        return definition

    try:
        inline_definition = json.loads(custom_config_text)
    except json.JSONDecodeError as exc:
        raise ValueError("Inline node configuration must be valid JSON.") from exc

    if not isinstance(inline_definition, dict):
        raise ValueError("Inline node configuration must decode to a JSON object.")

    resolved_definition = deepcopy(inline_definition)
    resolved_definition.setdefault("id", node_type_id)
    resolved_definition.setdefault("name", definition.get("name", "User defined"))
    resolved_definition.setdefault("inline_configuration", True)
    return resolved_definition


def expand_tool_nodes(
    node_states: list[dict[str, Any]],
    edge_states: list[dict[str, Any]],
    catalog: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Expand TOOL nodes into direct graph branches before molecule assembly.

    Args:
        node_states: Raw frontend node state dicts.
        edge_states: Raw frontend edge state dicts.
        catalog: Brick catalog keyed by id.

    Returns:
        Tuple of expanded node and edge state lists.
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
    payload: GraphPayload | dict[str, Any],
    catalog_path: Path | None = None,
    catalog: dict[str, dict[str, Any]] | None = None,
    brick_db_path: Path = DEFAULT_BRICK_DB_PATH,
    user_brick_db_path: Path = DEFAULT_USER_BRICK_DB_PATH,
) -> BrickGraph:
    """Reconstruct a ``BrickGraph`` from a frontend graph payload.

    Args:
        payload: Frontend graph state as a ``GraphPayload`` container or a raw
            dict. Raw dicts are parsed into a ``GraphPayload`` automatically.
        catalog_path: Optional path to an explicit JSON brick catalog file.
        catalog: Pre-loaded catalog dict. Takes precedence over ``catalog_path``
            and the database when supplied.
        brick_db_path: SQLite database used for system bricks when no catalog is
            supplied directly.
        user_brick_db_path: SQLite database used for user bricks when no catalog
            is supplied directly.

    Returns:
        Assembled ``BrickGraph`` ready for SMILES export.

    Raises:
        ValueError: If the payload is structurally invalid or references unknown
            brick ids.
    """

    if isinstance(payload, dict):
        graph_payload = GraphPayload.from_dict(payload)
    else:
        graph_payload = payload

    raw = graph_payload.to_raw()
    node_states: list[dict[str, Any]] = raw["nodes"]
    edge_states: list[dict[str, Any]] = raw["edges"]

    resolved_catalog = _resolve_catalog(
        catalog_path,
        catalog,
        brick_db_path,
        user_brick_db_path,
    )
    node_states, edge_states = expand_tool_nodes(node_states, edge_states, resolved_catalog)
    _validate_period_marker_pairs(node_states, resolved_catalog)
    graph = BrickGraph()
    bricks_by_frontend_id: dict[int, BrickNode] = {}
    port_assignments: dict[int, dict[int, int]] = {}

    for node_state in node_states:
        frontend_node_id = int(node_state["id"])
        node_type_id = _read_node_type_id(node_state)
        resolved_definition = resolve_node_definition(node_state, resolved_catalog)
        if resolved_definition is None:
            raise ValueError(f"Unknown brick id: {node_type_id}")

        brick = BrickNode.from_dict(resolved_definition)
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
            raise ValueError(
                "Edge references a node that is not present in the state payload."
            )

        try:
            start_port = port_assignments[start_node_id][start_slot_id]
            end_port = port_assignments[end_node_id][end_slot_id]
        except KeyError as exc:
            raise ValueError(
                "Edge references a slot that is not present in the node state."
            ) from exc

        graph.add_edge(
            start_brick,
            end_brick,
            left_port=start_port,
            right_port=end_port,
            bond_type=_read_edge_bond_type(edge_state),
        )

    return graph


def build_molecule_from_state(
    payload: GraphPayload | dict[str, Any],
    catalog_path: Path | None = None,
    catalog: dict[str, dict[str, Any]] | None = None,
    brick_db_path: Path = DEFAULT_BRICK_DB_PATH,
    user_brick_db_path: Path = DEFAULT_USER_BRICK_DB_PATH,
) -> Chem.Mol | None:
    """Build an RDKit molecule from a frontend graph payload.

    Args:
        payload: Frontend graph state as a ``GraphPayload`` or raw dict.
        catalog_path: Optional path to an explicit JSON brick catalog file.
        catalog: Pre-loaded catalog dict.
        brick_db_path: SQLite database used for system bricks.
        user_brick_db_path: SQLite database used for user bricks.

    Returns:
        Sanitized RDKit molecule with 2D coordinates, or ``None`` for empty
        graphs.
    """

    graph = build_graph_from_state(
        payload,
        catalog_path=catalog_path,
        catalog=catalog,
        brick_db_path=brick_db_path,
        user_brick_db_path=user_brick_db_path,
    )
    smiles = graph.to_smiles()
    if not smiles:
        return None

    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        raise ValueError("Failed to construct an RDKit molecule from the graph state.")

    molecule = cap_hanging_ports_with_hydrogen(molecule)

    AllChem.Compute2DCoords(molecule)
    return molecule


def build_molecule_from_definition(definition: dict[str, Any]) -> Chem.Mol | None:
    """Build an RDKit molecule from one serialized brick definition.

    Args:
        definition: JSON-compatible brick definition dict.

    Returns:
        Sanitized RDKit molecule with 2D coordinates, or ``None`` for empty
        definitions.
    """

    node = BrickNode.from_dict(definition)
    smiles = node.to_smiles()
    if not smiles:
        return None

    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        raise ValueError(
            "Failed to construct an RDKit molecule from the brick definition."
        )

    molecule = cap_hanging_ports_with_hydrogen(molecule)
    AllChem.Compute2DCoords(molecule)
    return molecule


def render_state_smiles(
    payload: GraphPayload | dict[str, Any],
    catalog_path: Path | None = None,
    catalog: dict[str, dict[str, Any]] | None = None,
    brick_db_path: Path = DEFAULT_BRICK_DB_PATH,
    user_brick_db_path: Path = DEFAULT_USER_BRICK_DB_PATH,
) -> str:
    """Render a frontend graph state payload to a SMILES string.

    Args:
        payload: Frontend graph state as a ``GraphPayload`` or raw dict.
        catalog_path: Optional path to an explicit JSON brick catalog file.
        catalog: Pre-loaded catalog dict.
        brick_db_path: SQLite database used for system bricks.
        user_brick_db_path: SQLite database used for user bricks.

    Returns:
        Canonical SMILES string, or an empty string for an empty graph.
    """

    molecule = build_molecule_from_state(
        payload,
        catalog_path=catalog_path,
        catalog=catalog,
        brick_db_path=brick_db_path,
        user_brick_db_path=user_brick_db_path,
    )
    if molecule is None:
        return ""

    return Chem.MolToSmiles(molecule)


def render_state_image(
    payload: GraphPayload | dict[str, Any],
    image_size: int = DEFAULT_IMAGE_SIZE,
    catalog_path: Path | None = None,
    catalog: dict[str, dict[str, Any]] | None = None,
    brick_db_path: Path = DEFAULT_BRICK_DB_PATH,
    user_brick_db_path: Path = DEFAULT_USER_BRICK_DB_PATH,
) -> Image.Image:
    """Render a frontend state payload to a cropped PIL image.

    Args:
        payload: Frontend graph state as a ``GraphPayload`` or raw dict.
        image_size: Width and height of the render canvas in pixels.
        catalog_path: Optional path to an explicit JSON brick catalog file.
        catalog: Pre-loaded catalog dict.
        brick_db_path: SQLite database used for system bricks.
        user_brick_db_path: SQLite database used for user bricks.

    Returns:
        White-padded-trimmed PIL image of the assembled molecule.
    """

    molecule = build_molecule_from_state(
        payload,
        catalog_path=catalog_path,
        catalog=catalog,
        brick_db_path=brick_db_path,
        user_brick_db_path=user_brick_db_path,
    )
    if molecule is None:
        return Image.new("RGB", (image_size, image_size), (255, 255, 255))

    return render_molecule_image(molecule, image_size=image_size)


def render_state_image_bytes(
    payload: GraphPayload | dict[str, Any],
    image_size: int = DEFAULT_IMAGE_SIZE,
    catalog_path: Path | None = None,
    catalog: dict[str, dict[str, Any]] | None = None,
    brick_db_path: Path = DEFAULT_BRICK_DB_PATH,
    user_brick_db_path: Path = DEFAULT_USER_BRICK_DB_PATH,
) -> bytes:
    """Render a frontend state payload into PNG bytes.

    Args:
        payload: Frontend graph state as a ``GraphPayload`` or raw dict.
        image_size: Width and height of the render canvas in pixels.
        catalog_path: Optional path to an explicit JSON brick catalog file.
        catalog: Pre-loaded catalog dict.
        brick_db_path: SQLite database used for system bricks.
        user_brick_db_path: SQLite database used for user bricks.

    Returns:
        PNG-encoded image bytes of the assembled molecule.
    """

    image = render_state_image(
        payload,
        image_size=image_size,
        catalog_path=catalog_path,
        catalog=catalog,
        brick_db_path=brick_db_path,
        user_brick_db_path=user_brick_db_path,
    )
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def render_brick_definition_image(
    definition: dict[str, Any],
    image_size: int = DEFAULT_IMAGE_SIZE,
) -> Image.Image:
    """Render one brick definition payload to a cropped PIL image.

    Args:
        definition: JSON-compatible brick definition dict.
        image_size: Width and height of the render canvas in pixels.

    Returns:
        White-padded-trimmed PIL image of the brick molecule.
    """

    molecule = build_molecule_from_definition(definition)
    if molecule is None:
        return Image.new("RGB", (image_size, image_size), (255, 255, 255))

    return render_molecule_image(molecule, image_size=image_size)


def render_brick_definition_image_bytes(
    definition: dict[str, Any],
    image_size: int = DEFAULT_IMAGE_SIZE,
) -> bytes:
    """Render one brick definition payload into PNG bytes.

    Args:
        definition: JSON-compatible brick definition dict.
        image_size: Width and height of the render canvas in pixels.

    Returns:
        PNG-encoded image bytes.
    """

    image = render_brick_definition_image(definition, image_size=image_size)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def render_brick_definition_svg(
    definition: dict[str, Any],
    image_size: int = DEFAULT_IMAGE_SIZE,
) -> str:
    """Render one brick definition payload into an SVG string.

    Args:
        definition: JSON-compatible brick definition dict.
        image_size: Width and height of the SVG canvas in pixels.

    Returns:
        SVG markup string.
    """

    molecule = build_molecule_from_definition(definition)
    if molecule is None:
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'width="{image_size}" height="{image_size}" '
            f'viewBox="0 0 {image_size} {image_size}"></svg>'
        )

    return render_molecule_svg_text(molecule, image_size=image_size)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _resolve_port_assignments(node_state: dict[str, Any]) -> dict[int, int]:
    """Map frontend slot ids to actual brick port indices."""

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
    """Read one edge payload value without treating zero as missing."""

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
    """Return whether one frontend node payload needs tool expansion."""

    definition = resolve_node_definition(node_state, catalog)
    return bool(definition and definition.get("tool_action") == DUPLICATOR_TOOL_ACTION)


def _read_node_type_id(node_state: dict[str, Any]) -> str:
    """Return the referenced frontend brick id as a normalized string."""

    return str(node_state.get("nodeTypeId") or node_state.get("brickId") or "")


def _normalize_period_number(value: Any) -> int:
    """Normalize one period-node label value to a positive integer."""

    if value is None:
        return 1

    normalized = str(value).strip()
    if not normalized.isdigit() or int(normalized) <= 0:
        raise ValueError("Period number must be a positive integer.")

    return int(normalized)


def _resolve_period_definition(
    node_state: dict[str, Any],
    definition: dict[str, Any],
) -> dict[str, Any]:
    """Apply one frontend period-node label onto the catalog definition."""

    period_number = _normalize_period_number(
        node_state.get("periodNumber", definition.get("default_period_number", 1))
    )
    resolved_definition = deepcopy(definition)

    for site_payload in resolved_definition.get("nodes", []):
        if site_payload.get("kind") == "atom" and site_payload.get("symbol") == "W":
            site_payload["atom_map_num"] = period_number

    return resolved_definition


def _validate_period_marker_pairs(
    node_states: list[dict[str, Any]],
    catalog: dict[str, dict[str, Any]],
) -> None:
    """Require each period label to appear exactly twice in one graph."""

    period_counts: dict[int, int] = {}

    for node_state in node_states:
        definition = resolve_node_definition(node_state, catalog)
        if not definition or definition.get("tool_kind") != PERIOD_TOOL_KIND:
            continue

        period_number = _normalize_period_number(
            node_state.get("periodNumber", definition.get("default_period_number", 1))
        )
        period_counts[period_number] = period_counts.get(period_number, 0) + 1

    invalid_numbers = [
        period_number
        for period_number, count in period_counts.items()
        if count != 2
    ]
    if invalid_numbers:
        raise ValueError(
            "Each period number must appear exactly twice in one molecule."
        )


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
            if (
                int(_read_edge_value(edge_state, "endNode", "to", "nodeId"))
                == tool_node_id
                and int(_read_edge_value(edge_state, "endPort", "to", "slotId"))
                in left_slot_ids
            )
        ],
        key=lambda edge_state: (
            int(_read_edge_value(edge_state, "endPort", "to", "slotId")),
            int(edge_state.get("id", 0)),
        ),
    )
    outgoing_edges = [
        edge_state
        for edge_state in edge_states
        if (
            int(_read_edge_value(edge_state, "startNode", "from", "nodeId"))
            == tool_node_id
            and int(_read_edge_value(edge_state, "startPort", "from", "slotId"))
            in right_slot_ids
        )
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
        if (
            int(_read_edge_value(edge_state, "startNode", "from", "nodeId"))
            != tool_node_id
            and int(_read_edge_value(edge_state, "endNode", "to", "nodeId"))
            != tool_node_id
        )
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

    next_node_id = (
        max((int(node_state["id"]) for node_state in remaining_nodes), default=0) + 1
    )
    next_edge_id = (
        max((int(edge_state.get("id", 0)) for edge_state in remaining_edges), default=0)
        + 1
    )
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
            start_node_id = int(
                _read_edge_value(edge_state, "startNode", "from", "nodeId")
            )
            if start_node_id != current_node_id:
                continue

            edge_id = int(edge_state.get("id", 0))
            end_node_id = int(_read_edge_value(edge_state, "endNode", "to", "nodeId"))
            visited_edge_ids.add(edge_id)
            if end_node_id in visited_node_ids:
                continue

            visited_node_ids.add(end_node_id)
            pending_node_ids.append(end_node_id)

    return visited_node_ids, visited_edge_ids


def _clone_downstream_subgraph(
    downstream_node_ids: set[int],
    downstream_edge_ids: set[int],
    node_states: list[dict[str, Any]],
    edge_states: list[dict[str, Any]],
    next_node_id: int,
    next_edge_id: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[int, int], int, int]:
    """Clone one downstream branch and return its remapped nodes and edges."""

    node_id_map: dict[int, int] = {}
    cloned_nodes: list[dict[str, Any]] = []
    cloned_edges: list[dict[str, Any]] = []

    for node_state in node_states:
        original_node_id = int(node_state["id"])
        if original_node_id not in downstream_node_ids:
            continue

        cloned_node = deepcopy(node_state)
        cloned_node["id"] = next_node_id
        node_id_map[original_node_id] = next_node_id
        cloned_nodes.append(cloned_node)
        next_node_id += 1

    for edge_state in edge_states:
        original_edge_id = int(edge_state.get("id", 0))
        if original_edge_id not in downstream_edge_ids:
            continue

        cloned_edge = deepcopy(edge_state)
        start_node_id = int(
            _read_edge_value(cloned_edge, "startNode", "from", "nodeId")
        )
        start_slot_id = int(
            _read_edge_value(cloned_edge, "startPort", "from", "slotId")
        )
        end_node_id = int(_read_edge_value(cloned_edge, "endNode", "to", "nodeId"))
        end_slot_id = int(_read_edge_value(cloned_edge, "endPort", "to", "slotId"))
        _write_edge_endpoint(
            cloned_edge,
            "start",
            node_id_map[start_node_id],
            start_slot_id,
        )
        _write_edge_endpoint(cloned_edge, "end", node_id_map[end_node_id], end_slot_id)
        cloned_edge["id"] = next_edge_id
        cloned_edges.append(cloned_edge)
        next_edge_id += 1

    return cloned_nodes, cloned_edges, node_id_map, next_node_id, next_edge_id


def _write_edge_endpoint(
    edge_state: dict[str, Any],
    endpoint_prefix: str,
    node_id: int,
    slot_id: int,
) -> None:
    """Write one edge endpoint back to either supported payload shape."""

    direct_node_key = "startNode" if endpoint_prefix == "start" else "endNode"
    direct_port_key = "startPort" if endpoint_prefix == "start" else "endPort"
    nested_key = "from" if endpoint_prefix == "start" else "to"

    edge_state[direct_node_key] = node_id
    edge_state[direct_port_key] = slot_id

    nested_payload = edge_state.get(nested_key)
    if isinstance(nested_payload, dict):
        nested_payload["nodeId"] = node_id
        nested_payload["slotId"] = slot_id
