"""
PDF report generator -- ReportLab platypus layout.

Receives a payload dict containing all calculation results and project info.
Returns PDF as bytes. Called from POST /api/report/generate.

Section order:
  1  Design Basis
  2  Wind Analysis
  3  Steel Post Design
  4  Connection Design
  5  Subframe Design
  6  Lifting Design
  7  Foundation Design
  8  Results Summary
"""

from __future__ import annotations

import io
import math
from datetime import datetime
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.graphics.renderPDF import draw as rl_draw
from reportlab.graphics.shapes import (
    Drawing,
    Group,
    Line,
    Rect,
    Circle,
    String,
)
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.flowables import Flowable

from .constants import APPLICABLE_CODES

# -- Colour palette -----------------------------------------------------------
_BLACK   = colors.HexColor("#000000")
_WHITE   = colors.HexColor("#FFFFFF")
_GREY_LT = colors.HexColor("#F2F2F2")   # table header background
_GREY_MD = colors.HexColor("#CCCCCC")   # table border
_GREY_DK = colors.HexColor("#888888")   # secondary text
_RED     = colors.HexColor("#8B0000")   # FAIL
_GREEN   = colors.HexColor("#2D6A2D")   # PASS
_AMBER   = colors.HexColor("#7A5C00")   # override note

# -- Page dimensions ----------------------------------------------------------
_W, _H   = A4
_ML = _MR = 20 * mm
_MT = _MB  = 25 * mm
_USABLE_W = _W - _ML - _MR   # 170 mm

# -- Paragraph styles ---------------------------------------------------------
_S_SMALL  = ParagraphStyle("Small",  fontName="Helvetica",       fontSize=8,  leading=11)
_S_BOLD   = ParagraphStyle("Bold",   fontName="Helvetica-Bold",  fontSize=9,  leading=13)
_S_H1     = ParagraphStyle("H1",     fontName="Helvetica-Bold",  fontSize=18, leading=22, alignment=1)
_S_H2     = ParagraphStyle("H2",     fontName="Helvetica-Bold",  fontSize=12, leading=16, alignment=1)
_S_H3     = ParagraphStyle("H3",     fontName="Helvetica-Bold",  fontSize=10, leading=14)
_S_MONO   = ParagraphStyle("Mono",   fontName="Courier",         fontSize=8,  leading=11)
_S_AMBER  = ParagraphStyle("Amber",  fontName="Helvetica-Oblique", fontSize=8, leading=11, textColor=_AMBER)

# Table cell styles -- wordWrap='CJK' forces wrapping on any boundary
_TS_CELL  = ParagraphStyle("TCell",  fontName="Helvetica",      fontSize=8, leading=10, wordWrap="CJK")
_TS_BOLD  = ParagraphStyle("TBold",  fontName="Helvetica-Bold", fontSize=8, leading=10, wordWrap="CJK")

# -- Table base style ---------------------------------------------------------
_TS_BASE = TableStyle([
    ("GRID",          (0, 0), (-1, -1), 0.5, _GREY_MD),
    ("FONTNAME",      (0, 0), (-1, -1), "Helvetica"),
    ("FONTSIZE",      (0, 0), (-1, -1), 8),
    ("TOPPADDING",    (0, 0), (-1, -1), 3),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ("LEFTPADDING",   (0, 0), (-1, -1), 5),
    ("RIGHTPADDING",  (0, 0), (-1, -1), 5),
    ("BACKGROUND",    (0, 0), (-1, 0), _GREY_LT),
    ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [_WHITE, colors.HexColor("#FAFAFA")]),
    ("VALIGN",        (0, 0), (-1, -1), "TOP"),
])


# -- Helper: safe float formatting --------------------------------------------

def _f(v: Any, dp: int = 3, unit: str = "") -> str:
    """Format a numeric value; return em-dash for None."""
    if v is None:
        return "--"
    try:
        formatted = f"{float(v):.{dp}f}"
        return f"{formatted} {unit}".strip() if unit else formatted
    except (TypeError, ValueError):
        return str(v)


def _p(text: str, style: ParagraphStyle | None = None) -> Paragraph:
    """Wrap a string in a Paragraph for table cell use."""
    return Paragraph(str(text) if text is not None else "--", style or _TS_CELL)


def _ph(text: str) -> Paragraph:
    """Header cell paragraph."""
    return Paragraph(str(text), _TS_BOLD)


def _pass_cell(passed: bool | None) -> Paragraph:
    if passed is True:
        return Paragraph('<font color="#2D6A2D"><b>PASS</b></font>', _TS_CELL)
    elif passed is False:
        return Paragraph('<font color="#8B0000"><b>FAIL</b></font>', _TS_CELL)
    return _p("--")


def _ur_row(label: str, ur: float | None, limit: float = 1.0, demand: str = "", capacity: str = "") -> list:
    if ur is None:
        return [_p(label), _p(demand), _p(capacity), _p("--"), _pass_cell(None)]
    passed = ur < limit
    return [_p(label), _p(demand), _p(capacity), _p(_f(ur, 3)), _pass_cell(passed)]


