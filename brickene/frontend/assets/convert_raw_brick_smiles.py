"""Convert the raw brick SMILES catalog into one standard brick config file."""

from __future__ import annotations

import argparse
import dataclasses
import json
from pathlib import Path
from typing import Any

from brickene.core.node import BrickNode, BrickType, Port, Site

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
        (
            replacement_by_index[left.index],
            replacement_by_index[right.index],
        )
        for left, right in node.edges
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


def get_brick_id(brick_name: str, raw_entry: dict[str, Any]) -> str:
    """Extract the canonical brick ID from one raw catalog entry.

    Args:
        brick_name: Human-readable brick name from the raw catalog key.
        raw_entry: Raw catalog entry payload.

    Returns:
        Brick ID normalized as a string.

    Raises:
        ValueError: If the raw entry does not define a usable ID.
    """

    brick_id = str(raw_entry.get("id", "")).strip()
    if not brick_id:
        raise ValueError(f"Missing brick id for raw catalog entry: {brick_name}")
    return brick_id


def build_catalog_payload(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Convert the raw brick catalog into one standard config payload.

    Args:
        payload: Raw SMILES catalog keyed by brick name.

    Returns:
        Aggregated config payload keyed by brick name.
    """

    catalog_payload: dict[str, dict[str, Any]] = {}

    for brick_name, raw_entry in payload.items():
        brick_id = get_brick_id(brick_name, raw_entry)
        node = build_brick_node(raw_entry)
        catalog_payload[brick_id] = {
            "id": brick_id,
            "name": brick_name,
            "alias": list(raw_entry.get("alias", [])),
            **node.to_dict(),
        }

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
    catalog_payload = build_catalog_payload(payload)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(catalog_payload, indent=2, sort_keys=True),
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
