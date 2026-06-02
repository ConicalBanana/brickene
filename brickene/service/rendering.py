"""Low-level RDKit molecule rendering primitives."""

from __future__ import annotations

import io
import math
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops
from rdkit import Chem
from rdkit.Chem import AllChem
from rdkit.Chem.Draw import rdMolDraw2D
from rdkit.Geometry.rdGeometry import Point2D, Point3D

DEFAULT_IMAGE_SIZE = 512

# Port vectors are normalized to this pixel length in the cropped image space.
# System bricks rendered with shared_coordinate_size produce vectors of ~30px;
# matching that value keeps port dot placement consistent across all bricks.
_PORT_VEC_NORMALIZED_LENGTH = 30.0

_SVG_NAMESPACE = "http://www.w3.org/2000/svg"
_FONT_CANDIDATES = (
    Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    Path("/System/Library/Fonts/SFNS.ttf"),
)
# Fractional margin applied to the canvas size when computing trim bounds.
_TRIM_MARGIN_FRACTION = 0.06


def _get_bold_font_file() -> str | None:
    """Return a usable bold font path, or None if no candidate is found."""

    for font_path in _FONT_CANDIDATES:
        if font_path.exists():
            return str(font_path)
    return None


def _collect_port_atoms(
    molecule: Chem.Mol,
) -> dict[int, tuple[int, tuple[int, ...]]]:
    """Return port_number → (atom_idx, attached_indices) for all port atoms."""

    ports: dict[int, tuple[int, tuple[int, ...]]] = {}
    for atom in molecule.GetAtoms():
        if atom.GetAtomicNum() != 0:
            continue
        port_number = atom.GetAtomMapNum()
        if port_number <= 0:
            continue
        ports[port_number] = (
            atom.GetIdx(),
            tuple(n.GetIdx() for n in atom.GetNeighbors()),
        )
    return ports


def _get_molecule_coordinate_bounds(
    molecule: Chem.Mol,
) -> tuple[float, float, float, float]:
    """Return (min_x, min_y, max_x, max_y) of the 2D atom coordinates."""

    conformer = molecule.GetConformer()
    x_coords = [
        conformer.GetAtomPosition(i).x for i in range(molecule.GetNumAtoms())
    ]
    y_coords = [
        conformer.GetAtomPosition(i).y for i in range(molecule.GetNumAtoms())
    ]
    return (min(x_coords), min(y_coords), max(x_coords), max(y_coords))


def _translate_molecule_to_origin(
    molecule: Chem.Mol,
    bounds: tuple[float, float, float, float],
) -> Chem.Mol:
    """Shift atom coordinates so the bounding box starts at (0, 0)."""

    translated = Chem.Mol(molecule)
    conformer = translated.GetConformer()
    min_x, min_y, _, _ = bounds
    for i in range(translated.GetNumAtoms()):
        pos = conformer.GetAtomPosition(i)
        conformer.SetAtomPosition(
            i, Point3D(pos.x - min_x, pos.y - min_y, pos.z)
        )
    return translated


def _render_svg_layer(
    molecule: Chem.Mol,
    image_size: int,
    shared_coordinate_size: tuple[float, float] | None = None,
) -> tuple[str, Any]:
    """Render a molecule to SVG with port dummy atoms hidden.

    Port atoms are given empty labels so they are invisible, and their DOM
    elements are ready to be stripped by :func:`_remove_port_elements_from_svg`.

    Returns:
        ``(svg_text, drawer)`` — the SVG markup and the live drawer object
        (used later for :func:`_build_port_geometry`).
    """

    draw_molecule = rdMolDraw2D.PrepareMolForDrawing(
        Chem.Mol(molecule), kekulize=False
    )
    if shared_coordinate_size is not None:
        draw_molecule = _translate_molecule_to_origin(
            draw_molecule,
            _get_molecule_coordinate_bounds(draw_molecule),
        )

    drawer = rdMolDraw2D.MolDraw2DSVG(image_size, image_size)
    draw_options = drawer.drawOptions()
    draw_options.padding = 0.0
    bold_font = _get_bold_font_file()
    if bold_font is not None:
        draw_options.fontFile = bold_font

    for atom in draw_molecule.GetAtoms():
        if atom.GetAtomicNum() == 0 and atom.GetAtomMapNum() > 0:
            draw_options.atomLabels[atom.GetIdx()] = ""

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


