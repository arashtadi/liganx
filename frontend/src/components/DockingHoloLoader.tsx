/**
 * DockingHoloLoader (U1)
 *
 * "Year 4026" docking-in-progress viewport. Shown while a job is in the
 * pre-flight phase (status=pending OR status=running with no cells done
 * yet) — the period where the user is staring at a 0% bar wondering if
 * anything is happening. First-time targets can spend ~30-60s here while
 * the receptor is fetched, cleaned, mutated, and prepared, so we want
 * something visually interesting + informative (real PDB ID, real
 * mutation, real backend stage when available).
 *
 * Layout:
 *   ┌────────────────────────────────────────────────┐
 *   │  ● DOCK.PROC │ stage             RUN 00:42 COH │
 *   ├────────────────────────────────────────────────┤
 *   │ ΔG  −7.5      [Three.js viewport]       POSE   │
 *   │                                                │
 *   │ RMSD 2.1Å                              GPU $/h │
 *   ├────────────────────────────────────────────────┤
 *   │ › fetched 2ITY from rcsb · 5294 atoms          │
 *   │ › stripped het-atoms · kept chain A            │
 *   │ › patched Gln61 → His via PDBFixer             │
 *   │ › embedded ligand · RDKit MMFF94 conformer     │
 *   │ › ▌ sampling poses · QuickVina2-GPU ···        │
 *   └────────────────────────────────────────────────┘
 *
 * Three.js is dynamically imported and the scene cleans up on unmount,
 * so this component is safe to mount/unmount as jobs change status.
 * Graceful no-op if WebGL isn't available.
 */
import { useEffect, useRef, useState } from "react";
import type { Job } from "../api";

interface DockingHoloLoaderProps {
  job: Job;
  /** Optional friendly stage label override (from JobPage's stage detection).
   *  When omitted we cycle through generic stage names. */
  stageLabel?: string | null;
}

// Friendly engine name for the log feed.
function engineDisplay(engine: string | null | undefined): string {
  switch (engine) {
    case "gnina": return "GNINA";
    case "boltz2": return "Boltz-2";
    case "quickvina2_gpu":
    case null:
    case undefined:
      return "QuickVina2-GPU";
    default:
      return engine;
  }
}

// Parse a mutation slug ("Q61H", "T790M") into a Gln61→His-style label.
const AA_3 = {
  A: "Ala", R: "Arg", N: "Asn", D: "Asp", C: "Cys", E: "Glu", Q: "Gln",
  G: "Gly", H: "His", I: "Ile", L: "Leu", K: "Lys", M: "Met", F: "Phe",
  P: "Pro", S: "Ser", T: "Thr", W: "Trp", Y: "Tyr", V: "Val",
} as const;

function prettyMutation(slug: string): { resn: string; mut: string; pretty: string; pocket: string | null } {
  // Match canonical "Q61H" pattern: ref(1) + position(N+) + alt(1).
  const m = slug.match(/^([A-Z])(\d+)([A-Z])$/);
  if (!m) return { resn: "RES", mut: slug, pretty: slug, pocket: null };
  const [, fromCode, pos, toCode] = m;
  const from = AA_3[fromCode as keyof typeof AA_3] ?? fromCode;
  const to = AA_3[toCode as keyof typeof AA_3] ?? toCode;
  return {
    resn: `RES.${pos}`,
    mut: `${from.toUpperCase()} → ${to.toUpperCase()}`,
    pretty: `${from}${pos} → ${to}`,
    pocket: null,
  };
}

