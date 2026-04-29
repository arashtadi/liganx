

# ────────────────────────────────────────────────────────────────────────
# Batched docking — one HTTP call, one GPU init, N ligands.
#
# QuickVina2-GPU exposes --ligand_directory + --output_directory which
# loads the receptor once and processes every PDBQT in the directory in
# a single GPU session. That's the actual throughput multiplier vs. our
# old "one HTTP call per ligand" loop, which paid the GPU init + receptor
# load cost on every cell.
#
# Caller is expected to group same-receptor cells (one receptor + N
# ligands per request). The caller-supplied `id` is used as the filename
# stem in the scratch dir, so we sanitize it to a safe path component.
# ────────────────────────────────────────────────────────────────────────

import re as _re_batch
_ID_RE = _re_batch.compile(r"[^A-Za-z0-9_.-]")


def _safe_id(s: str) -> str:
    """Cap caller IDs to a safe 64-char filename stem.

    We pass these straight to QuickVina-GPU as ligand_directory entries,
    so anything path-traversal-y (slashes, dots, null bytes) becomes "_".
    """
    s = _ID_RE.sub("_", s)
    return (s or "_")[:64]


class LigandIn(BaseModel):
    id: str          # caller's identifier (compound_id, variant tag, etc.)
    pdbqt_b64: str


class BatchDockRequest(BaseModel):
    receptor_pdbqt_b64: str
    box: Box
    ligands: list[LigandIn]
    exhaustiveness: int = 8
    num_modes: int = 9
    seed: int = 42
    thread: int = 8000


@app.post("/dock_batch")
def dock_batch(req: BatchDockRequest) -> dict:
    """Run N ligands against one receptor in a single QuickVina-GPU call.

    Response shape:
        {
          "results": [
            {"id": "...", "pose_pdbqt_b64": "...", "modes": [...]},
            {"id": "...", "error": "..."},
            ...
          ],
          "engine": "QuickVina2-GPU-2.1",
          "log": "...stdout tail...",
          "ligands_total": N,
          "ligands_succeeded": M
        }

    Per-ligand failures don't fail the whole batch — they come back with
    `{"id": ..., "error": "..."}` and the caller decides whether to retry.
    """
    if not req.ligands:
        raise HTTPException(400, "no ligands provided")
    if len(req.ligands) > 200:
        raise HTTPException(400, "max 200 ligands per batch")
    try:
        receptor_bytes = base64.b64decode(req.receptor_pdbqt_b64)
    except Exception as e:
        raise HTTPException(400, f"receptor base64 decode failed: {e}")

    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        receptor = work / "receptor.pdbqt"
        receptor.write_bytes(receptor_bytes)
        in_dir = work / "in"
        out_dir = work / "out"
        in_dir.mkdir()
        out_dir.mkdir()

        # Map sanitized stem → caller's original id so we can return
        # results keyed by what the caller sent, even if sanitization
        # rewrote characters or de-duplicated collisions.
        id_map: dict[str, str] = {}
        for lig in req.ligands:
            safe = _safe_id(lig.id)
            base_safe = safe
            n = 1
            while safe in id_map:
                safe = f"{base_safe}_{n}"
                n += 1
            id_map[safe] = lig.id
            try:
                (in_dir / f"{safe}.pdbqt").write_bytes(base64.b64decode(lig.pdbqt_b64))
            except Exception as e:
                raise HTTPException(400, f"ligand {lig.id!r} base64 decode failed: {e}")

        cmd = [
            str(VINA_BIN),
            "--receptor", str(receptor),
            "--ligand_directory", str(in_dir),
            "--output_directory", str(out_dir),
            "--center_x", str(req.box.center_x),
            "--center_y", str(req.box.center_y),
            "--center_z", str(req.box.center_z),
            "--size_x", str(req.box.size_x),
            "--size_y", str(req.box.size_y),
            "--size_z", str(req.box.size_z),
            "--seed", str(req.seed),
            "--num_modes", str(req.num_modes),
            "--thread", str(req.thread),
            "--opencl_binary_path", str(VINA_DIR),
        ]
        log.info("batch dispatch: %d ligands · %s ...", len(req.ligands), " ".join(cmd[:6]))

        # QuickVina-GPU does ~3-4s per ligand once the GPU is warm; the
        # first ligand pays the OpenCL init cost (~5-10s). Add headroom
        # for slow batches and prep variance.
        timeout = max(300, 30 + 6 * len(req.ligands))
        try:
            res = subprocess.run(
                cmd, cwd=str(VINA_DIR), capture_output=True, text=True, timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(504, f"QuickVina2-GPU batch exceeded {timeout}s")

        if res.returncode != 0:
            tail = (res.stderr or res.stdout or "").strip()[-600:]
            raise HTTPException(500, f"vina-gpu batch rc={res.returncode}: {tail}")

        # QuickVina-GPU writes one output PDBQT per input. The output
        # naming convention varies by version: some emit `{stem}_out.pdbqt`,
        # others preserve `{stem}.pdbqt` in the output dir. Try both.
        results: list[dict] = []
        for safe, orig_id in id_map.items():
            candidates = [
                out_dir / f"{safe}_out.pdbqt",
                out_dir / f"{safe}.pdbqt",
            ]
            pose_path = next((p for p in candidates if p.exists() and p.stat().st_size > 0), None)
            if pose_path is None:
                results.append({"id": orig_id, "error": "no pose written"})
                continue

            # Parse modes from the pose file's own REMARK VINA RESULT
            # lines, NOT from stdout (stdout interleaves all ligands and
            # is hard to reattribute reliably).
            try:
                pose_text = pose_path.read_text()
            except Exception as e:
                results.append({"id": orig_id, "error": f"read pose: {e}"})
                continue
            modes: list[dict] = []
            for line in pose_text.splitlines():
                if line.startswith("REMARK VINA RESULT"):
                    parts = line.split()
                    if len(parts) >= 6:
                        try:
                            modes.append({
                                "rank": len(modes) + 1,
                                "affinity_kcal_mol": float(parts[3]),
                                "rmsd_lb": float(parts[4]),
                                "rmsd_ub": float(parts[5]),
                            })
                        except ValueError:
                            pass
            if not modes:
                results.append({
                    "id": orig_id,
                    "error": "no modes parsed",
                    "raw_excerpt": pose_text[:200],
                })
                continue
            results.append({
                "id": orig_id,
                "pose_pdbqt_b64": base64.b64encode(pose_path.read_bytes()).decode("ascii"),
                "modes": modes,
            })

        return {
            "results": results,
            "engine": ENGINE_NAME,
            "log": res.stdout[-2000:],
            "ligands_total": len(req.ligands),
            "ligands_succeeded": sum(1 for r in results if "error" not in r),
        }