def _section_title(title: str, num: str) -> Table:
    t = Table([[_ph(f"{num}  {title}")]], colWidths=[_USABLE_W])
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), _GREY_LT),
        ("FONTNAME",      (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, -1), 10),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("LINEBELOW",     (0, 0), (-1, -1), 1, _BLACK),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def _sub_title(title: str) -> Table:
    t = Table([[_ph(title)]], colWidths=[_USABLE_W])
    t.setStyle(TableStyle([
        ("FONTNAME",      (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, -1), 9),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING",   (0, 0), (-1, -1), 4),
        ("LINEBELOW",     (0, 0), (-1, -1), 0.5, _GREY_MD),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    return t


# Two-column inputs table: Parameter 70mm / Value 100mm
_CW_INPUTS = [70 * mm, 100 * mm]

def _inputs_table(rows: list[tuple[str, str]]) -> Table:
    data = [[_ph("Parameter"), _ph("Value")]] + [[_p(r[0]), _p(r[1])] for r in rows]
    t = Table(data, colWidths=_CW_INPUTS)
    t.setStyle(_TS_BASE)
    return t


def _spec_table(rows: list[tuple[str, str]]) -> Table:
    """Component Specification table -- same column widths as inputs, grey header."""
    data = [[_ph("Component Specification"), _ph("")]] + [[_p(r[0]), _p(r[1])] for r in rows]
    t = Table(data, colWidths=_CW_INPUTS)
    ts = TableStyle(list(_TS_BASE._cmds))
    t.setStyle(ts)
    return t


# Four-column derivation table: Description 40mm / Formula 45mm / Substitution 55mm / Result 30mm
_CW_DERIV = [40 * mm, 45 * mm, 55 * mm, 30 * mm]

def _derivation_table(rows: list[list]) -> Table:
    hdr = [_ph("Description"), _ph("Formula"), _ph("Substitution / Result"), _ph("Ref")]
    data = [hdr] + [[_p(c) for c in row] for row in rows]
    t = Table(data, colWidths=_CW_DERIV, repeatRows=1)
    t.setStyle(_TS_BASE)
    return t


def _results_table(rows: list[list], headers: list[str] | None = None) -> Table:
    if headers is None:
        headers = ["Check", "Demand", "Capacity", "UR / FOS", "Result"]
    # Five-column variant when default headers used
    if len(headers) == 5:
        cw = [50 * mm, 35 * mm, 35 * mm, 25 * mm, 25 * mm]
    else:
        cw = [50 * mm, 35 * mm, 35 * mm, 25 * mm, 25 * mm]
    data = [[_ph(h) for h in headers]] + rows
    t = Table(data, colWidths=cw)
    ts = TableStyle(list(_TS_BASE._cmds))
    t.setStyle(ts)
    return t


def _sp(n: float = 4) -> Spacer:
    return Spacer(1, n * mm)


# -- Base plate sketch ---------------------------------------------------------

class _DrawingFlowable(Flowable):
    """Thin wrapper so a ReportLab Drawing can sit in a Platypus story."""

    def __init__(self, drawing: Drawing):
        super().__init__()
        self._d = drawing
        self.width  = drawing.width
        self.height = drawing.height

    def draw(self):
        rl_draw(self._d, self.canv, 0, 0)


def draw_base_plate_sketch(conn: dict, section: dict) -> Drawing:
    """
    Return a dimensioned base plate plan view Drawing from connection and
    section result dicts. Coordinates computed in mm, converted to ReportLab
    points via ×mm exactly once at each drawing call. sf is dimensionless.
    """
    # ── Extract geometry (mm, raw) ────────────────────────────────────────────
    bp = conn.get("base_plate", {}) or {}
    bt = conn.get("bolt_tension", {}) or {}
    be = conn.get("bolt_embedment", {}) or {}

    plate_w  = float(bp.get("plate_width_mm")  or 400)
    plate_h  = float(bp.get("plate_height_mm") or 500)
    plate_t  = float(bp.get("plate_thickness_mm") or 20)
    bolt_d   = float(bt.get("bolt_diameter_mm") or 20)
    n_cols   = int(bt.get("n_tension") or 2)
    Ds       = float(bt.get("Ds_mm") or 300)
    edge     = 50.0
    b_fl     = float(section.get("b_mm") or 150)
    h_sec    = float(section.get("h_mm") or 300)
    L_prov   = float(be.get("L_provided_mm") or 0)
    desig    = section.get("designation", "--")
    bolt_grade  = "8.8"
    total_bolts = n_cols * 2

    # p2: bolt pitch (mm). Defined here for use in both bolt circles and labels.
    p2_mm = (plate_w - 2 * edge) / max(n_cols - 1, 1) if n_cols > 1 else 0.0

    # ── Scale factor ──────────────────────────────────────────────────────────
    sf = min(140.0 / plate_w, 160.0 / plate_h) * 0.85

    # Canvas margins (mm, unscaled) — space for dim lines and title outside plate
    margin_l = 25.0   # left  — Ds dim line
    margin_r = 25.0   # right — plate height dim line
    margin_b = 20.0   # bottom — plate width dim line
    margin_t = 14.0   # top   — title

    ann_strip = 36.0  # mm — annotation block height (3 lines × 10pt + padding)

    pw_sc = plate_w * sf   # scaled plate width  [mm]
    ph_sc = plate_h * sf   # scaled plate height [mm]

    canvas_w = (margin_l + pw_sc + margin_r) * mm
    canvas_h = (ann_strip + margin_b + ph_sc + margin_t) * mm

    drw = Drawing(canvas_w, canvas_h)

    ox = margin_l * mm                    # plate left edge [pt]
    oy = (ann_strip + margin_b) * mm      # plate bottom edge [pt]
    pw = pw_sc * mm
    ph = ph_sc * mm
    cx = ox + pw / 2
    cy = oy + ph / 2

    # ── Geometry sanity ───────────────────────────────────────────────────────
    bolt_zone_h = plate_h - 2 * edge
    bolt_zone_w = plate_w - 2 * edge

    footprint_note = ""
    drawn_h = h_sec
    drawn_b = b_fl
    if h_sec >= bolt_zone_h:
        drawn_h = bolt_zone_h - 2 * edge
        footprint_note = f"Section depth truncated for clarity (actual h={int(h_sec)}mm)"
    if b_fl >= bolt_zone_w:
        drawn_b = bolt_zone_w - 2 * edge

    fw = drawn_b * sf * mm
    fh = drawn_h * sf * mm

    # ── 1. Base plate ─────────────────────────────────────────────────────────
    drw.add(Rect(ox, oy, pw, ph,
                 fillColor=colors.HexColor("#E8E8E8"),
                 strokeColor=colors.HexColor("#000000"), strokeWidth=1.5))

    # ── 2. Section footprint ──────────────────────────────────────────────────
    drw.add(Rect(cx - fw / 2, cy - fh / 2, fw, fh,
                 fillColor=colors.HexColor("#B0B0B0"),
                 strokeColor=colors.HexColor("#000000"), strokeWidth=1.0))

    # ── 3. Centrelines ────────────────────────────────────────────────────────
    ext = 6 * mm
    cl = dict(strokeColor=colors.HexColor("#666666"), strokeDashArray=[4, 3], strokeWidth=0.5)
    drw.add(Line(ox - ext, cy, ox + pw + ext, cy, **cl))
    drw.add(Line(cx, oy - ext, cx, oy + ph + ext, **cl))

    # ── 4. Bolt circles ───────────────────────────────────────────────────────
    br = min(max(bolt_d * sf * mm * 0.35, 4), 8)

    if n_cols == 1:
        x_cols = [cx]
    elif n_cols == 2:
        x_cols = [ox + edge * sf * mm, ox + (plate_w - edge) * sf * mm]
    else:
        x_cols = [ox + (edge + i * p2_mm) * sf * mm for i in range(n_cols)]

    y_tension     = oy + (plate_h - edge) * sf * mm
    y_compression = oy + edge * sf * mm

    for xc in x_cols:
        for yr in (y_tension, y_compression):
            drw.add(Circle(xc, yr, br,
                           fillColor=colors.HexColor("#1A1A1A"),
                           strokeColor=None, strokeWidth=0))

    # ── 5. Bolt pitch label inside plate (between bolt columns, if n_cols > 1) ─
    if n_cols > 1 and len(x_cols) >= 2:
        mid_pitch_x = (x_cols[0] + x_cols[1]) / 2
        mid_pitch_y = (y_tension + y_compression) / 2
        drw.add(String(mid_pitch_x, mid_pitch_y,
                       f"p={int(round(p2_mm))}mm",
                       fontName="Helvetica", fontSize=6,
                       fillColor=colors.HexColor("#444444"), textAnchor="middle"))

    # ── 6. Dimension lines ────────────────────────────────────────────────────
    tick = 3 * mm

    def _hdim(x1, x2, y_base, label, above=True, fs=7):
        dy   = tick / 2
        sign = 1 if above else -1
        drw.add(Line(x1, y_base - dy, x1, y_base + dy, strokeColor=_BLACK, strokeWidth=0.5))
        drw.add(Line(x2, y_base - dy, x2, y_base + dy, strokeColor=_BLACK, strokeWidth=0.5))
        drw.add(Line(x1, y_base, x2, y_base, strokeColor=_BLACK, strokeWidth=0.5))
        drw.add(String((x1 + x2) / 2, y_base + sign * (dy + 1.5 * mm), label,
                       fontName="Helvetica", fontSize=fs, fillColor=_BLACK, textAnchor="middle"))

    def _vdim(y1, y2, x_base, label, right=True, fs=7):
        dx   = tick / 2
        sign = 1 if right else -1
        drw.add(Line(x_base - dx, y1, x_base + dx, y1, strokeColor=_BLACK, strokeWidth=0.5))
        drw.add(Line(x_base - dx, y2, x_base + dx, y2, strokeColor=_BLACK, strokeWidth=0.5))
        drw.add(Line(x_base, y1, x_base, y2, strokeColor=_BLACK, strokeWidth=0.5))
        anchor = "start" if right else "end"
        drw.add(String(x_base + sign * (dx + 1.5 * mm), (y1 + y2) / 2, label,
                       fontName="Helvetica", fontSize=fs, fillColor=_BLACK, textAnchor=anchor))

    dim_y_w = oy - 15 * mm          # plate width dim — 15mm below plate bottom
    dim_xR  = ox + pw + 20 * mm     # plate height dim — 20mm right of plate
    dim_xL  = ox - 20 * mm          # Ds dim — 20mm left of plate

    # Plate width — below plate
    _hdim(ox, ox + pw, dim_y_w, f"{int(plate_w)}mm", above=False)

    # Plate height — right of plate
    _vdim(oy, oy + ph, dim_xR, f"{int(plate_h)}mm", right=True)

    # Ds (lever arm between bolt rows) — left of plate only
    _vdim(y_compression, y_tension, dim_xL, f"Ds={int(Ds)}mm", right=False)

    # ── 7. Title ──────────────────────────────────────────────────────────────
    title_y = oy + ph + 8 * mm
    drw.add(String(ox, title_y, "BASE PLATE DETAIL — PLAN VIEW",
                   fontName="Helvetica-Bold", fontSize=9,
                   fillColor=_BLACK, textAnchor="start"))

    # ── 8. Annotation block ───────────────────────────────────────────────────
    # Two columns separated by 60mm. Block sits in the ann_strip below margin_b.
    # Top of block at (ann_strip - 4)mm from canvas bottom; lines at 10pt spacing.
    line_h_pt = 10        # points between annotation lines
    ann_top   = (ann_strip - 4) * mm   # y of first line
    right_col = ox + 60 * mm          # x of right column

    emb_label = f"{int(L_prov)}mm emb." if L_prov else "--"
    left_lines = [
        f"Plate: {int(plate_w)} x {int(plate_h)} x {int(plate_t)}mm, S275",
        f"Bolts: {total_bolts} No. M{int(bolt_d)} Gr.{bolt_grade} @ {emb_label}",
        f"Edge dist.: {int(edge)}mm ea.   Pitch: {int(round(p2_mm))}mm" if n_cols > 1
        else f"Edge dist.: {int(edge)}mm ea.",
    ]
    right_lines = [
        f"Ds = {int(Ds)}mm",
        f"Bolt rows: 2   Cols: {n_cols}",
        f"Section: {desig}",
    ]
    for i, txt in enumerate(left_lines):
        drw.add(String(ox, ann_top - i * line_h_pt, txt,
                       fontName="Helvetica", fontSize=7,
                       fillColor=_BLACK, textAnchor="start"))
    for i, txt in enumerate(right_lines):
        drw.add(String(right_col, ann_top - i * line_h_pt, txt,
                       fontName="Helvetica", fontSize=7,
                       fillColor=_BLACK, textAnchor="start"))

    if footprint_note:
        drw.add(String(ox, ann_top - 3 * line_h_pt, f"* {footprint_note}",
                       fontName="Helvetica-Oblique", fontSize=7,
                       fillColor=colors.HexColor("#CC0000"), textAnchor="start"))

    return drw


# -- Page header / footer callbacks -------------------------------------------

class _HeaderCanvas:
    """Mixin applied via onLaterPages to draw header on non-cover pages."""

    def __init__(self, project_name: str, job_ref: str):
        self._pname = project_name
        self._jref = job_ref

    def draw(self, canvas, doc):
        canvas.saveState()
        y = _H - _MT + 4 * mm
        canvas.setFont("Helvetica-Bold", 8)
        canvas.setFillColor(_BLACK)
        left = f"{self._pname}  |  {self._jref}" if self._jref else self._pname
        canvas.drawString(_ML, y, left)
        page_str = f"Page {doc.page}"
        canvas.drawRightString(_W - _MR, y, page_str)
        canvas.setStrokeColor(_GREY_MD)
        canvas.setLineWidth(0.5)
        canvas.line(_ML, y - 2 * mm, _W - _MR, y - 2 * mm)
        canvas.restoreState()


# -- Section builders ---------------------------------------------------------

def _section_design_basis(calc: dict) -> list:
    story: list = []
    story.append(_section_title("Design Basis", "1"))
    story.append(_sp(3))

    story.append(_sub_title("1.1  Applicable Codes"))
    story.append(_sp(2))
    cw = [38 * mm, 68 * mm, 64 * mm]
    data = [[_ph("Designation"), _ph("Title"), _ph("Scope")]]
    for c in APPLICABLE_CODES:
        data.append([_p(c["en_designation"]), _p(c["eurocode_label"]), _p(c["governs"])])
    t = Table(data, colWidths=cw, repeatRows=1)
    t.setStyle(_TS_BASE)
    story.append(t)
    story.append(_sp(3))

    story.append(_sub_title("1.2  Material Specifications"))
    story.append(_sp(2))
    steel_fy = calc.get("steel", {}).get("fy_N_per_mm2", 275)
    rows = [
        ("Structural steel", f"S275 / S355, fy = {steel_fy} N/mm2 (selected section)"),
        ("Concrete", "fck = 25 N/mm2 (default C25/30)"),
        ("Rebar", "fyk = 500 N/mm2 (Grade B500B)"),
        ("Bolts", "Grade 8.8, fub = 800 N/mm2"),
    ]
    story.append(_inputs_table(rows))
    story.append(_sp(3))

    story.append(_sub_title("1.3  Load Combinations"))
    story.append(_sp(2))
    rows2 = [
        ("ULS", "1.35G + 1.5Q  (EN 1990 Eq 6.10)"),
        ("SLS", "1.0G + 1.0Q"),
        ("DA1-C1 (EC7)", "gammaQ = 1.5, gammaphi = 1.0  -- factored loads, unfactored strength"),
        ("DA1-C2 (EC7)", "gammaQ = 1.3, gammaphi = 1.25 -- moderately factored loads, factored strength"),
    ]
    story.append(_inputs_table(rows2))
    return story


def _section_wind(wind: dict, dp: dict) -> list:
    story: list = []
    story.append(_section_title("Wind Analysis", "2"))
    story.append(_sp(3))

    vb_ov = dp.get("vb", {})
    sf_ov = dp.get("shelter_factor", {})
    vb_val = vb_ov.get("effective", 20.0) if isinstance(vb_ov, dict) else vb_ov
    sf_val = sf_ov.get("effective", 1.0)  if isinstance(sf_ov, dict) else sf_ov

    rows = [
        ("Basic wind velocity vb", f"{_f(vb_val, 1)} m/s  (SG NA fixed: 20 m/s)"),
        ("Return period", f"{wind.get('return_period', 50)} years"),
        ("Reference height ze", f"{_f(wind.get('ze_m'), 2)} m"),
        ("Air density rho", "1.194 kg/m3  (SG NA)"),
        ("Terrain category", "II  (z0 = 0.05 m, SG NA)"),
        ("cp,net", f"{_f(wind.get('cp_net'), 2)}  (EN 1991-1-4 Table 7.9)"),
        ("Shelter factor psi_s", f"{_f(sf_val, 3)}"),
        ("Post spacing", f"{_f(dp.get('post_spacing'), 2)} m"),
    ]
    if wind.get("lh_ratio") is not None:
        rows.insert(5, ("l/h ratio", f"{_f(wind['lh_ratio'], 2)}  (barrier length / ze)"))
    story.append(_sub_title("2.1  Inputs"))
    story.append(_sp(2))
    story.append(_inputs_table(rows))
    story.append(_sp(3))

    vb_e = wind.get("vb_m_per_s", vb_val)
    ze = wind.get("ze_m", 10.0)
    cr = wind.get("cr", 0)
    vm = wind.get("vm_m_per_s", 0)
    Iv = wind.get("Iv", 0)
    qp = wind.get("qp_kPa", 0)
    dp_kPa = wind.get("design_pressure_kPa", 0)

    derivation = [
        ["Basic wind pressure", "qb = 0.5*rho*vb^2",
         f"0.5 x 1.194 x {_f(vb_e,2)}^2 = {_f(wind.get('qb_N_per_m2'),1)} N/m2", "EC1 Eq 4.10"],
        ["Roughness factor", "cr = 0.19 x ln(ze / 0.05)",
         f"0.19 x ln({_f(ze,2)} / 0.05) = {_f(cr,4)}", "EC1 Cl 4.3.2"],
        ["Mean wind velocity", "vm = cr x vb",
         f"{_f(cr,4)} x {_f(vb_e,2)} = {_f(vm,3)} m/s", "EC1 Cl 4.3.1"],
        ["Turbulence intensity", "Iv = 1 / ln(ze / 0.05)",
         f"1 / ln({_f(ze,2)} / 0.05) = {_f(Iv,4)}", "EC1 Cl 4.4"],
        ["Peak velocity pressure", "qp = [1 + 7*Iv] x 0.5*rho*vm^2",
         f"[1 + 7x{_f(Iv,4)}] x 0.5 x 1.194 x {_f(vm,3)}^2 = {_f(qp,4)} kPa", "EC1 Eq 4.8"],
        ["cp,net", "Table 7.9 lookup", f"{_f(wind.get('cp_net'),2)}", "EC1 Table 7.9"],
        ["Shelter factor psi_s", "Figure 7.20 lookup", f"{_f(sf_val,3)}", "EC1 Fig 7.20"],
        ["Design pressure", "q = qp x cp,net x psi_s",
         f"{_f(qp,4)} x {_f(wind.get('cp_net'),2)} x {_f(sf_val,3)} = {_f(dp_kPa,4)} kPa", ""],
    ]
    story.append(_sub_title("2.2  Derivation"))
    story.append(_sp(2))
    story.append(_derivation_table(derivation))

    overrides = []
    if isinstance(vb_ov, dict) and vb_ov.get("override") is not None:
        overrides.append(f"vb overridden: calculated {_f(vb_ov['calculated'],1)} m/s -> "
                         f"override {_f(vb_ov['override'],1)} m/s. Reason: {vb_ov.get('override_reason','')}")
    if isinstance(sf_ov, dict) and sf_ov.get("override") is not None:
        overrides.append(f"Shelter factor overridden: calculated {_f(sf_ov['calculated'],3)} -> "
                         f"override {_f(sf_ov['override'],3)}. Reason: {sf_ov.get('override_reason','')}")
    for note in overrides:
        story.append(_sp(2))
        story.append(Paragraph(f"Override note: {note}", _S_AMBER))

    return story


def _section_steel(steel: dict, dp: dict) -> list:
    story: list = []
    story.append(_section_title("Steel Post Design", "3"))
    story.append(_sp(3))

    desig = steel.get("designation", "--")
    fy = steel.get("fy_N_per_mm2", 275)
    grade_label = "S355" if fy >= 355 else "S275"
    pl = dp.get("post_length", {})
    post_len = pl.get("effective", steel.get("post_length_m")) if isinstance(pl, dict) else pl
    sc = steel.get("section_class")
    lcr_m = steel.get("Lcr_mm", 0) / 1000 if steel.get("Lcr_mm") else dp.get("subframe_spacing", 0)

    # Component specification
    story.append(_sub_title("3.1  Component Specification"))
    story.append(_sp(2))
    story.append(_spec_table([
        ("Selected section", f"UB {desig}"),
        ("Steel grade", f"{grade_label}  (fy = {_f(fy,0)} N/mm2)"),
        ("Mass", f"{_f(steel.get('mass_kg_per_m'),1)} kg/m"),
        ("Section class (EC3 Table 5.2)", f"Class {sc}" if sc else "--"),
        ("Post length L", f"{_f(post_len,2)} m"),
        ("Subframe spacing Lcr", f"{_f(lcr_m,2)} m"),
        ("Deflection limit", f"L / {int(steel.get('deflection_limit_n', 65))}"),
    ]))
    story.append(_sp(3))

    # Section properties
    rows = [
        ("h x b x tf x tw", f"{_f(steel.get('h_mm'),1)} x {_f(steel.get('b_mm'),1)} x {_f(steel.get('tf_mm'),1)} x {_f(steel.get('tw_mm'),1)} mm"),
        ("Iy", f"{_f(steel.get('Iy_cm4'),1)} cm4"),
        ("Iz", f"{_f(steel.get('Iz_cm4'),1)} cm4"),
        ("Iw", f"{_f(steel.get('Iw_dm6'),4)} dm6"),
        ("It", f"{_f(steel.get('It_cm4'),2)} cm4"),
        ("Wpl,y", f"{_f(steel.get('Wpl_y_cm3'),1)} cm3"),
    ]
    story.append(_sub_title("3.2  Section Properties"))
    story.append(_sp(2))
    story.append(_inputs_table(rows))
    story.append(_sp(3))

    # Section classification
    eps = steel.get("epsilon")
    story.append(_sub_title("3.3  Section Classification  (EC3 Table 5.2)"))
    story.append(_sp(2))
    class_rows = [
        ("epsilon = sqrt(235 / fy)", f"sqrt(235 / {_f(fy,0)}) = {_f(eps,4)}"),
        ("Flange cf/tf", f"{_f(steel.get('cf_tf_ratio'),3)}  ->  Class {steel.get('flange_class','--')}"),
        ("Web cw/tw", f"{_f(steel.get('cw_tw_ratio'),3)}  ->  Class {steel.get('web_class','--')}"),
        ("Governing section class", f"Class {sc}{'  (Wel used for bending)' if steel.get('class3_wel_used') else ''}"),
    ]
    story.append(_inputs_table(class_rows))
    story.append(_sp(3))

    # Loading
    w = steel.get("w_kN_per_m", 0)
    L = post_len or 0
    M = steel.get("M_Ed_kNm", 0)
    V = steel.get("V_Ed_kN", 0)
    story.append(_sub_title("3.4  Design Loading"))
    story.append(_sp(2))
    story.append(_derivation_table([
        ["Wind UDL", "w = q x s",
         f"{_f(w/L if L else 0,4)} x {_f(dp.get('post_spacing'),2)} = {_f(w,4)} kN/m", ""],
        ["ULS moment", "M_Ed = 1.5 x w x L^2 / 2",
         f"1.5 x {_f(w,4)} x {_f(L,2)}^2 / 2 = {_f(M,2)} kNm", "EC3"],
        ["ULS shear", "V_Ed = 1.5 x w x L",
         f"1.5 x {_f(w,4)} x {_f(L,2)} = {_f(V,2)} kN", "EC3"],
    ]))
    story.append(_sp(3))

    # LTB
    Mpl = steel.get("Mpl_kNm", 0)
    Mcr = steel.get("Mcr_kNm", 0)
    lam = steel.get("lambda_bar_LT", 0)
    phi_lt = steel.get("phi_LT", 0)
    chi = steel.get("chi_LT", 0)
    Mb  = steel.get("Mb_Rd_kNm", 0)
    Wpl = steel.get("Wpl_y_cm3", 0)
    story.append(_sub_title("3.5  Lateral Torsional Buckling  (EC3 Cl 6.3.2)"))
    story.append(_sp(2))
    story.append(_derivation_table([
        ["Mpl,Rd", "Wpl,y x fy / gammaM1",
         f"{_f(Wpl,1)}x10^3 x {_f(fy,0)} / 1.0x10^6 = {_f(Mpl,2)} kNm", "EC3 Cl 6.2.5"],
        ["Mcr", "C1 x pi^2*E*Iz/Lcr^2 x sqrt(Iw/Iz + Lcr^2*G*It/(pi^2*E*Iz))",
         f"= {_f(Mcr,2)} kNm", "EC3 Cl 6.3.2"],
        ["lambda_bar_LT", "sqrt(Mpl / Mcr)",
         f"sqrt({_f(Mpl,2)} / {_f(Mcr,2)}) = {_f(lam,4)}", ""],
        ["phi_LT", "0.5[1 + alpha_LT*(lambda_LT - 0.4) + 0.75*lambda_LT^2]",
         f"= {_f(phi_lt,4)}", "EC3 Cl 6.3.2.3"],
        ["chi_LT", "min(1, 1/(phi_LT + sqrt(phi_LT^2 - 0.75*lambda_LT^2)))",
         f"= {_f(chi,4)}", ""],
        ["Mb,Rd", "chi_LT x Wpl,y x fy / gammaM1",
         f"{_f(chi,4)} x {_f(Wpl,1)}x10^3 x {_f(fy,0)} / 1.0x10^6 = {_f(Mb,2)} kNm", ""],
    ]))
    story.append(_sp(3))

    # Deflection
    delta = steel.get("delta_mm", 0)
    d_allow = steel.get("delta_allow_mm", 0)
    Iy = steel.get("Iy_cm4", 1)
    story.append(_sub_title("3.6  Deflection"))
    story.append(_sp(2))
    story.append(_derivation_table([
        ["delta", "w*L^4 / (8*E*I)",
         f"{_f(w,4)}x{_f(L*1000,0)}^4 / (8x210000x{_f(Iy,0)}x10^4) = {_f(delta,2)} mm", ""],
        ["delta_allow", f"L / {int(steel.get('deflection_limit_n',65))}",
         f"{_f(L*1000,0)} / {int(steel.get('deflection_limit_n',65))} = {_f(d_allow,2)} mm", ""],
    ]))
    story.append(_sp(3))

    # Shear
    Av = steel.get("Av_mm2", 0)
    Vc = steel.get("Vc_kN", 0)
    story.append(_sub_title("3.7  Shear"))
    story.append(_sp(2))
    story.append(_derivation_table([
        ["Av", "A - 2b*tf + (tw + 2r)*tf", f"= {_f(Av,1)} mm2", "EC3 Cl 6.2.6"],
        ["Vc,Rd", "Av x (fy/sqrt(3)) / gammaM0",
         f"{_f(Av,1)} x ({_f(fy,0)}/sqrt(3)) / 1.0 / 1000 = {_f(Vc,2)} kN", "EC3 Cl 6.2.6"],
    ]))
    story.append(_sp(3))

    # Results
    ur_m = steel.get("UR_moment")
    ur_d = steel.get("UR_deflection")
    ur_s = steel.get("UR_shear")
    story.append(_sub_title("3.8  Results Summary"))
    story.append(_sp(2))
    story.append(_results_table([
        _ur_row("Bending (LTB)", ur_m, demand=f"M_Ed = {_f(M,2)} kNm", capacity=f"Mb,Rd = {_f(Mb,2)} kNm"),
        _ur_row("Deflection", ur_d, demand=f"delta = {_f(delta,2)} mm", capacity=f"delta_allow = {_f(d_allow,2)} mm"),
        _ur_row("Shear", ur_s, demand=f"V_Ed = {_f(V,2)} kN", capacity=f"Vc,Rd = {_f(Vc,2)} kN"),
    ]))
    return story


def _section_connection(conn: dict, section: dict | None = None) -> list:
    story: list = []
    story.append(_section_title("Connection Design", "4"))
    story.append(_sp(3))

    bt   = conn.get("bolt_tension", {})
    bs   = conn.get("bolt_shear", {})
    bc   = conn.get("bolt_combined", {})
    be   = conn.get("bolt_embedment", {})
    bbrg = conn.get("bolt_bearing", {})
    weld = conn.get("weld", {})
    bp   = conn.get("base_plate", {})
    gc   = conn.get("g_clamp", {})

    cfg = conn.get("config_id", "derived")
    cfg_label = "Dynamic derivation (no config_id)" if cfg == "derived" else str(cfg)

    Ds   = bt.get("Ds_mm", 0) or 0
    nt   = bt.get("n_tension", 0) or 0
    ns   = bs.get("n_shear", 0) or 0
    Lp   = be.get("L_provided_mm", 0) or 0
    bpb  = bp.get("base_plate_bending", {}) or {}
    bpbearing = bp.get("base_plate_bearing", {}) or {}

    # Infer plate dimensions from bending sub-dict if available
    plate_w  = bpb.get("plate_width_mm") or bpbearing.get("plate_width_mm")
    plate_h  = bpb.get("plate_height_mm") or bpbearing.get("plate_height_mm")
    plate_t  = bpb.get("plate_thickness_mm") or bpbearing.get("plate_thickness_mm")
    bolt_dia = bt.get("bolt_diameter_mm") or conn.get("bolt_diameter_mm")

    # ns = total bolts (2 rows x nt cols); nt = bolts per row on tension side
    # Total bolt count is ns (= 2 * nt); displaying nt+ns would double-count.
    bolt_spec = f"M{int(bolt_dia)} Grade 8.8" if bolt_dia else "Grade 8.8"
    if nt and ns:
        bolt_spec += f" -- {nt} bolts/row x 2 rows = {ns} total"
    elif nt:
        bolt_spec += f" -- {nt} bolts"

    plate_spec = "--"
    if plate_w and plate_h and plate_t:
        plate_spec = f"{int(plate_w)} x {int(plate_h)} x {int(plate_t)} mm, S275"
    elif plate_t:
        plate_spec = f"t = {int(plate_t)} mm, S275"

    weld_spec = "--"
    if weld.get("throat_mm") and weld.get("weld_length_mm"):
        weld_spec = f"{_f(weld['throat_mm'],1)} mm throat, {_f(weld['weld_length_mm'],0)} mm total length"

    failure_kN = gc.get("failure_load_kN")
    n_clamps   = gc.get("n_clamps")

    # Component specification
    story.append(_sub_title("4.1  Component Specification"))
    story.append(_sp(2))
    story.append(_spec_table([
        ("Config", cfg_label),
        ("Base plate", plate_spec),
        ("Bolt specification", bolt_spec),
        ("Bolt lever arm Ds", f"{_f(Ds,1)} mm"),
        ("Embedment depth provided", f"{_f(Lp,0)} mm"),
        ("Fillet weld", weld_spec),
        ("G clamp", f"{n_clamps} clamps, failure load = {_f(failure_kN,2)} kN" if n_clamps else "--"),
    ]))
    story.append(_sp(3))

    # Derivation inputs table
    rows = [
        ("n_tension (bolts per row, tension side)", str(nt or "--")),
        ("n_shear (total bolts, 2 rows)", str(ns or "--")),
        ("fck", f"{_f(be.get('fck_N_per_mm2'), 0)} N/mm2"),
        ("fbd", f"{_f(be.get('fbd_N_per_mm2'), 3)} N/mm2"),
    ]
    if bpb.get("Z_plate_mm3"):
        rows.insert(2, ("Plate Z (section modulus)", f"{_f(bpb.get('Z_plate_mm3'), 0)} mm3"))
    story.append(_sub_title("4.2  Derivation Inputs"))
    story.append(_sp(2))
    story.append(_inputs_table(rows))
    story.append(_sp(3))

    # Base plate sketch — vector graphic embedded before bolt tension derivation
    if section:
        try:
            sketch = draw_base_plate_sketch(conn, section)
            rule = Table([[""]], colWidths=[_USABLE_W])
            rule.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, -1), 0.5, _GREY_MD)]))
            story.append(KeepTogether([
                rule,
                _sp(2),
                _DrawingFlowable(sketch),
                _sp(2),
                Table([[""]], colWidths=[_USABLE_W], style=TableStyle([
                    ("LINEBELOW", (0, 0), (-1, -1), 0.5, _GREY_MD),
                ])),
                _sp(3),
            ]))
        except Exception as _sketch_exc:
            import warnings
            warnings.warn(f"Base plate sketch failed: {_sketch_exc}")

    Ft  = bt.get("Ft_per_bolt_kN", 0) or 0
    FTR = bt.get("FT_Rd_kN", 0) or 0

    story.append(_sub_title("4.3  Bolt Tension  (EC3-1-8 Cl 3.6.1)"))
    story.append(_sp(2))
    story.append(_derivation_table([
        ["Total tension T", "T = M_Ed / Ds",
         f"M_Ed x 1000 / {_f(Ds,1)} = {_f(bt.get('T_total_kN'),2)} kN", ""],
        ["Force per bolt Ft", "Ft = T / n_tension",
         f"{_f(bt.get('T_total_kN'),2)} / {nt} = {_f(Ft,2)} kN", ""],
        ["Tension resistance FT,Rd", "FT,Rd = 0.9 x fub x As,nom / gammaM2",
         f"0.9 x 800 x As / 1.25 / 1000 = {_f(FTR,2)} kN", "EC3-1-8 Cl 3.6.1"],
    ]))
    story.append(_sp(3))

    Fv  = bs.get("Fv_per_bolt_kN", 0) or 0
    FvR = bs.get("Fv_Rd_kN", 0) or 0
    story.append(_sub_title("4.4  Bolt Shear + Combined"))
    story.append(_sp(2))
    story.append(_derivation_table([
        ["Shear per bolt Fv", "Fv = V_Ed / n_shear",
         f"{_f(Fv,2)} kN", "EC3-1-8 Cl 3.6.1"],
        ["Shear resistance Fv,Rd", "Fv,Rd = 0.6 x fub x As / gammaM2",
         f"= {_f(FvR,2)} kN", ""],
        ["Combined check", "Fv/Fv,Rd + (Ft/FT,Rd) / 1.4",
         f"{_f(Fv/FvR if FvR else 0,3)} + {_f(Ft/FTR/1.4 if FTR else 0,3)} = {_f(bc.get('UR'),3)}", "EC3 Table 3.4"],
    ]))
    story.append(_sp(3))

    story.append(_sub_title("4.5  Bolt Embedment  (EC2 Cl 8.4.2)"))
    story.append(_sp(2))
    Lr    = be.get("L_required_mm", 0) or 0
    fbd_v = be.get("fbd_N_per_mm2", 0) or 0
    story.append(_derivation_table([
        ["Design bond strength fbd", "fbd = 2.25 x eta1 x eta2 x fctd",
         f"= {_f(fbd_v,3)} N/mm2", "EC2 Cl 8.4.2"],
        ["Required anchorage L_req", "L_req = Ft / (fbd x pi x d)",
         f"{_f(Ft,2)} x 1000 / ({_f(fbd_v,3)} x pi x d) = {_f(Lr,1)} mm", ""],
        ["Provided embedment L_prov", "L_prov", f"{_f(Lp,0)} mm", ""],
    ]))
    story.append(_sp(3))

    story.append(_sub_title("4.6  Weld  (MoI method)"))
    story.append(_sp(2))
    story.append(_derivation_table([
        ["Weld length", "2b + 2(h - 2tf)", f"{_f(weld.get('weld_length_mm'),1)} mm  ({weld.get('weld_length_source','')})", ""],
        ["Throat", "a = 0.7 x s", f"{_f(weld.get('throat_mm'),2)} mm", "EC3 Cl 4.5.3"],
        ["Direct shear fs", "fs = V / weld_length", f"{_f(weld.get('fs_N_per_mm'),3)} N/mm", ""],
        ["Moment stress fm", "fm = M x (h/2) / Iw,weld", f"{_f(weld.get('fm_N_per_mm'),3)} N/mm", ""],
        ["Resultant FR", "FR = sqrt(fs^2 + fm^2)", f"{_f(weld.get('FR_N_per_mm'),3)} N/mm", ""],
        ["Weld resistance Fw,Rd", "Fw,Rd = fu x a / (beta_w x gammaM2 x sqrt(2))", f"{_f(weld.get('Fw_Rd_N_per_mm'),3)} N/mm", "EC3 Cl 4.5.3.3"],
    ]))
    story.append(_sp(3))

    story.append(_sub_title("4.7  Base Plate"))
    story.append(_sp(2))
    story.append(_derivation_table([
        ["c (overhang)", "t x sqrt(fy / (3 x fcd x gammaM0))", f"{_f(bpbearing.get('c_mm'),2)} mm", "EC3 Annex I"],
        ["Effective bearing area Aeff", "Aeff = beff x leff",
         f"{_f(bpbearing.get('A_eff_mm2'),1)} mm2", ""],
        ["Compression resistance", "fcd x Aeff",
         f"{_f(bpbearing.get('compression_resistance_kN'),2)} kN", ""],
        ["Plate bending M_cap", "fy x Z_plate / gammaM0",
         f"{_f(bpb.get('M_cap_kNm'),3)} kNm", ""],
        ["Plate bending M_demand", "Ft x e_bolt / 1000",
         f"{_f(bpb.get('M_demand_kNm'),3)} kNm", ""],
    ]))
    story.append(_sp(3))

    story.append(_sub_title("4.8  G Clamp  (STS test report 10784-0714-02391-8-MEME)"))
    story.append(_sp(2))
    story.append(_derivation_table([
        ["External pressure", "qp x psi_s",
         f"= {_f(gc.get('F_wind_kN',0) / (gc.get('n_clamps',1) or 1),3)} kPa (approx)", ""],
        ["Wind force", "p x (h/2) x s",
         f"= {_f(gc.get('F_wind_kN'),3)} kN", ""],
        ["Factored force", "F x 1.5", f"= {_f(gc.get('F_factored_kN'),3)} kN", ""],
        ["n clamps", "max(ceil(F_fac/Ffail), n_provided)",
         f"{gc.get('n_clamps_required','--')} req'd, {gc.get('n_clamps_provided','--')} provided -> {gc.get('n_clamps','--')}", ""],
        ["Force per clamp", "F_factored / n_clamps", f"{_f(gc.get('F_per_clamp_kN'),3)} kN", ""],
        ["Failure load", "STS test", f"{_f(gc.get('failure_load_kN'),2)} kN", ""],
    ]))
    story.append(_sp(3))

    story.append(_sub_title("4.9  Results Summary"))
    story.append(_sp(2))
    story.append(_results_table([
        _ur_row("Bolt tension",       bt.get("UR"), demand=f"{_f(Ft,2)} kN", capacity=f"{_f(FTR,2)} kN"),
        _ur_row("Bolt shear",         bs.get("UR"), demand=f"{_f(Fv,2)} kN", capacity=f"{_f(FvR,2)} kN"),
        _ur_row("Bolt bearing",       bbrg.get("UR")),
        _ur_row("Combined",           bc.get("UR")),
        _ur_row("Embedment",          be.get("UR"), demand=f"L_req={_f(Lr,1)} mm", capacity=f"L_prov={_f(Lp,0)} mm"),
        _ur_row("Weld",               weld.get("UR"), demand=f"{_f(weld.get('FR_N_per_mm'),1)} N/mm", capacity=f"{_f(weld.get('Fw_Rd_N_per_mm'),1)} N/mm"),
        _ur_row("Base plate bearing", bpbearing.get("UR")),
        _ur_row("Base plate bending", bpb.get("UR")),
        _ur_row("G clamp",            gc.get("UR")),
    ]))
    return story


