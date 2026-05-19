/**
 * FepHoloLoader (U13 — Sample G "alchemical morph")
 *
 * Continuous holographic loader shown across the entire FEP+ run on
 * FepStudyPage. Unlike the docking loader (which goes away once
 * results stream in), the FEP loader stays mounted the whole time
 * an edge is running — FEP edges take 1-2 hours each and the user
 * needs something to watch.
 *
 * Visual concept (alchemical morph):
 *   - Two ligands superimposed in a binding pocket, A fading to B
 *     across λ ∈ [0, 1] (and back).
 *   - 12 λ-window markers on a horizontal ladder, current window
 *     highlighted; markers wiggle (Hamiltonian replica exchanges).
 *   - TIP3P water spheres drifting around the box.
 *   - Pocket helices (wireframe) framing the morph.
 *
 * HUD:
 *   ΔΔG.EST   λ-WINDOW   REPLICAS   GPU $/h
 *
 * Log feed (stays on screen, no clearing):
 *   › receptor prepped · Amber14SB
 *   › ligand A parametrised · OpenFF Sage 2.2
 *   › ligand B parametrised · OpenFF Sage 2.2
 *   › solvated · 8.4k TIP3P waters · 1.0 ns/window
 *   › 12 λ windows · HREX active · MBAR pending
 *
 * The animation NEVER stops while the loader is mounted — λ
 * ping-pongs forever and the ΔΔG.EST jitters around an asymptote.
 * That's deliberate: the user explicitly asked for "continuous
 * movement till the FEP+ finishes".
 *
 * Three.js is dynamically imported. Falls back to HUD-only if WebGL
 * is unavailable. Geometry/material disposal on unmount.
 */
import { useEffect, useRef, useState } from "react";
import type { FepStudyGraph } from "../api";

interface FepHoloLoaderProps {
  graph: FepStudyGraph;
  /** Optional friendly stage label override (parent already humanises
   *  per-edge sub-stages). When omitted we cycle through generic FEP
   *  stage names so the terminal row never looks stuck. */
  stageLabel?: string | null;
}

// Engine label for the log feed (sage / espaloma / mace-off).
function engineDisplay(engine: string | null | undefined): string {
  switch (engine) {
    case "espaloma": return "Espaloma 0.3.2";
    case "mace": return "MACE-OFF";
    case "sage":
    case null:
    case undefined:
      return "OpenFF Sage 2.2";
    default:
      return engine;
  }
}

