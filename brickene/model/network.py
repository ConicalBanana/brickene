"""Graph utilities for connecting multiple bricks into a molecule."""

from __future__ import annotations

from typing import Any

import networkx as nx
from rdkit import Chem

from brickene.model.brick import BrickNode, Port


class BrickGraph(nx.Graph):
    """Contain a network of ``BrickNode`` instances.

    Edges may carry port metadata via ``left_port`` and ``right_port`` arguments
    when calling ``add_edge``. Those values identify which mapped dummy atoms
    should be connected when exporting the network to SMILES.
    """

    def add_edge(self, u_of_edge: BrickNode, v_of_edge: BrickNode, **attr: Any) -> None:
        """Add an edge between two bricks.

        Args:
            u_of_edge: Left brick node.
            v_of_edge: Right brick node.
            **attr: Optional edge attributes. ``left_port`` and ``right_port``
                are normalized into a node-id keyed ``ports`` mapping.
        """

        left_port = attr.pop("left_port", attr.pop("port_u", None))
        right_port = attr.pop("right_port", attr.pop("port_v", None))

        if left_port is not None or right_port is not None:
            if left_port is None or right_port is None:
                raise ValueError("Both left_port and right_port must be provided.")

            attr["ports"] = {
                id(u_of_edge): self._coerce_port_index(left_port),
                id(v_of_edge): self._coerce_port_index(right_port),
            }

        super().add_edge(u_of_edge, v_of_edge, **attr)

    def to_smiles(self) -> str:
        """Convert the brick graph into a SMILES string.

        Returns:
            SMILES representation of the assembled network.

        Raises:
            ValueError: If an edge references missing port metadata or an
                invalid port within a brick.
        """

        if self.number_of_nodes() == 0:
            return ""

        component_lookup: dict[int, int] = {}
        combined_mol: Chem.Mol | None = None

        for component_index, node in enumerate(self.nodes):
            component_lookup[id(node)] = component_index
            component_mol = self._prepare_component_mol(node, component_index)
            combined_mol = (
                component_mol
                if combined_mol is None
                else Chem.CombineMols(combined_mol, component_mol)
            )

        assert combined_mol is not None
        rw_mol = Chem.RWMol(combined_mol)

        for left_node, right_node, edge_data in self.edges(data=True):
            port_map = self._resolve_edge_ports(left_node, right_node, edge_data)
            left_port_atom = self._find_port_atom(
                rw_mol,
                component_lookup[id(left_node)],
                port_map[id(left_node)],
            )
            right_port_atom = self._find_port_atom(
                rw_mol,
                component_lookup[id(right_node)],
                port_map[id(right_node)],
            )

            left_neighbor_idx = self._single_neighbor_index(left_port_atom)
            right_neighbor_idx = self._single_neighbor_index(right_port_atom)
            bond_type = self._coerce_bond_type(edge_data.get("bond_type"))
            rw_mol.AddBond(left_neighbor_idx, right_neighbor_idx, order=bond_type)

            remove_indices = sorted(
                [left_port_atom.GetIdx(), right_port_atom.GetIdx()], reverse=True
            )
            for atom_index in remove_indices:
                rw_mol.RemoveAtom(atom_index)

        mol = rw_mol.GetMol()
        Chem.SanitizeMol(mol)
        return Chem.MolToSmiles(mol)

    @staticmethod
    def _coerce_port_index(port: int | Port) -> int:
        """Normalize a port object or integer into an integer index."""

        return port.index if isinstance(port, Port) else int(port)

    @staticmethod
    def _coerce_bond_type(bond_type: Any) -> Chem.BondType:
        """Normalize a bond type attribute for RDKit."""

        if bond_type is None:
            return Chem.BondType.SINGLE
        if isinstance(bond_type, Chem.BondType):
            return bond_type
        if isinstance(bond_type, str):
            return getattr(Chem.BondType, bond_type.upper())
        raise TypeError(f"Unsupported bond type: {bond_type!r}")

    @staticmethod
    def _prepare_component_mol(node: BrickNode, component_index: int) -> Chem.Mol:
        """Create a labeled RDKit molecule for a brick node."""

        mol = Chem.MolFromSmiles(node.to_smiles())
        if mol is None:
            raise ValueError("Brick node contains an invalid SMILES definition.")

        for atom in mol.GetAtoms():
            if atom.GetAtomicNum() != 0:
                continue

            port_index = atom.GetAtomMapNum()
            if port_index <= 0:
                raise ValueError(
                    "All ports in a brick network must use positive atom-map numbers."
                )

            atom.SetProp("brick_component", str(component_index))
            atom.SetProp("brick_port_index", str(port_index))

        return mol

    @staticmethod
    def _resolve_edge_ports(
        left_node: BrickNode,
        right_node: BrickNode,
        edge_data: dict[str, Any],
    ) -> dict[int, int]:
        """Resolve port metadata for an edge."""

        ports = edge_data.get("ports")
        if not isinstance(ports, dict):
            raise ValueError(
                "Each network edge must define left_port/right_port or a ports mapping."
            )

        try:
            return {
                id(left_node): int(ports[id(left_node)]),
                id(right_node): int(ports[id(right_node)]),
            }
        except KeyError as exc:
            raise ValueError(
                "Edge port metadata does not match its endpoint nodes."
            ) from exc

    @staticmethod
    def _find_port_atom(
        mol: Chem.RWMol,
        component_index: int,
        port_index: int,
    ) -> Chem.Atom:
        """Find the current dummy atom for a specific component port."""

        for atom in mol.GetAtoms():
            if atom.GetAtomicNum() != 0:
                continue
            if not (
                atom.HasProp("brick_component")
                and atom.HasProp("brick_port_index")
            ):
                continue
            if atom.GetProp("brick_component") != str(component_index):
                continue
            if atom.GetProp("brick_port_index") != str(port_index):
                continue
            return atom

        raise ValueError(
            f"Port {port_index} was not found in component {component_index}."
        )

    @staticmethod
    def _single_neighbor_index(atom: Chem.Atom) -> int:
        """Return the single bonded neighbor index for a port atom."""

        neighbors = list(atom.GetNeighbors())
        if len(neighbors) != 1:
            raise ValueError("Ports must have exactly one neighboring atom.")
        return neighbors[0].GetIdx()