def _section_subframe(sub: dict, dp: dict) -> list:
    story: list = []
    story.append(_section_title("Subframe Design", "5"))
    story.append(_sp(3))

    od  = sub.get("od_mm", 0)
    t   = sub.get("t_mm", 0)
    fy  = sub.get("fy_N_per_mm2", 400)
    w   = sub.get("w_kN_per_m", 0)
    M   = sub.get("M_Ed_kNm", 0)
    Wel = sub.get("Wel_mm3", 0)
    Mc  = sub.get("Mc_Rd_kNm", 0)
    ur  = sub.get("UR_subframe")

    # Component specification
    story.append(_sub_title("5.1  Component Specification"))
    story.append(_sp(2))
    story.append(_spec_table([
        ("CHS designation", sub.get("designation", "--")),
        ("OD x t", f"{_f(od,1)} x {_f(t,1)} mm"),
        ("Steel grade / fy", f"GI pipe, {_f(fy,0)} N/mm2"),
        ("Subframe spacing (span)", f"{_f(dp.get('subframe_spacing'),2)} m"),
        ("Post spacing", f"{_f(dp.get('post_spacing'),2)} m"),
    ]))
    story.append(_sp(3))

    dp_kPa = dp.get("design_pressure_kPa") or 0
    sf_sp  = dp.get("subframe_spacing") or 1
    story.append(_sub_title("5.2  Derivation"))
    story.append(_sp(2))
    story.append(_derivation_table([
        ["UDL", "w = dp x subframe_spacing",
         f"{_f(dp_kPa,4)} x {_f(sf_sp,2)} = {_f(w,4)} kN/m", ""],
        ["M_Ed", "1.5/10 x w x L^2",
         f"0.15 x {_f(w,4)} x {_f(dp.get('post_spacing',3),2)}^2 = {_f(M,4)} kNm", "P105 continuous beam"],
        ["Wel", "section property", f"{_f(Wel,2)} mm3", ""],
        ["Mc,Rd", "1.2 x fy x Wel / gammaM0",
         f"1.2 x {_f(fy,0)} x {_f(Wel,0)} / 1.0 x 10^-6 = {_f(Mc,4)} kNm", "P105 Cl 5"],
    ]))
    story.append(_sp(3))

    story.append(_sub_title("5.3  Results"))
    story.append(_sp(2))
    story.append(_results_table([
        _ur_row("Subframe bending", ur, demand=f"M_Ed = {_f(M,4)} kNm", capacity=f"Mc,Rd = {_f(Mc,4)} kNm"),
    ]))
    if sub.get("hardware_note"):
        story.append(_sp(2))
        story.append(Paragraph(f"Note: {sub['hardware_note']}", _S_AMBER))
    return story


