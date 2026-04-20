"""
AI-assisted steel section retrieval — Gemini 2.5 Flash via google-genai SDK.

Workflow:
1. Fetch fully-rendered HTML from supplier catalogue page (Playwright headless Chromium)
2. Pass HTML + design demand to Gemini — extract structured section list JSON
3. Cross-check extracted sections against parts_library.json cache
4. Run _check_section() on each candidate (lightest first); return first passing section
5. On any exception: fall back to iterating parts_library.json directly

Provider: Google AI Studio, model gemini-2.5-flash
SDK: google-genai v1.x  (from google import genai)
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import os
from functools import lru_cache
from pathlib import Path

from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright
from google import genai
from google.genai import types as genai_types

from app.calculation.steel import _check_section, _load_sections

_PARTS_PATH = Path(__file__).parent.parent / "data" / "parts_library.json"

# Consteel SG — fully JS-rendered catalogue page
_CATALOGUE_URL = "https://consteel.com.sg/"

_EXTRACT_PROMPT = """\
You are a structural steel section database. Given the raw HTML of a supplier catalogue page, \
extract a JSON array of Universal Beam (UB) sections that have a plastic section modulus \
Wpl_y_cm3 >= {wpl_min:.0f} cm³.

Return ONLY a valid JSON array with objects having exactly these keys:
  designation, mass_kg_per_m, h_mm, b_mm, tw_mm, tf_mm, r_mm,
  Iy_cm4, Iz_cm4, Wpl_y_cm3, Wel_y_cm3, Wpl_z_cm3, Wel_z_cm3, Iw_dm6, It_cm4,
  E_N_per_mm2 (always 210000), fy_N_per_mm2 (always {fy:.0f})

Sort ascending by mass_kg_per_m (lightest first).
Do NOT include any explanation text — only the JSON array.

