// parseExtra parity + coverage tests.
//
// The runner writes every DockingResult.extra as a pipe-delimited
// key=value string (plus bare failure prefixes). lib/parseExtra.ts is the
// ONLY place the frontend turns that back into typed data — the matrix,
// PoseDetail, the confidence ribbon and the AI panel all read its output.
// A silent key rename on the runner side, or a regex slip here, breaks a
// whole panel of the results page with zero error.
//
// The FIXTURES table below is deliberately the same set of strings the
// backend test backend/tests/test_extra_parsers.py asserts against
// _summarize_extra (the Python parser that feeds the Liganx AI context).
// Keep the two in sync — that's the cross-parser "parity" the audit asked
// for. If you add a key to the runner's extra format, add it here AND in
// the Python test.

import { describe, it, expect } from "vitest";
import { parseExtra } from "../lib/parseExtra";

describe("parseExtra — empty / malformed input", () => {
  it("returns {raw:''} for null/undefined/empty", () => {
    expect(parseExtra(null)).toEqual({ raw: "" });
    expect(parseExtra(undefined)).toEqual({ raw: "" });
    expect(parseExtra("")).toEqual({ raw: "" });
  });

  it("ignores unknown keys and junk fragments without throwing", () => {
    const r = parseExtra("totally_unknown=42|no_equals_here|engine=local");
    expect(r.engine).toBe("local");
    // unknown keys simply don't appear on the typed object
    expect((r as Record<string, unknown>).totally_unknown).toBeUndefined();
  });
});

describe("parseExtra — failure prefixes", () => {
  it("ligand_prep_failed → failure.kind 'ligand_prep' and bails early", () => {
    const r = parseExtra("ligand_prep_failed: RDKit could not embed SMILES");
    expect(r.failure).toEqual({
      kind: "ligand_prep",
      reason: "RDKit could not embed SMILES",
    });
  });

  it("docking_failed → failure.kind 'docking'", () => {
    const r = parseExtra("docking_failed: Vina exited 1");
    expect(r.failure?.kind).toBe("docking");
  });

  it("mutant_build_failed → failure.kind 'mutant_build' AND keeps parsing trailing fields", () => {
    const r = parseExtra(
      "mutant_build_failed:residue not modeled|engine=local|vinardo=-5.10",
    );
    expect(r.failure?.kind).toBe("mutant_build");
    // mutant_build deliberately does NOT bail — the WT-fallback dock's
    // engine/vinardo are still attached and should still parse.
    expect(r.engine).toBe("local");
    expect(r.vinardo).toBe(-5.1);
  });
});

