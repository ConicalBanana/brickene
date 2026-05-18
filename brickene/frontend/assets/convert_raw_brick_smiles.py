"""Convert the raw brick SMILES catalog into one standard brick config file."""

from __future__ import annotations

import argparse
import dataclasses
import json
from pathlib import Path
from typing import Any

from brickene.core.node import Atom, BrickNode, BrickType, Edge, Port, Site

RAW_TYPE_TO_BRICK_TYPE: dict[str, BrickType] = {
    "bridge": BrickType.BRIDGE,
    "core": BrickType.SKELETON,
    "sidechain": BrickType.SIDE_CHAIN,
    "side_chain": BrickType.SIDE_CHAIN,
    "substituent": BrickType.SUBSTITUENT,
}
DEFAULT_PORT_BRICK_TYPE = BrickType.SKELETON
DEFAULT_SOURCE_PATH = \
    Path(__file__).resolve().parent / "raw_brick_smiles.json"
DEFAULT_OUTPUT_PATH = \
    Path(__file__).resolve().parent / "brick_configs.json"
TOOL_BRICK_PAYLOADS: dict[str, dict[str, Any]] = {
    "900": {
        "id": "900",
        "name": "Duplicator",
        "alias": [],
        "brick_type": "TOOL",
        "tool_action": "duplicate",
        "nodes": [
            {"index": 1, "kind": "port", "side": "left"},
            {"index": 2, "kind": "port", "side": "left"},
            {"index": 3, "kind": "port", "side": "left"},
            {"index": 4, "kind": "port", "side": "left"},
            {"index": 5, "kind": "port", "side": "left"},
            {"index": 6, "kind": "port", "side": "right"},
        ],
        "edges": [],
    },
    "901": {
        "id": "901",
        "name": "User defined",
        "alias": [],
        "brick_type": "TOOL",
        "inline_configuration": True,
        "nodes": [],
        "edges": [],
    },
    "902": {
        "id": "902",
        "name": "period",
        "alias": [],
        "brick_type": "TOOL",
        "tool_kind": "period",
        "default_period_number": 1,
        "nodes": [
            {"index": 1, "kind": "port", "side": "left"},
            {"index": 2, "kind": "port", "side": "right"},
            {"index": 3, "kind": "atom", "symbol": "W", "atom_map_num": 1},
        ],
        "edges": [
            [1, 3, "SINGLE"],
            [3, 2, "SINGLE"],
        ],
    }
}


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments for the converter."""

    parser = argparse.ArgumentParser(
        description=(
            "Convert raw_brick_smiles.json entries into one JSON catalog of "
            "standard BrickNode configs."
        )
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE_PATH,
        help="Path to the raw brick SMILES catalog.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="Output JSON file for the generated brick config catalog.",
    )
    return parser.parse_args()


def normalize_brick_type(raw_type: str) -> BrickType:
    """Map a raw brick type label onto the standard BrickType enum.

    Args:
        raw_type: Type label from the raw SMILES catalog.

    Returns:
        Standardized brick type for BrickNode config serialization.

    Raises:
        ValueError: If the raw type label is not supported.
    """

    try:
        return RAW_TYPE_TO_BRICK_TYPE[raw_type.strip().lower()]
    except KeyError as exc:
        raise ValueError(f"Unsupported raw brick type: {raw_type}") from exc


def apply_preferred_port_type(
    node: BrickNode,
    preferred_brick_type: BrickType,
) -> BrickNode:
    """Return a copy of a brick node with all ports set to one preferred type.

    Args:
        node: Parsed brick node.
        preferred_brick_type: Preferred brick type to assign to every port.

    Returns:
        Brick node with updated port metadata.
    """

    replacement_by_index: dict[int, Site] = {}
    updated_nodes: list[Site] = []

    for site in node.nodes:
        if isinstance(site, Port):
            updated_site = dataclasses.replace(
                site,
                preferred_brick_type=preferred_brick_type,
            )
        else:
            updated_site = site

        replacement_by_index[site.index] = updated_site
        updated_nodes.append(updated_site)

    updated_edges = [
        Edge(
            left=replacement_by_index[edge.left.index],
            right=replacement_by_index[edge.right.index],
            bond_type=edge.bond_type,
        )
        for edge in node.edges
    ]

    return BrickNode(
        brick_type=node.brick_type,
        nodes=updated_nodes,
        edges=updated_edges,
    )


def build_brick_node(raw_entry: dict[str, Any]) -> BrickNode:
    """Convert one raw brick entry into a standard BrickNode.

    Args:
        raw_entry: Raw catalog entry containing a SMILES string and raw type.

    Returns:
        Standardized BrickNode with preferred port types set to core.
    """

    node = BrickNode.from_smiles(
        raw_entry["smiles"],
        brick_type=normalize_brick_type(raw_entry["type"]),
    )
    return apply_preferred_port_type(node, DEFAULT_PORT_BRICK_TYPE)


def get_connected_symbol_by_port(node: BrickNode) -> dict[int, str | None]:
    """Find the atom symbol directly attached to each port in one brick.

    Args:
        node: Parsed brick node.

    Returns:
        Mapping from port index to the bonded atom symbol.

    Raises:
        ValueError: If one port is connected to multiple atoms.
    """

    connected_symbol_by_port = {port.index: None for port in node.ports}

    for edge in node.edges:
        left_site = edge.left
        right_site = edge.right
        port_site: Port | None = None
        atom_site: Atom | None = None

        if isinstance(left_site, Port) and isinstance(right_site, Atom):
            port_site = left_site
            atom_site = right_site
        elif isinstance(left_site, Atom) and isinstance(right_site, Port):
            port_site = right_site
            atom_site = left_site

        if port_site is None or atom_site is None:
            continue

        existing_symbol = connected_symbol_by_port[port_site.index]
        if existing_symbol is not None and existing_symbol != atom_site.symbol:
            raise ValueError(
                "Each port must connect to exactly one atom symbol in the brick."
            )

        connected_symbol_by_port[port_site.index] = atom_site.symbol

    return connected_symbol_by_port


def build_serialized_node_payload(node: BrickNode) -> dict[str, Any]:
    """Serialize one brick node and annotate port nodes with atom symbols.

    Args:
        node: Parsed brick node.

    Returns:
        Serialized brick node payload with connected port symbols added.
    """

    node_payload = node.to_dict()
    connected_symbol_by_port = get_connected_symbol_by_port(node)

    for site_payload in node_payload["nodes"]:
        if site_payload.get("kind") != "port":
            continue

        site_payload["connected_symbol"] = connected_symbol_by_port.get(
            site_payload["index"]
        )

    return node_payload


def get_brick_id(sequence_number: int) -> str:
    """Build the canonical brick ID from raw catalog order.

    Args:
        sequence_number: One-based position of the brick in the raw catalog.

    Returns:
        Brick ID normalized as a string.
    """

    return str(sequence_number)


def assign_brick_ids(payload: dict[str, Any]) -> dict[str, Any]:
    """Assign sequence-based IDs back onto each raw catalog entry.

    Args:
        payload: Raw SMILES catalog keyed by brick name.

    Returns:
        Raw catalog payload with generated IDs persisted on each entry.
    """

    for sequence_number, raw_entry in enumerate(payload.values(), start=1):
        raw_entry["id"] = get_brick_id(sequence_number)

    return payload


def build_catalog_payload(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Convert the raw brick catalog into one standard config payload.

    Args:
        payload: Raw SMILES catalog keyed by brick name.

    Returns:
        Aggregated config payload keyed by brick name.
    """

    catalog_payload: dict[str, dict[str, Any]] = {}

    for brick_name, raw_entry in payload.items():
        brick_id = str(raw_entry["id"])
        node = build_brick_node(raw_entry)
        node_payload = build_serialized_node_payload(node)
        catalog_payload[brick_id] = {
            "id": brick_id,
            "name": brick_name,
            "alias": list(raw_entry.get("alias", [])),
            **node_payload,
        }

    catalog_payload.update(TOOL_BRICK_PAYLOADS)

    return catalog_payload


def convert_catalog(source_path: Path, output_path: Path) -> Path:
    """Convert the raw brick catalog into one standard config file.

    Args:
        source_path: Path to the raw SMILES catalog JSON file.
        output_path: Destination JSON file for the generated config catalog.

    Returns:
        Path to the generated config file.
    """

    payload = json.loads(source_path.read_text(encoding="utf-8"))
    payload = assign_brick_ids(payload)
    source_path.write_text(
        json.dumps(payload, indent=4),
        encoding="utf-8",
    )
    catalog_payload = build_catalog_payload(payload)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(catalog_payload, indent=2),
        encoding="utf-8",
    )
    return output_path


def main() -> int:
    """Run the raw SMILES to brick config conversion CLI."""

    args = parse_args()
    output_path = convert_catalog(args.source, args.output)
    print(f"Generated brick config catalog at {output_path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
