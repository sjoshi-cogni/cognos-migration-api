import re
import openpyxl
from typing import List, Tuple, Dict
from app.core.logging import get_logger

logger = get_logger(__name__)

def load_mapping_from_workbook(wb: openpyxl.Workbook) -> Tuple[List, Dict]:
    ws = wb.active
    headers = [c.value for c in next(ws.iter_rows(max_row=1))]
    idx = {h: i for i, h in enumerate(headers)}
    table_mapping, column_mapping = [], {}

    for row in ws.iter_rows(min_row=2, values_only=True):
        try:
            cog = f"{row[idx['Cognos Database']]}.{row[idx['Cognos Schema']]}.{row[idx['Cognos Table']]}"
            db = f"{row[idx['Databricks Database']]}.{row[idx['Databricks Schema']]}.{row[idx['Databricks Table']]}"
            table_mapping.append((cog, db))
            cog_col = row[idx.get("Cognos Columns")]
            db_col = row[idx.get("Databricks Columns")]
            if cog_col and db_col:
                column_mapping[cog_col.lower()] = db_col
        except Exception:
            continue
    return table_mapping, column_mapping

def load_date_clause_from_workbook(wb: openpyxl.Workbook) -> str:
    ws = wb.active
    for row in ws.iter_rows(values_only=True):
        for cell in row:
            if cell:
                text = str(cell)
                if "if (" in text.lower() and "date" in text.lower():
                    return text.strip()
    return ""

def remove_double_quotes(sql: str) -> str:
    sql = re.sub(r'"(\w+)"\.\"(\w+)\"', r'\1.\2', sql)
    return re.sub(r'"(\w+)"', r'\1', sql)

def apply_mapping(sql: str, table_mapping: List, column_mapping: Dict) -> str:
    for cog, db in table_mapping:
        cog_clean = re.sub(r"[\[\]]", "", cog)
        sql = re.sub(re.escape(cog_clean), db, sql, flags=re.IGNORECASE)
    for cog_col, db_col in column_mapping.items():
        sql = re.sub(rf"(\b\w+\.){re.escape(cog_col)}\b", rf"\1{db_col}", sql, flags=re.IGNORECASE)
    for cog_col, db_col in column_mapping.items():
        sql = re.sub(rf"\b{re.escape(cog_col)}\b", db_col, sql, flags=re.IGNORECASE)
    return sql

def fix_databricks_sql(sql: str) -> str:
    def fix_subquery_alias(match):
        return f"{match.group(2).strip()} AS {match.group(1)}"
    sql = re.sub(r"\b(\w+)\s*=\s*(\(\s*SELECT[\s\S]*?\))", fix_subquery_alias, sql, flags=re.IGNORECASE)
    sql = re.sub(r"\[(.*?)\]", r"\1", sql)

    def fix_coalesce(match):
        return f"COALESCE({match.group(2).strip()}, {match.group(3).strip()}) AS {match.group(1)}"
    sql = re.sub(r"\b(\w+)\s*=\s*COALESCE\(\s*([^,]+)\s*,\s*([^)]+)\)", fix_coalesce, sql, flags=re.IGNORECASE)

    def concat_replace(match):
        return f"CONCAT(COALESCE({match.group(2)},''), ' ', COALESCE({match.group(3)},'')) AS {match.group(1)}"
    sql = re.sub(
        r"\b(\w+)\s*=\s*(\w+(?:\.\w+)?)\s*\+\s*SPACE\s*\(\s*1\s*\)\s*\+\s*(\w+(?:\.\w+)?)",
        concat_replace, sql, flags=re.IGNORECASE
    )

    def fix_select_block(match):
        block = match.group(0)
        def fix_alias(m):
            alias, expr = m.group(1), m.group(2).strip()
            if "=" in expr or "COALESCE" in expr.upper() or "CONCAT" in expr.upper():
                return m.group(0)
            return f"{expr} AS {alias}"
        return re.sub(r"\b(\w+)\s*=\s*([^,\n]+)", fix_alias, block)

    sql = re.sub(r"(select[\s\S]*?from)", fix_select_block, sql, flags=re.IGNORECASE)
    return sql

