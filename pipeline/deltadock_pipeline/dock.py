"""AutoDock Vina runner + result parsing.

Vina output (default) looks like:

    -----+------------+----------+----------
     mode |   affinity | dist from best mode
          | (kcal/mol) | rmsd l.b.| rmsd u.b.
    -----+------------+----------+----------
       1       -10.51      0.000      0.000
       2        -9.87      1.245      3.418
       ...

We parse this and return the best (lowest, most negative) affinity along with all modes.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)


class DockError(RuntimeError):
    pass


@dataclass
class PocketBox:
    """Vina search-box specification (centre + size in Å)."""

    center_x: float
    center_y: float
    center_z: float
    size_x: float = 22.0
    size_y: float = 22.0
    size_z: float = 22.0


@dataclass
class DockingMode:
    rank: int
    affinity_kcal_mol: float
    rmsd_lb: float
    rmsd_ub: float


@dataclass
class DockingResult:
    """Outcome of one docking run."""

    receptor_pdbqt: Path
    ligand_pdbqt: Path
    pose_pdbqt: Path
    log_path: Path
    modes: list[DockingMode] = field(default_factory=list)

    @property
    def best_score(self) -> float:
        """Lowest affinity in kcal/mol (most negative = strongest binding)."""
        if not self.modes:
            raise DockError("No docking modes parsed — Vina probably failed")
        return min(m.affinity_kcal_mol for m in self.modes)


_AFFINITY_LINE = re.compile(
    r"^\s*(\d+)\s+(-?\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s*$"
)


def parse_vina_log(log_text: str) -> list[DockingMode]:
    """Pull all mode rows out of a Vina stdout/log."""
    modes: list[DockingMode] = []
    for line in log_text.splitlines():
        m = _AFFINITY_LINE.match(line)
        if m:
            modes.append(
                DockingMode(
                    rank=int(m.group(1)),
                    affinity_kcal_mol=float(m.group(2)),
                    rmsd_lb=float(m.group(3)),
                    rmsd_ub=float(m.group(4)),
                )
            )
    return modes


def dock_one(
    receptor_pdbqt: Path | str,
    ligand_pdbqt: Path | str,
    box: PocketBox,
    work_dir: Path | str,
    *,
    exhaustiveness: int = 8,
    num_modes: int = 9,
    seed: int = 42,
    vina_path: str = "vina",
) -> DockingResult:
    """Run AutoDock Vina once.

    Args:
        receptor_pdbqt, ligand_pdbqt: prepped inputs from `prep.py`.
        box: search-box centre + size.
        work_dir: scratch directory; pose + log files written here.
        exhaustiveness: Vina parameter (8 = default, 32 for production).
        num_modes: how many top poses to retain.
        seed: Vina RNG seed for reproducibility.
        vina_path: path to the vina binary (override via VINA_PATH env in backend).

    Returns:
        DockingResult with parsed modes and pose file paths.
    """
    receptor_pdbqt = Path(receptor_pdbqt)
    ligand_pdbqt = Path(ligand_pdbqt)
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    if not receptor_pdbqt.exists():
        raise DockError(f"Receptor PDBQT not found: {receptor_pdbqt}")
    if not ligand_pdbqt.exists():
        raise DockError(f"Ligand PDBQT not found: {ligand_pdbqt}")
    if not shutil.which(vina_path):
        raise DockError(f"Vina binary not found at {vina_path!r} — install or set VINA_PATH")

    pose_path = work_dir / f"{ligand_pdbqt.stem}_dock.pdbqt"
    log_path = work_dir / f"{ligand_pdbqt.stem}_dock.log"

    cmd = [
        vina_path,
        "--receptor", str(receptor_pdbqt),
        "--ligand", str(ligand_pdbqt),
        "--center_x", str(box.center_x),
        "--center_y", str(box.center_y),
        "--center_z", str(box.center_z),
        "--size_x", str(box.size_x),
        "--size_y", str(box.size_y),
        "--size_z", str(box.size_z),
        "--exhaustiveness", str(exhaustiveness),
        "--num_modes", str(num_modes),
        "--seed", str(seed),
        "--out", str(pose_path),
    ]

    log.info("Running Vina: %s vs %s", receptor_pdbqt.name, ligand_pdbqt.name)
    res = subprocess.run(cmd, capture_output=True, text=True, check=False)
    log_path.write_text(res.stdout + "\n" + res.stderr)

    if res.returncode != 0:
        raise DockError(
            f"Vina exited {res.returncode} for {ligand_pdbqt.name}:\n"
            f"{res.stderr.strip() or res.stdout.strip()}"
        )

    modes = parse_vina_log(res.stdout)
    if not modes:
        raise DockError(f"Vina ran but no modes parsed. Log:\n{res.stdout}")

    return DockingResult(
        receptor_pdbqt=receptor_pdbqt,
        ligand_pdbqt=ligand_pdbqt,
        pose_pdbqt=pose_path,
        log_path=log_path,
        modes=modes,
    )
