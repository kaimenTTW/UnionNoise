"""
POST /api/optimize-section

Deterministic optimisation loop against the grade-specific UB library.

Case A (starting section fails any check):
  Move UP (heavier) from the starting index.
  First section where all checks pass → selected.

Case B (starting section passes all checks):
  Move DOWN (lighter) from the starting index.
  Stop when a check fails (use previous) OR max(UR) >= 0.95 (use current).
  Selected = last all-pass section before failure or first 0.95-threshold hit.
"""

from __future__ import annotations

import bisect
from functools import lru_cache
from pathlib import Path
import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.calculation.steel import _check_section

router = APIRouter(prefix="/api", tags=["optimize-section"])

_DATA_DIR = Path(__file__).parent.parent / "data"


@lru_cache(maxsize=2)
def _load_grade_sections(grade_file: str) -> list[dict]:
    with (_DATA_DIR / grade_file).open() as f:
        data = json.load(f)
    return sorted(data["sections"], key=lambda s: s.get("mass_kg_per_m", 9999))


# ── Request / Response ────────────────────────────────────────────────────────

class OptimizeSectionRequest(BaseModel):
    section: dict = Field(..., description="Starting section dict (designation + geometry).")

    # Demand parameters (must match the select-section call)
    w_kN_per_m: float = Field(..., gt=0)
    L_mm: float = Field(..., gt=0)
    Lcr_mm: float = Field(..., gt=0)
    post_length_m: float = Field(..., gt=0)
    deflection_limit_n: float = Field(65.0, gt=0)
    M_Ed_kNm: float = Field(..., gt=0)
    V_Ed_kN: float = Field(..., gt=0)


class OptimizeSectionResponse(BaseModel):
    selected_section: dict
    checks: dict
    optimisation_case: str          # "A" or "B"
    iterations: int
    optimised: bool                 # True when max UR >= 0.95
    message: str


# ── Endpoint ─────────────────────────────────────────────────────────────────

@router.post("/optimize-section", response_model=OptimizeSectionResponse)
def optimize_section(body: OptimizeSectionRequest) -> OptimizeSectionResponse:
    """
    Run the optimisation loop against the grade-specific UB library.
    Pure Python — no LLM in loop.
    """
    fy = float(body.section.get("fy_N_per_mm2", 275.0))
    grade_file = (
        "parts_library_S355.json"
        if fy >= 355
        else "parts_library_S275.json"
    )

    try:
        library = _load_grade_sections(grade_file)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Library load failed: {exc}") from exc

    if not library:
        raise HTTPException(status_code=422, detail=f"No sections in library for fy={fy}")

    check_kwargs = dict(
        M_Ed_kNm=body.M_Ed_kNm,
        V_Ed_kN=body.V_Ed_kN,
        w_kN_per_m=body.w_kN_per_m,
        L_mm=body.L_mm,
        Lcr_mm=body.Lcr_mm,
        post_length_m=body.post_length_m,
        deflection_limit_n=body.deflection_limit_n,
    )

    # Find starting index: match designation, fallback to mass bisect
    start_desig = body.section.get("designation", "")
    start_mass = body.section.get("mass_kg_per_m", 0.0)
    start_idx = None
    for i, sec in enumerate(library):
        if sec["designation"] == start_desig:
            start_idx = i
            break
    if start_idx is None:
        # Insert position by mass
        masses = [s["mass_kg_per_m"] for s in library]
        start_idx = bisect.bisect_left(masses, start_mass)
        start_idx = min(start_idx, len(library) - 1)

    # Check the starting section
    start_check = _check_section(sec=library[start_idx], **check_kwargs)

    if not start_check["pass"]:
        # ── Case A: move UP (heavier) until all pass ──────────────────────────
        selected_section = None
        selected_check = None
        iterations = 0
        for i in range(start_idx, len(library)):
            iterations += 1
            sec = library[i]
            check = _check_section(sec=sec, **check_kwargs)
            if check["pass"]:
                selected_section = sec
                selected_check = check
                break

        if selected_section is None:
            raise HTTPException(
                status_code=422,
                detail="No section in library passes all checks — demand may be too high.",
            )

        max_ur = max(
            selected_check["UR_moment"],
            selected_check["UR_deflection"],
            selected_check["UR_shear"],
        )
        return OptimizeSectionResponse(
            selected_section=selected_section,
            checks={
                "UR_moment": selected_check["UR_moment"],
                "UR_deflection": selected_check["UR_deflection"],
                "UR_shear": selected_check["UR_shear"],
                "pass": True,
            },
            optimisation_case="A",
            iterations=iterations,
            optimised=max_ur >= 0.95,
            message=(
                f"Case A: starting section failed checks. "
                f"Moved up {iterations} position(s) to find the lightest passing section."
            ),
        )

    else:
        # ── Case B: move DOWN (lighter) seeking passes + max(UR) >= 0.95 ─────
        # Primary goal: find a section where ALL checks pass AND max(UR) >= 0.95.
        # Fallback: if failure is hit before 0.95 is reached, return the last
        # section that passed (even if max(UR) < 0.95).
        last_pass_idx = start_idx
        last_pass_check = start_check
        iterations = 0

        for i in range(start_idx - 1, -1, -1):
            iterations += 1
            sec = library[i]
            check = _check_section(sec=sec, **check_kwargs)
            max_ur = max(check["UR_moment"], check["UR_deflection"], check["UR_shear"])

            if not check["pass"]:
                # Failed — use the last passing section (fallback)
                break

            last_pass_idx = i
            last_pass_check = check

            if max_ur >= 0.95:
                # Both conditions met: passes + well utilised — stop here
                break

        selected_section = library[last_pass_idx]
        selected_check = last_pass_check
        max_ur = max(
            selected_check["UR_moment"],
            selected_check["UR_deflection"],
            selected_check["UR_shear"],
        )
        optimised = max_ur >= 0.95
        return OptimizeSectionResponse(
            selected_section=selected_section,
            checks={
                "UR_moment": selected_check["UR_moment"],
                "UR_deflection": selected_check["UR_deflection"],
                "UR_shear": selected_check["UR_shear"],
                "pass": True,
            },
            optimisation_case="B",
            iterations=iterations,
            optimised=optimised,
            message=(
                f"Case B: moved down {iterations} position(s). "
                + (
                    f"Both conditions met: max UR = {max_ur:.3f} >= 0.95."
                    if optimised
                    else f"Fallback — no lighter passing section reaches 0.95 (max UR = {max_ur:.3f})."
                )
            ),
        )
