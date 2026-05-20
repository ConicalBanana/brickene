"""Low-level RDKit molecule rendering primitives."""

from __future__ import annotations

import io

from PIL import Image, ImageChops
from rdkit import Chem
from rdkit.Chem.Draw import rdMolDraw2D

DEFAULT_IMAGE_SIZE = 1024


def render_molecule_image(molecule: Chem.Mol, image_size: int) -> Image.Image:
    """Render one molecule to a cropped PIL image.

    Args:
        molecule: RDKit molecule with 2D coordinates.
        image_size: Width and height of the initial canvas in pixels.

    Returns:
        White-padded-trimmed PIL image.
    """

    drawer = rdMolDraw2D.MolDraw2DCairo(image_size, image_size)
    draw_options = drawer.drawOptions()
    draw_options.padding = 0.02
    drawer.DrawMolecule(molecule)
    drawer.FinishDrawing()

    png_bytes = drawer.GetDrawingText()
    with Image.open(io.BytesIO(png_bytes)) as rendered_image:
        return trim_white_padding(rendered_image)


def render_molecule_svg_text(molecule: Chem.Mol, image_size: int) -> str:
    """Render one molecule to an SVG string.

    Args:
        molecule: RDKit molecule with 2D coordinates.
        image_size: Width and height of the SVG canvas in pixels.

    Returns:
        SVG markup string.
    """

    drawer = rdMolDraw2D.MolDraw2DSVG(image_size, image_size)
    draw_options = drawer.drawOptions()
    draw_options.padding = 0.02
    drawer.DrawMolecule(molecule)
    drawer.FinishDrawing()
    return drawer.GetDrawingText()


def trim_white_padding(image: Image.Image) -> Image.Image:
    """Crop away uniform white padding around a rendered image.

    Args:
        image: Source PIL image to trim.

    Returns:
        Cropped image, or the original if the image is entirely white.
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
        molecule: RDKit molecule that may contain dummy port atoms.

    Returns:
        Sanitized molecule with port atoms replaced by explicit hydrogens.

    Raises:
        ValueError: If a dummy atom connects to more than one neighbor.
    """

    editable_molecule = Chem.RWMol(molecule)
    dummy_atom_indices: list[int] = []

    for atom in editable_molecule.GetAtoms():
        if atom.GetAtomicNum() != 0:
            continue

        neighbors = list(atom.GetNeighbors())
        if len(neighbors) > 1:
            raise ValueError(
                "Dangling ports must connect to at most one neighboring atom."
            )

        if len(neighbors) == 1:
            neighbor = neighbors[0]
            neighbor.SetNumExplicitHs(neighbor.GetNumExplicitHs() + 1)
            neighbor.SetNoImplicit(True)

        dummy_atom_indices.append(atom.GetIdx())

    for atom_index in sorted(dummy_atom_indices, reverse=True):
        editable_molecule.RemoveAtom(atom_index)

    capped_molecule = editable_molecule.GetMol()
    Chem.SanitizeMol(capped_molecule)
    return capped_molecule
