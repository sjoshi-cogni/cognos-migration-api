import re
from typing import List, Dict
from app.services.table_extractor import TABLE_PATTERN, FALLBACK_PATTERN, split_table, clean_identifier
from app.services.cognos_cleanup import clean_sql_for_parsing
from app.core.logging import get_logger

logger = get_logger(__name__)

COLUMN_PATTERN = re.compile(r'([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)')
SELECT_BLOCK_PATTERN = re.compile(r'\bselect\b(.*?)\bfrom\b(.*?)(?=\bselect\b|$)', re.IGNORECASE | re.DOTALL)

def extract_lineage(sql: str, report_name: str) -> List[Dict]:
    sql = clean_sql_for_parsing(sql)
    table_dict = {}

    for _, obj in TABLE_PATTERN.findall(sql):
        if "." not in obj:
            continue
        table_dict[obj.lower()] = {"Report_Name": report_name, **split_table(obj)}

    for obj in FALLBACK_PATTERN.findall(sql):
        if obj.lower() in table_dict or len(obj.split(".")) < 3:
            continue
        table_dict[obj.lower()] = {"Report_Name": report_name, **split_table(obj)}

    alias_map = {}
    for m in re.finditer(r'(from|join)\s+([^\s,()]+)\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_]*)', sql, re.IGNORECASE):
        tbl, alias = m.group(2), m.group(3)
        if tbl.lower() in table_dict:
            alias_map[alias.lower()] = table_dict[tbl.lower()]
    for t in table_dict.values():
        alias_map[t["Table_Name"].lower()] = t

    seen, table_has_cols, all_rows = set(), set(), []

    for alias, col in COLUMN_PATTERN.findall(sql):
        alias = alias.lower()
        col = clean_identifier(col)
        if alias not in alias_map:
            continue
        t = alias_map[alias]
        key = (report_name, t["Full_Table_Ref"], col)
        if key not in seen:
            seen.add(key)
            table_has_cols.add(t["Full_Table_Ref"])
            all_rows.append({**t, "Column_Name": col})

    for select_part, from_part in SELECT_BLOCK_PATTERN.findall(sql):
        cols = []
        for col in select_part.split(","):
            col = re.sub(r'\bas\b.*', '', col, flags=re.IGNORECASE).strip()
            col = re.sub(r'\(.*?\)', '', col)
            if "." in col:
                col = col.split(".")[-1]
            col = clean_identifier(col)
            if re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', col):
                cols.append(col)
        for t in table_dict.values():
            if t["Table_Name"].lower() not in from_part.lower():
                continue
            if t["Full_Table_Ref"] in table_has_cols:
                continue
            for col in cols:
                key = (report_name, t["Full_Table_Ref"], col)
                if key not in seen:
                    seen.add(key)
                    table_has_cols.add(t["Full_Table_Ref"])
                    all_rows.append({**t, "Column_Name": col})

    for t in table_dict.values():
        if t["Full_Table_Ref"] not in table_has_cols:
            all_rows.append({**t, "Column_Name": ""})

    logger.info(f"{report_name}: {len(all_rows)} lineage rows extracted")
    return all_rows
