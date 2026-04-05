"""
POST /api/extract

Accepts either:
  - multipart/form-data with a `file` field (PDF / .docx / .txt)
  - application/json with a `text` field

Calls the LLM service to extract design parameters and returns structured JSON.
"""

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.services.llm import ExtractedParameters, extract_parameters

router = APIRouter(prefix="/api", tags=["extract"])


@router.post("/extract", response_model=ExtractedParameters)
async def extract_endpoint(
    file: UploadFile | None = File(default=None),
    text: str | None = Form(default=None),
) -> ExtractedParameters:
    """
    Extract design parameters from an uploaded document or pasted text.
    Exactly one of `file` or `text` must be provided.
    """
    if file is None and (text is None or text.strip() == ""):
        raise HTTPException(
            status_code=422,
            detail="Provide either a `file` upload or a `text` field.",
        )

    if file is not None:
        raw_bytes = await file.read()
        # Attempt UTF-8 decode; fall back to latin-1 for binary PDFs
        try:
            document_text = raw_bytes.decode("utf-8")
        except UnicodeDecodeError:
            document_text = raw_bytes.decode("latin-1")

        # For PDF/binary files the text will contain noise — the LLM still
        # extracts what it can. A full Docling pipeline is deferred to iteration 2.
        if not document_text.strip():
            raise HTTPException(
                status_code=422,
                detail="Could not extract readable text from the uploaded file.",
            )
    else:
        document_text = text  # type: ignore[assignment]

    try:
        result = await extract_parameters(document_text)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"LLM extraction failed: {exc}",
        ) from exc

    return result


@router.post("/extract-text")
async def extract_text_json(body: dict) -> ExtractedParameters:
    """
    JSON body variant: { "text": "..." }
    Exists so the frontend can POST JSON directly without multipart.
    """
    text_input: str = body.get("text", "")
    if not text_input.strip():
        raise HTTPException(status_code=422, detail="`text` field is required.")

    try:
        result = await extract_parameters(text_input)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"LLM extraction failed: {exc}") from exc

    return result
