"""Sync raw brick SMILES into SQLite-backed system definitions and assets."""

from __future__ import annotations

import argparse
import dataclasses
import io
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import cairosvg
from PIL import Image, ImageChops
from rdkit import Chem
from rdkit.Chem import AllChem
from rdkit.Chem.Draw import rdMolDraw2D
from rdkit.Geometry import Point2D, Point3D

from brickene.brick_store import DEFAULT_BRICK_DB_PATH, BrickStore
from brickene.core.node import Atom, BrickNode, BrickType, Edge, Port, Site

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
SVG_NAMESPACE = "http://www.w3.org/2000/svg"
FONT_CANDIDATES = (
    Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    Path("/System/Library/Fonts/SFNS.ttf"),
)
WHITE_RGB = (255, 255, 255)
Point = tuple[float, float]
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
    for atom in prepared.GetAtoms():
        if atom.GetAtomicNum() != 0:
            continue

        atom_map_number = atom.GetAtomMapNum()
        if atom_map_number > 0:
            atom.SetProp("atomLabel", str(atom_map_number))

    AllChem.Compute2DCoords(prepared)
    return prepared


def get_bold_font_file() -> str | None:
    """Return a usable bold font file for RDKit text rendering."""

    for font_path in FONT_CANDIDATES:
        if font_path.exists():
            return str(font_path)
    return None


def find_ports(molecule: Chem.Mol) -> dict[int, tuple[int, tuple[int, ...]]]:
    """Collect mapped dummy atoms and their attached atom indices."""

    ports: dict[int, tuple[int, tuple[int, ...]]] = {}
    for atom in molecule.GetAtoms():
        if atom.GetAtomicNum() != 0:
            continue

        port_number = atom.GetAtomMapNum()
        if port_number <= 0:
            continue

        neighbors = tuple(neighbor.GetIdx() for neighbor in atom.GetNeighbors())
        if not neighbors:
            raise ValueError(
                f"Port {port_number} must be connected to at least one atom."
            )

        ports[port_number] = (atom.GetIdx(), neighbors)

    return ports


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


def translate_molecule_to_origin(
    molecule: Chem.Mol,
    bounds: CoordinateBounds,
) -> Chem.Mol:
    """Shift molecule coordinates so the bounding box starts at the origin."""

    translated = Chem.Mol(molecule)
    conformer = translated.GetConformer()
    min_x, min_y, _, _ = bounds

    for index in range(translated.GetNumAtoms()):
        position = conformer.GetAtomPosition(index)
        conformer.SetAtomPosition(
            index,
            Point3D(position.x - min_x, position.y - min_y, position.z),
        )

    return translated


def round_point(point: Any) -> Point:
    """Round one RDKit draw point into a JSON-friendly coordinate pair."""

    return (round(point.x, 2), round(point.y, 2))


def build_port_geometry(
    drawer: Any,
    ports: dict[int, tuple[int, tuple[int, ...]]],
    offset: Point = (0.0, 0.0),
) -> dict[str, dict[str, Point]]:
    """Build trimmed image-space geometry for every mapped port."""

    port_geometry: dict[str, dict[str, Point]] = {}
    offset_x, offset_y = offset

    for port_number, (port_atom_idx, attached_atom_indices) in sorted(ports.items()):
        port_pos = round_point(drawer.GetDrawCoords(port_atom_idx))
        attached_positions = [
            round_point(drawer.GetDrawCoords(attached_atom_idx))
            for attached_atom_idx in attached_atom_indices
        ]
        port_start_pos = (
            round(
                sum(position[0] for position in attached_positions)
                / len(attached_positions),
                2,
            ),
            round(
                sum(position[1] for position in attached_positions)
                / len(attached_positions),
                2,
            ),
        )
        trimmed_port_pos = (
            round(port_pos[0] - offset_x, 2),
            round(port_pos[1] - offset_y, 2),
        )
        trimmed_start_pos = (
            round(port_start_pos[0] - offset_x, 2),
            round(port_start_pos[1] - offset_y, 2),
        )

        port_geometry[str(port_number)] = {
            "port_start_pos": trimmed_start_pos,
            "port_vec": (
                round(trimmed_port_pos[0] - trimmed_start_pos[0], 2),
                round(trimmed_port_pos[1] - trimmed_start_pos[1], 2),
            ),
        }

    return port_geometry


def configure_draw_options(
    draw_options: rdMolDraw2D.MolDrawOptions,
) -> None:
    """Apply the shared draw configuration used by all asset render passes."""

    draw_options.padding = 0.0

    bold_font_file = get_bold_font_file()
    if bold_font_file is not None:
        draw_options.fontFile = bold_font_file


