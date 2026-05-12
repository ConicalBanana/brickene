"""Render one molecular image per brick from the raw SMILES catalog."""

from __future__ import annotations

import argparse
import io
import json
import re
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops
from rdkit import Chem
from rdkit.Chem import AllChem
from rdkit.Chem.Draw import rdMolDraw2D

DEFAULT_SOURCE_PATH = Path(__file__).resolve().parent / "raw_brick_smiles.json"
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "brick_images"
DEFAULT_IMAGE_SIZE = 512
FONT_CANDIDATES = (
    Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    Path("/System/Library/Fonts/SFNS.ttf"),
)


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
    background = Image.new("RGB", rgb_image.size, (255, 255, 255))
    diff = ImageChops.difference(rgb_image, background)
    bounds = diff.getbbox()

    if bounds is None:
        return rgb_image

    return rgb_image.crop(bounds)


def render_molecule_image(molecule: Chem.Mol, image_size: int) -> Image.Image:
    """Render one molecule to a cropped PIL image.

    Args:
        molecule: RDKit molecule with 2D coordinates.
        image_size: Width and height of the base render canvas in pixels.

    Returns:
        Cropped PIL image containing only the molecule drawing.
    """

    drawer = rdMolDraw2D.MolDraw2DCairo(image_size, image_size)
    draw_options = drawer.drawOptions()
    draw_options.padding = 0.0

    bold_font_file = get_bold_font_file()
    if bold_font_file is not None:
        draw_options.fontFile = bold_font_file

    drawer.DrawMolecule(molecule)
    drawer.FinishDrawing()

    png_bytes = drawer.GetDrawingText()
    with Image.open(io.BytesIO(png_bytes)) as rendered_image:
        return trim_white_padding(rendered_image)


def render_brick_image(
    brick_name: str,
    raw_entry: dict[str, Any],
    output_dir: Path,
    image_size: int,
) -> Path:
    """Render one brick image and return the output path.

    Args:
        brick_name: Catalog key for the brick.
        raw_entry: Raw catalog entry containing at least one SMILES string.
        output_dir: Directory where the image should be written.
        image_size: Width and height of the output image in pixels.

    Returns:
        Path to the written image file.
    """

    molecule = build_molecule(raw_entry["smiles"])
    brick_id = get_brick_id(brick_name, raw_entry)
    output_path = output_dir / f"{sanitize_filename(brick_id)}.png"
    rendered_image = render_molecule_image(molecule, image_size)
    rendered_image.save(output_path)
    return output_path


def render_catalog(
    source_path: Path,
    output_dir: Path,
    image_size: int,
) -> list[Path]:
    """Render every brick from the raw catalog into one output directory.

    Args:
        source_path: Path to the raw brick JSON catalog.
        output_dir: Directory for output PNG images.
        image_size: Width and height of each output image in pixels.

    Returns:
        Paths to all rendered image files.
    """

    catalog = load_catalog(source_path)
    output_dir.mkdir(parents=True, exist_ok=True)

    rendered_paths: list[Path] = []
    for brick_name, raw_entry in catalog.items():
        rendered_paths.append(
            render_brick_image(
                brick_name=brick_name,
                raw_entry=raw_entry,
                output_dir=output_dir,
                image_size=image_size,
            )
        )

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
        f"{len(rendered_paths)} brick images to {args.output_dir.resolve()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
