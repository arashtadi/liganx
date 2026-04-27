"""Smoke tests — confirms the app boots and basic routes respond."""

from fastapi.testclient import TestClient

from deltadock.main import app


def test_health_returns_ok():
    with TestClient(app) as client:
        r = client.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert "version" in body


def test_create_and_get_job():
    payload = {
        "pdb_id": "1M17",
        "chain": "A",
        "uniprot_id": "P00533",
        "mutations": ["T790M", "L858R"],
        "compounds": [
            {"name": "Gefitinib", "smiles": "COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1"},
            {"name": "Osimertinib", "smiles": "COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1"},
        ],
    }
    with TestClient(app) as client:
        r = client.post("/jobs", json=payload)
        assert r.status_code == 201, r.text
        job = r.json()
        assert job["pdb_id"] == "1M17"
        assert set(job["mutations"]) == {"T790M", "L858R"}
        assert len(job["compounds"]) == 2

        # Background task is fire-and-forget; results may or may not be populated yet.
        # Re-fetch and confirm the shape regardless.
        r2 = client.get(f"/jobs/{job['id']}")
        assert r2.status_code == 200
        assert r2.json()["id"] == job["id"]
