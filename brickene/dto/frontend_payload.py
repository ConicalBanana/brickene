"""Typed containers for frontend graph payloads sent to backend endpoints."""

from __future__ import annotations

import dataclasses
from typing import Any


@dataclasses.dataclass
class PortConfigEntry:
    """One port slot assignment from a frontend node state.

    Args:
        slot_id: Frontend slot identifier for this port.
        side: Visual side placement (``"left"`` or ``"right"``), when present.
        actual_port_id: Brick-level port index this slot maps to.
    """

    slot_id: int
    side: str | None
    actual_port_id: str | None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PortConfigEntry:
        """Parse one port configuration entry from a raw frontend dict.

        Args:
            data: Raw port state dict from the frontend payload.

        Returns:
            Parsed port configuration entry.
        """

        return cls(
            slot_id=int(data.get("slotId", data.get("id", 0))),
            side=data.get("side") or None,
            actual_port_id=data.get("actualPortId"),
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize this entry back to a frontend-compatible dict."""

        result: dict[str, Any] = {"slotId": self.slot_id}
        if self.side is not None:
            result["side"] = self.side
        if self.actual_port_id is not None:
            result["actualPortId"] = self.actual_port_id
        return result


@dataclasses.dataclass
class NodeState:
    """One node in a frontend graph payload.

    Args:
        id: Frontend node identifier.
        node_type_id: Brick catalog id referenced by this node.
        port_configuration: Slot-to-port assignments for this node.
        custom_config_text: Inline JSON configuration for user-defined nodes.
        period_number: Period label value for period-tool nodes.
    """

    id: int
    node_type_id: str
    port_configuration: list[PortConfigEntry]
    custom_config_text: str
    period_number: str | None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> NodeState:
        """Parse one node state from a raw frontend dict.

        Args:
            data: Raw node state dict from the frontend payload.

        Returns:
            Parsed node state.
        """

        period_raw = data.get("periodNumber")
        return cls(
            id=int(data["id"]),
            node_type_id=str(
                data.get("nodeTypeId") or data.get("brickId") or ""
            ),
            port_configuration=[
                PortConfigEntry.from_dict(p)
                for p in (data.get("portConfiguration") or [])
            ],
            custom_config_text=str(data.get("customConfigText") or ""),
            period_number=str(period_raw) if period_raw is not None else None,
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize this node state back to a frontend-compatible dict."""

        result: dict[str, Any] = {
            "id": self.id,
            "nodeTypeId": self.node_type_id,
            "portConfiguration": [p.to_dict() for p in self.port_configuration],
            "customConfigText": self.custom_config_text,
        }
        if self.period_number is not None:
            result["periodNumber"] = self.period_number
        return result


@dataclasses.dataclass
class EdgeState:
    """One edge in a frontend graph payload.

    Args:
        id: Frontend edge identifier.
        start_node_id: Source node frontend id.
        start_slot_id: Source port slot id on the start node.
        end_node_id: Target node frontend id.
        end_slot_id: Target port slot id on the end node.
        bond_type: Optional RDKit bond type name (e.g. ``"SINGLE"``).
    """

    id: int
    start_node_id: int
    start_slot_id: int
    end_node_id: int
    end_slot_id: int
    bond_type: str | None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EdgeState:
        """Parse one edge state from a raw frontend dict.

        The frontend may send either a flat shape (``startNode``, ``startPort``,
        ``endNode``, ``endPort``) or a nested shape (``from.nodeId``,
        ``from.slotId``, ``to.nodeId``, ``to.slotId``).

        Args:
            data: Raw edge state dict from the frontend payload.

        Returns:
            Parsed edge state.

        Raises:
            ValueError: If a required edge endpoint field is absent.
        """

        def _read(direct_key: str, nested_key: str, value_key: str) -> Any:
            if direct_key in data:
                return data[direct_key]
            nested = data.get(nested_key)
            if isinstance(nested, dict) and value_key in nested:
                return nested[value_key]
            raise ValueError(f"Edge state is missing {direct_key}.")

        bond_type_raw = data.get("bondType", data.get("bond_type"))
        return cls(
            id=int(data.get("id", 0)),
            start_node_id=int(_read("startNode", "from", "nodeId")),
            start_slot_id=int(_read("startPort", "from", "slotId")),
            end_node_id=int(_read("endNode", "to", "nodeId")),
            end_slot_id=int(_read("endPort", "to", "slotId")),
            bond_type=str(bond_type_raw).upper() if bond_type_raw is not None else None,
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize this edge state back to a frontend-compatible dict."""

        result: dict[str, Any] = {
            "id": self.id,
            "startNode": self.start_node_id,
            "startPort": self.start_slot_id,
            "endNode": self.end_node_id,
            "endPort": self.end_slot_id,
        }
        if self.bond_type is not None:
            result["bondType"] = self.bond_type
        return result


@dataclasses.dataclass
class GraphPayload:
    """Typed container for a complete frontend graph state payload.

    Wraps the JSON body sent by the frontend to ``/render`` and ``/smiles``
    endpoints, providing validated, consistently-typed access to nodes and
    edges rather than raw ``dict[str, Any]`` manipulation.

    Args:
        nodes: Parsed node states in the graph.
        edges: Parsed edge states in the graph.
    """

    nodes: list[NodeState]
    edges: list[EdgeState]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> GraphPayload:
        """Parse a complete graph payload from a raw frontend dict.

        Args:
            data: Raw JSON-decoded request body.

        Returns:
            Validated graph payload container.

        Raises:
            ValueError: If the required ``nodes`` or ``edges`` lists are absent.
        """

        node_list = data.get("nodes")
        edge_list = data.get("edges")
        if not isinstance(node_list, list) or not isinstance(edge_list, list):
            raise ValueError("State payload must include node and edge lists.")

        return cls(
            nodes=[NodeState.from_dict(n) for n in node_list],
            edges=[EdgeState.from_dict(e) for e in edge_list],
        )

    def to_raw(self) -> dict[str, Any]:
        """Serialize this payload back to a frontend-compatible raw dict."""

        return {
            "nodes": [n.to_dict() for n in self.nodes],
            "edges": [e.to_dict() for e in self.edges],
        }
