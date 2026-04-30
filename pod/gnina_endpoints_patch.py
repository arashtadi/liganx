

# ── GNINA endpoints (Vina fork with CNN rescoring) ──────────────────────
#
# GNINA is a Vina derivative (Koes lab, Pittsburgh) that adds a CNN-based
# pose-rescoring head trained on PDBbind. It accepts the same PDBQT
# receptor + PDBQT ligand + box inputs as Vina, runs on the same NVIDIA
# GPU, and returns both a Vina-style affinity (kcal/mol) AND a 0-1 CNN
# confidence score.
#
# These endpoints sit alongside the existing /dock and /dock_batch
# QuickVina2-GPU routes — same input shapes, different binary, different
# scoring head. The runner picks one or the other based on the user's
# engine choice on NewJobPage.
#
# Why same-shape inputs/outputs: keeps the runner.py dispatch logic
# trivial (just swap the URL path) and lets us run engine A/B tests
# without any data-model changes.

import shutil as _shutil_gnina

GNINA_BIN = _shutil_gnina.which("gnina") or "/usr/local/bin/gnina"


class GninaDockRequest(BaseModel):
    receptor_pdbqt_b64: str
    ligand_pdbqt_b64: str
    box: Box
    exhaustiveness: int = 8
    num_modes: int = 9
    seed: int = 42
    # CNN scoring mode. "rescore" runs Vina docking then CNN-rescores
    # the top poses (fast, ~2x QuickVina time). "refine" also re-docks
    # using CNN gradients (slower, more accurate). Default to rescore
    # since users will typically be doing matrix screens where speed
    # matters more than the marginal pose-refinement gain.
    cnn_mode: str = "rescore"   # one of: "rescore", "refine", "none"


@app.post("/dock_gnina")
def dock_gnina(req: GninaDockRequest) -> dict:
    """Single-ligand docking via GNINA.

    Response shape mirrors /dock (the QuickVina2-GPU endpoint) so the
    runner dispatch is symmetric:

        {
          "pose_pdbqt_b64": "...",
          "modes": [
            {"rank": 1, "affinity_kcal_mol": -8.4, "cnn_score": 0.71, "cnn_affinity": -7.9},
            ...
          ],
          "engine": "GNINA-1.3",
          "log": "...stdout tail..."
        }

    The CNN columns (cnn_score, cnn_affinity) are unique to GNINA and
    are what the user is paying for compared to vanilla Vina — they're
    the trained-on-PDBbind ranking signal.
    """
    try:
        receptor_bytes = base64.b64decode(req.receptor_pdbqt_b64)
        ligand_bytes = base64.b64decode(req.ligand_pdbqt_b64)
    except Exception as e:
        raise HTTPException(400, f"base64 decode failed: {e}")

    if req.cnn_mode not in {"rescore", "refine", "none"}:
        raise HTTPException(400, f"cnn_mode must be rescore|refine|none, got {req.cnn_mode!r}")

    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        receptor = work / "receptor.pdbqt"
        ligand = work / "ligand.pdbqt"
        out_pose = work / "pose.pdbqt"
        receptor.write_bytes(receptor_bytes)
        ligand.write_bytes(ligand_bytes)

        cmd = [
            GNINA_BIN,
            "--receptor", str(receptor),
            "--ligand", str(ligand),
            "--out", str(out_pose),
            "--center_x", str(req.box.center_x),
            "--center_y", str(req.box.center_y),
            "--center_z", str(req.box.center_z),
            "--size_x", str(req.box.size_x),
            "--size_y", str(req.box.size_y),
            "--size_z", str(req.box.size_z),
            "--seed", str(req.seed),
            "--num_modes", str(req.num_modes),
            "--exhaustiveness", str(req.exhaustiveness),
            "--cnn_scoring", req.cnn_mode,
        ]
        log.info("gnina dispatch: %s ...", " ".join(cmd[:8]))

        # GNINA on a 4090 takes ~10-30s per ligand for cnn=rescore,
        # 30-90s for cnn=refine. Wallclock budget similar to Vina with
        # a generous ceiling.
        timeout = 180 if req.cnn_mode == "refine" else 90
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise HTTPException(504, f"gnina exceeded {timeout}s")

        if res.returncode != 0:
            tail = (res.stderr or res.stdout or "").strip()[-600:]
            raise HTTPException(500, f"gnina rc={res.returncode}: {tail}")

        if not out_pose.exists() or out_pose.stat().st_size == 0:
            raise HTTPException(500, "gnina wrote no pose file")

        # GNINA writes its REMARK lines slightly differently from Vina:
        #   REMARK minimizedAffinity -8.42
        #   REMARK CNNscore 0.7128
        #   REMARK CNNaffinity 7.9123
        # We parse all three so the runner can record them. CNNscore is
        # the headline 0-1 confidence; CNNaffinity is the CNN's pK_d
        # estimate (positive = stronger binder, opposite sign from Vina).
        pose_text = out_pose.read_text()
        modes: list[dict] = []
        current: dict = {}
        for line in pose_text.splitlines():
            if line.startswith("MODEL "):
                current = {"rank": len(modes) + 1}
            elif line.startswith("REMARK minimizedAffinity"):
                try:
                    current["affinity_kcal_mol"] = float(line.split()[-1])
                except (ValueError, IndexError):
                    pass
            elif line.startswith("REMARK CNNscore"):
                try:
                    current["cnn_score"] = float(line.split()[-1])
                except (ValueError, IndexError):
                    pass
            elif line.startswith("REMARK CNNaffinity"):
                try:
                    current["cnn_affinity"] = float(line.split()[-1])
                except (ValueError, IndexError):
                    pass
            elif line.startswith("ENDMDL"):
                if "affinity_kcal_mol" in current:
                    modes.append(current)
                current = {}
        # Some GNINA builds emit a single pose without MODEL/ENDMDL framing —
        # handle that by treating any leftover `current` as the only mode.
        if current and "affinity_kcal_mol" in current and not modes:
            current["rank"] = 1
            modes.append(current)

        if not modes:
            raise HTTPException(500, "gnina produced no parseable modes")

        return {
            "pose_pdbqt_b64": base64.b64encode(out_pose.read_bytes()).decode("ascii"),
            "modes": modes,
            "engine": "GNINA-1.3",
            "log": (res.stdout or "")[-1000:],
        }


