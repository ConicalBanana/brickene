"""Render one molecular image per brick from the raw SMILES catalog."""

from __future__ import annotations

import argparse
import io
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import cairosvg
from PIL import Image, ImageChops, ImageDraw
from rdkit import Chem
from rdkit.Chem import AllChem
from rdkit.Chem.Draw import rdMolDraw2D
from rdkit.Geometry import Point2D, Point3D

DEFAULT_SOURCE_PATH = Path(__file__).resolve().parent / "raw_brick_smiles.json"
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "brick_images"
DEFAULT_IMAGE_SIZE = 512
LARGE_BRICK_ATOM_THRESHOLD = 20
Point = tuple[float, float]
CoordinateBounds = tuple[float, float, float, float]
RGBAColor = tuple[int, int, int, int]
FONT_CANDIDATES = (
    Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    Path("/System/Library/Fonts/SFNS.ttf"),
)
WHITE_RGB = (255, 255, 255)
WHITE_RGBA = (255, 255, 255, 255)
TRANSPARENT_RGBA = (255, 255, 255, 0)
SVG_NAMESPACE = "http://www.w3.org/2000/svg"


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments for brick image rendering.

    Returns:
        Parsed command-line arguments.
    """

    parser = argparse.ArgumentParser(
        description=(
            "Render individual SVG images for every brick in "
            "raw_brick_smiles.json."
        )
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE_PATH,
        help="Path to the raw brick SMILES JSON catalog.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory where rendered brick SVG assets will be written.",
    )
    parser.add_argument(
        "--image-size",
        type=int,
        default=DEFAULT_IMAGE_SIZE,
        help="Width and height of each output PNG image in pixels.",
    )
    return parser.parse_args()


def load_catalog(source_path: Path) -> dict[str, dict[str, Any]]:
    """Load the raw brick catalog from disk.

    Args:
        source_path: Path to the JSON file containing raw brick definitions.

    Returns:
        Raw brick catalog keyed by brick name.
    """

    return json.loads(source_path.read_text(encoding="utf-8"))


def sanitize_filename(brick_name: str) -> str:
    """Convert a brick name into a stable filesystem-friendly stem.

    Args:
        brick_name: Human-readable brick name from the catalog.

    Returns:
        Safe filename stem derived from the brick name.
    """

    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "_", brick_name.strip())
    return sanitized.strip("._-") or "brick"


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


def build_molecule(smiles: str) -> Chem.Mol:
    """Build a 2D-ready RDKit molecule from one SMILES string.

    Args:
        smiles: SMILES representation of one brick.

    Returns:
        RDKit molecule with 2D coordinates.

    Raises:
        ValueError: If the input SMILES cannot be parsed.
    """

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
    """Return a usable bold font file for RDKit text rendering.

    Returns:
        Absolute font path if a preferred bold font is available, else None.
    """

    for font_path in FONT_CANDIDATES:
        if font_path.exists():
            return str(font_path)
    return None


def trim_white_padding(image: Image.Image) -> Image.Image:
    """Crop away uniform white padding around a rendered image.

    Args:
        image: Rendered PIL image.

    Returns:
        Cropped image with outer white borders removed.
    """

    rgb_image = image.convert("RGB")
    background = Image.new("RGB", rgb_image.size, WHITE_RGB)
    diff = ImageChops.difference(rgb_image, background)
    bounds = diff.getbbox()

    if bounds is None:
        return rgb_image

    return rgb_image.crop(bounds)


def get_trim_bounds(image: Image.Image) -> tuple[int, int, int, int] | None:
    """Return the non-white bounding box for one rendered image."""

    rgb_image = image.convert("RGB")
    background = Image.new("RGB", rgb_image.size, WHITE_RGB)
    diff = ImageChops.difference(rgb_image, background)
    return diff.getbbox()


def get_alpha_bounds(image: Image.Image) -> tuple[int, int, int, int] | None:
    """Return the non-transparent bounding box for one RGBA image."""

    alpha_channel = image.convert("RGBA").getchannel("A")
    return alpha_channel.getbbox()


def merge_bounds(
    left_bounds: tuple[int, int, int, int] | None,
    right_bounds: tuple[int, int, int, int] | None,
) -> tuple[int, int, int, int] | None:
    """Return the bounding box covering both inputs."""

    if left_bounds is None:
        return right_bounds
    if right_bounds is None:
        return left_bounds

    return (
        min(left_bounds[0], right_bounds[0]),
        min(left_bounds[1], right_bounds[1]),
        max(left_bounds[2], right_bounds[2]),
        max(left_bounds[3], right_bounds[3]),
    )


def round_point(point: Any) -> Point:
    """Round one RDKit draw point into a JSON-friendly coordinate pair."""

    return (round(point.x, 2), round(point.y, 2))


def build_uniform_atom_palette(
    color: tuple[float, float, float],
) -> dict[int, tuple[float, float, float]]:
    """Build one RDKit atom palette that forces all atom labels to one color."""

    return {atomic_number: color for atomic_number in range(119)}


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


def render_svg_layer(
    molecule: Chem.Mol,
    image_size: int,
    *,
    show_port_labels: bool,
    shared_coordinate_size: Point | None = None,
) -> tuple[str, Any]:
    """Render one molecule to an RDKit SVG string.

    Args:
        molecule: RDKit molecule with 2D coordinates.
        image_size: Width and height of the SVG canvas in pixels.
        show_port_labels: Whether mapped dummy atoms should show their port number.

    Returns:
        SVG text and the configured RDKit SVG drawer.
    """

    draw_molecule = rdMolDraw2D.PrepareMolForDrawing(Chem.Mol(molecule), kekulize=False)
    if shared_coordinate_size is not None:
        draw_molecule = translate_molecule_to_origin(
            draw_molecule,
            get_molecule_coordinate_bounds(draw_molecule),
        )

    drawer = rdMolDraw2D.MolDraw2DSVG(image_size, image_size)
    draw_options = drawer.drawOptions()
    configure_draw_options(draw_options, molecule)

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
    """Remove mapped port atoms and their bond segments from an RDKit SVG.

    Args:
        svg_text: Source SVG text.
        port_atom_indices: Atom indices corresponding to mapped dummy ports.

    Returns:
        SVG text with port-related elements removed.
    """

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
    """Rasterize one SVG string into a white-background RGBA PIL image.

    Args:
        svg_text: SVG content to rasterize.
        image_size: Output raster width and height in pixels.

    Returns:
        Rasterized PIL image.
    """

    png_bytes = cairosvg.svg2png(
        bytestring=svg_text.encode("utf-8"),
        output_width=image_size,
        output_height=image_size,
        background_color="white",
    )
    with Image.open(io.BytesIO(png_bytes)) as rasterized_image:
        return rasterized_image.convert("RGBA")


def crop_svg_to_bounds(
    svg_text: str,
    bounds: tuple[int, int, int, int] | None,
    image_size: int,
) -> tuple[str, int, int]:
    """Crop one SVG to the requested bounds by adjusting its viewBox.

    Args:
        svg_text: SVG content to crop.
        bounds: Bounding box in the original render coordinate space.
        image_size: Original square render size when no bounds are available.

    Returns:
        Cropped SVG text plus its output width and height.
    """

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


def mask_ports(
    image: Image.Image,
    drawer: rdMolDraw2D.MolDraw2DCairo,
    ports: dict[int, tuple[int, tuple[int, ...]]],
) -> Image.Image:
    """Hide the rendered port bonds and port endpoints in white."""

    masked_image = image.convert("RGBA")
    draw = ImageDraw.Draw(masked_image)
    line_width = max(6, min(masked_image.size) // 55)
    marker_radius = max(10, min(masked_image.size) // 24)

    for port_atom_idx, attached_atom_indices in ports.values():
        port_pos = round_point(drawer.GetDrawCoords(port_atom_idx))
        for attached_atom_idx in attached_atom_indices:
            port_start_pos = round_point(drawer.GetDrawCoords(attached_atom_idx))
            draw.line(
                [port_start_pos, port_pos],
                fill=WHITE_RGBA,
                width=line_width,
            )
        draw.ellipse(
            [
                port_pos[0] - marker_radius,
                port_pos[1] - marker_radius,
                port_pos[0] + marker_radius,
                port_pos[1] + marker_radius,
            ],
            fill=WHITE_RGBA,
        )

    return masked_image


def make_white_pixels_transparent(image: Image.Image) -> Image.Image:
    """Convert white and near-white pixels to transparent pixels."""

    transparent_image = image.convert("RGBA")
    pixel_access = transparent_image.load()
    width, height = transparent_image.size

    for x_coord in range(width):
        for y_coord in range(height):
            red, green, blue, alpha = pixel_access[x_coord, y_coord]
            if alpha == 0 or (red >= 250 and green >= 250 and blue >= 250):
                pixel_access[x_coord, y_coord] = TRANSPARENT_RGBA
            else:
                pixel_access[x_coord, y_coord] = cast_rgba_color(
                    (red, green, blue, alpha)
                )

    return transparent_image


def cast_rgba_color(color: tuple[int, int, int, int]) -> RGBAColor:
    """Return one tuple as an RGBAColor for static typing clarity."""

    return color


def configure_draw_options(
    draw_options: rdMolDraw2D.MolDrawOptions,
    molecule: Chem.Mol,
) -> None:
    """Apply the shared draw configuration used by all asset render passes."""

    draw_options.padding = 0.0

    # if molecule.GetNumAtoms() > LARGE_BRICK_ATOM_THRESHOLD:
    #     if hasattr(draw_options, "fixedFontSize"):
    #         draw_options.fixedFontSize = 30

    bold_font_file = get_bold_font_file()
    if bold_font_file is not None:
        draw_options.fontFile = bold_font_file


def render_draw_layer(
    molecule: Chem.Mol,
    image_size: int,
    *,
    atom_palette: dict[int, tuple[float, float, float]] | None = None,
    symbol_color: tuple[float, float, float] | None = None,
) -> tuple[Image.Image, rdMolDraw2D.MolDraw2DCairo]:
    """Render one draw layer with custom RDKit color settings."""

    draw_molecule = rdMolDraw2D.PrepareMolForDrawing(Chem.Mol(molecule), kekulize=False)
    drawer = rdMolDraw2D.MolDraw2DCairo(image_size, image_size)
    draw_options = drawer.drawOptions()
    configure_draw_options(draw_options, molecule)

    if atom_palette is not None:
        draw_options.setAtomPalette(atom_palette)
    if symbol_color is not None:
        draw_options.setSymbolColour(symbol_color)

    for atom in draw_molecule.GetAtoms():
        if atom.GetAtomicNum() == 0 and atom.GetAtomMapNum() > 0:
            draw_options.atomLabels[atom.GetIdx()] = ""

    drawer.DrawMolecule(draw_molecule)
    drawer.FinishDrawing()

    png_bytes = drawer.GetDrawingText()
    with Image.open(io.BytesIO(png_bytes)) as rendered_image:
        return rendered_image.convert("RGBA"), drawer


def render_molecule_svg(
    molecule: Chem.Mol,
    image_size: int,
    shared_coordinate_size: Point | None = None,
) -> tuple[str, int, int, dict[str, dict[str, Point]]]:
    """Render one molecule to a cropped SVG asset and port geometry.

    Args:
        molecule: RDKit molecule with 2D coordinates.
        image_size: Width and height of the base render canvas in pixels.

    Returns:
        Cropped SVG text, cropped width, cropped height, and per-port geometry.
    """

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
    stripped_image = rasterize_svg(stripped_svg, image_size)
    trim_bounds = get_trim_bounds(stripped_image)

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


def render_brick_image(
    brick_name: str,
    raw_entry: dict[str, Any],
    output_dir: Path,
    image_size: int,
    molecule: Chem.Mol | None = None,
    shared_coordinate_size: Point | None = None,
) -> tuple[Path, Path]:
    """Render one brick image and return the output path.

    Args:
        brick_name: Catalog key for the brick.
        raw_entry: Raw catalog entry containing at least one SMILES string.
        output_dir: Directory where the image should be written.
        image_size: Width and height of the output image in pixels.

    Returns:
        Paths to the written image and port-geometry JSON files.
    """

    molecule = molecule or build_molecule(raw_entry["smiles"])
    brick_id = get_brick_id(brick_name, raw_entry)
    output_stem = sanitize_filename(brick_id)
    image_output_path = output_dir / f"{output_stem}.svg"
    json_output_path = output_dir / f"{output_stem}.json"
    rendered_svg, rendered_width, rendered_height, port_geometry = render_molecule_svg(
        molecule,
        image_size,
        shared_coordinate_size=shared_coordinate_size,
    )
    image_output_path.write_text(rendered_svg, encoding="utf-8")
    json_output_path.write_text(
        json.dumps(
            {
                "image_width": rendered_width,
                "image_height": rendered_height,
                "ports": port_geometry,
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    return image_output_path, json_output_path


def render_catalog(
    source_path: Path,
    output_dir: Path,
    image_size: int,
) -> list[tuple[Path, Path]]:
    """Render every brick from the raw catalog into one output directory.

    Args:
        source_path: Path to the raw brick JSON catalog.
        output_dir: Directory for output PNG images.
        image_size: Width and height of each output image in pixels.

    Returns:
        Output image and JSON paths for each rendered brick.
    """

    catalog = load_catalog(source_path)
    output_dir.mkdir(parents=True, exist_ok=True)

    molecules_by_name: dict[str, Chem.Mol] = {}
    max_coordinate_width = 0.0
    max_coordinate_height = 0.0

    for brick_name, raw_entry in catalog.items():
        molecule = build_molecule(raw_entry["smiles"])
        molecules_by_name[brick_name] = molecule
        min_x, min_y, max_x, max_y = get_molecule_coordinate_bounds(molecule)
        max_coordinate_width = max(max_coordinate_width, max_x - min_x)
        max_coordinate_height = max(max_coordinate_height, max_y - min_y)

    shared_coordinate_size = (max_coordinate_width, max_coordinate_height)

    rendered_paths: list[tuple[Path, Path]] = []
    for brick_name, raw_entry in catalog.items():
        image_output_path, json_output_path = render_brick_image(
            brick_name=brick_name,
            raw_entry=raw_entry,
            output_dir=output_dir,
            image_size=image_size,
            molecule=molecules_by_name[brick_name],
            shared_coordinate_size=shared_coordinate_size,
        )
        rendered_paths.append((image_output_path, json_output_path))

    return rendered_paths


def main() -> int:
    """Run the brick rendering CLI.

    Returns:
        Process exit status code.
    """

    args = parse_args()
    rendered_paths = render_catalog(args.source, args.output_dir, args.image_size)
    print(
        "Rendered "
        f"{len(rendered_paths)} brick assets to {args.output_dir.resolve()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