def _section_lifting(lift: dict) -> list:
    story: list = []
    story.append(_section_title("Lifting Design", "6"))
    story.append(_sp(3))

    hole = lift.get("hole", {}) or {}
    hook = lift.get("hook", {}) or {}

    # Component specification
    story.append(_sub_title("6.1  Component Specification"))
    story.append(_sp(2))
    bar_dia   = hook.get("diameter_mm")
    bar_desig = hook.get("bar", "--")
    n_hooks   = hook.get("n_hooks", "--")
    story.append(_spec_table([
        ("Lifting hole diameter", f"{_f(hole.get('hole_diameter_mm'),0)} mm"),
        ("Lifting hole edge distance", f"{_f(hole.get('edge_distance_mm'),0)} mm"),
        ("Web thickness tw", f"{_f(hole.get('tw_mm'),2)} mm"),
        ("Lifting hook bar", f"{bar_desig}, {_f(bar_dia,0)} mm dia, {n_hooks} hooks"),
        ("Hook embedment provided", f"{_f(hook.get('L_provided_mm'),0)} mm"),
    ]))
    story.append(_sp(3))

    story.append(_sub_title("6.2  Lifting Holes -- Web Shear"))
    story.append(_sp(2))
    story.append(_inputs_table([
        ("Hole diameter", f"{_f(hole.get('hole_diameter_mm'),0)} mm"),
        ("Edge distance", f"{_f(hole.get('edge_distance_mm'),0)} mm"),
        ("Web thickness tw", f"{_f(hole.get('tw_mm'),2)} mm"),
        ("Post self-weight", f"{_f(hole.get('post_weight_kN'),2)} kN"),
    ]))
    story.append(_sp(2))
    story.append(_derivation_table([
        ["Shear area Av", "Av = edge x tw",
         f"{_f(hole.get('edge_distance_mm'),0)} x {_f(hole.get('tw_mm'),2)} = {_f(hole.get('Av_mm2'),1)} mm2", ""],
        ["Shear resistance V_Rd", "V_Rd = Av x fy/sqrt(3) / gammaM0",
         f"= {_f(hole.get('V_Rd_kN'),2)} kN", "EC3 Cl 6.2.6"],
        ["Factored load W", "W = post_weight x 1.5",
         f"{_f(hole.get('post_weight_kN'),2)} x 1.5 = {_f(hole.get('W_post_factored_kN'),2)} kN", ""],
    ]))
    story.append(_sp(3))

    story.append(_sub_title("6.3  Lifting Hooks -- Rebar Tension / Bond"))
    story.append(_sp(2))
    story.append(_inputs_table([
        ("Bar designation", hook.get("bar", "--")),
        ("Bar diameter", f"{_f(hook.get('diameter_mm'),0)} mm"),
        ("As", f"{_f(hook.get('As_mm2'),0)} mm2"),
        ("n_hooks", str(hook.get("n_hooks", "--"))),
        ("Embedment provided", f"{_f(hook.get('L_provided_mm'),0)} mm"),
        ("fbd", f"{_f(hook.get('fbd_N_per_mm2'),4)} N/mm2"),
    ]))
    story.append(_sp(2))
    story.append(_derivation_table([
        ["Factored weight W", "W = P_G x 1.5", f"= {_f(hook.get('W_factored_kN'),2)} kN", ""],
        ["Force per hook F_hook", "F_hook = W / n_hooks",
         f"{_f(hook.get('W_factored_kN'),2)} / {hook.get('n_hooks','--')} = {_f(hook.get('F_hook_kN'),2)} kN", ""],
        ["Tension resistance FT,Rd", "FT,Rd = 0.9 x fub x As / gammaM2",
         f"= {_f(hook.get('FT_Rd_kN'),2)} kN", "EC3-1-8 Cl 3.6.1"],
        ["Required bond length L_req", "L_req = F_hook / (fbd x pi x d)",
         f"= {_f(hook.get('L_required_mm'),1)} mm", "EC2 Cl 8.4.2"],
    ]))
    story.append(_sp(3))

    story.append(_sub_title("6.4  Results"))
    story.append(_sp(2))
    story.append(_results_table([
        _ur_row("Lifting hole shear", hole.get("UR_shear"),
                demand=f"W = {_f(hole.get('W_post_factored_kN'),2)} kN",
                capacity=f"V_Rd = {_f(hole.get('V_Rd_kN'),2)} kN"),
        _ur_row("Hook tension", hook.get("UR_tension"),
                demand=f"F = {_f(hook.get('F_hook_kN'),2)} kN",
                capacity=f"FT,Rd = {_f(hook.get('FT_Rd_kN'),2)} kN"),
        _ur_row("Hook bond length", hook.get("UR_bond"),
                demand=f"L_req = {_f(hook.get('L_required_mm'),1)} mm",
                capacity=f"L_prov = {_f(hook.get('L_provided_mm'),0)} mm"),
    ]))
    return story


