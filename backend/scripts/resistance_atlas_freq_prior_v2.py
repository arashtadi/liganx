"""Drug-INDEPENDENT mutation-frequency prior (spike #8).

The v1 freq_prior was per (target, mutation, drug) — circular for
negative controls because designed-retention drugs got freq=0 just
because they have no resistance to score. This v2 uses the
mutation's frequency in cancer samples (regardless of which drug
the patient is on). T315I scores `3` for both Imatinib (resistance)
AND Ponatinib (retention) — the negative-control signal must then
come from Δ + ESM2 alone.

Tier definition (per mutation, drug-independent):
  3 = recurrent cancer hotspot (>5% of cancer samples in the
      indication) — e.g. EGFR T790M in post-TKI NSCLC, BRAF V600E
      in melanoma, KRAS G12C in NSCLC
  2 = well-documented recurrent (1-5%) — e.g. ABL E255K, T474I
  1 = published but rare (<1%) — e.g. ABL F359V, V299L
  0 = not observed in cancer samples or single-case-report only

Sources: COSMIC v97 (academic), AACR GENIE v15 (public via
cBioPortal), and per-indication review papers (Soverini 2018 for
BCR-ABL, Frampton 2015 for EGFR, Heinrich 2008 for KIT, Bose 2013
for HER2, DiNardo 2018 for IDH1).

For mutations that appear in the calibration set under multiple
drug contexts (e.g. T315I across Imatinib / Dasatinib / Nilotinib /
Ponatinib), every event gets the SAME tier score.
"""
import json

# Key insight: tier is per (gene, position, mutant_AA) — drug-free.
# We look up the canonical mutation, not the event.
MUTATION_TIER = {
    # ABL — Soverini 2018 review of CML resistance landscape
    ("ABL1", 315, "I"): 3,   # T315I — gatekeeper, 15-20% of TKI resistance
    ("ABL1", 255, "K"): 2,   # E255K — P-loop
    ("ABL1", 253, "H"): 2,   # Y253H — P-loop
    ("ABL1", 317, "L"): 2,   # F317L — atp pocket
    ("ABL1", 299, "L"): 1,   # V299L — rare
    ("ABL1", 359, "V"): 1,   # F359V — rare
    ("ABL1", 396, "P"): 1,   # H396P — rare
    ("ABL1", 351, "T"): 1,   # M351T — ~1-3%
    # EGFR — Frampton 2015 + Thress 2015 + Lynch 2004
    ("EGFR", 790, "M"): 3,   # T790M — dominant 1st-gen resistance
    ("EGFR", 797, "S"): 3,   # C797S — dominant osimertinib resistance
    ("EGFR", 792, "H"): 1,   # L792H — rare
    ("EGFR", 792, "Q"): 1,   # L792Q — rare alt
    ("EGFR", 858, "R"): 3,   # L858R — most common activating
    ("EGFR", 719, "S"): 2,   # G719S — ~5-10% activating
    # KIT — Heinrich 2008 review of GIST resistance
    ("KIT", 816, "V"): 3,    # D816V — >90% in advanced mastocytosis
    ("KIT", 670, "I"): 2,    # T670I — gatekeeper GIST resistance
    ("KIT", 654, "A"): 2,    # V654A — GIST resistance
    # BTK — Woyach 2014 + Wang 2022
    ("BTK", 481, "S"): 3,    # C481S — >80% of ibrutinib resistance
    ("BTK", 474, "I"): 2,    # T474I — emerging pirtobrutinib resistance
    # BRAF — Bollag 2010
    ("BRAF", 600, "E"): 3,   # V600E — most common BRAF cancer driver
    # KRAS — Hofmann 2022 + Awad 2021
    ("KRAS", 12, "C"): 3,    # G12C — most common targetable KRAS
    ("KRAS", 96, "D"): 1,    # Y96D — rare acquired
    # ALK — Doebele 2012 + Katayama 2016
    ("ALK", 1196, "M"): 3,   # L1196M — gatekeeper, dominant
    ("ALK", 1202, "R"): 3,   # G1202R — solvent-front
    ("ALK", 1171, "N"): 1,   # I1171N — rare alectinib resistance
    # ROS1 — Awad 2013
    ("ROS1", 2032, "R"): 3,  # G2032R — dominant crizotinib resistance
    # MET — Recondo 2020
    ("MET", 1228, "V"): 2,   # D1228V — DFG resistance
    ("MET", 1230, "H"): 2,   # Y1230H — DFG resistance
    # FLT3 — Smith 2012, McMahon 2019
    ("FLT3", 691, "L"): 3,   # F691L — gatekeeper
    ("FLT3", 835, "Y"): 3,   # D835Y — most common
    ("FLT3", 835, "V"): 2,   # D835V — less common alt
    # HER2 — Bose 2013
    ("ERBB2", 755, "S"): 2,
    ("ERBB2", 777, "L"): 2,
    ("ERBB2", 842, "I"): 1,
    # PI3Kα — Karakas 2006 + COSMIC
    ("PIK3CA", 1047, "R"): 3,
    ("PIK3CA", 545, "K"): 3,
    # IDH1 — DiNardo 2018
    ("IDH1", 132, "H"): 3,
}

events = json.load(open('/tmp/events.json'))["events"]
out = {}
missing = []
for e in events:
    gene = e.get("gene")
    pos = e.get("position")
    mut = e.get("mutant")
    key = (gene, pos, mut)
    if key in MUTATION_TIER:
        out[e["id"]] = {"freq_tier": MUTATION_TIER[key], "drug_independent": True}
    else:
        # Deletions or events not in the per-mutation table
        out[e["id"]] = {"freq_tier": 0, "drug_independent": True, "note": "not_in_table"}
        missing.append(e["id"])

print(f"Curated {len(out)} of {len(events)} events; {len(missing)} fell back to 0: {missing}")
with open('/tmp/freq_prior_v2.json', 'w') as f:
    json.dump({
        "schema_version": 2,
        "drug_independent": True,
        "tier_definition": {
            "3": "recurrent cancer hotspot (>5% of relevant indication)",
            "2": "well-documented recurrent (1-5%)",
            "1": "published rare (<1%)",
            "0": "not in cancer samples / single-case-report",
        },
        "freq_tier": {eid: r["freq_tier"] for eid, r in out.items()},
        "notes": "v2 fixes spike #7 circularity by scoring mutations independently of drug. T315I scores 3 for both Imatinib (resistance) AND Ponatinib (retention); the negative-control discrimination must come from Δ + ESM2 alone.",
    }, f, indent=2)
print("Wrote /tmp/freq_prior_v2.json")