def _remove_port_elements_from_svg(
    svg_text: str,
    port_atom_indices: set[int],
) -> str:
    """Remove mapped port atoms and their bond segments from an RDKit SVG."""

    ET.register_namespace("", _SVG_NAMESPACE)
    xml_declaration = ""
    stripped_text = svg_text.lstrip()
    if stripped_text.startswith("<?xml"):
        xml_declaration = stripped_text.splitlines()[0]

    root = ET.fromstring(svg_text)
    port_atom_classes = {f"atom-{idx}" for idx in port_atom_indices}

    for parent in root.iter():
        for child in list(parent):
            class_tokens = set(child.attrib.get("class", "").split())
            if class_tokens & port_atom_classes:
                parent.remove(child)

    cleaned_svg = ET.tostring(root, encoding="unicode")
    return f"{xml_declaration}\n{cleaned_svg}" if xml_declaration else cleaned_svg


def _compute_trim_bounds(
    drawer: Any,
    molecule: Chem.Mol,
    port_atom_indices: set[int],
    image_size: int,
) -> tuple[int, int, int, int]:
    """Compute a tight crop box for the non-port molecule content.

    Uses the draw coordinates of every non-port atom as the content bounds,
    then adds a margin to accommodate atom labels and bond-line visual width.

    Returns:
        ``(left, top, right, bottom)`` in SVG pixel coordinates.
    """

    non_port_indices = [
        atom.GetIdx()
        for atom in molecule.GetAtoms()
        if atom.GetIdx() not in port_atom_indices
    ]
    if not non_port_indices:
        return (0, 0, image_size, image_size)

    coords = [drawer.GetDrawCoords(i) for i in non_port_indices]
    min_x = min(c.x for c in coords)
    min_y = min(c.y for c in coords)
    max_x = max(c.x for c in coords)
    max_y = max(c.y for c in coords)

    margin = max(20, int(image_size * _TRIM_MARGIN_FRACTION))
    return (
        max(0, int(min_x) - margin),
        max(0, int(min_y) - margin),
        min(image_size, int(max_x) + margin),
        min(image_size, int(max_y) + margin),
    )


def _crop_svg_to_bounds(
    svg_text: str,
    bounds: tuple[int, int, int, int],
    image_size: int,
) -> tuple[str, int, int]:
    """Adjust the SVG viewBox and dimensions to the given pixel bounds.

    Returns:
        ``(cropped_svg, width, height)``.
    """

    ET.register_namespace("", _SVG_NAMESPACE)
    xml_declaration = ""
    stripped_text = svg_text.lstrip()
    if stripped_text.startswith("<?xml"):
        xml_declaration = stripped_text.splitlines()[0]

    root = ET.fromstring(svg_text)
    left, top, right, bottom = bounds
    width = max(1, right - left)
    height = max(1, bottom - top)
    root.set("viewBox", f"{left} {top} {width} {height}")
    root.set("width", str(width))
    root.set("height", str(height))

    cropped_svg = ET.tostring(root, encoding="unicode")
    result = f"{xml_declaration}\n{cropped_svg}" if xml_declaration else cropped_svg
    return result, width, height


