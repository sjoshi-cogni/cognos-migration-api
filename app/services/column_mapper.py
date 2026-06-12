import re
import numpy as np
import pandas as pd
from typing import List, Dict
from thefuzz import fuzz
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from scipy.optimize import linear_sum_assignment
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

WEIGHTS = {"fuzzy_ratio": 0.15, "token_sort_ratio": 0.25, "token_set_ratio": 0.25, "tfidf_cosine": 0.35}

ABBREVIATIONS = {
    "id": "identifier", "num": "number", "no": "number", "nbr": "number",
    "amt": "amount", "qty": "quantity", "dt": "date", "dte": "date",
    "ts": "timestamp", "desc": "description", "nm": "name", "nme": "name",
    "addr": "address", "cd": "code", "cde": "code", "typ": "type",
    "flg": "flag", "ind": "indicator", "val": "value", "pct": "percent",
    "yr": "year", "mo": "month", "mth": "month", "dy": "day",
    "cust": "customer", "emp": "employee", "dept": "department",
    "acct": "account", "trx": "transaction", "txn": "transaction",
    "cat": "category", "grp": "group", "lvl": "level", "stat": "status",
    "src": "source", "tgt": "target", "cnt": "count", "tot": "total",
    "avg": "average", "ref": "reference", "rev": "revenue",
    "prc": "price", "rte": "rate", "bal": "balance", "curr": "currency",
}

def normalize_column_name(name: str) -> str:
    if not name or not isinstance(name, str):
        return ""
    s = name.strip().lower()
    s = re.sub(r'([a-z])([A-Z])', r'\1 \2', s)
    s = re.sub(r'[_\-\.]+', ' ', s)
    s = re.sub(r'[^a-z0-9\s]', '', s)
    return re.sub(r'\s+', ' ', s).strip()

def expand_abbreviations(text: str) -> str:
    return " ".join(ABBREVIATIONS.get(t, t) for t in text.split())

def compute_score_matrix(db1_columns: List[str], db2_columns: List[str]) -> np.ndarray:
    n_src, n_tgt = len(db1_columns), len(db2_columns)
    src_norms = [normalize_column_name(c) for c in db1_columns]
    src_exps = [expand_abbreviations(s) for s in src_norms]
    tgt_norms = [normalize_column_name(c) for c in db2_columns]
    tgt_exps = [expand_abbreviations(t) for t in tgt_norms]

    try:
        vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), lowercase=True)
        tfidf_matrix = vectorizer.fit_transform(src_exps + tgt_exps)
        tfidf_scores = cosine_similarity(tfidf_matrix[:n_src], tfidf_matrix[n_src:])
    except ValueError:
        tfidf_scores = np.zeros((n_src, n_tgt))

    scores = np.zeros((n_src, n_tgt))
    for i in range(n_src):
        for j in range(n_tgt):
            if src_norms[i] == tgt_norms[j] or src_exps[i] == tgt_exps[j]:
                scores[i, j] = 100.0
            else:
                scores[i, j] = (
                    WEIGHTS["fuzzy_ratio"] * fuzz.ratio(src_exps[i], tgt_exps[j])
                    + WEIGHTS["token_sort_ratio"] * fuzz.token_sort_ratio(src_exps[i], tgt_exps[j])
                    + WEIGHTS["token_set_ratio"] * fuzz.token_set_ratio(src_exps[i], tgt_exps[j])
                    + WEIGHTS["tfidf_cosine"] * (tfidf_scores[i, j] * 100)
                )
    return scores

def _get_db2_columns(catalog: str, schema: str, table: str) -> List[str]:
    from databricks.sdk import WorkspaceClient
    client = WorkspaceClient(host=settings.DATABRICKS_HOST, token=settings.DATABRICKS_TOKEN)
    query = f"""
        SELECT column_name FROM `{catalog}`.information_schema.columns
        WHERE LOWER(table_schema) = LOWER('{schema}') AND LOWER(table_name) = LOWER('{table}')
        ORDER BY ordinal_position
    """
    try:
        warehouses = list(client.warehouses.list())
        wh_id = next((w.id for w in warehouses if str(w.state).upper() == "RUNNING"), None)
        if not wh_id and warehouses:
            wh_id = warehouses[0].id
        result = client.statement_execution.execute_statement(
            warehouse_id=wh_id, statement=query, wait_timeout="5m"
        )
        if result.result and result.result.data_array:
            return [row[0] for row in result.result.data_array]
    except Exception as e:
        logger.error(f"Failed to get columns for {catalog}.{schema}.{table}: {e}")
    return []