export function DockingHoloLoader({ job, stageLabel }: DockingHoloLoaderProps) {
  const threeHostRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [stageDisplay, setStageDisplay] = useState<string>(stageLabel || "cleaning receptor");
  const [elapsed, setElapsed] = useState<string>("00:00");
  const [hudDg, setHudDg] = useState<string>("−calc");
  const [hudPose, setHudPose] = useState<string>("0 / 9");
  const [hudRmsd, setHudRmsd] = useState<string>("— Å");
  const [logsShown, setLogsShown] = useState<number>(0);
  const [dots, setDots] = useState<string>("·");

  // (U1b) Multi-mutation / multi-compound support. A real job often has
  // multiple of each (e.g. EGFR T790M + C797S × 4 compounds = 8 cells).
  // We cycle the displayed mutation and compound every ~3s so every name
  // gets screen time, plus we render an "(i of N)" tag whenever count > 1
  // so the user knows there are more than what's currently visible.
  const mutations = (job.mutations ?? []).filter((m) => !!m);
  const compounds = (job.compounds ?? []).filter((c) => !!c?.name);
  const nMut = mutations.length;
  const nComp = compounds.length;
  const [mutCycleIdx, setMutCycleIdx] = useState<number>(0);
  const [compCycleIdx, setCompCycleIdx] = useState<number>(0);

  useEffect(() => {
    if (nMut <= 1) return;
    const id = setInterval(() => setMutCycleIdx((i) => (i + 1) % nMut), 3000);
    return () => clearInterval(id);
  }, [nMut]);
  useEffect(() => {
    if (nComp <= 1) return;
    const id = setInterval(() => setCompCycleIdx((i) => (i + 1) % nComp), 3000);
    return () => clearInterval(id);
  }, [nComp]);

  const activeMut = nMut > 0 ? mutations[mutCycleIdx % nMut] : null;
  const mutInfo = activeMut ? prettyMutation(activeMut) : null;
  const activeCompound = nComp > 0 ? compounds[compCycleIdx % nComp].name : "ligand";
  const engineLabel = engineDisplay(job.engine);
  const atomCountHint = "≈5k"; // we don't have the real atom count client-side; rough hint

  // Three.js setup. Lazy-imported so the bundle doesn't pay for it on pages
  // that never show the loader. Disposes geometry/materials on unmount.
  useEffect(() => {
    let cancelled = false;
    let raf = 0;

    (async () => {
      const host = threeHostRef.current;
      if (!host) return;
      let THREE: typeof import("three");
      try {
        THREE = await import("three");
      } catch {
        return; // bundler couldn't load three; viewport stays blank, HUD still works
      }
      if (cancelled || !host) return;

      const W = host.clientWidth || 640;
      const H = 300;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
      camera.position.set(0, 0, 22);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      renderer.setSize(W, H);
      renderer.setClearColor(0x000000, 0);
      host.appendChild(renderer.domElement);

      scene.add(new THREE.AmbientLight(0xffffff, 0.4));
      const keyL = new THREE.DirectionalLight(0x9fe1cb, 0.7);
      keyL.position.set(8, 6, 10);
      scene.add(keyL);
      const rimL = new THREE.DirectionalLight(0x378add, 0.5);
      rimL.position.set(-8, -4, -6);
      scene.add(rimL);

      // ── Protein backbone (helical wireframe) ──────────────────────
      const protein = new THREE.Group();
      const ribbon: import("three").Vector3[] = [];
      const N = 90;
      const mutIdx = 32;
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const theta = t * Math.PI * 6.5;
        const r = 3.6 + 0.7 * Math.sin(t * Math.PI * 3);
        ribbon.push(
          new THREE.Vector3(
            Math.cos(theta) * r,
            (t - 0.5) * 9,
            Math.sin(theta) * r,
          ),
        );
      }
      const curve = new THREE.CatmullRomCurve3(ribbon);

      const tubeGeo = new THREE.TubeGeometry(curve, 220, 0.28, 8, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: 0x5dcaa5, roughness: 0.5, metalness: 0.1,
        transparent: true, opacity: 0.4, wireframe: true,
      });
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      protein.add(tubeMesh);

      const tubeSolidGeo = new THREE.TubeGeometry(curve, 220, 0.18, 6, false);
      const tubeSolidMat = new THREE.MeshStandardMaterial({
        color: 0x378add, roughness: 0.6, metalness: 0.05,
        transparent: true, opacity: 0.55,
      });
      const tubeSolidMesh = new THREE.Mesh(tubeSolidGeo, tubeSolidMat);
      protein.add(tubeSolidMesh);

      const residueGeos: import("three").BufferGeometry[] = [];
      const residueMats: import("three").Material[] = [];
      for (let i = 0; i < N; i += 4) {
        if (Math.abs(i - mutIdx) <= 1) continue;
        const g = new THREE.SphereGeometry(0.22, 12, 12);
        const m = new THREE.MeshStandardMaterial({
          color: i % 8 < 4 ? 0x5dcaa5 : 0x378add,
          roughness: 0.4, metalness: 0.1,
          transparent: true, opacity: 0.85,
        });
        const s = new THREE.Mesh(g, m);
        s.position.copy(ribbon[i]);
        protein.add(s);
        residueGeos.push(g);
        residueMats.push(m);
      }

      // ── Mutation residue + orbital rings ──────────────────────────
      const mutGroup = new THREE.Group();
      mutGroup.position.copy(ribbon[mutIdx]);

      const mutCoreGeo = new THREE.SphereGeometry(0.55, 20, 20);
      const mutCoreMat = new THREE.MeshBasicMaterial({ color: 0xe24b4a });
      mutGroup.add(new THREE.Mesh(mutCoreGeo, mutCoreMat));

      const mutGlowGeo = new THREE.SphereGeometry(0.95, 20, 20);
      const mutGlowMat = new THREE.MeshBasicMaterial({
        color: 0xe24b4a, transparent: true, opacity: 0.25,
      });
      const mutGlowMesh = new THREE.Mesh(mutGlowGeo, mutGlowMat);
      mutGroup.add(mutGlowMesh);

      const mutHaloGeo = new THREE.SphereGeometry(1.6, 20, 20);
      const mutHaloMat = new THREE.MeshBasicMaterial({
        color: 0xf7c1c1, transparent: true, opacity: 0.08,
      });
      mutGroup.add(new THREE.Mesh(mutHaloGeo, mutHaloMat));

      const ringRadius = 1.6;
      const orbitalRings: Array<{
        mesh: import("three").Mesh;
        axis: "x" | "y" | "z";
        speed: number;
      }> = [];
      const ringGeos: import("three").BufferGeometry[] = [];
      const ringMats: import("three").Material[] = [];
      for (let r = 0; r < 3; r++) {
        const torusGeo = new THREE.TorusGeometry(ringRadius, 0.04, 6, 80);
        const torusMat = new THREE.MeshBasicMaterial({
          color: 0xe24b4a, transparent: true, opacity: 0.55,
        });
        const torus = new THREE.Mesh(torusGeo, torusMat);
        if (r === 0) torus.rotation.x = Math.PI / 2;
        if (r === 1) torus.rotation.y = Math.PI / 2;
        if (r === 2) { torus.rotation.x = Math.PI / 3; torus.rotation.z = Math.PI / 4; }
        mutGroup.add(torus);
        orbitalRings.push({
          mesh: torus,
          axis: r === 0 ? "z" : r === 1 ? "x" : "y",
          speed: 0.8 + r * 0.3,
        });
        ringGeos.push(torusGeo);
        ringMats.push(torusMat);
      }
      protein.add(mutGroup);
      scene.add(protein);

      // ── Ligand + comet trail ──────────────────────────────────────
      const ligand = new THREE.Group();
      const atoms: Array<{ pos: [number, number, number]; r: number; c: number }> = [
        { pos: [0, 0, 0], r: 0.32, c: 0x9fe1cb },
        { pos: [1.1, 0.25, 0], r: 0.32, c: 0x9fe1cb },
        { pos: [-0.9, 0.55, 0.35], r: 0.32, c: 0x9fe1cb },
        { pos: [1.9, -0.35, 0.45], r: 0.30, c: 0xf09595 },
        { pos: [-1.6, -0.15, -0.55], r: 0.28, c: 0xef9f27 },
      ];
      const bonds: Array<[number, number]> = [[0, 1], [0, 2], [1, 3], [2, 4]];
      const ligGeos: import("three").BufferGeometry[] = [];
      const ligMats: import("three").Material[] = [];
      atoms.forEach((a) => {
        const g = new THREE.SphereGeometry(a.r, 16, 16);
        const m = new THREE.MeshStandardMaterial({
          color: a.c, roughness: 0.3, metalness: 0.15,
        });
        const s = new THREE.Mesh(g, m);
        s.position.set(a.pos[0], a.pos[1], a.pos[2]);
        ligand.add(s);
        ligGeos.push(g);
        ligMats.push(m);
      });
      bonds.forEach(([i, j]) => {
        const start = new THREE.Vector3().fromArray(atoms[i].pos);
        const end = new THREE.Vector3().fromArray(atoms[j].pos);
        const dir = new THREE.Vector3().subVectors(end, start);
        const len = dir.length();
        const cyl = new THREE.CylinderGeometry(0.08, 0.08, len, 8);
        const m = new THREE.MeshStandardMaterial({ color: 0x5dcaa5, roughness: 0.4 });
        const b = new THREE.Mesh(cyl, m);
        b.position.copy(start).add(end).multiplyScalar(0.5);
        b.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir.clone().normalize(),
        );
        ligand.add(b);
        ligGeos.push(cyl);
        ligMats.push(m);
      });
      scene.add(ligand);

      const trail: import("three").Mesh[] = [];
      const trailGeos: import("three").BufferGeometry[] = [];
      const trailMats: import("three").MeshBasicMaterial[] = [];
      for (let i = 0; i < 12; i++) {
        const tg = new THREE.SphereGeometry(0.10, 8, 8);
        const tm = new THREE.MeshBasicMaterial({
          color: 0x5dcaa5, transparent: true, opacity: 0,
        });
        const tmesh = new THREE.Mesh(tg, tm);
        scene.add(tmesh);
        trail.push(tmesh);
        trailGeos.push(tg);
        trailMats.push(tm);
      }

      const startPos = new THREE.Vector3(11, 4, 7);
      const t0 = performance.now();

      const animate = () => {
        const t = (performance.now() - t0) / 1000;
        protein.rotation.y = t * 0.22;
        protein.rotation.x = Math.sin(t * 0.15) * 0.12;

        orbitalRings.forEach((r) => {
          if (r.axis === "x") r.mesh.rotation.x += 0.018 * r.speed;
          if (r.axis === "y") r.mesh.rotation.y += 0.018 * r.speed;
          if (r.axis === "z") r.mesh.rotation.z += 0.018 * r.speed;
        });

        const pulse = (Math.sin(t * 2.2) + 1) * 0.5;
        mutGlowMesh.scale.setScalar(1 + pulse * 0.35);
        mutGlowMat.opacity = 0.18 + pulse * 0.18;

        const cycle = (t % 8) / 8;
        const mutWorld = new THREE.Vector3();
        mutGroup.getWorldPosition(mutWorld);

        if (cycle < 0.55) {
          const lerp = cycle / 0.55;
          const eased = 1 - Math.pow(1 - lerp, 3);
          ligand.position.lerpVectors(startPos, mutWorld, eased);
        } else if (cycle < 0.85) {
          ligand.position.copy(mutWorld);
          const wob = (cycle - 0.55) / 0.30;
          ligand.position.x += Math.sin(wob * Math.PI * 4) * 0.10;
          ligand.position.y += Math.cos(wob * Math.PI * 4) * 0.10;
        } else {
          ligand.position.copy(startPos);
        }
        ligand.rotation.y = t * 1.6;
        ligand.rotation.x = t * 0.85;

        for (let i = 0; i < trail.length; i++) {
          const back = i * 0.03;
          const c = Math.max(0, cycle - back);
          if (c < 0.55) {
            const tt = c / 0.55;
            const eased = 1 - Math.pow(1 - tt, 3);
            trail[i].position.lerpVectors(startPos, mutWorld, eased);
            trailMats[i].opacity = 0.5 * (1 - i / trail.length) * (cycle < 0.55 ? 1 : 0);
          } else {
            trailMats[i].opacity = 0;
          }
        }

        renderer.render(scene, camera);
        raf = requestAnimationFrame(animate);
      };
      animate();

      const handleResize = () => {
        const w = host.clientWidth || 640;
        renderer.setSize(w, H);
        camera.aspect = w / H;
        camera.updateProjectionMatrix();
      };
      window.addEventListener("resize", handleResize);

      cleanupRef.current = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", handleResize);
        tubeGeo.dispose(); tubeMat.dispose();
        tubeSolidGeo.dispose(); tubeSolidMat.dispose();
        mutCoreGeo.dispose(); mutCoreMat.dispose();
        mutGlowGeo.dispose(); mutGlowMat.dispose();
        mutHaloGeo.dispose(); mutHaloMat.dispose();
        residueGeos.forEach((g) => g.dispose());
        residueMats.forEach((m) => m.dispose());
        ringGeos.forEach((g) => g.dispose());
        ringMats.forEach((m) => m.dispose());
        ligGeos.forEach((g) => g.dispose());
        ligMats.forEach((m) => m.dispose());
        trailGeos.forEach((g) => g.dispose());
        trailMats.forEach((m) => m.dispose());
        renderer.dispose();
        if (renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      };
    })();

    return () => {
      cancelled = true;
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []); // mount-only

  // Stage label cycles every 1.4s only when no backend stage available.
  useEffect(() => {
    if (stageLabel) {
      setStageDisplay(stageLabel);
      return;
    }
    const generic = [
      "cleaning receptor",
      "patching mutation",
      "embedding ligand",
      "searching poses",
      "scoring with " + (job.engine === "gnina" ? "gnina" : "vina"),
    ];
    let i = 0;
    setStageDisplay(generic[0]);
    const id = setInterval(() => {
      i = (i + 1) % generic.length;
      setStageDisplay(generic[i]);
    }, 1800);
    return () => clearInterval(id);
  }, [stageLabel, job.engine]);

  // Elapsed clock — based on job.created_at, NOT mount time, so the clock
  // is accurate even if the user navigated away and came back.
  useEffect(() => {
    const start = (() => {
      const raw = job.created_at;
      // Backend timestamps are UTC ISO without Z — append it so JS doesn't apply local offset.
      const withZ = raw.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(raw) ? raw : raw + "Z";
      return new Date(withZ).getTime();
    })();
    const tick = () => {
      const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const mm = String(Math.floor(sec / 60)).padStart(2, "0");
      const ss = String(sec % 60).padStart(2, "0");
      setElapsed(`${mm}:${ss}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [job.created_at]);

  // HUD readouts — purely decorative. Cycle every 1.1s.
  useEffect(() => {
    let pose = 0;
    const id = setInterval(() => {
      pose = (pose + 1) % 10;
      setHudPose(`${pose} / 9`);
      setHudDg((-(7.5 + Math.random() * 2.2)).toFixed(1));
      setHudRmsd(`${(1.4 + Math.random() * 1.6).toFixed(2)} Å`);
    }, 1100);
    return () => clearInterval(id);
  }, []);

  // Log lines fade in sequentially.
  useEffect(() => {
    const totalLogs = 5;
    let n = 0;
    const id = setInterval(() => {
      n = Math.min(totalLogs, n + 1);
      setLogsShown(n);
      if (n >= totalLogs) clearInterval(id);
    }, 800);
    return () => clearInterval(id);
  }, []);

  // Animated dots after the final log line.
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      n = (n + 1) % 4;
      setDots("·".repeat(n + 1));
    }, 400);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      background: "linear-gradient(180deg, #07090d 0%, #0c1018 100%)",
      borderRadius: 12,
      padding: "1.25rem 1.5rem",
      border: "0.5px solid #1a2030",
      position: "relative",
      overflow: "hidden",
      color: "#B5D4F4",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    }}>
      {/* Perspective grid background — pure CSS, no Three.js dependency. */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.6,
        backgroundImage:
          "linear-gradient(rgba(93,202,165,0.05) 1px, transparent 1px), " +
          "linear-gradient(90deg, rgba(93,202,165,0.05) 1px, transparent 1px)",
        backgroundSize: "30px 30px",
      }} />

      {/* Horizontal scan line (CSS animation). */}
      <div className="holo-scanline" style={{
        position: "absolute", top: 0, bottom: 0, width: 2, left: -10,
        background: "linear-gradient(180deg, transparent, rgba(93,202,165,0.35), transparent)",
        pointerEvents: "none",
      }} />

      {/* Header bar. */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "0.9rem", position: "relative", zIndex: 3,
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{
            display: "inline-block", width: 6, height: 6, borderRadius: "50%",
            background: "#5DCAA5",
            boxShadow: "0 0 10px #5DCAA5, 0 0 20px #5DCAA5",
          }} />
          <span style={{ fontSize: 11, color: "#5DCAA5", letterSpacing: "0.08em" }}>DOCK.PROC</span>
          <span style={{ fontSize: 11, color: "#2a3140" }}>│</span>
          <span style={{ fontSize: 13, color: "#B5D4F4" }}>{stageDisplay}</span>
        </div>
        <div style={{
          display: "flex", gap: 14, alignItems: "center",
          fontSize: 10, color: "#5F5E5A", letterSpacing: "0.06em",
        }}>
          <span>RUN <span style={{ color: "#9FE1CB" }}>{elapsed}</span></span>
          <span>COH <span style={{ color: "#9FE1CB" }}>0.97</span></span>
        </div>
      </div>

      {/* 3D viewport. */}
      <div style={{
        position: "relative", height: 300, borderRadius: 8, overflow: "hidden", zIndex: 2,
      }}>
        <div ref={threeHostRef} style={{ position: "absolute", inset: 0 }} />

        {/* Corner HUDs (absolutely positioned). */}
        <div style={hudCornerStyle({ top: 12, left: 12 })}>
          <div style={hudRow}>
            <div style={hudLine} />
            <span style={hudLabel}>ΔG.EST</span>
          </div>
          <span style={hudValue}>{hudDg}</span>
        </div>
        <div style={hudCornerStyle({ top: 12, right: 12, align: "flex-end" })}>
          <div style={hudRow}>
            <span style={hudLabel}>POSE</span>
            <div style={hudLine} />
          </div>
          <span style={{ ...hudValue, paddingLeft: 0, paddingRight: 26 }}>{hudPose}</span>
        </div>
        <div style={hudCornerStyle({ bottom: 12, left: 12 })}>
          <span style={hudValue}>{hudRmsd}</span>
          <div style={hudRow}>
            <div style={hudLine} />
            <span style={hudLabel}>RMSD</span>
          </div>
        </div>
        <div style={hudCornerStyle({ bottom: 12, right: 12, align: "flex-end" })}>
          <span style={{ ...hudValue, paddingLeft: 0, paddingRight: 26 }}>0.69 $/h</span>
          <div style={hudRow}>
            <span style={hudLabel}>GPU</span>
            <div style={hudLine} />
          </div>
        </div>

        {/* Mutation side-readout (overlaid over the 3D rendering).
            Cycles with mutCycleIdx so each mutation in a multi-mutation
            job gets its turn on screen. The "(i of N)" tag appears
            only when there's more than one. */}
        {mutInfo && (
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(48px, -16px)", pointerEvents: "none", zIndex: 4,
          }}>
            <div style={{ fontSize: 9, color: "#F09595", letterSpacing: "0.08em" }}>
              {mutInfo.resn}
              {nMut > 1 && (
                <span style={{ color: "#5F5E5A", marginLeft: 6 }}>
                  ({(mutCycleIdx % nMut) + 1} of {nMut})
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: "#F7C1C1", letterSpacing: "0.04em" }}>{mutInfo.mut}</div>
            <div style={{ fontSize: 8, color: "#5F5E5A", letterSpacing: "0.06em" }}>{job.pdb_id} · {job.chain}</div>
          </div>
        )}
      </div>

      {/* Terminal log feed. */}
      <div style={{
        marginTop: "1rem", paddingTop: "0.9rem",
        borderTop: "0.5px solid #1a2030",
        fontSize: 12, color: "#5F5E5A", lineHeight: 1.85,
        position: "relative", zIndex: 3,
      }}>
        <LogLine show={logsShown >= 1}>
          {"› fetched "}<span style={{ color: "#9FE1CB" }}>{job.pdb_id}</span>{" from rcsb · "}
          <span style={{ color: "#B5D4F4" }}>{atomCountHint} atoms</span>
        </LogLine>
        <LogLine show={logsShown >= 2}>
          {"› stripped het-atoms · kept chain "}<span style={{ color: "#9FE1CB" }}>{job.chain}</span>
        </LogLine>
        <LogLine show={logsShown >= 3}>
          {nMut === 0 && (
            <>{"› receptor ready · "}<span style={{ color: "#B5D4F4" }}>wild-type</span></>
          )}
          {nMut === 1 && mutInfo && (
            <>{"› patched "}<span style={{ color: "#F09595" }}>{mutInfo.pretty}</span>{" via PDBFixer"}</>
          )}
          {nMut > 1 && mutInfo && (
            <>
              {"› patched "}<span style={{ color: "#F09595" }}>{mutInfo.pretty}</span>{" · "}
              <span style={{ color: "#5F5E5A" }}>{(mutCycleIdx % nMut) + 1}/{nMut} mutants</span>
            </>
          )}
        </LogLine>
        <LogLine show={logsShown >= 4}>
          {"› embedded "}<span style={{ color: "#9FE1CB" }}>{activeCompound}</span>{" · "}
          <span style={{ color: "#B5D4F4" }}>RDKit MMFF94</span>{" conformer"}
          {nComp > 1 && (
            <span style={{ color: "#5F5E5A" }}>{" · "}{(compCycleIdx % nComp) + 1}/{nComp} compounds</span>
          )}
        </LogLine>
        <LogLine show={logsShown >= 5}>
          {"› "}<span style={{ color: "#5DCAA5" }}>{"▌"}</span>{" sampling poses · "}
          <span style={{ color: "#B5D4F4" }}>{engineLabel}</span>{" "}
          <span>{dots}</span>
        </LogLine>
      </div>

      {/* Inline keyframes for the scan line. Scoped via class so we don't
          collide with anything else in Liganx. */}
      <style>{`
        @keyframes holoScanSweep {
          0% { left: -10px; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { left: 100%; opacity: 0; }
        }
        .holo-scanline {
          animation: holoScanSweep 7s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

// ─── Local style helpers ───────────────────────────────────────────────

const hudLabel: React.CSSProperties = {
  fontSize: 8, color: "#5F5E5A", letterSpacing: "0.1em",
};
const hudValue: React.CSSProperties = {
  fontSize: 13, color: "#9FE1CB", paddingLeft: 26,
};
const hudLine: React.CSSProperties = {
  width: 18, height: 0.5, background: "#185FA5",
};
const hudRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
};
function hudCornerStyle(opts: {
  top?: number; bottom?: number; left?: number; right?: number;
  align?: "flex-start" | "flex-end";
}): React.CSSProperties {
  return {
    position: "absolute",
    top: opts.top,
    bottom: opts.bottom,
    left: opts.left,
    right: opts.right,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    alignItems: opts.align ?? "flex-start",
    zIndex: 4,
  };
}

function LogLine({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      opacity: show ? 1 : 0,
      transition: "opacity 0.5s",
    }}>
      {children}
    </div>
  );
}
