/**
 * Lightweight, dependency-free SMILES sanity check for the paste / file-upload
 * compound inputs. This is NOT a full RDKit parse — it's a fast pre-filter that
 * rejects the common ways a pasted string isn't a molecule at all (prose, a
 * truncated copy, unbalanced brackets, stray characters) so the user gets an
 * immediate "3 lines weren't valid SMILES" message instead of watching those
 * cells fail one-by-one at dock time. Real chemical validation (valence,
 * aromaticity, embeddability) still happens backend-side in RDKit/Meeko.
 *
 * It deliberately errs toward ACCEPTING: a false accept just fails later as a
 * single dock cell (the current behaviour); a false reject would block a
 * legitimate compound, which is worse. So the checks below are all "this string
 * cannot possibly be a SMILES", never "this molecule looks unusual".
 */

export interface SmilesCheck { ok: boolean; reason?: string; }

// Characters that can legally appear in a SMILES string (organic-subset atoms,
// bracket atoms, bonds, ring-closure digits, branches, stereo, charges, wildcard).
const SMILES_CHARS = /^[A-Za-z0-9@+\-\[\]()=#$:.\/\\%*]+$/;

export function validateSmiles(raw: string): SmilesCheck {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, reason: "empty" };
  if (/\s/.test(s)) return { ok: false, reason: "contains spaces" };
  if (s.length > 600) return { ok: false, reason: "too long to be a single SMILES" };
  if (!SMILES_CHARS.test(s)) return { ok: false, reason: "invalid characters" };
  if (!/[A-Za-z]/.test(s)) return { ok: false, reason: "no atoms" };

  // Balanced branches — every "(" needs a matching ")".
  let paren = 0;
  for (const ch of s) {
    if (ch === "(") paren++;
    else if (ch === ")") { paren--; if (paren < 0) return { ok: false, reason: "unbalanced ( )" }; }
  }
  if (paren !== 0) return { ok: false, reason: "unbalanced ( )" };

  // Balanced bracket atoms — "[...]" can't nest and must close.
  let inBracket = false;
  for (const ch of s) {
    if (ch === "[") { if (inBracket) return { ok: false, reason: "nested [ ]" }; inBracket = true; }
    else if (ch === "]") { if (!inBracket) return { ok: false, reason: "unbalanced [ ]" }; inBracket = false; }
  }
  if (inBracket) return { ok: false, reason: "unbalanced [ ]" };

  // Ring-closure labels must pair up. Digits INSIDE bracket atoms are
  // isotopes/H-counts/charges, not ring bonds, so blank the bracket contents
  // first, then every ring label (single digit, or %NN) must occur an even
  // number of times — an odd count means an unclosed ring (a common sign of a
  // truncated copy-paste).
  const bare = s.replace(/\[[^\]]*\]/g, "[]");
  const ring: Record<string, number> = {};
  for (let i = 0; i < bare.length; i++) {
    const ch = bare[i];
    if (ch === "%") {
      const m = bare.slice(i, i + 3).match(/^%(\d\d)$/);
      if (!m) return { ok: false, reason: "bad %NN ring closure" };
      ring[m[1]] = (ring[m[1]] || 0) + 1;
      i += 2;
    } else if (ch >= "0" && ch <= "9") {
      ring[ch] = (ring[ch] || 0) + 1;
    }
  }
  for (const k of Object.keys(ring)) {
    if (ring[k] % 2 !== 0) return { ok: false, reason: "unclosed ring" };
  }

  return { ok: true };
}
