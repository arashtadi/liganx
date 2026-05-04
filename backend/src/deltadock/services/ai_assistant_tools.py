"""Tool-use during Optimize generation (Tier 1 #4).

The Generate-Score-Filter loop docks variants AFTER the AI has committed.
The Hard-Constraint Reject Loop catches ones the AI itself thinks are
weak, but still after-the-fact. With native Anthropic tool use, the AI
can self-validate WHILE it's drafting variants — call validate_smiles()
on a candidate, see it fails RDKit, regenerate without us ever needing
to filter it server-side.

What's wired in v1:
  - validate_smiles(smi) — RDKit parse + canonical form check (~1ms)
  - compute_properties(smi) — MW, logP, QED, Lipinski, PAINS (~5ms)

What's deferred (would add real GPU time per Optimize):
  - quick_dock_smiles(smi) — full Vina re-dock (~15s GPU). The orchestrator
    already batch-docks survivors at the end, so adding it here would
    duplicate cost. Worth revisiting if we see the model proposing
    confidently-bad designs that quick-dock would catch.

Loop budget:
  - Max 5 turn-loop iterations (each is an AI round-trip + tool exec)
  - Max 6 tool calls per request
  - Hits Cloudflare 100s edge limit at ~3 round-trips, so the cap is
    really about latency more than cost

Cost: each tool round-trip is ~3-5s of Anthropic latency + the tool's
own runtime. For pure RDKit tools, ~3-6s extra worst case. Cheap
relative to the ~50s the rest of /optimize takes.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

import httpx

log = logging.getLogger(__name__)

# Bound the multi-turn tool loop. The Anthropic API handles up to ~25 turns
# per request in theory, but at our latency budget (Cloudflare 100s edge
# timeout, 60s per Anthropic call) we can't afford more than a few.
MAX_TOOL_LOOP_TURNS = 5
MAX_TOOL_CALLS_PER_REQUEST = 6


# ──────────────────────────────────────────────────────────────────────
# Tool schemas — what the model sees in its `tools` array
# ──────────────────────────────────────────────────────────────────────

OPTIMIZE_TOOLS: list[dict] = [
    {
        "name": "validate_smiles",
        "description": (
            "Check whether a SMILES string parses with RDKit and return its "
            "canonical form. Use this to verify a candidate variant BEFORE "
            "committing it to the final variants array. Returns "
            "{valid: true, canonical_smiles: '...'} or {valid: false, error: '...'}. "
            "Cheap (~1ms) — call as often as you need."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "smiles": {
                    "type": "string",
                    "description": "The SMILES string to validate.",
                },
            },
            "required": ["smiles"],
        },
    },
    {
        "name": "compute_properties",
        "description": (
            "Compute drug-likeness properties for a candidate SMILES: "
            "molecular weight, logP, TPSA, QED, Lipinski violations, PAINS "
            "alerts, synthetic accessibility score. Use this to sanity-check "
            "that your variant stays in drug-like space (RoF, QED > 0.5, "
            "SA Score < 6). Cheap (~5ms). Returns the property panel as JSON."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "smiles": {
                    "type": "string",
                    "description": "The SMILES string to inspect.",
                },
            },
            "required": ["smiles"],
        },
    },
]


# ──────────────────────────────────────────────────────────────────────
# Tool implementations
# ──────────────────────────────────────────────────────────────────────


def _exec_validate_smiles(input_args: dict) -> str:
    """RDKit parse + canonical form. Returns a JSON string the model can
    parse. Defensive against missing/malformed input — the model can
    occasionally pass empty strings."""
    smi = (input_args.get("smiles") or "").strip()
    if not smi:
        return json.dumps({"valid": False, "error": "empty SMILES"})
    try:
        from .properties import validate_smiles
        valid, canonical, err = validate_smiles(smi)
        if not valid:
            return json.dumps({"valid": False, "error": err or "RDKit parse failed"})
        return json.dumps({"valid": True, "canonical_smiles": canonical})
    except Exception as e:
        log.warning("tool validate_smiles failed: %s", e)
        return json.dumps({"valid": False, "error": f"validation crashed: {e}"})


def _exec_compute_properties(input_args: dict) -> str:
    """Full property panel via the existing services/properties module.
    The model uses this to sanity-check drug-likeness (RoF / QED / SA)
    BEFORE shipping a variant. Returns a JSON string with a curated
    subset (full panel would be ~1000 tokens of JSON)."""
    smi = (input_args.get("smiles") or "").strip()
    if not smi:
        return json.dumps({"valid": False, "error": "empty SMILES"})
    try:
        from .properties import compute_properties
        from .sa_score import compute_sa_score, sa_label
        panel = dict(compute_properties(smi))
        if not panel.get("valid"):
            return json.dumps({"valid": False, "error": panel.get("error", "invalid SMILES")})
        # Cherry-pick the fields the model actually needs; full panel
        # would balloon the tool result back into the conversation.
        out = {
            "valid": True,
            "mw": panel.get("mw"),
            "logp": panel.get("logp"),
            "tpsa": panel.get("tpsa"),
            "qed": panel.get("qed"),
            "h_bond_donors": panel.get("h_bond_donors"),
            "h_bond_acceptors": panel.get("h_bond_acceptors"),
            "rotatable_bonds": panel.get("rotatable_bonds"),
            "lipinski_violations": panel.get("lipinski_violations"),
            "pains_alerts": panel.get("pains_alerts", []),
        }
        sa = compute_sa_score(panel.get("canonical_smiles") or smi)
        if sa is not None:
            out["sa_score"] = round(sa, 2)
            out["sa_label"] = sa_label(sa)
        return json.dumps(out)
    except Exception as e:
        log.warning("tool compute_properties failed: %s", e)
        return json.dumps({"valid": False, "error": f"properties crashed: {e}"})


# Lookup table — extend here when adding new tools to OPTIMIZE_TOOLS.
_TOOL_DISPATCHERS = {
    "validate_smiles": _exec_validate_smiles,
    "compute_properties": _exec_compute_properties,
}


def _execute_tool(name: str, input_args: dict) -> str:
    """Dispatch a tool call to its implementation. Returns the result as a
    JSON string (Anthropic tool_result content must be a string).
    Returns a structured error string for unknown tools rather than
    raising, so the model can recover ("oh, that tool doesn't exist, let
    me use a different one")."""
    fn = _TOOL_DISPATCHERS.get(name)
    if fn is None:
        return json.dumps({"error": f"unknown tool: {name!r}"})
    try:
        return fn(input_args)
    except Exception as e:
        log.exception("tool execution unexpected failure: %s", name)
        return json.dumps({"error": f"tool {name} crashed: {e}"})


# ──────────────────────────────────────────────────────────────────────
# Multi-turn tool loop
# ──────────────────────────────────────────────────────────────────────


async def call_with_tool_loop(
    *,
    api_url: str,
    headers: dict,
    payload_base: dict,
    timeout_s: float,
) -> tuple[str, dict]:
    """Run the Anthropic Messages API in a multi-turn loop, executing tool
    calls as the model emits them and feeding results back. Stops when:
      - stop_reason == "end_turn" (model has produced its final answer)
      - MAX_TOOL_LOOP_TURNS exceeded (safety net for runaway loops)
      - MAX_TOOL_CALLS_PER_REQUEST exceeded (cost cap)
      - Any HTTP error from Anthropic (caller should handle)

    `payload_base` is the original payload (model, system, messages,
    max_tokens, etc.) WITHOUT a `tools` field — this function adds
    OPTIMIZE_TOOLS itself so callers don't have to worry about schema
    drift. The function mutates a local copy of payload_base; the
    caller's dict is untouched.

    Returns (final_text, telemetry):
      final_text: concatenated text from the model's last assistant turn
      telemetry: {turns: int, tool_calls: int, tools_used: list[str]}
    """
    payload = dict(payload_base)
    payload["tools"] = OPTIMIZE_TOOLS
    messages = list(payload.get("messages", []))
    payload["messages"] = messages

    tools_used: list[str] = []
    tool_calls = 0

    async with httpx.AsyncClient(timeout=timeout_s) as client:
        for turn in range(MAX_TOOL_LOOP_TURNS):
            r = await client.post(api_url, headers=headers, json=payload)
            if r.status_code >= 400:
                # Caller's job to map HTTP errors to RuntimeError. Bubble
                # the raw text up via a structured exception so the
                # outer wrapper can decide on 502/503/etc.
                raise RuntimeError(
                    f"Anthropic returned HTTP {r.status_code} on tool-loop turn {turn + 1}: "
                    f"{r.text[:200]}"
                )

            body = r.json()
            content = body.get("content", []) or []
            stop_reason = body.get("stop_reason")

            # Collect text + any tool_use blocks. The model can emit BOTH
            # text and tool_use in the same response — we run the tools
            # but the text is "thinking" we don't ship to the user.
            tool_uses = [b for b in content if b.get("type") == "tool_use"]

            if stop_reason == "tool_use" and tool_uses:
                # Append the assistant turn (must include the tool_use
                # blocks verbatim — Anthropic uses the IDs to correlate)
                messages.append({"role": "assistant", "content": content})

                # Execute each tool, package as tool_result blocks
                tool_results: list[dict] = []
                for use in tool_uses:
                    tool_calls += 1
                    if tool_calls > MAX_TOOL_CALLS_PER_REQUEST:
                        # Hit cost cap mid-batch. Tell the model the tool
                        # was unavailable and let it commit with what it has.
                        log.info("tool-loop: cap hit at %d calls, denying further", tool_calls)
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": use.get("id"),
                            "content": json.dumps({
                                "error": f"tool budget exhausted ({MAX_TOOL_CALLS_PER_REQUEST} max per request); "
                                          "commit your best variants now without further validation",
                            }),
                            "is_error": True,
                        })
                        continue
                    name = use.get("name", "")
                    args = use.get("input", {}) or {}
                    tools_used.append(name)
                    result_str = _execute_tool(name, args)
                    log.info(
                        "tool-loop turn %d: %s(%s) → %s",
                        turn + 1, name, json.dumps(args)[:80], result_str[:120],
                    )
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": use.get("id"),
                        "content": result_str,
                    })
                messages.append({"role": "user", "content": tool_results})
                # Loop continues — model gets another shot with the tool results
                continue

            # No more tool use. Concatenate text blocks and return.
            final_text = ""
            for b in content:
                if b.get("type") == "text":
                    final_text += b.get("text", "")
            log.info(
                "tool-loop completed: turns=%d tool_calls=%d stop_reason=%s",
                turn + 1, tool_calls, stop_reason,
            )
            return final_text, {
                "turns": turn + 1,
                "tool_calls": tool_calls,
                "tools_used": tools_used,
            }

    # Hit MAX_TOOL_LOOP_TURNS without converging. Take the last assistant
    # turn's text (if any) and return it, but log loud — this should be
    # rare in practice.
    log.warning("tool-loop hit MAX_TOOL_LOOP_TURNS=%d without end_turn", MAX_TOOL_LOOP_TURNS)
    return "", {
        "turns": MAX_TOOL_LOOP_TURNS,
        "tool_calls": tool_calls,
        "tools_used": tools_used,
        "error": "tool loop did not converge",
    }