describe("parseExtra — individual keys", () => {
  it("confidence (valid values only)", () => {
    expect(parseExtra("confidence=high").confidence).toBe("high");
    expect(parseExtra("confidence=garbage").confidence).toBeUndefined();
  });

  it("foldx_ddg → number", () => {
    expect(parseExtra("foldx_ddg=-0.66").foldxDDG).toBe(-0.66);
    expect(parseExtra("foldx_ddg=notanumber").foldxDDG).toBeUndefined();
  });

  it("contacts — 2-field and 3-field (with distance)", () => {
    const r = parseExtra("contacts=LYS745:Hydrophobic,MET793:HBAcceptor:2.6");
    expect(r.contacts).toEqual([
      { residue: "LYS745", type: "Hydrophobic", distance: undefined },
      { residue: "MET793", type: "HBAcceptor", distance: 2.6 },
    ]);
  });

  it("vinardo / strain / water", () => {
    expect(parseExtra("vinardo=-4.62").vinardo).toBe(-4.62);
    expect(parseExtra("strain=mild:5.40").strain).toEqual({ verdict: "mild", kcal: 5.4 });
    expect(parseExtra("water=6/9").water).toEqual({ displaced: 6, pocketCount: 9 });
  });

  it("boltz-2 fields: aff_value / aff_prob / pocket_residues / boltz2_aligned_to_wt", () => {
    const r = parseExtra(
      "aff_value=-1.8|aff_prob=0.83|pocket_residues=14|boltz2_aligned_to_wt=1.2A",
    );
    expect(r.affValue).toBe(-1.8);
    expect(r.affProb).toBe(0.83);
    expect(r.pocketResidues).toBe(14);
    expect(r.boltz2AlignedRmsd).toBe(1.2);
  });

  it("interface KPIs + vina_terms decomposition", () => {
    const r = parseExtra(
      "iface_bsa=712.4|iface_hb=3|vina_terms=g1:-42.04,g2:-1115.74,rep:4.46,hyd:-19.39,hb:-2.07,total:-8.42",
    );
    expect(r.interfaceBsa).toBe(712.4);
    expect(r.interfaceHbonds).toBe(3);
    expect(r.vinaTerms).toEqual({
      g1: -42.04, g2: -1115.74, rep: 4.46, hyd: -19.39, hb: -2.07, total: -8.42,
    });
  });

  it("mutation_outside_pocket → outsidePocketA", () => {
    expect(parseExtra("mutation_outside_pocket=19.2A").outsidePocketA).toBe(19.2);
  });

  it("extras=pending → extrasPending flag", () => {
    expect(parseExtra("extras=pending").extrasPending).toBe(true);
  });
});

describe("parseExtra — ensemble docking (shipped 2026-05-15)", () => {
  it("ensemble=N/M | ens_spread | ens_best parse into the ensemble object", () => {
    const r = parseExtra("ensemble=3/4|ens_spread=0.74|ens_best=conf2");
    expect(r.ensemble).toEqual({ docked: 3, total: 4, spread: 0.74, best: "conf2" });
  });

  it("segment order does not matter (merge-update)", () => {
    const r = parseExtra("ens_best=input|ensemble=1/1|ens_spread=0.00");
    expect(r.ensemble).toEqual({ docked: 1, total: 1, spread: 0, best: "input" });
  });

  it("malformed ensemble=N/M is ignored, not crashing", () => {
    const r = parseExtra("ensemble=notaratio|ens_spread=0.5");
    // spread still merges; the bad N/M just doesn't set docked/total
    expect(r.ensemble).toEqual({ docked: 0, total: 0, spread: 0.5 });
  });
});

describe("parseExtra — derived 'skipped' confidence", () => {
  it("posebusters check_skipped promotes confidence to 'skipped'", () => {
    const r = parseExtra("posebusters=check_skipped: timeout");
    expect(r.confidence).toBe("skipped");
  });

  it("an explicit confidence is NOT overridden by a skipped posebusters", () => {
    const r = parseExtra("confidence=high|posebusters=check_skipped: timeout");
    expect(r.confidence).toBe("high");
  });
});

describe("parseExtra — realistic full string", () => {
  it("parses a real ensemble cell's extra end-to-end", () => {
    const r = parseExtra(
      "pocket=catalog|engine=pod_gpu_ensemble|ensemble=4/4|ens_spread=0.91|ens_best=conf1" +
        "|vinardo=-7.21|strain=ok:1.10|confidence=high|posebusters=passed all 18 checks" +
        "|contacts=LYS745:HBAcceptor:2.6,MET793:Hydrophobic:3.1|water=2/5",
    );
    expect(r.engine).toBe("pod_gpu_ensemble");
    expect(r.ensemble).toEqual({ docked: 4, total: 4, spread: 0.91, best: "conf1" });
    expect(r.vinardo).toBe(-7.21);
    expect(r.strain).toEqual({ verdict: "ok", kcal: 1.1 });
    expect(r.confidence).toBe("high");
    expect(r.contacts).toHaveLength(2);
    expect(r.water).toEqual({ displaced: 2, pocketCount: 5 });
    expect(r.failure).toBeUndefined();
  });
});
