"""Focused tests for brick graph parsing and assembly."""

from pathlib import Path

from rdkit import Chem

from brickene.core.network import BrickGraph as BrickNetwork
from brickene.core.node import BrickGraph, BrickNode, BrickType


def canonical_smiles(smiles: str) -> str:
    """Canonicalize a SMILES string for stable comparisons."""

    mol = Chem.MolFromSmiles(smiles)
    assert mol is not None
    return Chem.MolToSmiles(mol)


def test_brick_graph_from_smiles_extracts_atoms_ports_and_edges() -> None:
    """A brick graph should expose ports and molecular connectivity."""

    graph = BrickGraph.from_smiles("[*:1]CC([*:2])O")

    assert sorted(port.index for port in graph.ports) == [1, 2]
    assert len(graph.atoms) == 3
    assert len(graph.nodes) == 5
    assert len(graph.edges) == 4


def test_brick_node_config_round_trip(tmp_path: Path) -> None:
    """A brick node should survive save/load configuration round-trips."""

    node = BrickNode.from_smiles(
        "[*:1]CC([*:2])O",
        brick_type=BrickType.SIDE_CHAIN,
    )
    config_path = tmp_path / "brick-node.json"

    node.save_config(config_path)
    restored = BrickNode.load_config(config_path)

    assert restored.brick_type is BrickType.SIDE_CHAIN
    assert len(restored.nodes) == 5
    assert len(restored.atoms) == 3
    assert sorted(port.index for port in restored.ports) == [1, 2]
    assert canonical_smiles(restored.to_smiles()) == canonical_smiles(node.to_smiles())


def test_network_to_smiles_connects_ports() -> None:
    """A network edge should connect the requested brick ports."""

    left_node = BrickNode.from_smiles("[*:1]C")
    right_node = BrickNode.from_smiles("C[*:1]")
    network = BrickNetwork()

    network.add_node(left_node)
    network.add_node(right_node)
    network.add_edge(left_node, right_node, left_port=1, right_port=1)

    assert canonical_smiles(network.to_smiles()) == canonical_smiles("CC")