def detect_patterns(sql: str):
    list_patterns = [
        (f"{tbl}.{col}" if tbl else col, prompt)
        for tbl, col, prompt in re.findall(
            r'(?:\"?(\w+)\"?\.)?\"?(\w+)\"?\s+in\s*\(\s*#\s*promptmany\(\s*\'([^\']+)\'\s*\)\s*#',
            sql, re.I
        )
    ]
    date_patterns = re.findall(
        r'(?:\"?(\w+)\"?\.)?\"?(\w+)\"?\s+between\s+#\s*prompt\(\s*\'([^\']+)\'\s*\)\s*#\s+and\s+#\s*prompt\(\s*\'([^\']+)\'\s*\)\s*#',
        sql, re.I
    )
    return list_patterns, date_patterns

def clean_sql_prompts(sql: str) -> str:
    sql = re.sub(r'\w+\.\w+\s+between\s+#\s*prompt\([^)]*\)\s*#\s+and\s+#\s*prompt\([^)]*\)\s*#', '1=1', sql, flags=re.I)
    sql = re.sub(r'(?:\"?\w+\"?\.)?\"?\w+\"?\s+in\s*\(\s*#\s*promptmany\([^)]*\)\s*#\s*\)', '1=1', sql, flags=re.I)
    sql = re.sub(r'#\s*prompt(?:many)?\([^)]*\)\s*#', '', sql)
    return sql

def build_m_query(sql: str, list_patterns: List, date_patterns: List, date_clause: str) -> str:
    where_defs, injections = [], []
    for col, prompt in list_patterns:
        pname = re.sub(r'\s+', '', prompt).lower()
        col_name = col.split(".")[-1]
        where_defs.append(f"""
    combinedlist_{pname} =
        if List.Count({prompt})=0 then ""
        else Text.Combine(List.Transform({prompt}, each Text.From(_)), ","),

    where{pname} =
        if combinedlist_{pname} <> ""
        then " AND {col_name} IN (" & combinedlist_{pname} & ")"
        else "",
""")
        injections.append(f"where{pname}")

    date_clause_block = ""
    if date_patterns and date_clause:
        date_clause_block = f"\n    {date_clause},"
        injections.append("dateClause")

    injection_str = ""
    if injections:
        injection_str = "\n        & " + "\n        & ".join(injections)

    return f"""
let
    databricksSource = Databricks.Query(
        "adb-80371074517305.5.azuredatabricks.net", "/sql/1.0/warehouses/0c867214ce8eb461",
        [Catalog="uc_edh_slv_P"]
    ),

{''.join(where_defs)}
{date_clause_block}

    query = "{sql.strip()}"
        {injection_str},

    finalsource = databricksSource(query)

in
    finalsource
"""

def convert_sql_to_mquery(
    sql_raw: bytes,
    filename: str,
    table_mapping: List,
    column_mapping: Dict,
    date_clause: str
) -> Tuple[str, Dict]:
    from app.services.cognos_cleanup import read_text
    sql = read_text(sql_raw)
    list_patterns, date_patterns = detect_patterns(sql)
    sql = clean_sql_prompts(sql)
    sql = remove_double_quotes(sql)
    sql = fix_databricks_sql(sql)
    sql = apply_mapping(sql, table_mapping, column_mapping)
    output = build_m_query(sql, list_patterns, date_patterns, date_clause if date_patterns else "")
    return output, {
        "filename": filename,
        "status": "success",
        "output_filename": filename.replace(".sql", "_Mquery_FINAL.txt"),
        "list_prompts_found": len(list_patterns),
        "date_prompts_found": len(date_patterns),
    }