def _combo_section(label: str, combo: dict, ftype: str, B: float, L: float) -> list:
    rows: list = []
    H = combo.get("H_factored_kN", 0)
    M = combo.get("M_factored_kNm", 0)

    rows.append(_sub_title(label))
    rows.append(_sp(2))

    rows.append(_derivation_table([
        ["Sliding resistance FR",
         "FR = P_G x tan(phi_d) + Pp" if ftype == "Embedded RC" else "FR = mu x P_G",
         f"= {_f(combo.get('F_R_sliding_kN'),2)} kN", ""],
        ["FOS sliding", "FR / H_factored", f"{_f(combo.get('FOS_sliding'),3)}", ""],
        ["Overturning M_Rd", "P_G x 0.9 x B/2",
         f"= {_f(combo.get('M_Rd_overturning_kNm'),2)} kNm", "EC7 EQU"],
        ["FOS overturning", "M_Rd / M_factored", f"{_f(combo.get('FOS_overturning'),3)}", ""],
    ]))
    rows.append(_sp(2))

    bd = combo.get("bearing_drained", {}) or {}
    eccentric = bd.get("eccentric_bearing", False)
    e_m    = bd.get("eccentricity_m") or bd.get("e_m")
    b_prime = bd.get("b_prime_m") or bd.get("B_prime_m")

    bearing_rows = []
    if ftype == "Embedded RC":
        ecc_note = "(e > B/6 -- eccentric branch)" if eccentric else "(e <= B/6 -- standard)"
        bearing_rows.append(["Eccentricity e", "e = M_SLS / P_G", f"= {_f(e_m,4)} m  {ecc_note}", ""])
        if eccentric and b_prime is not None:
            bearing_rows.append(["Partial contact width b'", "b' = 3(B/2 - e)", f"= {_f(b_prime,4)} m", "Meyerhof"])
            bearing_rows.append(["q_max", "4*P / (3*L*b')",
                                  f"4 x P_G / (3 x {_f(L,2)} x {_f(b_prime,4)}) = {_f(bd.get('q_applied_kPa'),2)} kPa", ""])
        bearing_rows.append(["Nq / Nc / Ngamma", "EC7 Annex D.4",
                              f"{_f(bd.get('Nq'),3)} / {_f(bd.get('Nc'),3)} / {_f(bd.get('Ny'),3)}", "EC7 D.4"])
        bearing_rows.append(["qu,drained", "c*Nc*sc + q*Nq*sq + 0.5*gamma*B'*Ngamma*sgamma",
                              f"= {_f(bd.get('qu_kPa'),2)} kPa", "EC7 D.4"])
        bearing_rows.append(["q_applied", "P_G / (B' x L)", f"= {_f(bd.get('q_applied_kPa'),2)} kPa", ""])
    else:
        bearing_rows.append(["Eccentricity e", "e = M_SLS / P_G", f"= {_f(e_m,3)} m", ""])
        formula = "4*P/(3*L*b')" if eccentric else "(P/(B*L)) x (1 + 6e/B)"
        bearing_rows.append(["q_max", formula,
                              f"= {_f(bd.get('q_max_kPa'),2)} kPa", ""])
        bearing_rows.append(["q_allow", "specified", f"= {_f(bd.get('q_allow_kPa'),2)} kPa", ""])

    rows.append(_derivation_table(bearing_rows))
    rows.append(_sp(2))

    bu = combo.get("bearing_undrained")
    if bu:
        rows.append(_derivation_table([
            ["ic (inclination)", "0.5 x (1 + sqrt(1 - H/(A'*cu,d)))",
             f"= {_f(bu.get('ic'),4)}", "EC7 D.3"],
            ["sc (shape)", "1 + 0.2 x (B'/L')", f"= {_f(bu.get('sc'),4)}", ""],
            ["qu,undrained", "(pi+2) x cu,d x bc x ic x sc + q",
             f"= {_f(bu.get('qu_kPa'),2)} kPa", "EC7 D.3"],
        ]))
        rows.append(_sp(2))

    return rows