def _resolve_mapping(row: pd.Series, df_mapping: pd.DataFrame) -> pd.Series:
    db, schema, table = row["DB_Name"], row["Schema_Name"], row["Table_Name"]
    for mask in [
        (df_mapping["DB1_DB_Name"].str.lower() == db.lower()) &
        (df_mapping["DB1_Schema_Name"].str.lower() == schema.lower()) &
        (df_mapping["DB1_Table_Name"].str.lower() == table.lower()),
        (df_mapping["DB1_Schema_Name"].str.lower() == schema.lower()) &
        (df_mapping["DB1_Table_Name"].str.lower() == table.lower()),
        df_mapping["DB1_Table_Name"].str.lower() == table.lower(),
    ]:
        matches = df_mapping[mask]
        if not matches.empty:
            return matches.iloc[0]
    return pd.Series({"DB2_DB_Name": None, "DB2_Schema_Name": None, "DB2_Table_Name": None})

def run_column_mapping(df_cognos: pd.DataFrame, df_mapping: pd.DataFrame) -> List[Dict]:
    resolved_rows = []
    for _, row in df_cognos.iterrows():
        m = _resolve_mapping(row, df_mapping)
        resolved_rows.append({
            "DB_Name": row["DB_Name"], "Schema_Name": row["Schema_Name"],
            "Table_Name": row["Table_Name"], "Column_Name": row["Column_Name"],
            "DB2_DB_Name": m.get("DB2_DB_Name"), "DB2_Schema_Name": m.get("DB2_Schema_Name"),
            "DB2_Table_Name": m.get("DB2_Table_Name"),
        })

    df_resolved = pd.DataFrame(resolved_rows)
    results = []
    unmapped_mask = (
        df_resolved["DB2_DB_Name"].isna() | df_resolved["DB2_Table_Name"].isna() |
        (df_resolved["DB2_DB_Name"] == "") | (df_resolved["DB2_Table_Name"] == "")
    )
    for _, row in df_resolved[unmapped_mask].iterrows():
        results.append({**row.to_dict(), "DB2_Column_Name": None, "Confidence_Score": 0.0, "Match_Status": "UNMAPPED_TABLE"})

    for (db2_cat, db2_sch, db2_tbl), group in df_resolved[~unmapped_mask].groupby(
        ["DB2_DB_Name", "DB2_Schema_Name", "DB2_Table_Name"], sort=False
    ):
        db2_columns = _get_db2_columns(db2_cat, db2_sch, db2_tbl)
        db1_cols = group["Column_Name"].tolist()
        group_rows = group.reset_index(drop=True)

        if not db2_columns:
            for _, row in group_rows.iterrows():
                results.append({**row.to_dict(), "DB2_Column_Name": None, "Confidence_Score": 0.0, "Match_Status": "NO_DB2_COLUMNS"})
            continue

        score_matrix = compute_score_matrix(db1_cols, db2_columns)
        row_ind, col_ind = linear_sum_assignment(score_matrix, maximize=True)
        assignment = {r: (c, round(score_matrix[r, c], 2)) for r, c in zip(row_ind, col_ind)}

        for i, (_, row) in enumerate(group_rows.iterrows()):
            if i in assignment:
                db2_col_idx, confidence = assignment[i]
                status = "MATCHED" if confidence >= settings.CONFIDENCE_THRESHOLD else "LOW_CONFIDENCE"
                results.append({**row.to_dict(), "DB2_Column_Name": db2_columns[db2_col_idx], "Confidence_Score": confidence, "Match_Status": status})
            else:
                results.append({**row.to_dict(), "DB2_Column_Name": None, "Confidence_Score": 0.0, "Match_Status": "NO_UNIQUE_MATCH"})

    return results
