"""Focused tests for brick graph parsing and assembly."""

import json
from pathlib import Path

from rdkit import Chem

from brickene.model.brick import BrickNode, BrickType
from brickene.model.network import BrickGraph
from brickene.service.render_service import render_state_smiles


def canonical_smiles(smiles: str) -> str:
    """Canonicalize a SMILES string for stable comparisons."""

    mol = Chem.MolFromSmiles(smiles)
    assert mol is not None
    return Chem.MolToSmiles(mol)


def test_brick_node_from_smiles_extracts_atoms_ports_and_edges() -> None:
    """A brick node should expose ports and molecular connectivity."""

    node = BrickNode.from_smiles("[*:1]C=C([*:2])O")

    assert sorted(port.index for port in node.ports) == [1, 2]
    assert len(node.atoms) == 3
    assert len(node.nodes) == 5
    assert len(node.edges) == 4
    assert sum(edge.bond_type == "DOUBLE" for edge in node.edges) == 1


def test_brick_node_config_round_trip(tmp_path: Path) -> None:
    """A brick node should survive save/load configuration round-trips."""

    node = BrickNode.from_smiles(
        "[*:1]C=C([*:2])O",
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
    network = BrickGraph()

    network.add_node(left_node)
    network.add_node(right_node)
    network.add_edge(left_node, right_node, left_port=1, right_port=1)

    assert canonical_smiles(network.to_smiles()) == canonical_smiles("CC")


def test_brick_node_round_trip_preserves_charged_aromatic_atoms() -> None:
    """Charged aromatic bricks should survive a BrickNode SMILES round-trip."""

    raw_catalog = json.loads(
        Path("brickene/frontend/assets/raw_brick_smiles.json").read_text(
            encoding="utf-8"
        )
    )

    for brick_name in ["BN-Py", "Boron subphthalocyanines"]:
        source_smiles = raw_catalog[brick_name]["smiles"]
        node = BrickNode.from_smiles(source_smiles)

        assert canonical_smiles(node.to_smiles()) == canonical_smiles(source_smiles)


def test_render_state_smiles_supports_problematic_bricks() -> None:
    """The backend render path should support the previously failing bricks."""

    for brick_id in ["2", "6", "11"]:
        payload = {
            "nodes": [
                {
                    "id": 1,
                    "nodeTypeId": brick_id,
                    "portConfiguration": [],
                }
            ],
            "edges": [],
        }

        smiles = render_state_smiles(payload)

        assert smiles
        assert Chem.MolFromSmiles(smiles) is not None


def test_brick_node_round_trip_preserves_atom_map_numbers_on_atoms() -> None:
    """Atom-map numbers on non-dummy atoms should survive SMILES round-trips."""

    node = BrickNode.from_smiles("[*:1][W:7][*:2]", brick_type=BrickType.TOOL)

    assert "[W:7]" in node.to_smiles()
