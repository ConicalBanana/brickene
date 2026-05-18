"""Render one molecular image per brick from the raw SMILES catalog."""

from __future__ import annotations

import argparse
import io
import json
import re
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageDraw
from rdkit import Chem
from rdkit.Chem import AllChem
from rdkit.Chem.Draw import rdMolDraw2D

DEFAULT_SOURCE_PATH = Path(__file__).resolve().parent / "raw_brick_smiles.json"
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "brick_images"
DEFAULT_IMAGE_SIZE = 512
LARGE_BRICK_ATOM_THRESHOLD = 20
Point = tuple[float, float]
RGBAColor = tuple[int, int, int, int]
FONT_CANDIDATES = (
    Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    Path("/System/Library/Fonts/SFNS.ttf"),
)
WHITE_RGB = (255, 255, 255)
WHITE_RGBA = (255, 255, 255, 255)
TRANSPARENT_RGBA = (255, 255, 255, 0)


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments for brick image rendering.

    Returns:
        Parsed command-line arguments.
    """

    parser = argparse.ArgumentParser(
        description=(
            "Render individual PNG images for every brick in "
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
        help="Directory where rendered brick images will be written.",
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


def build_port_geometry(
    drawer: rdMolDraw2D.MolDraw2DCairo,
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

    if molecule.GetNumAtoms() > LARGE_BRICK_ATOM_THRESHOLD:
        if hasattr(draw_options, "fixedFontSize"):
            draw_options.fixedFontSize = 30

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


def render_molecule_image(
    molecule: Chem.Mol,
    image_size: int,
) -> tuple[Image.Image, dict[str, dict[str, Point]]]:
    """Render one molecule to a cropped PIL image and port geometry.

    Args:
        molecule: RDKit molecule with 2D coordinates.
        image_size: Width and height of the base render canvas in pixels.

    Returns:
        Cropped PIL image plus per-port geometry in trimmed image space.
    """

    ports = find_ports(molecule)
    base_image, base_drawer = render_draw_layer(
        molecule,
        image_size,
        atom_palette=build_uniform_atom_palette((1.0, 1.0, 1.0)),
    )
    masked_base_image = mask_ports(base_image, base_drawer, ports)

    text_overlay_image, _ = render_draw_layer(
        molecule,
        image_size,
        symbol_color=(1.0, 1.0, 1.0),
    )
    transparent_text_overlay = make_white_pixels_transparent(text_overlay_image)

    trim_bounds = merge_bounds(
        get_trim_bounds(masked_base_image),
        get_alpha_bounds(transparent_text_overlay),
    )
    if trim_bounds is None:
        composited_image = Image.alpha_composite(
            masked_base_image.convert("RGBA"),
            transparent_text_overlay,
        )
        return composited_image.convert("RGB"), build_port_geometry(base_drawer, ports)

    cropped_base_image = masked_base_image.crop(trim_bounds)
    cropped_text_overlay = transparent_text_overlay.crop(trim_bounds)
    composited_image = Image.alpha_composite(
        cropped_base_image.convert("RGBA"),
        cropped_text_overlay,
    )
    port_geometry = build_port_geometry(
        base_drawer,
        ports,
        offset=(float(trim_bounds[0]), float(trim_bounds[1])),
    )
    return composited_image.convert("RGB"), port_geometry


def render_brick_image(
    brick_name: str,
    raw_entry: dict[str, Any],
    output_dir: Path,
    image_size: int,
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

    molecule = build_molecule(raw_entry["smiles"])
    brick_id = get_brick_id(brick_name, raw_entry)
    output_stem = sanitize_filename(brick_id)
    image_output_path = output_dir / f"{output_stem}.png"
    json_output_path = output_dir / f"{output_stem}.json"
    rendered_image, port_geometry = render_molecule_image(molecule, image_size)
    rendered_image.save(image_output_path)
    json_output_path.write_text(
        json.dumps({"ports": port_geometry}, indent=2, sort_keys=True),
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

    rendered_paths: list[tuple[Path, Path]] = []
    for brick_name, raw_entry in catalog.items():
        image_output_path, json_output_path = render_brick_image(
            brick_name=brick_name,
            raw_entry=raw_entry,
            output_dir=output_dir,
            image_size=image_size,
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
