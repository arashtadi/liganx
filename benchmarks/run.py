#!/usr/bin/env python3
"""
Liganx Mutation-Selectivity Benchmark Harness

Loads dataset.json, runs each case through the Liganx API (/assist/quick_dock),
and compares predicted ΔΔG to expected values from literature.

Usage:
    python run.py --token YOUR_SESSION_TOKEN --output results.csv

Requirements:
    - httpx (or requests)
    - Python 3.8+
"""

import json
import csv
import math
import argparse
import sys
from pathlib import Path
from datetime import datetime

try:
    import httpx
except ImportError:
    import requests as httpx_compat
    # Minimal adapter to make requests behave like httpx
    class HTTPXAdapter:
        def __init__(self):
            self.session = httpx_compat.Session()
        def post(self, url, json_data, timeout=None):
            resp = self.session.post(url, json=json_data, timeout=timeout)
            resp.json = resp.json
            return resp
    httpx = HTTPXAdapter()

API_BASE = "https://api.liganx.com"
QUICK_DOCK_ENDPOINT = f"{API_BASE}/assist/quick_dock"

# TODO: paste your session token below
SESSION_TOKEN = "YOUR_SESSION_TOKEN_HERE"

# Constants
RT_KCAL_MOL = 0.59165  # 298K in kcal/(mol·K)
QUANTITATIVE_THRESHOLD_KCAL = 2.0  # ±2 kcal/mol for "correct"


def load_dataset(dataset_path):
    """Load benchmark dataset from JSON."""
    with open(dataset_path, "r") as f:
        return json.load(f)


def expected_ddg_from_fold(fold_shift):
    """
    Calculate expected ΔΔG from fold-shift.
    
    ΔΔG = -RT ln(K) where K = fold_shift
    At 298K: ΔΔG ≈ -0.59 × ln(fold_shift) kcal/mol
    """
    if fold_shift <= 0:
        return None
    return -RT_KCAL_MOL * math.log(fold_shift)


def call_api(receptor_pdb, mutation_spec, ligand_smiles, headers):
    """
    Call Liganx quick_dock API.
    
    Args:
        receptor_pdb: PDB code (e.g., "2ITY")
        mutation_spec: Mutation string (e.g., "T790M") or None for WT
        ligand_smiles: SMILES string
        headers: HTTP headers with Authorization
    
    Returns:
        dict with 'dg' (ΔG in kcal/mol) or None on error
    """
    payload = {
        "receptor_pdb": receptor_pdb,
        "ligand_smiles": ligand_smiles,
        "mutation": mutation_spec,
    }
    
    try:
        resp = httpx.post(
            QUICK_DOCK_ENDPOINT,
            json=payload,
            headers=headers,
            timeout=60.0
        )
        resp.raise_for_status()
        data = resp.json()
        return {"dg": data.get("dg"), "raw": data}
    except Exception as e:
        return {"error": str(e), "raw": None}


