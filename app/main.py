from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1 import stage1, stage2, stage3
from app.core.config import settings

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Cognos to Databricks/Power BI Migration API"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stage1.router, prefix="/api/v1/stage1", tags=["Stage 1 - Table Extraction"])
app.include_router(stage2.router, prefix="/api/v1/stage2", tags=["Stage 2 - Column Mapping"])
app.include_router(stage3.router, prefix="/api/v1/stage3", tags=["Stage 3 - SQL Conversion"])

@app.get("/health")
def health_check():
    return {"status": "ok", "version": settings.VERSION}
