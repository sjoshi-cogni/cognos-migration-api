import io
import pandas as pd
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from app.services.table_mapper import run_table_mapping
from app.services.column_mapper import run_column_mapping
from app.schemas.stage2 import TableMappingResponse, ColumnMappingResponse

router = APIRouter()

@router.post("/map-tables", response_model=TableMappingResponse)
async def map_tables(lineage_file: UploadFile = File(...)):
    if not lineage_file.filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Expected an .xlsx file")
    raw = await lineage_file.read()
    df_input = pd.read_excel(io.BytesIO(raw), engine="openpyxl")
    results = run_table_mapping(df_input)
    mapped = sum(1 for r in results if r["DB2_DB_Name"] != "Not Found")
    return TableMappingResponse(
        total=len(results), mapped=mapped, not_found=len(results) - mapped, rows=results
    )

@router.post("/map-tables/download")
async def map_tables_download(lineage_file: UploadFile = File(...)):
    raw = await lineage_file.read()
    df_input = pd.read_excel(io.BytesIO(raw), engine="openpyxl")
    results = run_table_mapping(df_input)
    df = pd.DataFrame(results)
    buf = io.BytesIO()
    df.to_excel(buf, index=False, sheet_name="Sheet1")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Table_Mapping.xlsx"}
    )

@router.post("/map-columns", response_model=ColumnMappingResponse)
async def map_columns(
    lineage_file: UploadFile = File(...),
    mapping_file: UploadFile = File(...),
):
    df_cognos = pd.read_excel(io.BytesIO(await lineage_file.read()), engine="openpyxl")
    df_mapping = pd.read_excel(io.BytesIO(await mapping_file.read()), sheet_name="Sheet1", engine="openpyxl")
    results = run_column_mapping(df_cognos, df_mapping)
    from app.core.config import settings
    matched = sum(1 for r in results if r["Match_Status"] == "MATCHED")
    low_conf = sum(1 for r in results if r["Match_Status"] == "LOW_CONFIDENCE")
    unmapped = sum(1 for r in results if r["Match_Status"] == "UNMAPPED_TABLE")
    return ColumnMappingResponse(total=len(results), matched=matched, low_confidence=low_conf, unmapped=unmapped, rows=results)

@router.post("/map-columns/download")
async def map_columns_download(
    lineage_file: UploadFile = File(...),
    mapping_file: UploadFile = File(...),
):
    df_cognos = pd.read_excel(io.BytesIO(await lineage_file.read()), engine="openpyxl")
    df_mapping = pd.read_excel(io.BytesIO(await mapping_file.read()), sheet_name="Sheet1", engine="openpyxl")
    results = run_column_mapping(df_cognos, df_mapping)
    df = pd.DataFrame(results)
    buf = io.BytesIO()
    df.to_excel(buf, index=False, sheet_name="Column_Mapping")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Column_Mapping.xlsx"}
    )
