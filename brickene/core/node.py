"""Node and brick definitions for the molecular assembly graph."""

from __future__ import annotations

import dataclasses
import enum
import json
from pathlib import Path
from typing import Any

from rdkit import Chem


class BrickType(enum.Enum):
    """Enumerate supported brick categories."""

    SKELETON = 0
    SIDE_CHAIN = 1
    SUBSTITUENT = 2
    BRIDGE = 3


@dataclasses.dataclass(frozen=True)
class Site:
    """Base class for connection sites inside a brick graph.

    Args:
        index: Unique site index within the brick graph.
    """

    index: int


@dataclasses.dataclass(frozen=True)
class Port(Site):
    """Represent a connection port inside a brick graph.

    Args:
        index: Port index derived from the mapped dummy atom in SMILES.
        preferred_brick_type: Preferred brick type to attach at this port.
    """

    preferred_brick_type: BrickType | None = None


@dataclasses.dataclass(frozen=True)
class Atom(Site):
    """Represent an atom inside a brick graph.

    Args:
        index: Unique atom index within the brick graph.
        symbol: Atomic symbol.
    """

    symbol: str


@dataclasses.dataclass
class BrickGraph:
    """Contain the atom-and-port graph that defines a single brick.

    Args:
        nodes: Sites contained in the graph.
        edges: Undirected edges between sites.
        smiles: Optional SMILES representation for round-tripping.
    """

    nodes: list[Site] = dataclasses.field(default_factory=list)
    edges: list[tuple[Site, Site]] = dataclasses.field(default_factory=list)

    @property
    def ports(self) -> list[Port]:
        """Return all connection ports in the graph."""

        return [node for node in self.nodes if isinstance(node, Port)]

    @property
    def atoms(self) -> list[Atom]:
        """Return all atoms in the graph."""

        return [node for node in self.nodes if isinstance(node, Atom)]

    @classmethod
    def from_smiles(cls, smiles: str) -> BrickGraph:
        """Build a brick graph from a SMILES string.

        Mapped dummy atoms such as ``[*:1]`` are converted into ``Port``
        instances, while all other atoms become ``Atom`` instances.

        Args:
            smiles: SMILES representation of the brick.

        Returns:
            Parsed brick graph.

        Raises:
            ValueError: If the SMILES string cannot be parsed.
        """

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            raise ValueError(f"Invalid SMILES string: {smiles}")

        port_indices = [
            atom.GetAtomMapNum()
            for atom in mol.GetAtoms()
            if atom.GetAtomicNum() == 0 and atom.GetAtomMapNum() > 0
        ]
        next_port_index = max(port_indices, default=0) + 1
        next_atom_index = max(port_indices, default=0) + 1

        graph = cls()
        atom_idx_to_site: dict[int, Site] = {}

        for atom in mol.GetAtoms():
            if atom.GetAtomicNum() == 0:
                port_index = atom.GetAtomMapNum()
                if port_index <= 0:
                    port_index = next_port_index
                    next_port_index += 1
                site: Site = Port(index=port_index)
            else:
                site = Atom(index=next_atom_index, symbol=atom.GetSymbol())
                next_atom_index += 1

            graph.nodes.append(site)
            atom_idx_to_site[atom.GetIdx()] = site

        for bond in mol.GetBonds():
            graph.edges.append(
                (
                    atom_idx_to_site[bond.GetBeginAtomIdx()],
                    atom_idx_to_site[bond.GetEndAtomIdx()],
                )
            )

        return graph

    def to_smiles(self) -> str:
        """Convert the graph into a SMILES string.

        Returns:
            SMILES representation of the graph.

        Raises:
            ValueError: If the graph contains an unsupported edge endpoint.
        """
        if not self.nodes:
            return ""

        mol = Chem.RWMol()
        site_to_atom_index: dict[int, int] = {}

        for site in self.nodes:
            if isinstance(site, Port):
                atom = Chem.Atom(0)
                atom.SetAtomMapNum(site.index)
            elif isinstance(site, Atom):
                atom = Chem.Atom(site.symbol)
            else:
                raise ValueError(f"Unsupported site type: {type(site)!r}")

            site_to_atom_index[site.index] = mol.AddAtom(atom)

        for left_site, right_site in self.edges:
            try:
                left_idx = site_to_atom_index[left_site.index]
                right_idx = site_to_atom_index[right_site.index]
            except KeyError as exc:
                raise ValueError(
                    "Edges must reference sites present in the graph."
                ) from exc

            if mol.GetBondBetweenAtoms(left_idx, right_idx) is None:
                mol.AddBond(left_idx, right_idx, Chem.BondType.SINGLE)

        return Chem.MolToSmiles(mol)

    def to_dict(self) -> dict[str, Any]:
        """Serialize the graph into a JSON-compatible dictionary."""

        return {
            "smiles": self.to_smiles(),
            "nodes": [self._site_to_dict(node) for node in self.nodes],
            "edges": [[left.index, right.index] for left, right in self.edges],
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> BrickGraph:
        """Rebuild a brick graph from serialized data.

        Args:
            payload: JSON-compatible serialized brick graph.

        Returns:
            Reconstructed brick graph.
        """

        nodes: list[Site] = []
        node_by_index: dict[int, Site] = {}

        for node_payload in payload.get("nodes", []):
            node = cls._site_from_dict(node_payload)
            nodes.append(node)
            node_by_index[node.index] = node

        edges = [
            (node_by_index[left_index], node_by_index[right_index])
            for left_index, right_index in payload.get("edges", [])
        ]

        return cls(nodes=nodes, edges=edges)

    @staticmethod
    def _site_to_dict(site: Site) -> dict[str, Any]:
        """Serialize a site into a JSON-compatible dictionary."""

        if isinstance(site, Port):
            return {
                "kind": "port",
                "index": site.index,
                "preferred_brick_type": (
                    site.preferred_brick_type.name
                    if site.preferred_brick_type is not None
                    else None
                ),
            }

        if isinstance(site, Atom):
            return {"kind": "atom", "index": site.index, "symbol": site.symbol}

        raise TypeError(f"Unsupported site type: {type(site)!r}")

    @staticmethod
    def _site_from_dict(payload: dict[str, Any]) -> Site:
        """Deserialize a site from a JSON-compatible dictionary."""

        kind = payload["kind"]
        if kind == "port":
            preferred_brick_type = payload.get("preferred_brick_type")
            return Port(
                index=payload["index"],
                preferred_brick_type=(
                    BrickType[preferred_brick_type]
                    if preferred_brick_type is not None
                    else None
                ),
            )

        if kind == "atom":
            return Atom(index=payload["index"], symbol=payload["symbol"])

        raise ValueError(f"Unsupported site kind: {kind}")


class BrickNode:
    """Represent a single brick and its internal site graph.

    Args:
        brick_type: Classification of the brick.
        bg: Internal graph describing atoms and ports.
    """

    def __init__(self, brick_type: BrickType, bg: BrickGraph | None = None):
        self.brick_type = brick_type
        self.bg = bg if bg is not None else BrickGraph()

    @property
    def nodes(self) -> list[Site]:
        """Expose the sites in the brick graph."""

        return self.bg.nodes

    @property
    def edges(self) -> list[tuple[Site, Site]]:
        """Expose the site edges in the brick graph."""

        return self.bg.edges

    @property
    def ports(self) -> list[Port]:
        """Expose the brick graph ports directly on the brick node."""

        return self.bg.ports

    @property
    def atoms(self) -> list[Atom]:
        """Expose the brick graph atoms directly on the brick node."""

        return self.bg.atoms

    @classmethod
    def from_smiles(
        cls,
        smiles: str,
        brick_type: BrickType = BrickType.SKELETON,
    ) -> BrickNode:
        """Build a brick node from a SMILES string.

        Args:
            smiles: SMILES representation of the brick.
            brick_type: Classification of the brick.

        Returns:
            Brick node initialized with a parsed internal graph.
        """

        return cls(brick_type=brick_type, bg=BrickGraph.from_smiles(smiles))

    @classmethod
    def load_config(cls, fp: Path) -> BrickNode:
        """Load a brick node from a JSON configuration file.

        Args:
            fp: Path to the JSON configuration file.

        Returns:
            Loaded brick node.
        """

        payload = json.loads(fp.read_text(encoding="utf-8"))
        return cls(
            brick_type=BrickType[payload["brick_type"]],
            bg=BrickGraph.from_dict(payload["graph"]),
        )

    def dump_config(self) -> str:
        """Serialize the brick node into a JSON string."""

        payload = {
            "brick_type": self.brick_type.name,
            "graph": self.bg.to_dict(),
        }
        return json.dumps(payload, indent=2, sort_keys=True)

    def to_smiles(self) -> str:
        """Convert the brick definition into a SMILES string."""

        return self.bg.to_smiles()

    def save_config(self, fp: Path) -> None:
        """Write the brick node configuration to disk.

        Args:
            fp: Output JSON path.
        """

        fp.write_text(self.dump_config(), encoding="utf-8")
