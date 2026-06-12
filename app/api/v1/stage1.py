import io
import pandas as pd
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from typing import List
from app.services.cognos_cleanup import read_text
from app.services.table_extractor import extract_tables
from app.services.lineage_extractor import extract_lineage
from app.schemas.stage1 import TableExtractionResponse, LineageExtractionResponse

router = APIRouter()

@router.post("/extract-tables", response_model=TableExtractionResponse)
async def extract_tables_endpoint(files: List[UploadFile] = File(...)):
    all_rows = []
    for file in files:
        if not file.filename.lower().endswith(".sql"):
            continue
        raw = await file.read()
        sql = read_text(raw)
        report_name = file.filename.rsplit(".", 1)[0]
        all_rows.extend(extract_tables(sql, report_name))

    if not all_rows:
        raise HTTPException(status_code=400, detail="No valid SQL files uploaded or no tables found.")

    seen = set()
    unique_rows = []
    for row in all_rows:
        key = row["Full_Table_Ref"]
        if key not in seen:
            seen.add(key)
            unique_rows.append(row)

    return TableExtractionResponse(total_tables=len(unique_rows), tables=unique_rows)

@router.post("/extract-tables/download")
async def extract_tables_download(files: List[UploadFile] = File(...)):
    all_rows = []
    for file in files:
        if not file.filename.lower().endswith(".sql"):
            continue
        raw = await file.read()
        sql = read_text(raw)
        report_name = file.filename.rsplit(".", 1)[0]
        all_rows.extend(extract_tables(sql, report_name))

    df = pd.DataFrame(all_rows).drop_duplicates(subset=["Full_Table_Ref"])
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Final_Base_Tables.xlsx"}
    )

@router.post("/extract-lineage", response_model=LineageExtractionResponse)
async def extract_lineage_endpoint(files: List[UploadFile] = File(...)):
    all_rows = []
    for file in files:
        if not file.filename.lower().endswith(".sql"):
            continue
        raw = await file.read()
        sql = read_text(raw)
        report_name = file.filename.rsplit(".", 1)[0]
        all_rows.extend(extract_lineage(sql, report_name))

    return LineageExtractionResponse(total_rows=len(all_rows), rows=all_rows)

@router.post("/extract-lineage/download")
async def extract_lineage_download(files: List[UploadFile] = File(...)):
    all_rows = []
    for file in files:
        if not file.filename.lower().endswith(".sql"):
            continue
        raw = await file.read()
        sql = read_text(raw)
        report_name = file.filename.rsplit(".", 1)[0]
        all_rows.extend(extract_lineage(sql, report_name))

    df = pd.DataFrame(all_rows).drop_duplicates(subset=["Report_Name", "Full_Table_Ref", "Column_Name"])
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Final_Base_Tables_Columns.xlsx"}
    )