def _build_port_geometry(
    drawer: Any,
    ports: dict[int, tuple[int, tuple[int, ...]]],
    offset: tuple[float, float] = (0.0, 0.0),
) -> dict[str, dict[str, list[float]]]:
    """Compute cropped-image-space port geometry from draw coordinates."""

    offset_x, offset_y = offset
    port_geometry: dict[str, dict[str, list[float]]] = {}

    for port_number, (port_atom_idx, attached_indices) in sorted(ports.items()):
        if not attached_indices:
            continue
        port_pos = drawer.GetDrawCoords(port_atom_idx)
        attached = [drawer.GetDrawCoords(i) for i in attached_indices]
        start_x = round(
            sum(c.x for c in attached) / len(attached) - offset_x, 2
        )
        start_y = round(
            sum(c.y for c in attached) / len(attached) - offset_y, 2
        )
        raw_vec_x = (port_pos.x - offset_x) - start_x
        raw_vec_y = (port_pos.y - offset_y) - start_y
        length = math.hypot(raw_vec_x, raw_vec_y)
        if length > 0:
            scale = _PORT_VEC_NORMALIZED_LENGTH / length
            vec_x = round(raw_vec_x * scale, 2)
            vec_y = round(raw_vec_y * scale, 2)
        else:
            vec_x, vec_y = _PORT_VEC_NORMALIZED_LENGTH, 0.0
        port_geometry[str(port_number)] = {
            "port_start_pos": [start_x, start_y],
            "port_vec": [vec_x, vec_y],
        }

    return port_geometry


def render_molecule_svg_with_layout(
    molecule: Chem.Mol,
    image_size: int,
    *,
    shared_coordinate_size: tuple[float, float] | None = None,
) -> tuple[str, dict[str, Any]]:
    """Render one molecule to a cropped SVG string with port layout geometry.

    Port dummy atoms (atomic_num == 0, atom_map_num > 0) are detected
    automatically and stripped from the final SVG.  The SVG is then cropped
    to the tight bounding box of the remaining non-port content.  Port
    coordinates are expressed in the cropped viewport.

    Args:
        molecule: RDKit molecule with 2D coordinates.
        image_size: Width and height of the initial render canvas in pixels.
        shared_coordinate_size: When given, forces all molecules to the same
            visual scale (used for consistent brick-catalog thumbnails).

    Returns:
        ``(svg_text, layout_dict)`` where ``layout_dict`` has ``image_width``,
        ``image_height``, and ``ports`` in the cropped coordinate space.
    """

    ports = _collect_port_atoms(molecule)
    svg_text, drawer = _render_svg_layer(
        molecule, image_size, shared_coordinate_size
    )

    port_atom_indices = {port_atom_idx for port_atom_idx, _ in ports.values()}
    stripped_svg = _remove_port_elements_from_svg(svg_text, port_atom_indices)

    trim_bounds = _compute_trim_bounds(
        drawer, molecule, port_atom_indices, image_size
    )
    cropped_svg, cropped_width, cropped_height = _crop_svg_to_bounds(
        stripped_svg, trim_bounds, image_size
    )

    offset = (float(trim_bounds[0]), float(trim_bounds[1]))
    port_geometry = _build_port_geometry(drawer, ports, offset)

    layout: dict[str, Any] = {
        "image_width": cropped_width,
        "image_height": cropped_height,
        "ports": port_geometry,
    }
    return cropped_svg, layout


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

    Each dummy atom (atomic number 0) that has exactly one neighbor donates
    a hydrogen to that neighbor.  RDKit fills the remaining valence with
    implicit hydrogens so that an isolated alkyl side chain renders as its
    parent alkane (e.g. hexyl → ``CCCCCC``) rather than as a radical.

    Args:
        molecule: RDKit molecule that may contain dummy port atoms.

    Returns:
        Sanitized molecule with port atoms removed and neighbour valence
        adjusted.

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

        dummy_atom_indices.append(atom.GetIdx())

    for atom_index in sorted(dummy_atom_indices, reverse=True):
        editable_molecule.RemoveAtom(atom_index)

    capped_molecule = editable_molecule.GetMol()
    Chem.SanitizeMol(capped_molecule)
    return capped_molecule
