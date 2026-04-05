"""
LLM service — wraps LiteLLM so the provider is swappable via env vars.
Changing LITELLM_MODEL and API key env vars switches providers without code changes.
"""

import json
import os
import re

from dotenv import load_dotenv
from litellm import completion
from pydantic import BaseModel, field_validator

load_dotenv()

EXTRACT_SYSTEM_PROMPT = """You are an engineering document parser for noise barrier projects.
Extract the following design parameters from the provided document text.
Return ONLY a valid JSON object with exactly these keys (no markdown, no explanation):

{
  "project_name": "<string — project name or tender reference>",
  "location": "<string — site address or general location>",
  "barrier_height": <number — barrier height in metres, null if not found>,
  "barrier_type": "<'Type 1' | 'Type 2' | 'Type 3' — null if not found>",
  "foundation_constraint": "<string — foundation type or site constraint, empty string if not found>",
  "scope_note": "<string — brief scope description, empty string if not found>"
}

Rules:
- barrier_height must be a number (metres) or null — never a string
- barrier_type must be exactly 'Type 1', 'Type 2', or 'Type 3' — or null if unclear
- All string fields default to empty string "" if not found
- Do not invent values; use null or "" for missing data
"""


class ExtractedParameters(BaseModel):
    project_name: str
    location: str
    barrier_height: float | None
    barrier_type: str | None
    foundation_constraint: str
    scope_note: str

    @field_validator("barrier_type")
    @classmethod
    def validate_barrier_type(cls, v: str | None) -> str | None:
        if v is None:
            return None
        allowed = {"Type 1", "Type 2", "Type 3"}
        if v not in allowed:
            return None
        return v


async def extract_parameters(document_text: str) -> ExtractedParameters:
    model = os.getenv("LITELLM_MODEL", "claude-sonnet-4-6")

    response = completion(
        model=model,
        messages=[
            {"role": "system", "content": EXTRACT_SYSTEM_PROMPT},
            {"role": "user", "content": f"Document text:\n\n{document_text}"},
        ],
        temperature=0.0,
    )

    raw = response.choices[0].message.content or ""

    # Strip markdown code fences if present
    raw = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM returned non-JSON response: {raw[:200]}") from exc

    return ExtractedParameters(**data)