def _section_foundation(found: dict, dp: dict) -> list:
    story: list = []
    story.append(_section_title("Foundation Design", "7"))
    story.append(_sp(3))

    ftype = found.get("footing_type", "--")
    inp   = found.get("inputs", {}) or {}
    B     = inp.get("footing_B_m", 1.0)
    L     = inp.get("footing_L_m", 1.0)
    D     = inp.get("footing_D_m", 0.0)
    PG    = inp.get("P_G_kN", 0)
    fck   = inp.get("fck", 25)

    # Component specification
    story.append(_sub_title("7.1  Component Specification"))
    story.append(_sp(2))
    story.append(_spec_table([
        ("Footing type", ftype),
        ("Footing dimensions B x L x D", f"{int(B*1000)} x {int(L*1000)} x {int(D*1000)} mm"),
        ("Concrete grade fck", f"{_f(fck,0)} N/mm2  (C{int(fck)}/{'%d' % (int(fck)+5)})"),
        ("Post + footing self-weight P_G", f"{_f(PG,2)} kN"),
        ("Soil friction angle phi_k", f"{_f(inp.get('phi_k_deg'),1)} deg"),
        ("Soil unit weight gamma_s", f"{_f(inp.get('gamma_s_kN_m3'),1)} kN/m3"),
        ("Soil cohesion c'k", f"{_f(inp.get('c_k_kPa'),1)} kPa"),
    ]))
    story.append(_sp(3))

    rows = [
        ("B (wind direction)", f"{_f(B,2)} m"),
        ("L (perpendicular)", f"{_f(L,2)} m"),
        ("D (embedment)", f"{_f(D,2)} m"),
        ("P_G (permanent load)", f"{_f(PG,2)} kN"),
        ("phi_k", f"{_f(inp.get('phi_k_deg'),1)} deg"),
        ("gamma_s", f"{_f(inp.get('gamma_s_kN_m3'),1)} kN/m3"),
        ("c'k", f"{_f(inp.get('c_k_kPa'),1)} kPa"),
        ("cu", f"{_f(inp.get('cu_kPa'),1)} kPa"),
    ]

    sls   = found.get("SLS", {}) or {}
    H_sls = sls.get("H_factored_kN", 0)
    M_sls = sls.get("M_factored_kNm", 0)
    rows += [
        ("H_SLS (unfactored horizontal)", f"{_f(H_sls,2)} kN"),
        ("M_SLS (unfactored moment)", f"{_f(M_sls,2)} kNm"),
    ]

    story.append(_sub_title("7.2  Design Inputs"))
    story.append(_sp(2))
    story.append(_inputs_table(rows))
    story.append(_sp(3))

    for combo_key, combo_label in [("SLS", "7.3  SLS Check"), ("DA1_C1", "7.4  DA1-C1"), ("DA1_C2", "7.5  DA1-C2")]:
        combo = found.get(combo_key, {}) or {}
        story.extend(_combo_section(combo_label, combo, ftype, B, L))
        story.append(_sp(3))

    story.append(_sub_title("7.6  Results Summary"))
    story.append(_sp(2))
    summary_rows = []
    for combo_key, combo_label in [("SLS", "SLS"), ("DA1_C1", "DA1-C1"), ("DA1_C2", "DA1-C2")]:
        combo = found.get(combo_key, {}) or {}
        bd    = combo.get("bearing_drained", {}) or {}
        fos_sl  = combo.get("FOS_sliding")
        fos_ot  = combo.get("FOS_overturning")
        fos_lim_sl = combo.get("fos_limit_sliding", 1.0)
        fos_lim_ot = combo.get("fos_limit_overturning", 1.0)
        ur_br   = bd.get("UR_bearing")
        summary_rows.append([_p(f"{combo_label} Sliding"), _p("--"), _p(f"FOS >= {_f(fos_lim_sl,2)}"), _p(_f(fos_sl, 3)),
                              _pass_cell(fos_sl >= fos_lim_sl if fos_sl else None)])
        summary_rows.append([_p(f"{combo_label} Overturning"), _p("--"), _p(f"FOS >= {_f(fos_lim_ot,2)}"), _p(_f(fos_ot, 3)),
                              _pass_cell(fos_ot >= fos_lim_ot if fos_ot else None)])
        if ur_br is not None:
            summary_rows.append([_p(f"{combo_label} Bearing"), _p("--"), _p("UR < 1.0"), _p(_f(ur_br, 3)),
                                  _pass_cell(ur_br < 1.0)])
        bu = combo.get("bearing_undrained") or {}
        if bu and bu.get("UR_bearing") is not None:
            summary_rows.append([_p(f"{combo_label} Bearing (undrained)"), _p("--"), _p("UR < 1.0"),
                                  _p(_f(bu["UR_bearing"], 3)), _pass_cell(bu["UR_bearing"] < 1.0)])

    story.append(_results_table(summary_rows, headers=["Check", "Demand", "Limit", "UR / FOS", "Result"]))
    return story


