from pydantic import BaseModel
from typing import List

class ConversionResult(BaseModel):
    filename: str
    status: str
    output_filename: str
    list_prompts_found: int
    date_prompts_found: int

class ConversionResponse(BaseModel):
    total_files: int
    results: List[ConversionResult]