def run_benchmark(dataset_path, output_csv, session_token):
    """Run full benchmark suite."""
    
    if session_token == "YOUR_SESSION_TOKEN_HERE":
        print("ERROR: Session token not set.")
        print("  Edit run.py and paste your session token at line ~30 (SESSION_TOKEN = ...)")
        print("  Or pass --token via CLI.")
        sys.exit(1)
    
    # Load dataset
    dataset = load_dataset(dataset_path)
    print(f"Loaded {len(dataset)} cases from {dataset_path}")
    
    # Set up headers
    headers = {
        "Authorization": f"Bearer {session_token}",
        "Content-Type": "application/json",
    }
    
    # Results
    results = []
    
    for case in dataset:
        case_id = case["id"]
        target = case["target"]
        pdb_id = target["pdb_id"]
        mutations = case["mutations"]
        ligand = case["ligand"]
        expected = case["expected"]
        
        # Unpack expected values
        expected_fold = expected["fold_shift"]
        expected_ddg = expected_ddg_from_fold(expected_fold)
        direction = expected["direction"]
        
        print(f"\n--- {case_id} ---")
        print(f"  PDB: {pdb_id}, Mutation: {mutations[0] if mutations else 'WT'}")
        print(f"  Ligand: {ligand['name']}")
        print(f"  Expected fold-shift: {expected_fold}×, ΔΔG: {expected_ddg:.2f} kcal/mol")
        
        # Call API for WT
        print("  Calling API (WT)...", end=" ", flush=True)
        wt_result = call_api(pdb_id, None, ligand["smiles"], headers)
        if "error" in wt_result:
            print(f"ERROR: {wt_result['error']}")
            results.append({
                "case_id": case_id,
                "status": "API_ERROR",
                "error": wt_result["error"],
                "expected_fold": expected_fold,
                "expected_ddg": expected_ddg,
                "predicted_ddg": None,
            })
            continue
        
        wt_dg = wt_result.get("dg")
        print(f"ΔG(WT) = {wt_dg:.2f} kcal/mol" if wt_dg else "ΔG(WT) = ERROR")
        
        # Call API for mutant
        mutation_spec = mutations[0] if mutations else None
        print(f"  Calling API (mut: {mutation_spec})...", end=" ", flush=True)
        mut_result = call_api(pdb_id, mutation_spec, ligand["smiles"], headers)
        if "error" in mut_result:
            print(f"ERROR: {mut_result['error']}")
            results.append({
                "case_id": case_id,
                "status": "API_ERROR",
                "error": mut_result["error"],
                "expected_fold": expected_fold,
                "expected_ddg": expected_ddg,
                "predicted_ddg": None,
            })
            continue
        
        mut_dg = mut_result.get("dg")
        print(f"ΔG(mut) = {mut_dg:.2f} kcal/mol" if mut_dg else "ΔG(mut) = ERROR")
        
        # Compute predicted ΔΔG
        if wt_dg is not None and mut_dg is not None:
            predicted_ddg = mut_dg - wt_dg
            error_kcal = abs(predicted_ddg - expected_ddg) if expected_ddg else None
            
            # Check agreement
            sign_correct = (
                (direction == "weaker" and predicted_ddg >= 0) or
                (direction == "stronger" and predicted_ddg <= 0)
            ) if expected_ddg else None
            
            quantitative_correct = (
                error_kcal <= QUANTITATIVE_THRESHOLD_KCAL
            ) if error_kcal else None
            
            print(f"  Predicted ΔΔG: {predicted_ddg:.2f} kcal/mol")
            print(f"  Error: {error_kcal:.2f} kcal/mol" if error_kcal else "")
            print(f"  Sign correct: {sign_correct}, Quantitative: {quantitative_correct}")
            
            results.append({
                "case_id": case_id,
                "status": "SUCCESS",
                "expected_fold": expected_fold,
                "expected_ddg": expected_ddg,
                "predicted_ddg": predicted_ddg,
                "error_kcal": error_kcal,
                "sign_correct": sign_correct,
                "quantitative_correct": quantitative_correct,
            })
        else:
            results.append({
                "case_id": case_id,
                "status": "INCOMPLETE",
                "expected_fold": expected_fold,
                "expected_ddg": expected_ddg,
                "predicted_ddg": None,
            })
    
    # Write results CSV
    output_path = Path(output_csv or f"results_{datetime.now().isoformat()}.csv")
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "case_id", "status", "expected_fold", "expected_ddg",
                "predicted_ddg", "error_kcal", "sign_correct", "quantitative_correct"
            ]
        )
        writer.writeheader()
        writer.writerows(results)
    
    print(f"\n\n=== SUMMARY ===")
    print(f"Results written to {output_path}")
    
    successful = [r for r in results if r["status"] == "SUCCESS"]
    if successful:
        sign_correct_count = sum(1 for r in successful if r["sign_correct"])
        quantitative_count = sum(1 for r in successful if r["quantitative_correct"])
        
        print(f"Successfully evaluated: {len(successful)}/{len(results)}")
        print(f"Sign agreement: {sign_correct_count}/{len(successful)} ({100*sign_correct_count/len(successful):.0f}%)")
        print(f"Quantitative (±{QUANTITATIVE_THRESHOLD_KCAL} kcal/mol): {quantitative_count}/{len(successful)} ({100*quantitative_count/len(successful):.0f}%)")
        
        if sign_correct_count >= 8:
            print("✓ Qualitative threshold PASSED (8/10 cases)")
        else:
            print("✗ Qualitative threshold NOT met")
        
        if quantitative_count >= 5:
            print("✓ Quantitative threshold PASSED (5/10 cases)")
        else:
            print("✗ Quantitative threshold NOT met")


def main():
    parser = argparse.ArgumentParser(
        description="Liganx Mutation-Selectivity Benchmark Harness"
    )
    parser.add_argument(
        "--token",
        type=str,
        default=SESSION_TOKEN,
        help="Session token for Liganx API"
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output CSV file (default: results_<timestamp>.csv)"
    )
    parser.add_argument(
        "--dataset",
        type=str,
        default="dataset.json",
        help="Path to benchmark dataset (default: dataset.json)"
    )
    
    args = parser.parse_args()
    
    dataset_path = Path(args.dataset)
    if not dataset_path.exists():
        print(f"ERROR: Dataset not found: {dataset_path}")
        sys.exit(1)
    
    run_benchmark(dataset_path, args.output, args.token)


if __name__ == "__main__":
    main()
