"""
Server entry point — sets WindowsSelectorEventLoopPolicy before uvicorn
initialises its own event loop, which is required for Playwright on Windows.

Start with:
    uv run python run.py
"""

import sys
import asyncio

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
