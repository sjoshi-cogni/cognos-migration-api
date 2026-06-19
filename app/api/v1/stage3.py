import io
import zipfile
import openpyxl
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from typing import List
from app.services.sql_converter import load_mapping_from_workbook, load_date_clause_from_workbook, convert_sql_to_mquery
from app.schemas.stage3 import ConversionResponse

router = APIRouter()

@router.post("/convert", response_model=ConversionResponse)
async def convert_sql_files(
    sql_files: List[UploadFile] = File(...),
    mapping_file: UploadFile = File(...),
    prompt_file: UploadFile = File(None),
):
    if not mapping_file.filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="mapping_file must be .xlsx")

    mapping_wb = openpyxl.load_workbook(io.BytesIO(await mapping_file.read()))
    table_mapping, column_mapping = load_mapping_from_workbook(mapping_wb)

    date_clause = ""
    if prompt_file:
        prompt_wb = openpyxl.load_workbook(io.BytesIO(await prompt_file.read()))
        date_clause = load_date_clause_from_workbook(prompt_wb)

    results = []
    for sql_file in sql_files:
        if not sql_file.filename.lower().endswith(".sql"):
            continue
        raw = await sql_file.read()
        _, meta = convert_sql_to_mquery(raw, sql_file.filename, table_mapping, column_mapping, date_clause)
        results.append(meta)

    return ConversionResponse(total_files=len(results), results=results)

@router.post("/convert/download")
async def convert_and_download(
    sql_files: List[UploadFile] = File(...),
    mapping_file: UploadFile = File(...),
    prompt_file: UploadFile = File(None),
):
    mapping_wb = openpyxl.load_workbook(io.BytesIO(await mapping_file.read()))
    table_mapping, column_mapping = load_mapping_from_workbook(mapping_wb)

    date_clause = ""
    if prompt_file:
        prompt_wb = openpyxl.load_workbook(io.BytesIO(await prompt_file.read()))
        date_clause = load_date_clause_from_workbook(prompt_wb)

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for sql_file in sql_files:
            if not sql_file.filename.lower().endswith(".sql"):
                continue
            raw = await sql_file.read()
            output, meta = convert_sql_to_mquery(raw, sql_file.filename, table_mapping, column_mapping, date_clause)
            zf.writestr(meta["output_filename"], output)

    zip_buf.seek(0)
    return StreamingResponse(
        zip_buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=mquery_outputs.zip"}
    )