"""
Union Noise — FastAPI backend entry point.
All LLM calls use LiteLLM so the provider is swappable via env vars.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import calculate, extract

app = FastAPI(
    title="Union Noise API",
    description="AI-assisted noise barrier design system",
    version="0.1.0",
)

# Allow the Vite dev server and any local origin during development.
# Tighten this for production deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(extract.router)
app.include_router(calculate.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
