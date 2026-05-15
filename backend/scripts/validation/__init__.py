"""Retrospective validation harness (S2).

Pulls known compounds with experimental Ki/IC50/Kd from ChEMBL for one of
the catalog targets, runs them through Liganx docking, and reports the
Spearman correlation between predicted Vina scores and experimental
affinity. This is the single statistical number that answers "is the
method calibrated for our targets" — it doesn't replace a real chemist,
but it tells you whether the underlying method is in the same range as
standard published docking pipelines.

Modules:
  chembl_client  — fetch known-activity compounds for a UniProt target
  scoring        — pKi / pIC50 conversion + Spearman/Pearson correlation
  report         — CSV + markdown report generation
  run            — orchestrator CLI: `python -m validation.run ...`
"""