HTML:
{html}
"""

# Warn once at import time if the key is missing
if not os.environ.get("GOOGLE_API_KEY"):
    print(
        "WARNING: GOOGLE_API_KEY not set — section retrieval will use cache fallback only",
        flush=True,
    )


@lru_cache(maxsize=1)
def _load_cache() -> dict[str, dict]:
    """Return parts_library sections keyed by designation for O(1) lookup."""
    with _PARTS_PATH.open() as f:
        data = json.load(f)
    return {s["designation"]: s for s in data["sections"]}


def _playwright_fetch_sync(url: str) -> str:
    """
    Run Playwright in a dedicated thread with its own fresh SelectorEventLoop.
    Bypasses uvicorn's ProactorEventLoop on Windows which does not support
    Playwright's subprocess transport.
    """
    async def _fetch() -> str:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            try:
                page = await browser.new_page()
                await page.goto(url, wait_until="networkidle", timeout=30000)
                await page.wait_for_timeout(2000)
                content = await page.content()
                print(
                    f"[section_retrieval] Page fetched, {len(content)} chars",
                    flush=True,
                )
                return content
            finally:
                await browser.close()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(_fetch())
    finally:
        loop.close()


async def _fetch_page(url: str) -> str:
    print(f"[section_retrieval] Fetching page from {url}...", flush=True)
    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return await loop.run_in_executor(pool, _playwright_fetch_sync, url)


def _extract_sections_with_llm(html: str, wpl_min_cm3: float, fy: float) -> list[dict]:
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY not set")

    print("[section_retrieval] Calling Gemini for extraction...", flush=True)
    client = genai.Client(api_key=api_key)
    prompt = _EXTRACT_PROMPT.format(
        wpl_min=wpl_min_cm3,
        fy=fy,
        html=html[:80_000],  # truncate very large pages
    )
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=genai_types.GenerateContentConfig(
            temperature=0.0,
            response_mime_type="application/json",
        ),
    )
    text = response.text.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    sections = json.loads(text)
    print(f"[section_retrieval] Gemini returned {len(sections)} sections", flush=True)
    return sections


def _verify_against_cache(sections: list[dict]) -> list[dict]:
    """
    Cross-check LLM-extracted sections against parts_library.json.
    Prefer cached entry when designation matches (authoritative geometry).
    Keep LLM entry only when designation not in cache.
    """
    cache = _load_cache()
    verified: list[dict] = []
    for sec in sections:
        desig = sec.get("designation", "")
        if desig in cache:
            verified.append(cache[desig])
        else:
            verified.append(sec)
    return sorted(verified, key=lambda s: s.get("mass_kg_per_m", 9999))


async def select_section(
    M_Ed_kNm: float,
    V_Ed_kN: float,
    w_kN_per_m: float,
    L_mm: float,
    Lcr_mm: float,
    post_length_m: float,
    deflection_limit_n: float,
    fy: float = 275.0,
    catalogue_url: str = _CATALOGUE_URL,
) -> dict:
    """
    Select the lightest passing UB section using live AI retrieval with parts_library fallback.

    Returns the same dict shape as _check_section() with an additional "source" key:
      "source": "live"      — section found via Gemini extraction
      "source": "cache"     — section found by falling back to parts_library.json
      "error": "..."        — no section found anywhere
    """
    print(
        f"[section_retrieval] Attempting live retrieval — "
        f"M_Ed={M_Ed_kNm:.2f} kNm, V_Ed={V_Ed_kN:.2f} kN",
        flush=True,
    )

    kwargs = dict(
        M_Ed_kNm=M_Ed_kNm,
        V_Ed_kN=V_Ed_kN,
        w_kN_per_m=w_kN_per_m,
        L_mm=L_mm,
        Lcr_mm=Lcr_mm,
        post_length_m=post_length_m,
        deflection_limit_n=deflection_limit_n,
    )

    # Minimum Wpl_y needed: Wpl_min = M_Ed / (fy / gamma_M1) [in cm³]
    # gamma_M1 = 1.0 → Wpl_min [mm³] = M_Ed [kNm] × 1e6 / fy; cm³ = mm³/1e3
    wpl_min_cm3 = M_Ed_kNm * 1e6 / fy / 1e3

    fallback_reason: str | None = None

    try:
        html = await _fetch_page(catalogue_url)
        candidates = _extract_sections_with_llm(html, wpl_min_cm3=wpl_min_cm3, fy=fy)
        verified = _verify_against_cache(candidates)
        for sec in verified:
            result = _check_section(sec=sec, **kwargs)
            if result["pass"]:
                print(
                    f"[section_retrieval] Live: selected {result['designation']}",
                    flush=True,
                )
                return {**result, "source": "live", "fallback_reason": None}
        fallback_reason = "No live candidate passed checks — falling back to parts library"
        print(f"[section_retrieval] {fallback_reason}", flush=True)
    except PlaywrightTimeoutError:
        fallback_reason = "Live retrieval timed out — using cached sections"
        print(f"[section_retrieval] {fallback_reason}", flush=True)
    except RuntimeError as exc:
        fallback_reason = str(exc)  # e.g. "GOOGLE_API_KEY not set"
        print(f"[section_retrieval] RuntimeError: {fallback_reason}", flush=True)
    except Exception as exc:
        fallback_reason = f"{type(exc).__name__}: {exc}"
        print(f"[section_retrieval] Exception: {fallback_reason}", flush=True)

    # Fallback: iterate full parts_library.json sorted ascending by mass
    print("[section_retrieval] Running cache fallback...", flush=True)
    for sec in _load_sections():
        result = _check_section(sec=sec, **kwargs)
        if result["pass"]:
            print(
                f"[section_retrieval] Cache: selected {result['designation']}",
                flush=True,
            )
            return {**result, "source": "cache", "fallback_reason": fallback_reason}

    return {
        "error": "No section passes checks in live retrieval or parts library cache.",
        "pass": False,
        "fallback_reason": fallback_reason,
    }