export function FepHoloLoader({ graph, stageLabel }: FepHoloLoaderProps) {
  const threeHostRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // ── HUD state ────────────────────────────────────────────────────
  const [stageDisplay, setStageDisplay] = useState<string>(
    stageLabel || "running λ windows",
  );
  const [elapsed, setElapsed] = useState<string>("00:00");
  const [hudDdg, setHudDdg] = useState<string>("−calc");
  const [hudLambda, setHudLambda] = useState<string>("1 / 12");
  const [hudReplicas, setHudReplicas] = useState<string>("12");
  const [logsShown, setLogsShown] = useState<number>(0);
  const [dots, setDots] = useState<string>("·");

  // ── Multi-ligand cycle (A → B → C → A …) ─────────────────────────
  // FEP studies often involve a hit + 1-3 analogs (forming edges).
  // We cycle the displayed compound name every ~3 s so each analog
  // gets screen time. "(i of N)" tag appears when N > 1.
  const ligNames = (graph.nodes ?? [])
    .map((n) => n.name)
    .filter((n): n is string => !!n);
  const nLig = ligNames.length;
  const [ligCycleIdx, setLigCycleIdx] = useState<number>(0);
  useEffect(() => {
    if (nLig <= 1) return;
    const id = setInterval(() => setLigCycleIdx((i) => (i + 1) % nLig), 3000);
    return () => clearInterval(id);
  }, [nLig]);
  const activeLigA = nLig > 0 ? ligNames[ligCycleIdx % nLig] : "ligand A";
  const activeLigB = nLig > 1
    ? ligNames[(ligCycleIdx + 1) % nLig]
    : "ligand B";

  const engineLabel = engineDisplay(graph.force_field_engine);
  const nWindows = graph.n_lambda_windows ?? 12;
  const nsPerWindow = graph.ns_per_window ?? 1.0;
  const targetLabel = graph.pdb_id && graph.chain
    ? `${graph.pdb_id} · ${graph.chain}${graph.variant ? ` · ${graph.variant}` : ""}`
    : "target";

  // ─── Three.js scene ──────────────────────────────────────────────
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
        return; // viewport stays blank; HUD still works
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
      const keyL = new THREE.DirectionalLight(0xa6d6ff, 0.7);
      keyL.position.set(8, 6, 10);
      scene.add(keyL);
      const rimL = new THREE.DirectionalLight(0xe6a8d6, 0.45);
      rimL.position.set(-8, -4, -6);
      scene.add(rimL);

      // ── Pocket cage: two short helices framing the morph ─────────
      const cage = new THREE.Group();
      for (let h = 0; h < 2; h++) {
        const sign = h === 0 ? 1 : -1;
        const pts: import("three").Vector3[] = [];
        const N = 60;
        for (let i = 0; i < N; i++) {
          const t = i / (N - 1);
          const theta = t * Math.PI * 4.5 + (h ? Math.PI : 0);
          const r = 3.2 + 0.4 * Math.sin(t * Math.PI * 2);
          pts.push(new THREE.Vector3(
            Math.cos(theta) * r,
            (t - 0.5) * 6 * sign,
            Math.sin(theta) * r + sign * 1.6,
          ));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        const tubeGeo = new THREE.TubeGeometry(curve, 140, 0.18, 6, false);
        const tubeMat = new THREE.MeshStandardMaterial({
          color: 0x6a9bd6, roughness: 0.6, metalness: 0.08,
          transparent: true, opacity: 0.32, wireframe: true,
        });
        cage.add(new THREE.Mesh(tubeGeo, tubeMat));
      }
      scene.add(cage);

      // ── Ligand A and Ligand B (overlapping; one fades as the other rises)
      const buildLigand = (palette: { atom: number; tip: number; bond: number }) => {
        const g = new THREE.Group();
        const atoms: Array<{ pos: [number, number, number]; r: number; c: number }> = [
          { pos: [0, 0, 0], r: 0.32, c: palette.atom },
          { pos: [1.1, 0.25, 0.1], r: 0.32, c: palette.atom },
          { pos: [-0.9, 0.55, -0.3], r: 0.32, c: palette.atom },
          { pos: [1.9, -0.35, 0.4], r: 0.30, c: palette.tip },
          { pos: [-1.6, -0.15, -0.55], r: 0.28, c: palette.tip },
        ];
        const bonds: Array<[number, number]> = [[0, 1], [0, 2], [1, 3], [2, 4]];
        const geos: import("three").BufferGeometry[] = [];
        const mats: import("three").Material[] = [];
        atoms.forEach((a) => {
          const sg = new THREE.SphereGeometry(a.r, 16, 16);
          const sm = new THREE.MeshStandardMaterial({
            color: a.c, roughness: 0.3, metalness: 0.18,
            transparent: true, opacity: 1,
          });
          const s = new THREE.Mesh(sg, sm);
          s.position.set(a.pos[0], a.pos[1], a.pos[2]);
          g.add(s);
          geos.push(sg); mats.push(sm);
        });
        bonds.forEach(([i, j]) => {
          const start = new THREE.Vector3().fromArray(atoms[i].pos);
          const end = new THREE.Vector3().fromArray(atoms[j].pos);
          const dir = new THREE.Vector3().subVectors(end, start);
          const len = dir.length();
          const cg = new THREE.CylinderGeometry(0.08, 0.08, len, 8);
          const cm = new THREE.MeshStandardMaterial({
            color: palette.bond, roughness: 0.4,
            transparent: true, opacity: 1,
          });
          const c = new THREE.Mesh(cg, cm);
          c.position.copy(start).add(end).multiplyScalar(0.5);
          c.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            dir.clone().normalize(),
          );
          g.add(c);
          geos.push(cg); mats.push(cm);
        });
        return { group: g, geos, mats };
      };
      const ligA = buildLigand({ atom: 0x9fe1cb, tip: 0xef9f27, bond: 0x5dcaa5 });
      const ligB = buildLigand({ atom: 0xb5d4f4, tip: 0xe6a8d6, bond: 0x6a9bd6 });
      // B starts rotated slightly so the morph "feels" like a different scaffold.
      ligB.group.rotation.z = 0.35;
      ligB.group.position.set(0.2, 0.0, 0.0);
      scene.add(ligA.group);
      scene.add(ligB.group);

      // ── TIP3P water cloud (small blue spheres drifting in the box) ─
      const waters: Array<{
        mesh: import("three").Mesh;
        seed: number;
        baseR: number;
        baseTheta: number;
        baseY: number;
      }> = [];
      const waterGeos: import("three").BufferGeometry[] = [];
      const waterMats: import("three").Material[] = [];
      const W_COUNT = 30;
      for (let i = 0; i < W_COUNT; i++) {
        const wg = new THREE.SphereGeometry(0.10, 8, 8);
        const wm = new THREE.MeshBasicMaterial({
          color: 0x378add, transparent: true, opacity: 0.55,
        });
        const wmesh = new THREE.Mesh(wg, wm);
        const r = 4.5 + Math.random() * 2.5;
        const theta = Math.random() * Math.PI * 2;
        const y = (Math.random() - 0.5) * 7;
        wmesh.position.set(Math.cos(theta) * r, y, Math.sin(theta) * r);
        scene.add(wmesh);
        waters.push({
          mesh: wmesh, seed: Math.random() * 100,
          baseR: r, baseTheta: theta, baseY: y,
        });
        waterGeos.push(wg); waterMats.push(wm);
      }

      // ── λ-window ladder (12 small markers floating off to the side) ─
      const ladder = new THREE.Group();
      ladder.position.set(7.5, 0, 0);
      const markerGeos: import("three").BufferGeometry[] = [];
      const markerMats: import("three").MeshBasicMaterial[] = [];
      const markers: import("three").Mesh[] = [];
      for (let i = 0; i < nWindows; i++) {
        const mg = new THREE.BoxGeometry(0.7, 0.18, 0.18);
        const mm = new THREE.MeshBasicMaterial({
          color: 0x2a3140, transparent: true, opacity: 0.85,
        });
        const m = new THREE.Mesh(mg, mm);
        const y = (i / (nWindows - 1) - 0.5) * 6;
        m.position.set(0, y, 0);
        ladder.add(m);
        markers.push(m);
        markerGeos.push(mg);
        markerMats.push(mm);
      }
      scene.add(ladder);

      const t0 = performance.now();

      const animate = () => {
        const t = (performance.now() - t0) / 1000;

        // Slowly orbit the cage so it doesn't feel static.
        cage.rotation.y = t * 0.18;
        cage.rotation.x = Math.sin(t * 0.12) * 0.10;

        // λ ping-pong: 0 → 1 → 0 every 14s. Drives the morph fade.
        const cycle = (t % 14) / 14;            // 0..1
        const lambda = cycle < 0.5
          ? cycle * 2                            // 0 → 1
          : 2 - cycle * 2;                       // 1 → 0
        const opacityA = 1 - lambda * 0.85;
        const opacityB = 0.15 + lambda * 0.85;

        ligA.mats.forEach((m) => {
          (m as import("three").MeshStandardMaterial).opacity = opacityA;
        });
        ligB.mats.forEach((m) => {
          (m as import("three").MeshStandardMaterial).opacity = opacityB;
        });
        // A → B scale: B grows from 0.7 to 1.0 as λ → 1, A shrinks slightly
        const scaleA = 1.0 - lambda * 0.15;
        const scaleB = 0.85 + lambda * 0.15;
        ligA.group.scale.setScalar(scaleA);
        ligB.group.scale.setScalar(scaleB);
        // Both rotate slowly together
        ligA.group.rotation.y = t * 1.1;
        ligB.group.rotation.y = t * 1.1 + 0.5;

        // Waters drift in a slow swirl around the pocket
        waters.forEach((w) => {
          const theta = w.baseTheta + t * 0.12 + Math.sin(t * 0.4 + w.seed) * 0.15;
          const r = w.baseR + Math.sin(t * 0.6 + w.seed) * 0.3;
          const y = w.baseY + Math.sin(t * 0.45 + w.seed * 1.7) * 0.4;
          w.mesh.position.set(Math.cos(theta) * r, y, Math.sin(theta) * r);
        });

        // λ-window ladder: light up the active window + replica exchanges.
        // Active window cycles every 1.0s through 0..nWindows-1.
        const activeIdx = Math.floor((t * 0.8) % nWindows);
        markers.forEach((m, i) => {
          const mm = m.material as import("three").MeshBasicMaterial;
          if (i === activeIdx) {
            mm.color.setHex(0x5dcaa5);
            mm.opacity = 1;
            m.scale.x = 1.4;
          } else {
            const dist = Math.abs(i - activeIdx);
            mm.color.setHex(dist < 2 ? 0x378add : 0x2a3140);
            mm.opacity = dist < 2 ? 0.7 : 0.5;
            m.scale.x = 1.0;
          }
          // tiny jitter so the ladder breathes (replica exchange wobble)
          m.position.x = Math.sin(t * 1.3 + i * 0.7) * 0.05;
        });

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
        cage.traverse((obj) => {
          if ((obj as import("three").Mesh).geometry) {
            (obj as import("three").Mesh).geometry.dispose();
          }
          const m = (obj as import("three").Mesh).material;
          if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
          else if (m) (m as import("three").Material).dispose();
        });
        ligA.geos.forEach((g) => g.dispose());
        ligA.mats.forEach((m) => m.dispose());
        ligB.geos.forEach((g) => g.dispose());
        ligB.mats.forEach((m) => m.dispose());
        waterGeos.forEach((g) => g.dispose());
        waterMats.forEach((m) => m.dispose());
        markerGeos.forEach((g) => g.dispose());
        markerMats.forEach((m) => m.dispose());
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
  }, [nWindows]);

  // ── Stage label cycles every 1.8s when no backend stage provided ──
  useEffect(() => {
    if (stageLabel) {
      setStageDisplay(stageLabel);
      return;
    }
    const generic = [
      "preparing receptor",
      "parametrising ligands",
      "building hybrid topology",
      "solvating box",
      "running λ windows",
      "Hamiltonian replica exchange",
      "collecting MBAR samples",
    ];
    let i = 0;
    setStageDisplay(generic[0]);
    const id = setInterval(() => {
      i = (i + 1) % generic.length;
      setStageDisplay(generic[i]);
    }, 1800);
    return () => clearInterval(id);
  }, [stageLabel]);

  // ── Elapsed clock from created_at (survives navigation) ──────────
  useEffect(() => {
    const raw = graph.created_at;
    if (!raw) return;
    const withZ = raw.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(raw) ? raw : raw + "Z";
    const start = new Date(withZ).getTime();
    const tick = () => {
      const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const hh = Math.floor(sec / 3600);
      const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
      const ss = String(sec % 60).padStart(2, "0");
      setElapsed(hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [graph.created_at]);

  // ── HUD readouts (purely decorative; ΔΔG jitters around an asymptote)
  useEffect(() => {
    let lambdaIdx = 0;
    const id = setInterval(() => {
      lambdaIdx = (lambdaIdx + 1) % nWindows;
      setHudLambda(`${lambdaIdx + 1} / ${nWindows}`);
      // ΔΔG.EST jitters around -1.7 ± 0.4 (a typical kinase FEP+ result range).
      // This is decorative, NOT the real-time ΔΔG.
      setHudDdg((-(1.4 + Math.random() * 0.8)).toFixed(2));
      // Replicas count + exchange acceptance rate, both decorative.
      setHudReplicas(`${nWindows} · ${(40 + Math.random() * 10).toFixed(0)}%`);
    }, 1100);
    return () => clearInterval(id);
  }, [nWindows]);

  // ── Log lines fade in sequentially then STAY visible. ────────────
  // Unlike the docking loader, FEP shows ALL 6 lines so the user can
  // read what's happening behind the scenes for the hour-long run.
  useEffect(() => {
    const totalLogs = 6;
    let n = 0;
    const id = setInterval(() => {
      n = Math.min(totalLogs, n + 1);
      setLogsShown(n);
      if (n >= totalLogs) clearInterval(id);
    }, 900);
    return () => clearInterval(id);
  }, []);

  // ── Animated dots after the final log line. ──────────────────────
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
      {/* Perspective grid background. */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.6,
        backgroundImage:
          "linear-gradient(rgba(106,155,214,0.05) 1px, transparent 1px), " +
          "linear-gradient(90deg, rgba(106,155,214,0.05) 1px, transparent 1px)",
        backgroundSize: "30px 30px",
      }} />

      {/* Horizontal scan line. */}
      <div className="fep-holo-scanline" style={{
        position: "absolute", top: 0, bottom: 0, width: 2, left: -10,
        background: "linear-gradient(180deg, transparent, rgba(106,155,214,0.35), transparent)",
        pointerEvents: "none",
      }} />

      {/* Big plain-English header. */}
      <div style={{
        marginBottom: "0.85rem", position: "relative", zIndex: 3,
        textAlign: "center",
      }}>
        <div style={{
          fontSize: 15, color: "#E2F0E6", letterSpacing: "0.02em",
          fontFamily: "inherit",
        }}>
          FEP+ simulation in progress — please wait
        </div>
        <div style={{
          fontSize: 11, color: "#5F5E5A", marginTop: 2,
        }}>
          {nWindows} λ windows · {nsPerWindow} ns each · physics-based ΔΔG ·
          edges take ~30-90 min on a single GPU
        </div>
      </div>

      {/* Terminal-style status row. */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "0.9rem", position: "relative", zIndex: 3,
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{
            display: "inline-block", width: 6, height: 6, borderRadius: "50%",
            background: "#6A9BD6",
            boxShadow: "0 0 10px #6A9BD6, 0 0 20px #6A9BD6",
          }} />
          <span style={{ fontSize: 11, color: "#6A9BD6", letterSpacing: "0.08em" }}>FEP.PROC</span>
          <span style={{ fontSize: 11, color: "#2a3140" }}>│</span>
          <span style={{ fontSize: 13, color: "#B5D4F4" }}>{stageDisplay}</span>
        </div>
        <div style={{
          display: "flex", gap: 14, alignItems: "center",
          fontSize: 10, color: "#5F5E5A", letterSpacing: "0.06em",
        }}>
          <span>RUN <span style={{ color: "#A6D6FF" }}>{elapsed}</span></span>
          <span>ENG <span style={{ color: "#A6D6FF" }}>{engineLabel.split(" ")[0]}</span></span>
        </div>
      </div>

      {/* 3D viewport. */}
      <div style={{
        position: "relative", height: 300, borderRadius: 8, overflow: "hidden", zIndex: 2,
      }}>
        <div ref={threeHostRef} style={{ position: "absolute", inset: 0 }} />

        {/* Corner HUDs. */}
        <div style={hudCornerStyle({ top: 12, left: 12 })}>
          <div style={hudRow}>
            <div style={hudLine} />
            <span style={hudLabel}>ΔΔG.EST</span>
          </div>
          <span style={hudValue}>{hudDdg}</span>
        </div>
        <div style={hudCornerStyle({ top: 12, right: 12, align: "flex-end" })}>
          <div style={hudRow}>
            <span style={hudLabel}>λ.WIN</span>
            <div style={hudLine} />
          </div>
          <span style={{ ...hudValue, paddingLeft: 0, paddingRight: 26 }}>{hudLambda}</span>
        </div>
        <div style={hudCornerStyle({ bottom: 12, left: 12 })}>
          <span style={hudValue}>{hudReplicas}</span>
          <div style={hudRow}>
            <div style={hudLine} />
            <span style={hudLabel}>REPLICAS · ACC</span>
          </div>
        </div>
        <div style={hudCornerStyle({ bottom: 12, right: 12, align: "flex-end" })}>
          <span style={{ ...hudValue, paddingLeft: 0, paddingRight: 26 }}>0.69 $/h</span>
          <div style={hudRow}>
            <span style={hudLabel}>GPU</span>
            <div style={hudLine} />
          </div>
        </div>

        {/* Morph side-readout (which two ligands are being morphed). */}
        {nLig > 0 && (
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(48px, -16px)", pointerEvents: "none", zIndex: 4,
          }}>
            <div style={{ fontSize: 9, color: "#9FE1CB", letterSpacing: "0.08em" }}>
              MORPH
              {nLig > 1 && (
                <span style={{ color: "#5F5E5A", marginLeft: 6 }}>
                  ({(ligCycleIdx % nLig) + 1} of {nLig})
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: "#E2F0E6", letterSpacing: "0.04em" }}>
              {activeLigA}{nLig > 1 ? ` → ${activeLigB}` : ""}
            </div>
            <div style={{ fontSize: 8, color: "#5F5E5A", letterSpacing: "0.06em" }}>{targetLabel}</div>
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
          {"› receptor prepped · "}
          <span style={{ color: "#A6D6FF" }}>
            {graph.forcefield_protein || "Amber14SB"}
          </span>
        </LogLine>
        <LogLine show={logsShown >= 2}>
          {"› ligand "}<span style={{ color: "#9FE1CB" }}>A</span>{" parametrised · "}
          <span style={{ color: "#A6D6FF" }}>{engineLabel}</span>
          {nLig > 0 && (
            <span style={{ color: "#5F5E5A" }}>{" · "}{activeLigA}</span>
          )}
        </LogLine>
        <LogLine show={logsShown >= 3}>
          {"› ligand "}<span style={{ color: "#B5D4F4" }}>B</span>{" parametrised · "}
          <span style={{ color: "#A6D6FF" }}>{engineLabel}</span>
          {nLig > 1 && (
            <span style={{ color: "#5F5E5A" }}>{" · "}{activeLigB}</span>
          )}
        </LogLine>
        <LogLine show={logsShown >= 4}>
          {"› solvated · "}
          <span style={{ color: "#B5D4F4" }}>
            {graph.water_model || "TIP3P"}
          </span>{" · "}
          <span style={{ color: "#A6D6FF" }}>
            {nsPerWindow} ns/window
          </span>
        </LogLine>
        <LogLine show={logsShown >= 5}>
          {"› "}<span style={{ color: "#A6D6FF" }}>{nWindows}</span>{" λ windows · "}
          <span style={{ color: "#B5D4F4" }}>HREX active</span>
          {nLig > 1 && (
            <span style={{ color: "#5F5E5A" }}>
              {" · morph "}{(ligCycleIdx % nLig) + 1}/{nLig}
            </span>
          )}
        </LogLine>
        <LogLine show={logsShown >= 6}>
          {"› "}<span style={{ color: "#6A9BD6" }}>{"▌"}</span>{" "}
          <span style={{ color: "#B5D4F4" }}>collecting MBAR samples</span>{" "}
          <span>{dots}</span>
        </LogLine>
      </div>

      {/* Scoped keyframes for the scan line. */}
      <style>{`
        @keyframes fepHoloScanSweep {
          0% { left: -10px; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { left: 100%; opacity: 0; }
        }
        .fep-holo-scanline {
          animation: fepHoloScanSweep 8s ease-in-out infinite;
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
  fontSize: 13, color: "#A6D6FF", paddingLeft: 26,
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
