import sys, json, urllib.request

job_id = sys.argv[1] if len(sys.argv) > 1 else "1"
data = json.loads(urllib.request.urlopen(f"http://localhost:8000/jobs/{job_id}").read())
print("STATUS:", data["status"])
print()
print(f'{"Compound":<14} {"WT":>8} {"T790M":>8} {"Delta":>8}  extra')
print("-" * 70)
by = {}
for r in data["results"]:
    by.setdefault(r["compound_id"], {})[r["variant"]] = r
for c in data["compounds"]:
    rs = by.get(c["id"], {})
    wt = rs.get("WT", {}).get("best_score")
    mt = rs.get("T790M", {}).get("best_score")
    extra = rs.get("T790M", {}).get("extra") or ""
    if wt is not None and mt is not None:
        d = mt - wt
        print(f"{c['name']:<14} {wt:>8.2f} {mt:>8.2f} {d:>+8.2f}  {extra}")
    else:
        print(f"{c['name']:<14} {(wt if wt is not None else 'pending'):>8} {(mt if mt is not None else 'pending'):>8}")
