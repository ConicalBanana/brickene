"""Sync raw brick SMILES into SQLite-backed system definitions and assets."""

from __future__ import annotations

import argparse
import dataclasses
import json
from pathlib import Path
from typing import Any

from rdkit import Chem
from rdkit.Chem import AllChem

from brickene.model.brick import Atom, BrickNode, BrickType, Edge, Port, Site
from brickene.repository.brick_repository import DEFAULT_BRICK_DB_PATH, BrickStore
from brickene.service.rendering import render_molecule_svg_with_layout

RAW_TYPE_TO_BRICK_TYPE: dict[str, BrickType] = {
    "bridge": BrickType.BRIDGE,
    "core": BrickType.SKELETON,
    "sidechain": BrickType.SIDE_CHAIN,
    "side_chain": BrickType.SIDE_CHAIN,
    "substituent": BrickType.SUBSTITUENT,
}
SOURCE_FILE_NAMES = (
    "raw_brick_smiles.json",
    "raw_smiles_list.json",
)
DEFAULT_IMAGE_SIZE = 512
DEFAULT_PORT_BRICK_TYPE = BrickType.SKELETON
CoordinateBounds = tuple[float, float, float, float]
RenderedAsset = tuple[str, str, dict[str, Any]]
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
    },
}


def resolve_default_source_path() -> Path:
    """Return the first supported raw-catalog filename in this directory."""

    asset_dir = Path(__file__).resolve().parent
    for file_name in SOURCE_FILE_NAMES:
        candidate = asset_dir / file_name
        if candidate.exists():
            return candidate

    return asset_dir / SOURCE_FILE_NAMES[0]


DEFAULT_SOURCE_PATH = resolve_default_source_path()


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments for the system-brick sync script."""

    parser = argparse.ArgumentParser(
        description=(
            "Import a raw brick SMILES catalog and export the SQLite-backed "
            "system brick database."
        )
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE_PATH,
        help="Path to the raw brick SMILES catalog.",
    )
    parser.add_argument(
        "--brick-db",
        type=Path,
        default=DEFAULT_BRICK_DB_PATH,
        help="SQLite database that stores system brick definitions and assets.",
    )
    parser.add_argument(
        "--image-size",
        type=int,
        default=DEFAULT_IMAGE_SIZE,
        help="Width and height of each rendered SVG canvas in pixels.",
    )
    return parser.parse_args()


def load_raw_catalog(source_path: Path) -> dict[str, dict[str, Any]]:
    """Load the raw brick catalog from disk."""

    return json.loads(source_path.read_text(encoding="utf-8"))


def normalize_brick_type(raw_type: str) -> BrickType:
    """Map a raw type label onto the standard BrickType enum."""

    try:
        return RAW_TYPE_TO_BRICK_TYPE[raw_type.strip().lower()]
    except KeyError as exc:
        raise ValueError(f"Unsupported raw brick type: {raw_type}") from exc


def apply_preferred_port_type(
    node: BrickNode,
    preferred_brick_type: BrickType,
) -> BrickNode:
    """Return a copy of a brick node with all ports set to one type."""

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
    """Convert one raw brick entry into a standardized BrickNode."""

    node = BrickNode.from_smiles(
        raw_entry["smiles"],
        brick_type=normalize_brick_type(raw_entry["type"]),
    )
    return apply_preferred_port_type(node, DEFAULT_PORT_BRICK_TYPE)


def get_connected_symbol_by_port(node: BrickNode) -> dict[int, str | None]:
    """Find the directly bonded atom symbol for each port in one brick."""

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
    """Serialize one brick node and annotate ports with bonded symbols."""

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
    """Build the canonical brick ID from raw catalog order."""

    return str(sequence_number)


def assign_brick_ids(payload: dict[str, Any]) -> dict[str, Any]:
    """Assign sequence-based IDs back onto each raw catalog entry."""

    for sequence_number, raw_entry in enumerate(payload.values(), start=1):
        raw_entry["id"] = get_brick_id(sequence_number)

    return payload


def build_system_definition_payload(
    payload: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Convert the raw brick catalog into one system-definition payload."""

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


def build_molecule(smiles: str) -> Chem.Mol:
    """Build a 2D-ready RDKit molecule from one SMILES string."""

    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        raise ValueError(f"Invalid SMILES string: {smiles}")

    prepared = Chem.Mol(molecule)
    AllChem.Compute2DCoords(prepared)
    return prepared


def get_molecule_coordinate_bounds(molecule: Chem.Mol) -> CoordinateBounds:
    """Return the 2D coordinate bounds for one molecule."""

    conformer = molecule.GetConformer()
    x_coords = [
        conformer.GetAtomPosition(index).x
        for index in range(molecule.GetNumAtoms())
    ]
    y_coords = [
        conformer.GetAtomPosition(index).y
        for index in range(molecule.GetNumAtoms())
    ]
    return (min(x_coords), min(y_coords), max(x_coords), max(y_coords))


def render_asset_payloads(
    payload: dict[str, Any],
    image_size: int,
) -> list[RenderedAsset]:
    """Render the SVG and layout payload for each raw brick entry."""

    molecules_by_name: dict[str, Chem.Mol] = {}
    max_coordinate_width = 0.0
    max_coordinate_height = 0.0

    for brick_name, raw_entry in payload.items():
        molecule = build_molecule(raw_entry["smiles"])
        molecules_by_name[brick_name] = molecule
        min_x, min_y, max_x, max_y = get_molecule_coordinate_bounds(molecule)
        max_coordinate_width = max(max_coordinate_width, max_x - min_x)
        max_coordinate_height = max(max_coordinate_height, max_y - min_y)

    shared_coordinate_size = (max_coordinate_width, max_coordinate_height)
    rendered_assets: list[RenderedAsset] = []

    for brick_name, raw_entry in payload.items():
        svg_text, layout = render_molecule_svg_with_layout(
            molecules_by_name[brick_name],
            image_size,
            shared_coordinate_size=shared_coordinate_size,
        )
        rendered_assets.append((str(raw_entry["id"]), svg_text, layout))

    return rendered_assets


def sync_system_database(
    source_path: Path,
    brick_db_path: Path,
    image_size: int,
) -> tuple[int, int]:
    """Sync definitions and rendered assets from raw JSON into SQLite."""

    payload = assign_brick_ids(load_raw_catalog(source_path))
    source_path.write_text(
        json.dumps(payload, indent=4),
        encoding="utf-8",
    )

    definition_payload = build_system_definition_payload(payload)
    rendered_assets = render_asset_payloads(payload, image_size)

    brick_store = BrickStore(brick_db_path)
    definition_count = brick_store.sync_system_bricks(definition_payload)
    for brick_id, svg_text, layout_payload in rendered_assets:
        brick_store.save_system_brick_assets(brick_id, svg_text, layout_payload)

    return definition_count, len(rendered_assets)


def main() -> int:
    """Run the raw-catalog to SQLite system-database sync CLI."""

    args = parse_args()
    definition_count, asset_count = sync_system_database(
        args.source,
        args.brick_db,
        args.image_size,
    )
    print(f"Loaded source catalog {args.source.resolve()}")
    print(
        f"Synced {definition_count} system brick definitions to "
        f"{args.brick_db.resolve()}"
    )
    print(
        f"Synced {asset_count} rendered system brick asset bundles to "
        f"{args.brick_db.resolve()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
