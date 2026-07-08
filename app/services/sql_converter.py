import os
import re
import openpyxl
from typing import List, Tuple, Dict
from dotenv import load_dotenv
from app.core.logging import get_logger
import pandas as pd

load_dotenv()
logger = get_logger(__name__)

DATABRICKS_HOST = os.getenv("DATABRICKS_HOST", "default-host.databricks.net")
DATABRICKS_WAREHOUSE = os.getenv("DATABRICKS_HTTP_PATH", "/sql/1.0/warehouses/default")

    
def load_mapping_from_workbook(wb: openpyxl.Workbook) -> Tuple[List, Dict]:
    ws = wb.active
    headers = [c.value for c in next(ws.iter_rows(max_row=1)) if c.value is not None]
    idx = {h: i for i, h in enumerate(headers)}
    table_mapping, column_mapping = [], {}

    for row in ws.iter_rows(min_row=2, values_only=True):
        try:
            if all(k in idx for k in ['Cognos Database', 'Cognos Schema', 'Cognos Table', 'Databricks Database', 'Databricks Schema', 'Databricks Table']):
                cog_parts = [row[idx['Cognos Database']], row[idx['Cognos Schema']], row[idx['Cognos Table']]]
                db_parts  = [row[idx['Databricks Database']], row[idx['Databricks Schema']], row[idx['Databricks Table']]]
                # skip rows where any part is None
                if all(p is not None for p in cog_parts + db_parts):
                    cog = f"{cog_parts[0]}.{cog_parts[1]}.{cog_parts[2]}"
                    db  = f"{db_parts[0]}.{db_parts[1]}.{db_parts[2]}"
                    table_mapping.append((cog, db))

            cog_col = row[idx.get("Cognos Columns")] if "Cognos Columns" in idx else None
            db_col  = row[idx.get("Databricks Columns")] if "Databricks Columns" in idx else None

            if cog_col and db_col:
                column_mapping[str(cog_col).lower().strip()] = str(db_col).strip()
        except Exception as e:
            logger.warning(f"Skipping malformed mapping row: {e}")
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
    sql = re.sub(r'"(\w+)"\.\\"(\w+)\\"', r'\1.\2', sql)
    return re.sub(r'"(\w+)"', r'\1', sql)

def apply_mapping(sql: str, table_mapping: List, column_mapping: Dict) -> str:
    # Sort table mappings longest to shortest to prevent partial string matches
    sorted_tables = sorted(table_mapping, key=lambda x: len(x[0]), reverse=True)
    for cog, db in sorted_tables:
        cog_clean = re.sub(r"[\[\]]", "", cog)
        sql = re.sub(re.escape(cog_clean), db, sql, flags=re.IGNORECASE)
        
    # CRITICAL FIX: Sort column mapping keys from longest string to shortest string
    sorted_columns = sorted(column_mapping.items(), key=lambda x: len(x[0]), reverse=True)
    
    for cog_col, db_col in sorted_columns:
        # Match dot prefixed columns (e.g., SQL1.Event Description)
        sql = re.sub(rf"(\b\w+\.){re.escape(cog_col)}\b", rf"\1{db_col}", sql, flags=re.IGNORECASE)
        # Match isolated column identifiers using word boundaries (\b)
        sql = re.sub(rf"\b{re.escape(cog_col)}\b", db_col, sql, flags=re.IGNORECASE)
        
    return sql


