"""
Steel section retrieval — library iteration only.

select_section() iterates the combined S275+S355 parts library (or a grade-filtered
subset when constraints specify) and returns the lightest passing section.

parse_remarks() extracts design constraints from free-text engineer remarks via
Claude claude-sonnet-4-6 structured output. Non-blocking — returns empty constraints
on any failure.

find_suppliers() queries Claude with web_search to find Singapore structural steel
suppliers for the selected grade. Returns a shortlist with contact details. Non-blocking,
20s timeout. Never affects section selection or engineering outputs.

No web search in section selection. Library-sourced properties are correct and reliable.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import anthropic

from app.calculation.steel import _check_section

_DATA_DIR = Path(__file__).parent.parent / "data"


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
    parts_path = _DATA_DIR / "parts_library.json"
    with parts_path.open() as f:
        data = json.load(f)
    return {s["designation"]: s for s in data["sections"]}


_EMPTY_CONSTRAINTS: dict = {
    "grade": None,
    "condition_factor": None,
    "min_bolt_diameter_mm": None,
    "flag_lta": False,
    "flag_temporary": False,
    "flag_coastal": False,
    "notes_for_advisor": "",
    "constraints_parsed": False,
}

_UNKNOWN_SUPPLIERS: dict = {
    "suppliers": [],
    "search_summary": "Supplier search unavailable",
    "grade_note": None,
    "suppliers_found": False,
}


def parse_remarks(remarks: str) -> dict:
    """
    Extract design constraints from free-text engineer remarks via Claude.
    Returns a constraints dict. Non-blocking — returns empty constraints on any failure.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return dict(_EMPTY_CONSTRAINTS)

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=256,
            system=(
                "You are a structural engineering assistant. Extract design constraints "
                "from engineer remarks for a noise barrier project. Return ONLY valid "
                "JSON with no explanation or markdown."
            ),
            messages=[{
                "role": "user",
                "content": (
                    'Extract constraints from these remarks. Return ONLY this JSON structure '
                    'with no other text:\n'
                    '{\n'
                    '  "grade": "S275" or "S355" or null,\n'
                    '  "condition_factor": 0.8 or null,\n'
                    '  "min_bolt_diameter_mm": 24 or null,\n'
                    '  "flag_lta": true or false,\n'
                    '  "flag_temporary": true or false,\n'
                    '  "flag_coastal": true or false,\n'
                    '  "notes_for_advisor": "brief note or empty string"\n'
                    '}\n\n'
                    'Rules:\n'
                    '- grade: set only if S275, S355, grade 275, grade 355 explicitly mentioned\n'
                    '- condition_factor: 0.8 if used, second-hand, reconditioned, pre-owned mentioned\n'
                    '- min_bolt_diameter_mm: 24 if LTA or Land Transport Authority mentioned\n'
                    '- flag_lta: true if LTA or Land Transport Authority mentioned\n'
                    '- flag_temporary: true if temporary, temp works, or short-term mentioned\n'
                    '- flag_coastal: true if coastal, marine, waterfront, or sea mentioned\n'
                    '- notes_for_advisor: one sentence max, empty string if nothing notable\n\n'
                    f'Remarks: "{remarks}"'
                ),
            }],
        )

        text = ""
        for block in response.content:
            if hasattr(block, "text"):
                text += block.text
        text = text.strip()
        if text.startswith("```"):
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                text = text[start:end]

        parsed = json.loads(text)

        # Whitelist validation — reject anything outside the allowed value sets
        # so a hallucinated grade or factor cannot reach _check_section().
        grade = parsed.get("grade")
        if grade not in (None, "S275", "S355"):
            parsed["grade"] = None

        cf = parsed.get("condition_factor")
        if cf not in (None, 0.8):
            parsed["condition_factor"] = None

        return {**_EMPTY_CONSTRAINTS, **parsed, "constraints_parsed": True}

    except Exception:
        return dict(_EMPTY_CONSTRAINTS)


