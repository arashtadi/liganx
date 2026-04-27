"""Standalone smoke-test for the validation pipeline."""
import sys, logging, tempfile
sys.path.insert(0, "../pipeline")
logging.basicConfig(level=logging.WARNING)
from pathlib import Path
from deltadock_pipeline.prep import prepare_ligand
from deltadock_pipeline.dock import dock_one, PocketBox
from deltadock_pipeline.validate import validate_pose

receptor_pdbqt = Path.home() / ".deltadock" / "receptors" / "2ITY_A_WT.pdbqt"
receptor_pdb   = Path.home() / ".deltadock" / "pdb" / "2ITY_A.clean.pdb"

with tempfile.TemporaryDirectory() as work_str:
    work = Path(work_str)
    smi = "COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1"
    lig = prepare_ligand(smi, work / "gef.pdbqt", name="gefitinib")
    box = PocketBox(center_x=-50.5, center_y=-0.7, center_z=-21.6)
    result = dock_one(receptor_pdbqt, lig, box, work, exhaustiveness=4)
    print(f"Vina:        {result.best_score:.2f} kcal/mol")

    v = validate_pose(receptor_pdbqt, result.pose_pdbqt,
                       receptor_pdb=receptor_pdb, work_dir=work)
    print(f"confidence:  {v.confidence}")
    print(f"posebusters: {v.bust_summary} ({v.bust_passed} passed, {v.bust_failed} failed)")
    print(f"contacts:    {len(v.interactions)}")
    for c in v.interactions[:10]:
        print(f"   {c['residue']:>10s}  {c['type']}")
    print(f"sentence:    {v.sentence}")
    if v.error:
        print(f"error:       {v.error}")
