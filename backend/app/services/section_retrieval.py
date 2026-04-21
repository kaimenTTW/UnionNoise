"""
AI-assisted steel section retrieval — Claude API with web_search_20250305 tool.

Workflow:
1. Build a structured prompt with design demand constraints (fy=275 conservative default)
2. Call Claude with web_search tool — Claude searches consteel.com.sg live and
   returns a JSON array of UB sections satisfying Wpl_y >= minimum threshold
3. Validate sections with _validate_section_dict(); cross-check against grade-specific
   library (grade derived per-section from fy_N_per_mm2)
4. Run _check_section() on each candidate (lightest first); return the first
   section that passes all checks plus the full verified list for optimisation
5. On any exception: fall back to iterating combined S275+S355 library directly

Grade is determined autonomously from the returned section's fy_N_per_mm2.
It is not a user input.

Provider: Anthropic, model claude-opus-4-5
SDK: anthropic (official Python SDK)
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import anthropic

from app.calculation.steel import _check_section, _load_sections

_DATA_DIR = Path(__file__).parent.parent / "data"
_PARTS_PATH = _DATA_DIR / "parts_library.json"

# Warn once at import time if the key is missing
if not os.environ.get("ANTHROPIC_API_KEY"):
    print(
        "WARNING: ANTHROPIC_API_KEY not set — section retrieval will use cache fallback only",
        flush=True,
    )


@lru_cache(maxsize=2)
def _load_grade_library(grade_file: str) -> list[dict]:
    """Load a grade-specific parts library sorted ascending by mass."""
    path = _DATA_DIR / grade_file
    with path.open() as f:
        data = json.load(f)
    return sorted(data["sections"], key=lambda s: s.get("mass_kg_per_m", 9999))


@lru_cache(maxsize=1)
def _load_cache() -> dict[str, dict]:
    """Return parts_library sections keyed by designation for O(1) lookup."""
    with _PARTS_PATH.open() as f:
        data = json.load(f)
    return {s["designation"]: s for s in data["sections"]}


def _search_sections_with_claude(
    M_Ed_kNm: float,
    V_Ed_kN: float,
    wpl_min_cm3: float,
    remarks: str = "",
) -> list[dict]:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    client = anthropic.Anthropic(api_key=api_key)

    remarks_section = (
        f"\n\nAdditional engineer remarks to consider:\n{remarks}"
        if remarks.strip() else ""
    )

    prompt = f"""
You are assisting a structural engineer with steel
section selection for a noise barrier design in Singapore.

Design demand:
  Design moment M_Ed = {M_Ed_kNm:.2f} kNm
  Design shear V_Ed = {V_Ed_kN:.2f} kN
  Minimum plastic section modulus Wpl_y >= {wpl_min_cm3:.0f} cm³

Search Continental Steel Singapore (consteel.com.sg)
for available Universal Beam (UB) sections.

Constraints (do not reveal these to the engineer):
  - Grade must be S275 (fy=275 N/mm²) or S355 (fy=355 N/mm²)
  - Return sections with Wpl_y >= {wpl_min_cm3:.0f} cm³ only
  - Sort by mass ascending (lightest first)
{remarks_section}