class GninaBatchRequest(BaseModel):
    receptor_pdbqt_b64: str
    box: Box
    ligands: list[LigandIn]
    exhaustiveness: int = 8
    num_modes: int = 9
    seed: int = 42
    cnn_mode: str = "rescore"


@app.post("/dock_batch_gnina")
def dock_batch_gnina(req: GninaBatchRequest) -> dict:
    """Batched GNINA — N ligands against one receptor.

    GNINA doesn't have a native ligand-directory mode like QuickVina2-GPU,
    so this is sequential per-ligand under the hood. The win compared to
    N separate /dock_gnina calls is purely network — one HTTP round-trip,
    one receptor decode. The GPU still sees one ligand at a time.
    """
    if not req.ligands:
        raise HTTPException(400, "no ligands provided")
    if len(req.ligands) > 50:
        # Lower cap than QuickVina batch (200) because GNINA is sequential
        # internally — we don't want a single batch to monopolise the GPU
        # for >20 minutes.
        raise HTTPException(400, "max 50 ligands per gnina batch")
    if req.cnn_mode not in {"rescore", "refine", "none"}:
        raise HTTPException(400, f"cnn_mode must be rescore|refine|none, got {req.cnn_mode!r}")

    try:
        receptor_bytes = base64.b64decode(req.receptor_pdbqt_b64)
    except Exception as e:
        raise HTTPException(400, f"receptor base64 decode failed: {e}")

    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        receptor = work / "receptor.pdbqt"
        receptor.write_bytes(receptor_bytes)
        results: list[dict] = []

        per_ligand_timeout = 120 if req.cnn_mode == "refine" else 60

        for lig in req.ligands:
            try:
                ligand_bytes = base64.b64decode(lig.pdbqt_b64)
            except Exception as e:
                results.append({"id": lig.id, "error": f"base64 decode: {e}"})
                continue

            safe = _safe_id(lig.id)
            ligand = work / f"{safe}.pdbqt"
            out_pose = work / f"{safe}_out.pdbqt"
            ligand.write_bytes(ligand_bytes)

            cmd = [
                GNINA_BIN,
                "--receptor", str(receptor),
                "--ligand", str(ligand),
                "--out", str(out_pose),
                "--center_x", str(req.box.center_x),
                "--center_y", str(req.box.center_y),
                "--center_z", str(req.box.center_z),
                "--size_x", str(req.box.size_x),
                "--size_y", str(req.box.size_y),
                "--size_z", str(req.box.size_z),
                "--seed", str(req.seed),
                "--num_modes", str(req.num_modes),
                "--exhaustiveness", str(req.exhaustiveness),
                "--cnn_scoring", req.cnn_mode,
            ]

            try:
                res = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=per_ligand_timeout,
                )
            except subprocess.TimeoutExpired:
                results.append({"id": lig.id, "error": f"timeout after {per_ligand_timeout}s"})
                continue

            if res.returncode != 0:
                tail = (res.stderr or res.stdout or "").strip()[-300:]
                results.append({"id": lig.id, "error": f"rc={res.returncode}: {tail}"})
                continue
            if not out_pose.exists() or out_pose.stat().st_size == 0:
                results.append({"id": lig.id, "error": "no pose file"})
                continue

            # Same parser as the single endpoint — duplicated rather than
            # factored out because the patch file is appended verbatim
            # and we don't want to assume helper functions exist in the
            # parent dock_server.py's scope.
            pose_text = out_pose.read_text()
            modes: list[dict] = []
            current: dict = {}
            for line in pose_text.splitlines():
                if line.startswith("MODEL "):
                    current = {"rank": len(modes) + 1}
                elif line.startswith("REMARK minimizedAffinity"):
                    try: current["affinity_kcal_mol"] = float(line.split()[-1])
                    except (ValueError, IndexError): pass
                elif line.startswith("REMARK CNNscore"):
                    try: current["cnn_score"] = float(line.split()[-1])
                    except (ValueError, IndexError): pass
                elif line.startswith("REMARK CNNaffinity"):
                    try: current["cnn_affinity"] = float(line.split()[-1])
                    except (ValueError, IndexError): pass
                elif line.startswith("ENDMDL"):
                    if "affinity_kcal_mol" in current: modes.append(current)
                    current = {}
            if current and "affinity_kcal_mol" in current and not modes:
                current["rank"] = 1
                modes.append(current)

            if not modes:
                results.append({"id": lig.id, "error": "no modes parsed"})
                continue
            results.append({
                "id": lig.id,
                "pose_pdbqt_b64": base64.b64encode(out_pose.read_bytes()).decode("ascii"),
                "modes": modes,
            })

        return {
            "results": results,
            "engine": "GNINA-1.3",
            "ligands_total": len(req.ligands),
            "ligands_succeeded": sum(1 for r in results if "pose_pdbqt_b64" in r),
        }
