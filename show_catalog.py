import json, urllib.request
data = json.loads(urllib.request.urlopen("http://localhost:8000/catalog").read())
print(f"Library now serves {len(data)} targets:\n")
for t in data:
    n = len(t["mutations"])
    c = len(t["compounds"])
    print(f"  {t['id']:6s} {t['name']:42s}  mut={n:2d}  cpd={c}")
total_m = sum(len(t["mutations"]) for t in data)
total_c = sum(len(t["compounds"]) for t in data)
print(f"\nTotal: {total_m} mutations, {total_c} reference compounds across {len(data)} targets.")