def fix_databricks_sql(sql: str) -> str:
    # 1. Clear SQL Server bracket wrappers and nolock table hints
    sql = re.sub(r"\[(.*?)\]", r"\1", sql)
    sql = re.sub(r"\(\s*nolock\s*\)", "", sql, flags=re.IGNORECASE)

    # 2. Fix T-SQL style "Alias = Expression" where Expression uses '+' for concatenation
    # Example: Property = (s.event_desc + ' (' + cast(s.site_id as varchar (3)) + ')')
    # Target output: CONCAT(s.event_desc, ' (', cast(s.site_id as STRING), ')') AS Property
    def fix_legacy_concat_assignment(match):
        alias = match.group(1).strip()
        concat_content = match.group(2).strip()
        
        # Strip out wrapping parentheses if the whole expression was enclosed in them
        if concat_content.startswith('(') and concat_content.endswith(')'):
            # Simple check to verify it matches outer parens
            if concat_content.count('(') == concat_content.count(')'):
                concat_content = concat_content[1:-1].strip()

        # Replace '+' operators with commas for the Databricks CONCAT function
        cleaned_args = re.sub(r"\s*\+\s*", ", ", concat_content)
        
        # Convert T-SQL varchar casts to Databricks STRING data type
        cleaned_args = re.sub(r"\bvarchar\s*\(\d+\)", "STRING", cleaned_args, flags=re.IGNORECASE)
        
        return f"CONCAT({cleaned_args}) AS {alias}"

    # Target fields structured like: Name = (Expr1 + Expr2) or Name = Expr1 + Expr2
    sql = re.sub(
        r"\b([\w_]+)\s*=\s*([^\n,]+(?:\+)[^\n,]+)", 
        fix_legacy_concat_assignment, 
        sql, 
        flags=re.IGNORECASE
    )

    # 3. Fix standard subquery assignments (e.g., Alias = (SELECT ...))
    def fix_subquery_alias(match):
        return f"{match.group(2).strip()} AS {match.group(1)}"
    sql = re.sub(r"\b(\w+)\s*=\s*(\(\s*SELECT[\s\S]*?\))", fix_subquery_alias, sql, flags=re.IGNORECASE)

    return sql

def fix_select_block(match):
    block = match.group(0)
    
    def fix_alias(m):
        alias, expr = m.group(1).strip(), m.group(2).strip()
        if "=" in expr or "COALESCE" in expr.upper() or "CONCAT" in expr.upper():
            return m.group(0)
            
        # CRITICAL FIX: Convert spaces and forward slashes (Y/N) into clean underscores
        clean_alias = re.sub(r'[\s/]+', '_', alias)
        return f"{expr} AS {clean_alias}"
        
    # Regex extended to capture spaces and slashes inside the alias name group
    return re.sub(r"\b([\w\s/]+)\s*=\s*([^,\n]+)", fix_alias, block)


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
    
    # FIX: Wipe out broken legacy SQL2 where blocks if they exist
    sql = re.sub(r"where\s+SQL2\.\w+\s+1=1\s+and\s+SQL2\.\w+\s+1=1", "WHERE 1=1", sql, flags=re.I)
    return sql


def build_m_query(sql: str, list_patterns: List, date_patterns: List, date_clause: str) -> str:
    where_defs, injections = [], []
    for col, prompt in list_patterns:
        pname = re.sub(r'\s+', '', prompt).lower()
        col_name = col.split(".")[-1]

        if "source" in col_name.lower() or col_name == "ID":
            col_name = "src_sys_id"
        elif "event" in col_name.lower() or "code" in col_name.lower():
            col_name = "Event_Code"

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

    escaped_sql = sql.strip().replace('"', '""')

    # Extract just the hostname from DATABRICKS_HOST (strip https://)
    host = re.sub(r'^https?://', '', DATABRICKS_HOST).rstrip('/')
    # Warehouse ID is the last segment of the HTTP path
    warehouse_id = DATABRICKS_WAREHOUSE.split("/")[-1]

    return f"""let
{''.join(where_defs)}
{date_clause_block}

    query = "{escaped_sql}"{injection_str},

    Source = Databricks.Catalogs(
        "{host}",
        "/sql/1.0/warehouses/{warehouse_id}",
        [EnableAutomaticProxyDiscovery = false]
    ),

    finalsource = Value.NativeQuery(
        Source,
        query,
        null,
        [EnableFolding = false]
    )

in
    finalsource"""


def convert_sql_to_mquery(
    sql_raw: bytes,
    filename: str,
    table_mapping: List,
    column_mapping: Dict,
    date_clause: str
) -> Tuple[str, Dict]:
    from app.services.cognos_cleanup import read_text, strip_cognos_wrappers
    sql = read_text(sql_raw)
    sql = strip_cognos_wrappers(sql)
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