def _section_summary(calc: dict, dp: dict) -> list:
    story: list = []
    story.append(_section_title("Results Summary", "8"))
    story.append(_sp(3))

    story.append(_sub_title("8.1  All-Module Summary"))
    story.append(_sp(2))

    all_rows: list[list] = []

    # Wind
    wind  = calc.get("wind", {}) or {}
    dp_kPa = wind.get("design_pressure_kPa")
    all_rows.append([_p("Wind"), _p("Design pressure"), _p(f"{_f(dp_kPa,4)} kPa"), _p("--"), _p("--"), _pass_cell(True)])

    # Steel
    steel = calc.get("steel", {}) or {}
    for check, ur_key, demand_key, cap_key in [
        ("Post bending",    "UR_moment",    "M_Ed_kNm",      "Mb_Rd_kNm"),
        ("Post deflection", "UR_deflection","delta_mm",       "delta_allow_mm"),
        ("Post shear",      "UR_shear",     "V_Ed_kN",        "Vc_kN"),
    ]:
        ur = steel.get(ur_key)
        all_rows.append([_p("Steel post"), _p(check), _p(_f(steel.get(demand_key), 2)),
                         _p(_f(steel.get(cap_key), 2)), _p(_f(ur, 3)),
                         _pass_cell(ur < 1.0 if ur is not None else None)])

    sc = steel.get("section_class")
    if sc:
        all_rows.append([_p("Steel post"), _p("Section class"), _p(f"Class {sc}"), _p("<= Class 3"), _p("--"),
                         _pass_cell(sc <= 3 if sc else None)])

    # Connection
    conn = calc.get("connection", {}) or {}
    if conn:
        bt_sub  = conn.get("bolt_tension",  {}) or {}
        bs_sub  = conn.get("bolt_shear",    {}) or {}
        bbrg    = conn.get("bolt_bearing",  {}) or {}
        bc_sub  = conn.get("bolt_combined", {}) or {}
        be_sub  = conn.get("bolt_embedment",{}) or {}
        wd_sub  = conn.get("weld",          {}) or {}
        gc_sub  = conn.get("g_clamp",       {}) or {}
        bpp     = conn.get("base_plate",    {}) or {}
        bpbear  = bpp.get("base_plate_bearing", {}) or {}
        bpbend  = bpp.get("base_plate_bending", {}) or {}

        def _crow(check, ur, demand="--", capacity="--"):
            all_rows.append([_p("Connection"), _p(check), _p(demand), _p(capacity),
                              _p(_f(ur, 3)), _pass_cell(ur < 1.0 if ur is not None else None)])

        _crow("Bolt tension",
              bt_sub.get("UR"),
              f"Ft = {_f(bt_sub.get('Ft_per_bolt_kN'), 2)} kN",
              f"FT,Rd = {_f(bt_sub.get('FT_Rd_kN'), 2)} kN")
        _crow("Bolt shear",
              bs_sub.get("UR"),
              f"Fv = {_f(bs_sub.get('Fv_per_bolt_kN'), 2)} kN",
              f"Fv,Rd = {_f(bs_sub.get('Fv_Rd_kN'), 2)} kN")
        _crow("Bolt bearing",
              bbrg.get("UR"),
              "--",
              f"Fb,Rd = {_f(bbrg.get('Fb_Rd_kN'), 2)} kN")
        _crow("Combined",      bc_sub.get("UR"))
        _crow("Embedment",
              be_sub.get("UR"),
              f"L_req = {_f(be_sub.get('L_required_mm'), 1)} mm",
              f"L_prov = {_f(be_sub.get('L_provided_mm'), 0)} mm")
        _crow("Weld",
              wd_sub.get("UR"),
              f"FR = {_f(wd_sub.get('FR_N_per_mm'), 2)} N/mm",
              f"Fw,Rd = {_f(wd_sub.get('Fw_Rd_N_per_mm'), 2)} N/mm")
        _crow("Base plate bearing", bpbear.get("UR"))
        _crow("Base plate bending",
              bpbend.get("UR"),
              f"M_dem = {_f(bpbend.get('M_demand_kNm'), 3)} kNm",
              f"M_cap = {_f(bpbend.get('M_cap_kNm'), 3)} kNm")
        _crow("G clamp",
              gc_sub.get("UR"),
              f"F = {_f(gc_sub.get('F_per_clamp_kN'), 2)} kN",
              f"F_fail = {_f(gc_sub.get('failure_load_kN'), 2)} kN")

    # Subframe
    sub_fr = calc.get("subframe", {}) or {}
    if sub_fr:
        ur = sub_fr.get("UR_subframe")
        all_rows.append([_p("Subframe"), _p("Bending"), _p(_f(sub_fr.get("M_Ed_kNm"), 4)),
                         _p(_f(sub_fr.get("Mc_Rd_kNm"), 4)), _p(_f(ur, 4)),
                         _pass_cell(ur < 1.0 if ur is not None else None)])

    # Lifting
    lift = calc.get("lifting", {}) or {}
    if lift:
        hole = lift.get("hole", {}) or {}
        hook = lift.get("hook", {}) or {}
        all_rows.append([_p("Lifting"), _p("Hole shear"),
                         _p(f"W = {_f(hole.get('W_post_factored_kN'), 2)} kN"),
                         _p(f"V_Rd = {_f(hole.get('V_Rd_kN'), 2)} kN"),
                         _p(_f(hole.get("UR_shear"), 3)),
                         _pass_cell(hole.get("UR_shear") < 1.0 if hole.get("UR_shear") is not None else None)])
        all_rows.append([_p("Lifting"), _p("Hook tension"),
                         _p(f"F = {_f(hook.get('F_hook_kN'), 2)} kN"),
                         _p(f"FT,Rd = {_f(hook.get('FT_Rd_kN'), 2)} kN"),
                         _p(_f(hook.get("UR_tension"), 3)),
                         _pass_cell(hook.get("UR_tension") < 1.0 if hook.get("UR_tension") is not None else None)])
        all_rows.append([_p("Lifting"), _p("Hook bond"),
                         _p(f"L_req = {_f(hook.get('L_required_mm'), 1)} mm"),
                         _p(f"L_prov = {_f(hook.get('L_provided_mm'), 0)} mm"),
                         _p(_f(hook.get("UR_bond"), 3)),
                         _pass_cell(hook.get("UR_bond") < 1.0 if hook.get("UR_bond") is not None else None)])

    # Foundation
    found = calc.get("foundation", {}) or {}
    if found:
        for combo_key in ["SLS", "DA1_C1", "DA1_C2"]:
            combo = found.get(combo_key, {}) or {}
            cl = combo_key.replace("_", "-")
            H_fac = combo.get("H_factored_kN")
            M_fac = combo.get("M_factored_kNm")
            for check, fos_key, demand_str in [
                ("Sliding",    "FOS_sliding",    f"H = {_f(H_fac, 2)} kN"),
                ("Overturning","FOS_overturning", f"M = {_f(M_fac, 2)} kNm"),
            ]:
                fos = combo.get(fos_key)
                lim = combo.get("fos_limit_" + ("sliding" if "Sliding" in check else "overturning"), 1.0)
                all_rows.append([_p(f"Foundation {cl}"), _p(check), _p(demand_str), _p(f"FOS >= {_f(lim,2)}"),
                                  _p(_f(fos, 3)), _pass_cell(fos >= lim if fos else None)])
            bd  = combo.get("bearing_drained", {}) or {}
            ur  = bd.get("UR_bearing")
            if ur is not None:
                all_rows.append([_p(f"Foundation {cl}"), _p("Bearing (drained)"), _p("--"), _p("UR < 1.0"),
                                  _p(_f(ur, 3)), _pass_cell(ur < 1.0)])
            bu   = combo.get("bearing_undrained") or {}
            ur_u = bu.get("UR_bearing")
            if ur_u is not None:
                all_rows.append([_p(f"Foundation {cl}"), _p("Bearing (undrained)"), _p("--"), _p("UR < 1.0"),
                                  _p(_f(ur_u, 3)), _pass_cell(ur_u < 1.0)])

    cw   = [_USABLE_W * 0.17, _USABLE_W * 0.22, _USABLE_W * 0.15, _USABLE_W * 0.15, _USABLE_W * 0.11, _USABLE_W * 0.20]
    data = [[_ph("Module"), _ph("Check"), _ph("Demand"), _ph("Capacity"), _ph("UR/FOS"), _ph("Result")]] + all_rows
    t = Table(data, colWidths=cw, repeatRows=1)
    t.setStyle(_TS_BASE)
    story.append(t)
    story.append(_sp(4))

    # Overall banner
    all_pass = (
        steel.get("pass", False)
        and (not conn or conn.get("all_checks_pass", True))
        and (not sub_fr or sub_fr.get("pass", True))
        and (not lift or lift.get("all_checks_pass", True))
        and found.get("pass", False)
    )
    banner_color = _GREEN if all_pass else _RED
    banner_text  = "ALL CHECKS PASS" if all_pass else "ONE OR MORE CHECKS FAIL -- PE REVIEW REQUIRED"
    banner_data  = [[Paragraph(f'<font color="white"><b>{banner_text}</b></font>', _S_BOLD)]]
    bt_obj = Table(banner_data, colWidths=[_USABLE_W])
    bt_obj.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), banner_color),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
    ]))
    story.append(bt_obj)
    story.append(_sp(4))

    # Override notes
    overrides: list[tuple[str, str, str, str]] = []
    for field_name, ov in [
        ("vb [m/s]",             dp.get("vb")),
        ("shelter_factor",       dp.get("shelter_factor")),
        ("post_length [m]",      dp.get("post_length")),
        ("post_weight [kN]",     dp.get("post_weight")),
        ("vertical_load_G [kN]", dp.get("vertical_load_G")),
    ]:
        if isinstance(ov, dict) and ov.get("override") is not None:
            overrides.append((field_name, _f(ov["calculated"], 3), _f(ov["override"], 3), ov.get("override_reason", "")))

    if overrides:
        story.append(_sub_title("8.2  Engineer Override Notes"))
        story.append(_sp(2))
        ov_data = [[_ph("Field"), _ph("Calculated"), _ph("Override"), _ph("Reason")]] + [
            [_p(r[0]), _p(r[1]), _p(r[2]), _p(r[3])] for r in overrides
        ]
        ov_cw = [_USABLE_W * 0.22, _USABLE_W * 0.15, _USABLE_W * 0.15, _USABLE_W * 0.48]
        ov_t = Table(ov_data, colWidths=ov_cw)
        ts = TableStyle(list(_TS_BASE._cmds) + [
            ("FONTNAME",  (0, 1), (-1, -1), "Helvetica-Oblique"),
            ("TEXTCOLOR", (0, 1), (-1, -1), _AMBER),
        ])
        ov_t.setStyle(ts)
        story.append(ov_t)
    else:
        story.append(Paragraph("No engineer overrides applied.", _S_SMALL))

    return story