def find_suppliers(designation: str, grade: str, mass_kg_per_m: float) -> dict:
    """
    Query Claude with web_search + web_fetch to find Singapore structural steel
    suppliers for the selected grade. Claude searches first, then visits each
    supplier's contact page to extract phone and email.
    Non-blocking — returns unknown_result on any failure or timeout.
    Never affects section selection or engineering outputs.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return dict(_UNKNOWN_SUPPLIERS)

    try:
        import traceback

        client = anthropic.Anthropic(api_key=api_key)

        prompt = (
            f'Find structural steel suppliers in Singapore that stock Universal '
            f'Beam (UB) sections in grade {grade}. The specific section needed '
            f'is {designation} ({mass_kg_per_m}kg/m).\n\n'
            'Follow these steps:\n'
            '1. Search for Singapore steel suppliers and distributors that carry '
            f'UB sections in {grade}. Include Continental Steel Singapore and '
            'any other relevant stockists.\n'
            '2. For each supplier you find, visit their website contact page '
            'to extract their phone number and email address.\n'
            '3. Return the compiled supplier list.\n\n'
            'Return ONLY valid JSON, no explanation, no markdown fences:\n'
            '{\n'
            '  "suppliers": [\n'
            '    {\n'
            '      "name": "company name",\n'
            '      "website": "full URL or null",\n'
            '      "phone": "+65 XXXX XXXX or null",\n'
            '      "email": "email@domain.com or null",\n'
            '      "notes": "one sentence about what they supply"\n'
            '    }\n'
            '  ],\n'
            '  "search_summary": "one sentence summary of what was found",\n'
            '  "grade_note": "any note about grade availability or null"\n'
            '}\n\n'
            'Return up to 5 suppliers. Set phone/email to null only if you '
            'genuinely cannot find them after visiting the website. '
            'Do not fabricate contact details.'
        )

        messages: list[dict] = [{"role": "user", "content": prompt}]
        tools = [
            {"type": "web_search_20250305", "name": "web_search"},
            {"type": "web_fetch_20250910", "name": "web_fetch"},
        ]
        max_turns = 8
        response = None

        for turn in range(1, max_turns + 1):
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                timeout=45.0,
                tools=tools,
                messages=messages,
            )

            print(f"[find_suppliers] turn {turn} stop_reason: {response.stop_reason}", flush=True)
            print(f"[find_suppliers] turn {turn} block count: {len(response.content)}", flush=True)
            for i, block in enumerate(response.content):
                print(f"[find_suppliers] block[{i}] type: {block.type}", flush=True)
                if block.type == "text":
                    print(f"[find_suppliers] block[{i}] text (first 500): {block.text[:500]}", flush=True)
                if block.type == "tool_use":
                    print(f"[find_suppliers] block[{i}] tool_name: {block.name}", flush=True)
                    print(f"[find_suppliers] block[{i}] tool_input (first 200): {str(block.input)[:200]}", flush=True)

            if response.stop_reason == "end_turn":
                break

            if response.stop_reason == "tool_use":
                # Append assistant turn and continue — built-in tools are executed
                # server-side; no manual tool_result submission needed.
                messages.append({"role": "assistant", "content": response.content})
                continue

            # Any other stop_reason (e.g. max_tokens) — break and attempt extraction
            break

        if response is None:
            return dict(_UNKNOWN_SUPPLIERS)

        # Extract final JSON from last text block — take last, not accumulate,
        # because intermediate text blocks may contain tool reasoning.
        text = ""
        for block in response.content:
            if hasattr(block, "text"):
                text = block.text
        text = text.strip()

        print(f"[find_suppliers] extracted text (first 300): {text[:300] if text else 'EMPTY'}", flush=True)

        if "```json" in text:
            start = text.find("```json") + 7
            end = text.find("```", start)
            if end > start:
                text = text[start:end].strip()
        elif "```" in text:
            start = text.find("```") + 3
            end = text.find("```", start)
            if end > start:
                text = text[start:end].strip()
        else:
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                text = text[start:end]

        try:
            parsed = json.loads(text)
            print(f"[find_suppliers] parsed suppliers count: {len(parsed.get('suppliers', []))}", flush=True)
        except json.JSONDecodeError as e:
            print(f"[find_suppliers] JSON parse failed: {e}", flush=True)
            print(f"[find_suppliers] raw text was: {text}", flush=True)
            return dict(_UNKNOWN_SUPPLIERS)

        suppliers = parsed.get("suppliers")
        if not isinstance(suppliers, list):
            return dict(_UNKNOWN_SUPPLIERS)

        # Validate each entry has at minimum a name field; drop invalid rows
        suppliers = [s for s in suppliers if isinstance(s, dict) and s.get("name")]

        # Clamp to 5
        suppliers = suppliers[:5]
        parsed["suppliers"] = suppliers

        return {
            **_UNKNOWN_SUPPLIERS,
            **parsed,
            "suppliers": suppliers,
            "suppliers_found": len(suppliers) > 0,
        }

    except Exception as e:
        print(f"[find_suppliers] outer exception: {type(e).__name__}: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return dict(_UNKNOWN_SUPPLIERS)


def select_section(
    M_Ed_kNm: float,
    V_Ed_kN: float,
    w_kN_per_m: float,
    L_mm: float,
    Lcr_mm: float,
    post_length_m: float,
    deflection_limit_n: float,
    constraints: dict | None = None,
) -> dict:
    """
    Select the lightest passing UB section from the parts library.

    Uses the combined S275+S355 library by default; filters to a single grade
    when constraints["grade"] is set. Applies condition_factor to Wpl when
    constraints["condition_factor"] is set (used/reconditioned sections).

    After finding a passing section, runs find_suppliers() (non-blocking) to
    return a Singapore supplier shortlist for the selected grade.

    Returns the same dict shape as _check_section() plus:
      "source": always "cache"
      "fallback_reason": None or error string
      "all_sections": list of all candidate sections
      "constraints_applied": the constraints dict used
      "suppliers": supplier search result dict
    """
    constraints = constraints or {}

    grade = constraints.get("grade")
    if grade == "S355":
        sections = _load_grade_library("parts_library_S355.json")
    elif grade == "S275":
        sections = _load_grade_library("parts_library_S275.json")
    else:
        s275 = _load_grade_library("parts_library_S275.json")
        s355 = _load_grade_library("parts_library_S355.json")
        sections = sorted(s275 + s355, key=lambda s: s.get("mass_kg_per_m", 9999))

    condition_factor = constraints.get("condition_factor") or 1.0

    check_kwargs = dict(
        M_Ed_kNm=M_Ed_kNm,
        V_Ed_kN=V_Ed_kN,
        w_kN_per_m=w_kN_per_m,
        L_mm=L_mm,
        Lcr_mm=Lcr_mm,
        post_length_m=post_length_m,
        deflection_limit_n=deflection_limit_n,
        condition_factor=condition_factor,
    )

    passing_results: list[dict] = []
    for sec in sections:
        r = _check_section(sec=sec, **check_kwargs)
        if r["pass"]:
            passing_results.append(r)

    if not passing_results:
        return {
            "error": "No section passes checks in parts library.",
            "pass": False,
            "source": "cache",
            "all_sections": sections,
            "fallback_reason": "No passing section found",
            "constraints_applied": constraints,
            "suppliers": dict(_UNKNOWN_SUPPLIERS),
        }

    primary = passing_results[0]
    section_grade = "S355" if primary.get("fy_N_per_mm2", 275) >= 355 else "S275"

    try:
        suppliers = find_suppliers(
            designation=primary["designation"],
            grade=section_grade,
            mass_kg_per_m=primary["mass_kg_per_m"],
        )
    except Exception:
        suppliers = dict(_UNKNOWN_SUPPLIERS)

    return {
        **primary,
        "source": "cache",
        "all_sections": sections,
        "fallback_reason": None,
        "constraints_applied": constraints,
        "suppliers": suppliers,
    }
