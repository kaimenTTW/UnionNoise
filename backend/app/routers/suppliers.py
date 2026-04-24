"""
POST /api/suppliers — thin wrapper around find_suppliers().
Accepts designation, grade, mass_kg_per_m and returns a SupplierResult dict.
Non-blocking on the backend side; the heavy work is inside find_suppliers().
"""

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.section_retrieval import find_suppliers

router = APIRouter()


class SuppliersRequest(BaseModel):
    designation: str
    grade: str
    mass_kg_per_m: float


@router.post("/api/suppliers")
async def get_suppliers(req: SuppliersRequest) -> dict:
    return find_suppliers(
        designation=req.designation,
        grade=req.grade,
        mass_kg_per_m=req.mass_kg_per_m,
    )