# -- Cover page builder -------------------------------------------------------

def _build_cover(project_info: dict, meta: dict, report_meta: dict, calc: dict) -> list:
    story: list = []

    story.append(_sp(10))
    story.append(Paragraph("Union Noise / Hebei Jinbiao", ParagraphStyle(
        "Co", fontName="Helvetica", fontSize=9, textColor=_GREY_DK, alignment=1)))
    story.append(_sp(6))
    story.append(Paragraph("Structural Design Calculation", _S_H1))
    story.append(_sp(8))

    pname = project_info.get("project_name", "--")
    loc   = project_info.get("location", "--")
    bh    = project_info.get("barrier_height", "--")
    bt    = project_info.get("barrier_type", "--")
    story.append(Paragraph(pname, _S_H2))
    story.append(_sp(2))
    story.append(Paragraph(loc, ParagraphStyle("Loc", fontName="Helvetica", fontSize=10, alignment=1)))
    story.append(_sp(2))
    story.append(Paragraph(f"Barrier height: {bh} m  |  Type: {bt}",
                             ParagraphStyle("BH", fontName="Helvetica", fontSize=9, alignment=1, textColor=_GREY_DK)))
    story.append(_sp(20))

    created_by = meta.get("created_by", "--")
    created_at = meta.get("created_at", "--")
    if created_at and created_at != "--":
        try:
            dt = datetime.fromisoformat(created_at)
            created_at = dt.strftime("%d %b %Y")
        except ValueError:
            pass
    job_ref  = report_meta.get("job_reference", "--") or "--"
    revision = report_meta.get("revision", "--") or "--"
    checked  = report_meta.get("checked_by", "--") or "--"

    left_col = [
        ["Prepared by:", created_by],
        ["Date:", created_at],
        ["Job reference:", job_ref],
        ["Revision:", revision],
        ["Checked by:", checked],
    ]
    right_col = [
        ["Reviewed and endorsed by:", ""],
        ["Name:", "  " * 30],
        ["PE Registration:", "  " * 30],
        ["Signature:", "  " * 30],
        ["Date:", "  " * 30],
    ]

    half = _USABLE_W / 2 - 5 * mm
    lt = Table([[_p(r[0], _TS_BOLD), _p(r[1])] for r in left_col],
               colWidths=[35 * mm, half - 35 * mm])
    lt.setStyle(TableStyle([
        ("FONTSIZE",      (0, 0), (-1, -1), 9),
        ("TOPPADDING",    (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    rt = Table([[_p(r[0], _TS_BOLD), _p(r[1])] for r in right_col],
               colWidths=[38 * mm, half - 38 * mm])
    rt.setStyle(TableStyle([
        ("FONTSIZE",      (0, 0), (-1, -1), 9),
        ("TOPPADDING",    (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("BOX",           (0, 0), (-1, -1), 0.5, _GREY_MD),
        ("LINEBELOW",     (0, 1), (-1, -1), 0.3, _GREY_MD),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    combined = Table([[lt, rt]], colWidths=[half, half + 10 * mm])
    combined.setStyle(TableStyle([
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(combined)
    story.append(_sp(4))

    rule_t = Table([[""]], colWidths=[_USABLE_W])
    rule_t.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, -1), 0.5, _GREY_MD)]))
    story.append(rule_t)

    story.append(NextPageTemplate("body"))
    story.append(PageBreak())
    return story


# -- Main entry point ---------------------------------------------------------

def generate_pdf(payload: dict) -> bytes:
    """
    Build and return PDF bytes from the calculation payload.

    payload keys:
      project_info   -- project_name, location, barrier_height, barrier_type
      meta           -- created_by, created_at
      report_meta    -- job_reference, revision, checked_by
      design_parameters -- dp fields (post_spacing, subframe_spacing, etc.)
      calculation_results -- {wind, steel, connection, subframe, lifting, foundation}
    """
    project_info = payload.get("project_info", {})
    meta         = payload.get("meta", {})
    report_meta  = payload.get("report_meta", {})
    dp           = payload.get("design_parameters", {})
    calc         = payload.get("calculation_results", {})

    pname   = project_info.get("project_name", "Unnamed Project")
    job_ref = report_meta.get("job_reference", "") or ""

    buf = io.BytesIO()

    cover_frame = Frame(_ML, _MB, _USABLE_W, _H - _MT - _MB, id="cover")
    body_frame  = Frame(_ML, _MB, _USABLE_W, _H - _MT - _MB - 10 * mm, id="body")

    hdr = _HeaderCanvas(pname, job_ref)

    doc = BaseDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=_ML, rightMargin=_MR,
        topMargin=_MT, bottomMargin=_MB,
        title=f"Design Calculation -- {pname}",
        author=meta.get("created_by", ""),
    )

    cover_template = PageTemplate(id="cover", frames=[cover_frame])
    body_template  = PageTemplate(
        id="body",
        frames=[body_frame],
        onPage=hdr.draw,
    )
    doc.addPageTemplates([cover_template, body_template])

    story: list = []

    story.extend(_build_cover(project_info, meta, report_meta, calc))
    story.extend(_section_design_basis(calc))
    story.append(PageBreak())

    story.extend(_section_wind(calc.get("wind", {}), dp))
    story.append(PageBreak())

    if calc.get("steel"):
        story.extend(_section_steel(calc["steel"], dp))
        story.append(PageBreak())

    if calc.get("connection"):
        story.extend(_section_connection(calc["connection"], calc.get("steel")))
        story.append(PageBreak())

    if calc.get("subframe"):
        story.extend(_section_subframe(calc["subframe"], dp))
        story.append(PageBreak())

    if calc.get("lifting"):
        story.extend(_section_lifting(calc["lifting"]))
        story.append(PageBreak())

    if calc.get("foundation"):
        story.extend(_section_foundation(calc["foundation"], dp))
        story.append(PageBreak())

    story.extend(_section_summary(calc, dp))

    doc.build(story)
    return buf.getvalue()