def render_svg_layer(
    molecule: Chem.Mol,
    image_size: int,
    *,
    show_port_labels: bool,
    shared_coordinate_size: Point | None = None,
) -> tuple[str, Any]:
    """Render one molecule to an RDKit SVG string."""

    draw_molecule = rdMolDraw2D.PrepareMolForDrawing(Chem.Mol(molecule), kekulize=False)
    if shared_coordinate_size is not None:
        draw_molecule = translate_molecule_to_origin(
            draw_molecule,
            get_molecule_coordinate_bounds(draw_molecule),
        )

    drawer = rdMolDraw2D.MolDraw2DSVG(image_size, image_size)
    draw_options = drawer.drawOptions()
    configure_draw_options(draw_options)

    for atom in draw_molecule.GetAtoms():
        if atom.GetAtomicNum() != 0 or atom.GetAtomMapNum() <= 0:
            continue

        draw_options.atomLabels[atom.GetIdx()] = (
            str(atom.GetAtomMapNum()) if show_port_labels else ""
        )

    if shared_coordinate_size is not None:
        drawer.SetScale(
            image_size,
            image_size,
            Point2D(0.0, 0.0),
            Point2D(shared_coordinate_size[0], shared_coordinate_size[1]),
        )

    drawer.DrawMolecule(draw_molecule)
    drawer.FinishDrawing()
    return drawer.GetDrawingText(), drawer


def remove_port_elements_from_svg(
    svg_text: str,
    port_atom_indices: set[int],
) -> str:
    """Remove mapped port atoms and their bond segments from an RDKit SVG."""

    ET.register_namespace("", SVG_NAMESPACE)
    xml_declaration = ""
    stripped_text = svg_text.lstrip()
    if stripped_text.startswith("<?xml"):
        xml_declaration = stripped_text.splitlines()[0]

    root = ET.fromstring(svg_text)
    port_atom_classes = {f"atom-{atom_idx}" for atom_idx in port_atom_indices}

    for parent in root.iter():
        for child in list(parent):
            class_tokens = set(child.attrib.get("class", "").split())
            if class_tokens & port_atom_classes:
                parent.remove(child)

    cleaned_svg = ET.tostring(root, encoding="unicode")
    return f"{xml_declaration}\n{cleaned_svg}" if xml_declaration else cleaned_svg


def rasterize_svg(svg_text: str, image_size: int) -> Image.Image:
    """Rasterize one SVG string into a white-background PIL image."""

    png_bytes = cairosvg.svg2png(
        bytestring=svg_text.encode("utf-8"),
        output_width=image_size,
        output_height=image_size,
        background_color="white",
    )
    with Image.open(io.BytesIO(png_bytes)) as rasterized_image:
        return rasterized_image.convert("RGB")


def get_trim_bounds(image: Image.Image) -> tuple[int, int, int, int] | None:
    """Return the non-white bounding box for one rendered image."""

    background = Image.new("RGB", image.size, WHITE_RGB)
    diff = ImageChops.difference(image, background)
    return diff.getbbox()


def crop_svg_to_bounds(
    svg_text: str,
    bounds: tuple[int, int, int, int] | None,
    image_size: int,
) -> tuple[str, int, int]:
    """Crop one SVG to the requested bounds by adjusting its viewBox."""

    ET.register_namespace("", SVG_NAMESPACE)
    xml_declaration = ""
    stripped_text = svg_text.lstrip()
    if stripped_text.startswith("<?xml"):
        xml_declaration = stripped_text.splitlines()[0]

    root = ET.fromstring(svg_text)

    if bounds is None:
        left, top, right, bottom = 0, 0, image_size, image_size
    else:
        left, top, right, bottom = bounds

    width = max(1, right - left)
    height = max(1, bottom - top)
    root.set("viewBox", f"{left} {top} {width} {height}")
    root.set("width", str(width))
    root.set("height", str(height))

    cropped_svg = ET.tostring(root, encoding="unicode")
    return (
        f"{xml_declaration}\n{cropped_svg}" if xml_declaration else cropped_svg,
        width,
        height,
    )


def render_molecule_svg(
    molecule: Chem.Mol,
    image_size: int,
    *,
    shared_coordinate_size: Point | None = None,
) -> tuple[str, int, int, dict[str, dict[str, Point]]]:
    """Render one molecule to a cropped SVG asset and port geometry."""

    ports = find_ports(molecule)
    labeled_svg, svg_drawer = render_svg_layer(
        molecule,
        image_size,
        show_port_labels=True,
        shared_coordinate_size=shared_coordinate_size,
    )
    stripped_svg = remove_port_elements_from_svg(
        labeled_svg,
        {port_atom_idx for port_atom_idx, _ in ports.values()},
    )
    trim_bounds = get_trim_bounds(rasterize_svg(stripped_svg, image_size))

    cropped_svg, cropped_width, cropped_height = crop_svg_to_bounds(
        stripped_svg,
        trim_bounds,
        image_size,
    )

    if trim_bounds is None:
        return cropped_svg, cropped_width, cropped_height, build_port_geometry(
            svg_drawer,
            ports,
        )

    port_geometry = build_port_geometry(
        svg_drawer,
        ports,
        offset=(float(trim_bounds[0]), float(trim_bounds[1])),
    )
    return cropped_svg, cropped_width, cropped_height, port_geometry


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
        rendered_svg, rendered_width, rendered_height, port_geometry = render_molecule_svg(
            molecules_by_name[brick_name],
            image_size,
            shared_coordinate_size=shared_coordinate_size,
        )
        rendered_assets.append(
            (
                str(raw_entry["id"]),
                rendered_svg,
                {
                    "image_width": rendered_width,
                    "image_height": rendered_height,
                    "ports": port_geometry,
                },
            )
        )

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