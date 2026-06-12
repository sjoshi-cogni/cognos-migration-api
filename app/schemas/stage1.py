from pydantic import BaseModel
from typing import List, Optional

class TableRow(BaseModel):
    Report_Name: str
    Server_Name: Optional[str] = ""
    DB_Name: Optional[str] = ""
    Schema_Name: Optional[str] = ""
    Table_Name: str
    Full_Table_Ref: str

class TableExtractionResponse(BaseModel):
    total_tables: int
    tables: List[TableRow]

class ColumnRow(BaseModel):
    Report_Name: str
    Server_Name: Optional[str] = ""
    DB_Name: Optional[str] = ""
    Schema_Name: Optional[str] = ""
    Table_Name: str
    Full_Table_Ref: str
    Column_Name: Optional[str] = ""

class LineageExtractionResponse(BaseModel):
    total_rows: int
    rows: List[ColumnRow]
