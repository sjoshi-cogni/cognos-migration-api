import pandas as pd
from typing import List, Dict
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

MAPPING_QUERY = """
WITH corpfin_view_table_vw AS (
  SELECT lower(View_Source) AS view_db_name,
    lower(substring(View_Name, instr(View_Name, '.') + 1)) AS view_name_wo_schema,
    CASE
      WHEN lower(Db_Name)='accounting' THEN 'acct'
      WHEN lower(Db_Name)='playermanagement' THEN 'pm'
      WHEN lower(Db_Name)='tablemanager' THEN 'tblmgr'
      WHEN lower(Db_Name)='cta' THEN 'cta'
      WHEN lower(Db_Name)='ezpay' THEN 'ezpay'
      WHEN lower(Db_Name)='title31' THEN 't31'
      ELSE lower(Db_Name)
    END AS edh_brnz_schema_name,
    CASE
      WHEN lower(Db_Name)='accounting' THEN 'machine_acct'
      WHEN lower(Db_Name)='playermanagement' THEN 'patron'
      WHEN lower(Db_Name)='tablemanager' THEN 'table_manager'
      WHEN lower(Db_Name)='cta' THEN 'cta'
      WHEN lower(Db_Name)='ezpay' THEN 'ez_pay'
      WHEN lower(Db_Name)='genesis_bravo' THEN 'bravo_poker'
      WHEN lower(Db_Name)='glory' THEN 'gd_currency_counter'
      WHEN lower(Db_Name)='intrblok' THEN 'interblock'
      WHEN lower(Db_Name)='xchange' THEN 'global_cash_access_xchange'
      WHEN lower(Db_Name)='vertix' THEN 'axs_vertix'
      WHEN lower(Db_Name)='title31' THEN 'everi_compliance_aml'
      ELSE lower(Db_Name)
    END AS edh_slv_schema_name,
    lower(Db_Name) AS corpfinsql_db_name,
    lower(Table_Name) AS current_table_name,
    lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      Table_Name, 'DT_', 'DET_'), 'AR_', 'ARIA_'), 'BG_', 'BEL_'), 'GR_', 'GST_')) AS table_name
  FROM {corpfin_view_table}
)
SELECT DISTINCT
  b.view_db_name       AS DB1_DB_Name,
  b.edh_slv_schema_name AS DB1_Schema_Name,
  b.view_name_wo_schema AS DB1_Table_Name,
  a.catalog_nm         AS DB2_DB_Name,
  a.schema_nm          AS DB2_Schema_Name,
  a.obj_nm             AS DB2_Table_Name
FROM corpfin_view_table_vw AS b
LEFT JOIN {slv_src_obj_rel_table} AS a
    ON lower(a.src_obj_nm) = lower(b.table_name)
    AND lower(a.src_schema_nm) = lower(b.edh_brnz_schema_name)
WHERE ('{view_source_db_name}' = '' OR b.view_db_name = lower('{view_source_db_name}'))
    AND b.view_name_wo_schema = lower('{view_source_table_name}')
ORDER BY 1, 2, 3, 4, 5
"""

_client = None

def _get_client() -> WorkspaceClient:
    global _client
    if _client is None:
        _client = WorkspaceClient(
            host=settings.DATABRICKS_HOST,
            token=settings.DATABRICKS_TOKEN,
        )
    return _client

def _run_query(db_name: str, table_name: str) -> pd.DataFrame:
    sql = MAPPING_QUERY.format(
        corpfin_view_table=settings.CORPFIN_VIEW_TABLE,
        slv_src_obj_rel_table=settings.SLV_SRC_OBJ_REL_TABLE,
        view_source_db_name=db_name.replace("'", "''"),
        view_source_table_name=table_name.replace("'", "''"),
    )
    w = _get_client()
    response = w.statement_execution.execute_statement(
        warehouse_id=settings.DATABRICKS_HTTP_PATH.split("/")[-1],
        statement=sql,
        wait_timeout="30s",
    )
    if response.status.state != StatementState.SUCCEEDED:
        raise RuntimeError(f"Query failed: {response.status.error}")

    cols = [c.name for c in response.manifest.schema.columns]
    rows = response.result.data_array or []
    return pd.DataFrame(rows, columns=cols)


def run_table_mapping(df_input: pd.DataFrame) -> List[Dict]:
    df_unique = df_input.drop_duplicates(
        subset=["DB_Name", "Schema_Name", "Table_Name"]
    ).reset_index(drop=True)

    results = []
    for _, row in df_unique.iterrows():
        db_name = str(row.get("DB_Name", ""))
        table_name = str(row.get("Table_Name", ""))
        schema_name = str(row.get("Schema_Name", ""))

        try:
            result_df = _run_query(db_name, table_name)
            valid = result_df.dropna(subset=["DB2_DB_Name", "DB2_Schema_Name", "DB2_Table_Name"])
        except Exception as e:
            logger.error(f"Query failed for {table_name}: {e}",exc_info=True)
            valid = pd.DataFrame()

        if not valid.empty:
            for _, r in valid.iterrows():
                results.append({
                    "DB1_DB_Name": r["DB1_DB_Name"],
                    "DB1_Schema_Name": r["DB1_Schema_Name"],
                    "DB1_Table_Name": r["DB1_Table_Name"],
                    "DB2_DB_Name": r["DB2_DB_Name"],
                    "DB2_Schema_Name": r["DB2_Schema_Name"],
                    "DB2_Table_Name": r["DB2_Table_Name"],
                })
        else:
            results.append({
                "DB1_DB_Name": db_name or "Not Found",
                "DB1_Schema_Name": schema_name or "Not Found",
                "DB1_Table_Name": table_name or "Not Found",
                "DB2_DB_Name": "Not Found",
                "DB2_Schema_Name": "Not Found",
                "DB2_Table_Name": "Not Found",
            })

    return results
