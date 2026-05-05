# Liganx Pod Runbook

Common failure modes from the 2026-05-05 infrastructure incident and their diagnoses/fixes.

## "Quick Dock returns 'compound too large' on small molecules"

**Symptom:** Job fails with error message "compound too large" or similar, despite the molecule being ≤10 heavy atoms.

**Diagnosis:**
1. Check the pod error code: `flyctl logs -a liganx-api | grep rc=`
2. Interpret the return code:
   - `rc=127` → Missing shared library (libboost or OpenCL ICD)
   - `rc=1` → Genuine "compound too large" from QuickVina2-GPU (legitimate docking failure, not infra)
   - `rc=255` → OpenCL initialization failed (missing ICD registration or missing nvidia.icd)
   - `rc=134` → Abort signal (e.g., GNINA CNN kernel SIGABRT on unsupported GPU arch)

**Fix:**
- If `rc=127` or `rc=255`: Pod is missing dependencies. Run `bash /workspace/start_dock_server.sh` on the pod (via GoTTY terminal) to re-source `install_deps.sh` and repair. If that fails, see "Pod startup files lost after container rebuild" below.
- If `rc=1`: This is a real docking failure, not infrastructure. The compound is genuinely too large for the current exhaustiveness setting, or the target pocket is too small.
- If `rc=134`: GNINA CNN mode may be incompatible with the pod's GPU. Check `flyctl secrets list -a liganx-api` for `GNINA_CNN_MODE`. If it's set to "rescore" or "refine" and the pod has Blackwell GPU (sm_120+), set `GNINA_CNN_MODE=none` and redeploy: `flyctl secrets set GNINA_CNN_MODE=none -a liganx-api`.

## "Pod is migrated and POD_DOCK_URL is stale"

**Symptom:** All docking jobs start failing with connection timeouts or "pod not found" after a pod migration or restart.

**Diagnosis:**
1. Check what URL the API is currently using: `flyctl secrets list -a liganx-api | grep POD_DOCK_URL`
2. Verify the pod is actually running: `runpod status <pod-id>` or check the RunPod dashboard.
3. If the pod ID in the URL doesn't match the current pod ID, the secret is stale.

**Fix:**
```bash
# Get the new pod ID (e.g., diqoc6q2lt55mn)
NEW_POD_ID="diqoc6q2lt55mn"
NEW_PORT="7861"

# Update POD_DOCK_URL
flyctl secrets set POD_DOCK_URL=https://${NEW_POD_ID}-${NEW_PORT}.proxy.runpod.net -a liganx-api

# If Boltz-2 is separate, update its URL too
# flyctl secrets set BOLTZ2_POD_URL=https://${BOLTZ2_POD_ID}-7862.proxy.runpod.net -a liganx-api

# Redeploy to pick up the new secret
flyctl deploy -a liganx-api
```

The pod proxy URL format is always `https://<pod-id>-<port>.proxy.runpod.net`. Port 7861 is the default for dock_server (QuickVina2-GPU + GNINA). Boltz-2, if separate, typically runs on port 7862.

## "Pod startup files lost after container rebuild"

**Symptom:** Pod boots but `/health` returns 500, or docking fails immediately with "no such file" or "command not found" errors.

**Diagnosis:**
The container was rebuilt from scratch and lost `/workspace/start_dock_server.sh` and `/workspace/install_deps.sh`. These files are NOT part of the RunPod image; they must be copied in or sourced from the repo.

**Fix:**
1. SSH into the pod via the GoTTY web terminal (or direct SSH if exposed).
2. Clone the repo:
   ```bash
   cd /workspace
   git clone https://github.com/your-org/DockingOnline.git repo
   ```
3. Copy the startup scripts:
   ```bash
   cp repo/pod/start_dock_server.sh /workspace/
   cp repo/pod/install_deps.sh /workspace/
   chmod +x /workspace/start_dock_server.sh /workspace/install_deps.sh
   ```
4. Run the startup script to install dependencies and boot dock_server:
   ```bash
   bash /workspace/start_dock_server.sh
   ```
5. Verify the pod `/health` endpoint returns 200:
   ```bash
   curl http://localhost:7861/health
   ```

If cloning fails due to missing git or network, the pod is in a worse state — contact RunPod support or manually upload the files via the GoTTY file manager.

## "API health says git_sha is old after deploy"

**Symptom:** You just deployed a new version to Fly.io (`flyctl deploy -a liganx-api`), but curling `/health` still shows the old git_sha. Other endpoints work fine; it's just the version string that's stale.

**Diagnosis:**
Fly.io machines roll gradually. A new machine is spun up with the new image, but the old machine may still serve requests for 1–2 minutes. This is normal behavior.

**Fix:**
1. Wait 2–3 minutes and curl again. The new machine should fully replace the old one.
2. If the git_sha is still old after 3 minutes, force a restart:
   ```bash
   flyctl status -a liganx-api          # Verify machines are running
   flyctl machines restart -a liganx-api  # Force all machines to restart
   ```
3. Wait another 30s and verify: `curl https://api.liganx.com/health`

If `flyctl status` shows machines in "stopped" or "unknown" state, there may be a deployment failure. Check logs: `flyctl logs -a liganx-api -n 50`.