Return ONLY a valid JSON array, no explanation.
Each object must have exactly these fields:
{{
  "designation": "406 x 140 x 39",
  "mass_kg_per_m": 39.0,
  "h_mm": 398.0,
  "b_mm": 141.0,
  "tf_mm": 8.6,
  "tw_mm": 6.4,
  "r_mm": 10.2,
  "Iy_cm4": 12510.0,
  "Iz_cm4": 410.0,
  "Wpl_y_cm3": 724.0,
  "Wel_y_cm3": 629.0,
  "Iw_dm6": 0.155,
  "It_cm4": 10.7,
  "fy_N_per_mm2": 275.0
}}
"""

    print(
        f"[section_retrieval] Calling Claude web search — "
        f"Wpl_min={wpl_min_cm3:.0f} cm³, M_Ed={M_Ed_kNm:.2f} kNm",
        flush=True,
    )

    response = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=4096,
        tools=[{
            "type": "web_search_20250305",
            "name": "web_search",
        }],
        messages=[{"role": "user", "content": prompt}],
    )

    # Extract text from response — may contain tool_use blocks before the final text
    text = ""
    for block in response.content:
        if hasattr(block, "text"):
            text += block.text

    # Strip markdown fences if present
    text = text.strip()
    if "```" in text:
        start = text.find("[")
        end = text.rfind("]") + 1
        if start >= 0 and end > start:
            text = text[start:end]

    if not text:
        raise ValueError("Claude returned empty response — no JSON array found")

    sections = json.loads(text)
    print(
        f"[section_retrieval] Claude returned {len(sections)} sections from web search",
        flush=True,
    )
    return sections


_REQUIRED_FIELDS: dict[str, tuple] = {
    "designation":    (str,   None, None),
    "mass_kg_per_m":  (float,    0,  500),
    "h_mm":           (float,   50, 1000),
    "b_mm":           (float,   50,  500),
    "tf_mm":          (float,    1,   50),
    "tw_mm":          (float,    1,   50),
    "Iy_cm4":         (float,    1, 1_000_000),
    "Wpl_y_cm3":      (float,    1, 100_000),
    "Wel_y_cm3":      (float,    1, 100_000),
    "fy_N_per_mm2":   (float,  200,  500),
}


def _validate_section_dict(sec: dict) -> bool:
    """
    Returns True if section dict has all required fields with plausible values.
    Rejects hallucinated or malformed Claude output before it reaches _check_section().
    """
    for field, (ftype, low, high) in _REQUIRED_FIELDS.items():
        val = sec.get(field)
        if val is None:
            print(
                f"[section_retrieval] Rejected section "
                f"{sec.get('designation', '?')}: missing {field}",
                flush=True,
            )
            return False
        if ftype == float:
            try:
                val = float(val)
            except (TypeError, ValueError):
                print(
                    f"[section_retrieval] Rejected section "
                    f"{sec.get('designation', '?')}: {field} not numeric",
                    flush=True,
                )
                return False
            if low is not None and not (low < val < high):
                print(
                    f"[section_retrieval] Rejected section "
                    f"{sec.get('designation', '?')}: "
                    f"{field}={val} out of range ({low}, {high})",
                    flush=True,
                )
                return False
    return True


def _verify_against_cache(sections: list[dict]) -> list[dict]:
    """
    Validate, then cross-check LLM-extracted sections against grade-specific libraries.
    Grade is derived per-section from fy_N_per_mm2 (fy >= 355 → S355, else S275).
    Prefer cached entry when designation matches (authoritative geometry).
    Keep LLM entry only when designation not in cache.
    Returns sorted ascending by mass.
    Raises ValueError if all sections fail validation.
    """
    s275 = _load_grade_library("parts_library_S275.json")
    s355 = _load_grade_library("parts_library_S355.json")
    cache_s275 = {s["designation"]: s for s in s275}
    cache_s355 = {s["designation"]: s for s in s355}

    verified: list[dict] = []
    for sec in sections:
        if not _validate_section_dict(sec):
            continue
        desig = sec.get("designation", "")
        fy = float(sec.get("fy_N_per_mm2", 275))
        cache = cache_s355 if fy >= 355 else cache_s275
        if desig in cache:
            verified.append(cache[desig])
        else:
            verified.append(sec)

    if not verified:
        raise ValueError("All Claude-returned sections failed validation")

    return sorted(verified, key=lambda s: s.get("mass_kg_per_m", 9999))


async def select_section(
    M_Ed_kNm: float,
    V_Ed_kN: float,
    w_kN_per_m: float,
    L_mm: float,
    Lcr_mm: float,
    post_length_m: float,
    deflection_limit_n: float,
    remarks: str = "",
) -> dict:
    """
    Select the lightest passing UB section using live Claude web search with
    combined grade-library fallback. Grade is determined autonomously from the
    returned section's fy_N_per_mm2 — not a user input.

    Returns the same dict shape as _check_section() with additional keys:
      "source": "live" | "cache"
      "fallback_reason": str | None
      "all_sections": list[dict]  — all verified candidates for optimisation
    """
    print(
        f"[section_retrieval] Attempting live retrieval — "
        f"M_Ed={M_Ed_kNm:.2f} kNm, V_Ed={V_Ed_kN:.2f} kN",
        flush=True,
    )

    check_kwargs = dict(
        M_Ed_kNm=M_Ed_kNm,
        V_Ed_kN=V_Ed_kN,
        w_kN_per_m=w_kN_per_m,
        L_mm=L_mm,
        Lcr_mm=Lcr_mm,
        post_length_m=post_length_m,
        deflection_limit_n=deflection_limit_n,
    )

    # Use fy=275 as conservative default — larger minimum Wpl means Claude
    # returns more candidates; grade is determined from the returned section's fy.
    wpl_min_cm3 = M_Ed_kNm * 1e6 / 275.0 / 1e3

    fallback_reason: str | None = None

    try:
        raw = _search_sections_with_claude(
            M_Ed_kNm=M_Ed_kNm,
            V_Ed_kN=V_Ed_kN,
            wpl_min_cm3=wpl_min_cm3,
            remarks=remarks,
        )
        verified = _verify_against_cache(raw)

        # Run checks on all verified sections, collect results
        results = []
        for sec in verified:
            check = _check_section(sec=sec, **check_kwargs)
            results.append({**check, "section": sec})

        # Return lightest passing section + full list for optimisation
        for r in results:
            if r["pass"]:
                print(
                    f"[section_retrieval] Live: selected {r['designation']}",
                    flush=True,
                )
                return {
                    **r,
                    "source": "live",
                    "all_sections": verified,
                    "fallback_reason": None,
                }

        fallback_reason = "No live candidate passed all checks — falling back to library"
        print(f"[section_retrieval] {fallback_reason}", flush=True)

        # Even if none passed, return best result with all_sections so frontend
        # can run optimise (may go up from here)
        if results:
            return {
                **results[0],
                "source": "live",
                "all_sections": verified,
                "fallback_reason": fallback_reason,
            }

    except RuntimeError as exc:
        fallback_reason = str(exc)
        print(f"[section_retrieval] RuntimeError: {fallback_reason}", flush=True)
    except Exception as exc:
        fallback_reason = f"{type(exc).__name__}: {exc}"
        print(f"[section_retrieval] Exception: {fallback_reason}", flush=True)

    # Combined-library fallback (both grades, sorted by mass ascending)
    print("[section_retrieval] Running cache fallback...", flush=True)
    s275 = _load_grade_library("parts_library_S275.json")
    s355 = _load_grade_library("parts_library_S355.json")
    grade_sections = sorted(s275 + s355, key=lambda s: s.get("mass_kg_per_m", 9999))

    if not grade_sections:
        grade_sections = _load_sections()

    cache_results = []
    for sec in grade_sections:
        result = _check_section(sec=sec, **check_kwargs)
        cache_results.append({**result, "section": sec})
        if result["pass"]:
            print(
                f"[section_retrieval] Cache: selected {result['designation']}",
                flush=True,
            )
            return {
                **result,
                "source": "cache",
                "all_sections": grade_sections,
                "fallback_reason": fallback_reason,
            }

    return {
        "error": "No section passes checks in live retrieval or parts library cache.",
        "pass": False,
        "fallback_reason": fallback_reason,
        "all_sections": grade_sections,
    }
