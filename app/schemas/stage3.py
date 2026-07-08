from pydantic import BaseModel
from typing import List, Optional

class ConversionResult(BaseModel):
    filename: str
    status: str
    output_filename: str
    list_prompts_found: int
    date_prompts_found: int

class ConversionResponse(BaseModel):
    total_files: int
    results: List[ConversionResult]

class LLMFixResult(BaseModel):
    filename: str
    status: str
    output_filename: str
    list_prompts_found: int
    date_prompts_found: int
    llm_success: bool
    llm_summary: str
    fixed_mquery: Optional[str] = None

class LLMFixResponse(BaseModel):
    total_files: int
    results: List[LLMFixResult]
