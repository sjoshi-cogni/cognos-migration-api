import re
from typing import List, Dict
from app.services.cognos_cleanup import clean_sql_for_parsing
from app.core.logging import get_logger

logger = get_logger(__name__)

TABLE_PATTERN = re.compile(
    r'''
    \b(from|join|inner\s+join|left\s+join|right\s+join|
       full\s+join|cross\s+join|cross\s+apply|outer\s+apply|apply)
    \s+
    (
        (?:\[[^\]]+\]|"[^"]+"|[A-Za-z0-9_\$#]+)
        (?:\s*\.\s*
            (?:\[[^\]]+\]|"[^"]+"|[A-Za-z0-9_\$#]*)
        ){1,3}
    )
    ''',
    re.IGNORECASE | re.VERBOSE
)

FALLBACK_PATTERN = re.compile(
    r'''
    (
        (?:\[[^\]]+\]|"[^"]+"|[A-Za-z0-9_\$#]+)
        (?:\s*\.\s*
            (?:\[[^\]]+\]|"[^"]+"|[A-Za-z0-9_\$#]*)
        ){2,3}
    )
    ''',
    re.IGNORECASE | re.VERBOSE
)

SKIP_TABLES = {"id", "name", "date", "time", "code", "value"}

def clean_identifier(v: str) -> str:
    v = v.strip()
    if v.startswith("[") and v.endswith("]"):
        v = v[1:-1]
    if v.startswith('"') and v.endswith('"'):
        v = v[1:-1]
    return v.strip()

def split_table(obj: str) -> Dict:
    parts = [clean_identifier(p) for p in obj.split(".")]
    return {
        "Server_Name": parts[-4] if len(parts) >= 4 else "",
        "DB_Name": parts[-3] if len(parts) >= 3 else "",
        "Schema_Name": parts[-2] if len(parts) >= 2 else "",
        "Table_Name": parts[-1],
        "Full_Table_Ref": obj,
    }

def extract_tables(sql: str, report_name: str) -> List[Dict]:
    sql = clean_sql_for_parsing(sql)
    rows = []
    seen = set()

    for _, obj in TABLE_PATTERN.findall(sql):
        obj = obj.strip()
        if obj.lower().startswith("select") or "." not in obj:
            continue
        if obj in seen:
            continue
        seen.add(obj)
        rows.append({"Report_Name": report_name, **split_table(obj)})

    for obj in FALLBACK_PATTERN.findall(sql):
        obj = obj.strip()
        if obj in seen or "." not in obj:
            continue
        parts = obj.split(".")
        if len(parts) < 3:
            continue
        # Add this missing guard from original script
        if len(parts) == 2 and parts[0].islower():
            continue
        info = split_table(obj)
        if info["Table_Name"].lower() in SKIP_TABLES:
            continue
        seen.add(obj)
        rows.append({"Report_Name": report_name, **info})


    logger.info(f"{report_name}: {len(rows)} tables extracted")
    return rows
