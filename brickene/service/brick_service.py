"""Business logic for brick definition normalization and serialization."""

from __future__ import annotations

from typing import Any

from brickene.model.brick import Atom, BrickNode, BrickType, Port
from brickene.repository.brick_repository import RuntimeBrickStore


def serialize_brick_definition(node: BrickNode) -> dict[str, Any]:
    """Serialize one brick node and annotate its ports with bonded symbols.

    Args:
        node: Validated brick node to serialize.

    Returns:
        JSON-compatible dict with ``brick_type``, ``nodes``, ``edges``, and
        per-port ``connected_symbol`` annotations.
    """

    validate_brick_node(node)
    payload = node.to_dict()
    connected_symbol_by_port = get_connected_symbol_by_port(node)

    for site_payload in payload["nodes"]:
        if site_payload.get("kind") != "port":
            continue

        site_payload["connected_symbol"] = connected_symbol_by_port.get(
            int(site_payload["index"])
        )

    return payload


def get_connected_symbol_by_port(node: BrickNode) -> dict[int, str | None]:
    """Find the directly bonded atom symbol for each port in one brick.

    Args:
        node: Brick node to inspect.

    Returns:
        Mapping of port index to the bonded atom symbol, or ``None`` when
        the port is not directly bonded to an atom.

    Raises:
        ValueError: If any port does not connect to exactly one atom via a
            single bond.
    """

    connected_symbol_by_port = {port.index: None for port in node.ports}
    connection_counts = {port.index: 0 for port in node.ports}

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

        if port_site is None and atom_site is None:
            continue

        if port_site is None or atom_site is None:
            raise ValueError(
                "Each port must connect to exactly one atom."
            )

        if edge.bond_type != "SINGLE":
            raise ValueError("Each port must connect to an atom by a single bond.")

        if connection_counts[port_site.index] != 0:
            raise ValueError("Each port must connect to exactly one atom.")

        connected_symbol_by_port[port_site.index] = atom_site.symbol
        connection_counts[port_site.index] += 1

    missing_port_indices = [
        port_index
        for port_index, connection_count in connection_counts.items()
        if connection_count != 1
    ]
    if missing_port_indices:
        raise ValueError("Each port must connect to exactly one atom.")

    return connected_symbol_by_port


def validate_brick_node(node: BrickNode) -> None:
    """Validate the port contract for one brick node.

    Args:
        node: Brick node to validate.

    Raises:
        ValueError: If the node has no ports or port connections are invalid.
    """

    if not node.ports:
        raise ValueError("Node definitions must include at least one port.")

    get_connected_symbol_by_port(node)


def parse_brick_type(value: Any) -> BrickType:
    """Normalize one request payload value to a supported BrickType.

    Args:
        value: Raw value from a request payload (string, ``None``, etc.).

    Returns:
        Matching ``BrickType`` enum member.

    Raises:
        ValueError: If the value does not match any known brick type.
    """

    normalized = str(value or BrickType.SKELETON.name).strip().upper()

    try:
        return BrickType[normalized]
    except KeyError as exc:
        raise ValueError(
            "brick_type must be one of SKELETON, SIDE_CHAIN, SUBSTITUENT, or BRIDGE."
        ) from exc


def normalize_aliases(value: Any) -> list[str]:
    """Normalize one alias request value to a clean string list.

    Args:
        value: Raw alias value from a request payload.

    Returns:
        List of non-empty stripped alias strings.

    Raises:
        ValueError: If the value is not a list of strings.
    """

    if value is None:
        return []

    if not isinstance(value, list):
        raise ValueError("alias must be an array of strings.")

    aliases = []
    for alias in value:
        if not isinstance(alias, str):
            raise ValueError("alias must be an array of strings.")

        normalized = alias.strip()
        if normalized:
            aliases.append(normalized)

    return aliases


def normalize_brick_definition(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize one posted brick definition payload.

    The request may either be the definition object itself or a wrapper with a
    top-level ``definition`` key.

    Args:
        payload: Raw JSON-decoded request body.

    Returns:
        Normalized brick definition dict ready for storage.

    Raises:
        ValueError: If the payload is invalid or the brick graph is malformed.
    """

    definition_payload = payload.get("definition", payload)
    if not isinstance(definition_payload, dict):
        raise ValueError("definition must be a JSON object.")

    normalized_definition = dict(definition_payload)
    normalized_definition["brick_type"] = parse_brick_type(
        definition_payload.get("brick_type")
    ).name

    try:
        node = BrickNode.from_dict(normalized_definition)
    except KeyError as exc:
        raise ValueError(
            f"Invalid brick definition: missing {exc.args[0]}."
        ) from exc
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid brick definition: {exc}") from exc

    if not node.nodes:
        raise ValueError("definition must include at least one node.")

    return {
        "name": str(definition_payload.get("name") or "User defined").strip()
        or "User defined",
        "alias": normalize_aliases(definition_payload.get("alias")),
        **serialize_brick_definition(node),
    }


def build_runtime_catalog(
    brick_store: RuntimeBrickStore,
) -> dict[str, dict[str, Any]]:
    """Return the runtime catalog stored in SQLite.

    Args:
        brick_store: Runtime store providing the merged catalog.

    Returns:
        Catalog dict keyed by public brick id.
    """

    return brick_store.catalog_entries()
