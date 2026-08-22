# Liganx SEO content plan — weight toward tool-intent

_Date: 2026-06-04. Based on Google Search Console (last 3 months): 299 impressions,
1 click, avg position ~19. Conversion can't be measured yet (n=1 click), so this
plan uses **intent-weighted impression demand by page** as the proxy for where the
winnable, high-tool-intent traffic is._

## 1. Intent breakdown of current impressions (top 10 pages = 246 of 299)

| Page | Impressions | Intent bucket | Tool intent |
|---|---|---|---|
| /blog/alphafold-structures-for-docking | 70 | Methodology | **High** |
| /blog/vina-gnina-glide-scoring-function-comparison | 44 | Methodology | **High** |
| /blog/plasma-protein-binding-free-drug-hypothesis | 26 | ADMET | Low (informational) |
| /blog/egfr-c797s-osimertinib-resistance-fourth-generation | 23 | Mutation | Low (informational) |
| / (homepage) | 20 | Product/brand | n/a |
| /blog/prolif-interaction-fingerprints-pose-analysis | 16 | Methodology | **High** |
| /library | 14 | Product | n/a |
| /blog/ros1-fusion-nsclc-tki-landscape | 14 | Mutation/target | Low (informational) |
| /validation | 10 | Product | n/a |
| /blog/bcr-abl-t315i-cml-resistance-ladder | 9 | Mutation | Low (informational) |

**Category totals (top-10 blog pages):**

- **Methodology (high tool intent): 130 impressions** — alphafold + vina/gnina/glide + ProLIF
- Mutation / target (right persona, informational): 46 — C797S + ROS1 + BCR-ABL
- ADMET (informational): 26 — plasma protein binding

## 2. The read

The audience persona is well-matched across the board — nearly every query is a
drug-discovery researcher, almost no junk traffic. The difference is **moment of
intent**:

- **Methodology queries are the right people AT the right moment.** Someone
  searching "alphafold for docking" or "vina gnina glide" is doing/learning docking
  right now. This category is both the **highest tool intent** and already the
  **largest share of impressions** (130 vs. 72 for mutation+ADMET combined). The
  data is telling us where to lean.
- **Mutation/ADMET queries are the right people in reading mode.** They want to
  understand a mechanism, not necessarily dock this minute. Valuable top-of-funnel,
  but they convert only if the post bridges hard into Studio.

**Strategic conclusion:** tilt the content mix toward task-shaped, tool-intent
methodology ("how do I dock / prepare / score X"), because those searchers arrive
wanting a tool — and Liganx is the tool. Keep mutation/ADMET posts as net-wideners,
but sharpen every Studio bridge.

## 3. Net-new posts to write (prioritized by tool intent x demand)

Tier A — highest tool intent, direct product-flow match (write these first):

1. **Docking from a SMILES string: 2D sketch to ranked poses** — target "smiles
   docking", "dock smiles online". Matches the Studio/Ketcher input flow exactly.
2. **AutoDock Vina online: running Vina with no local install** — target "autodock
   vina online", "vina web interface". Pure product-intent query you already own
   the answer to.
3. **How to read a docking score: what's a good Vina score?** — target "good vina
   score", "vina binding affinity interpretation". Huge beginner-intent query;
   bridge to "dock and see your own scores".
4. **Virtual screening a compound library online** — target "virtual screening
   online", "screen compound library docking". Ties to /library + screening feature.
5. **Preparing a protein structure for docking** — target "protein preparation for
   docking", "receptor prep". Bridge: Studio preps receptors for you.
6. **Preparing a ligand for docking: protonation, tautomers, stereochemistry** —
   target "ligand preparation docking".

Tier B — methodology depth (strong intent, rounds out the silo):

7. Setting the docking grid box / search space ("autodock vina grid box size").
8. Redocking & RMSD: validating your docking setup ("redocking rmsd").
9. Blind docking vs targeted docking.
10. GNINA CNN scoring explained.
11. Consensus scoring across Vina / GNINA / Glide (leans on your multi-engine USP).
12. Induced-fit / flexible-receptor docking (complements the ensemble post).

These interlink tightly with the existing methodology posts (alphafold, vina/gnina/
glide, ProLIF, PoseBusters, MM-GBSA, ensemble), strengthening the topical silo that
is already your strongest performer.

## 4. Reweight the daily blog drafter

Current rotation treats the 5 themes roughly equally. Recommended weighting:

- ~50% Methodology / how-to (prioritize task-shaped, tool-intent queries above)
- ~25% Mutation / target deep-dives (top-of-funnel net-wideners — keep them)
- ~15% ADMET explainers
- ~10% News / clinical

Add a drafter rule: **every methodology post targets a task-shaped query ("how to
X") and bridges to the exact Studio feature that does X**, with the CTA placed near
the top, not only at the bottom.

## 5. Improve the existing mutation posts (don't rewrite — bridge)

The mutation posts pull the right persona but in reading mode. For the top ones
(C797S, ROS1, BCR-ABL, KRAS G12D), make the Studio bridge a concrete 2-click action
framed high in the post — "dock <drug> against <mutation> in Studio" with the
specific target/mutation reseed — rather than a generic link at the foot. That's the
step that turns a reader into a docker.
