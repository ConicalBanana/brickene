"""Render one brick image with annotated port positions for debugging."""

from __future__ import annotations

import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

try:
    from . import render_bricks
except ImportError:
    import render_bricks


DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "debug_outputs"
DEBUG_MARGIN_PX = 24
PORT_START_COLOR = "#dc2626"
PORT_LABEL_COLOR = "#111827"
PORT_LABEL_BACKGROUND = "#ffffff"
PORT_LABEL_BACKGROUND_OPACITY = "0.92"


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments for one debug render request.

    Returns:
        Parsed command-line arguments.
    """

    parser = argparse.ArgumentParser(
        description="Render one brick image with visible port-position overlays.",
    )
    parser.add_argument(
        "brick",
        help="Brick id or brick name to render.",
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=render_bricks.DEFAULT_SOURCE_PATH,
        help="Path to the raw brick SMILES JSON catalog.",
    )
    parser.add_argument(
        "--image-size",
        type=int,
        default=render_bricks.DEFAULT_IMAGE_SIZE,
        help="Base RDKit render size before cropping.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory where the annotated SVG and JSON files are written.",
    )
    return parser.parse_args()


def resolve_brick_entry(
    catalog: dict[str, dict[str, Any]],
    brick_ref: str,
) -> tuple[str, dict[str, Any]]:
    """Find one catalog entry by brick id or brick name.

    Args:
        catalog: Raw brick catalog keyed by brick name.
        brick_ref: Requested brick id or brick name.

    Returns:
        Matching catalog key and entry payload.

    Raises:
        ValueError: If no brick matches the requested identifier.
    """

    normalized_ref = brick_ref.strip()
    if normalized_ref in catalog:
        return normalized_ref, catalog[normalized_ref]

    for brick_name, raw_entry in catalog.items():
        if render_bricks.get_brick_id(brick_name, raw_entry) == normalized_ref:
            return brick_name, raw_entry

    raise ValueError(f"Unknown brick id or name: {brick_ref}")


def build_shared_coordinate_size(
    catalog: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any], render_bricks.Point]:
    """Build the shared coordinate size used by production brick rendering.

    Args:
        catalog: Raw brick catalog keyed by brick name.

    Returns:
        Mapping of brick names to prebuilt molecules and the shared coordinate size.
    """

    molecules_by_name: dict[str, Any] = {}
    max_coordinate_width = 0.0
    max_coordinate_height = 0.0

    for brick_name, raw_entry in catalog.items():
        molecule = render_bricks.build_molecule(str(raw_entry["smiles"]))
        molecules_by_name[brick_name] = molecule
        min_x, min_y, max_x, max_y = render_bricks.get_molecule_coordinate_bounds(
            molecule
        )
        max_coordinate_width = max(max_coordinate_width, max_x - min_x)
        max_coordinate_height = max(max_coordinate_height, max_y - min_y)

    return molecules_by_name, (max_coordinate_width, max_coordinate_height)


def annotate_svg(
    svg_text: str,
    brick_label: str,
    port_geometry: dict[str, dict[str, render_bricks.Point]],
) -> str:
    """Append visible port markers, vectors, and labels to one SVG image.

    Args:
        svg_text: Cropped SVG image for one brick.
        brick_label: Human-readable label shown in the debug title.
        port_geometry: Per-port coordinates returned by render_bricks.

    Returns:
        SVG text with one overlay group appended.
    """

    ET.register_namespace("", render_bricks.SVG_NAMESPACE)
    xml_declaration = ""
    stripped_text = svg_text.lstrip()
    if stripped_text.startswith("<?xml"):
        xml_declaration = stripped_text.splitlines()[0]

    root = ET.fromstring(svg_text)
    namespace = f"{{{render_bricks.SVG_NAMESPACE}}}"
    original_viewbox = root.get("viewBox", "0 0 1 1").split()
    viewbox_left = float(original_viewbox[0]) if len(original_viewbox) == 4 else 0.0
    viewbox_top = float(original_viewbox[1]) if len(original_viewbox) == 4 else 0.0
    width = max(1.0, float(root.get("width", "1") or 1))
    height = max(1.0, float(root.get("height", "1") or 1))
    margin = float(DEBUG_MARGIN_PX)

    original_children = list(root)
    for child in original_children:
        root.remove(child)

    root.set("viewBox", f"0 0 {width + margin * 2} {height + margin * 2}")
    root.set("width", str(int(width + margin * 2)))
    root.set("height", str(int(height + margin * 2)))

    ET.SubElement(
        root,
        f"{namespace}rect",
        {
            "x": "0",
            "y": "0",
            "width": str(int(width + margin * 2)),
            "height": str(int(height + margin * 2)),
            "fill": "white",
        },
    )
    image_group = ET.SubElement(
        root,
        f"{namespace}g",
        {
            "id": "debug-image-layer",
            "transform": (
                f"translate({margin - viewbox_left},{margin - viewbox_top})"
            ),
        },
    )
    for child in original_children:
        image_group.append(child)

    overlay_group = ET.SubElement(
        root,
        f"{namespace}g",
        {"id": "port-debug-overlay"},
    )

    ET.SubElement(
        overlay_group,
        f"{namespace}text",
        {
            "x": str(int(margin)),
            "y": str(int(margin - 6)),
            "fill": PORT_LABEL_COLOR,
            "font-size": "16",
            "font-weight": "700",
            "font-family": "Arial, sans-serif",
        },
    ).text = f"{brick_label} port anchors"

    for port_id, port_data in sorted(
        port_geometry.items(),
        key=lambda item: int(item[0]),
    ):
        start_x = port_data["port_start_pos"][0] + margin
        start_y = port_data["port_start_pos"][1] + margin
        label_x = start_x + 8
        label_y = start_y - 8
        label_width = max(28, 12 + len(port_id) * 9)

        ET.SubElement(
            overlay_group,
            f"{namespace}circle",
            {
                "cx": f"{start_x}",
                "cy": f"{start_y}",
                "r": "5.5",
                "fill": PORT_START_COLOR,
                "stroke": "white",
                "stroke-width": "1.5",
            },
        )
        ET.SubElement(
            overlay_group,
            f"{namespace}rect",
            {
                "x": f"{label_x - 4}",
                "y": f"{label_y - 14}",
                "rx": "4",
                "ry": "4",
                "width": f"{label_width}",
                "height": "18",
                "fill": PORT_LABEL_BACKGROUND,
                "fill-opacity": PORT_LABEL_BACKGROUND_OPACITY,
                "stroke": PORT_START_COLOR,
                "stroke-width": "1",
            },
        )
        ET.SubElement(
            overlay_group,
            f"{namespace}text",
            {
                "x": f"{label_x}",
                "y": f"{label_y}",
                "fill": PORT_LABEL_COLOR,
                "font-size": "12",
                "font-weight": "700",
                "font-family": "Arial, sans-serif",
            },
        ).text = f"P{port_id}"

    annotated_svg = ET.tostring(root, encoding="unicode")
    return (
        f"{xml_declaration}\n{annotated_svg}"
        if xml_declaration
        else annotated_svg
    )


def write_debug_png(svg_text: str, output_path: Path) -> None:
    """Rasterize one annotated SVG into a PNG file.

    Args:
        svg_text: Annotated SVG content.
        output_path: Destination PNG path.
    """

    png_bytes = render_bricks.cairosvg.svg2png(bytestring=svg_text.encode("utf-8"))
    output_path.write_bytes(png_bytes)


def render_debug_brick(
    brick_ref: str,
    source_path: Path,
    output_dir: Path,
    image_size: int,
) -> tuple[Path, Path, Path]:
    """Render one debug SVG and matching port-geometry JSON file.

    Args:
        brick_ref: Brick id or brick name to render.
        source_path: Raw brick catalog path.
        output_dir: Destination directory for debug outputs.
        image_size: Base RDKit render size before cropping.

    Returns:
        Paths to the written annotated SVG, PNG, and JSON files.
    """

    catalog = render_bricks.load_catalog(source_path)
    brick_name, raw_entry = resolve_brick_entry(catalog, brick_ref)
    molecules_by_name, shared_coordinate_size = build_shared_coordinate_size(catalog)
    molecule = molecules_by_name[brick_name]
    brick_id = render_bricks.get_brick_id(brick_name, raw_entry)
    rendered_svg, rendered_width, rendered_height, port_geometry = (
        render_bricks.render_molecule_svg(
            molecule,
            image_size,
            shared_coordinate_size=shared_coordinate_size,
        )
    )
    annotated_svg = annotate_svg(
        rendered_svg,
        f"{brick_name} ({brick_id})",
        port_geometry,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    output_stem = render_bricks.sanitize_filename(brick_id)
    svg_output_path = output_dir / f"{output_stem}-ports.svg"
    png_output_path = output_dir / f"{output_stem}-ports.png"
    json_output_path = output_dir / f"{output_stem}-ports.json"
    svg_output_path.write_text(annotated_svg, encoding="utf-8")
    write_debug_png(annotated_svg, png_output_path)
    json_output_path.write_text(
        json.dumps(
            {
                "brick_id": brick_id,
                "brick_name": brick_name,
                "image_width": rendered_width,
                "image_height": rendered_height,
                "ports": port_geometry,
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    return svg_output_path, png_output_path, json_output_path


def main() -> int:
    """Run the debug render CLI.

    Returns:
        Process exit status code.
    """

    args = parse_args()
    svg_output_path, png_output_path, json_output_path = render_debug_brick(
        brick_ref=args.brick,
        source_path=args.source,
        output_dir=args.output_dir,
        image_size=args.image_size,
    )
    print(f"Annotated SVG written to {svg_output_path.resolve()}")
    print(f"Annotated PNG written to {png_output_path.resolve()}")
    print(f"Port geometry JSON written to {json_output_path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
