from pydantic import BaseModel
from typing import Optional, List

class TableMappingRow(BaseModel):
    DB1_DB_Name: str
    DB1_Schema_Name: str
    DB1_Table_Name: str
    DB2_DB_Name: str
    DB2_Schema_Name: str
    DB2_Table_Name: str

class TableMappingResponse(BaseModel):
    total: int
    mapped: int
    not_found: int
    rows: List[TableMappingRow]

class ColumnMappingRow(BaseModel):
    DB_Name: Optional[str]
    Schema_Name: Optional[str]
    Table_Name: str
    Column_Name: str
    DB2_DB_Name: Optional[str]
    DB2_Schema_Name: Optional[str]
    DB2_Table_Name: Optional[str]
    DB2_Column_Name: Optional[str]
    Confidence_Score: float
    Match_Status: str

class ColumnMappingResponse(BaseModel):
    total: int
    matched: int
    low_confidence: int
    unmapped: int
    rows: List[ColumnMappingRow]

class CombinedMappingResponse(BaseModel):
    table: TableMappingResponse
    column: ColumnMappingResponse
