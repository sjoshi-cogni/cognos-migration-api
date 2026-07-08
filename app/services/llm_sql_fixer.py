import re
import time
import httpx
from typing import Tuple
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

MAX_ATTEMPTS = 5

SYSTEM_PROMPT = """You are a SQL migration expert specialising in converting T-SQL/Cognos SQL to Databricks SQL (Spark SQL).
Rules:
- Return ONLY the corrected SQL. No explanation, no markdown, no code fences.
- Fix all syntax incompatibilities: bracket identifiers, NOLOCK hints, TOP N, ISNULL→COALESCE, GETDATE()→CURRENT_TIMESTAMP, varchar→STRING, + concatenation→CONCAT(), T-SQL aliases (alias=expr → expr AS alias).
- Preserve all original table names, column names, joins, filters and logic exactly."""


def _call_llm(messages: list) -> str:
    url = f"{settings.DATABRICKS_HOST}/serving-endpoints/{settings.DATABRICKS_LLM_ENDPOINT}/invocations"
    logger.info(f"[LLM] Calling endpoint: {url}")
    t0 = time.time()
    resp = httpx.post(
        url,
        headers={"Authorization": f"Bearer {settings.DATABRICKS_TOKEN}"},
        json={"messages": messages, "max_tokens": 4096, "temperature": 0},
        timeout=60,
    )
    logger.info(f"[LLM] Response received in {time.time() - t0:.1f}s — HTTP {resp.status_code}")
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def _execute_explain(sql: str) -> str | None:
    """Run EXPLAIN via SDK StatementExecution. Returns error string if invalid, None if clean."""
    warehouse_id = settings.DATABRICKS_HTTP_PATH.split("/")[-1]
    logger.info(f"[EXPLAIN] Running against warehouse: {warehouse_id}")
    t0 = time.time()
    try:
        client = WorkspaceClient(
            host=settings.DATABRICKS_HOST,
            token=settings.DATABRICKS_TOKEN,
        )
        result = client.statement_execution.execute_statement(
            warehouse_id=warehouse_id,
            statement=f"EXPLAIN {sql}",
            wait_timeout="30s",
        )
        elapsed = time.time() - t0
        state = result.status.state
        logger.info(f"[EXPLAIN] Completed in {elapsed:.1f}s — state: {state}")
        if state in (StatementState.FAILED, StatementState.CANCELED):
            return result.status.error.message
        return None
    except Exception as e:
        logger.error(f"[EXPLAIN] Exception after {time.time() - t0:.1f}s: {e}")
        return str(e)


def _clean_llm_sql(raw: str) -> str:
    """Strip any accidental markdown fences the LLM adds."""
    raw = re.sub(r"^```(?:sql)?\s*", "", raw.strip(), flags=re.I)
    raw = re.sub(r"\s*```$", "", raw.strip())
    return raw.strip()


def fix_sql_with_llm(sql: str) -> Tuple[str, str, bool]:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Fix this SQL for Databricks:\n{sql}"},
    ]

    current_sql = sql
    last_error = ""

    for attempt in range(1, MAX_ATTEMPTS + 1):
        logger.info(f"LLM fix attempt {attempt}/{MAX_ATTEMPTS}")

        try:
            raw = _call_llm(messages)
            current_sql = _clean_llm_sql(raw)
            logger.info(f"[LLM] SQL extracted, length: {len(current_sql)} chars")
        except Exception as e:
            logger.error(f"[LLM] Call failed on attempt {attempt}: {e}")
            return current_sql, f"LLM call failed on attempt {attempt}: {e}", False

        error = _execute_explain(current_sql)

        if error is None:
            summary = f"SQL validated successfully on attempt {attempt}."
            logger.info(summary)
            return current_sql, summary, True

        last_error = error
        logger.info(f"Attempt {attempt} EXPLAIN error: {error[:200]}")

        if attempt < MAX_ATTEMPTS:
            messages += [
                {"role": "assistant", "content": current_sql},
                {"role": "user", "content": f"Still invalid. Databricks error:\n{error}\n\nFix it and return only the corrected SQL."},
            ]

    summary = (
        f"Could not produce valid Databricks SQL after {MAX_ATTEMPTS} attempts. "
        f"Last error: {last_error}"
    )
    return current_sql, summary, False


def extract_sql_from_mquery(mquery: str) -> str | None:
    match = re.search(r'query\s*=\s*"([\s\S]+?)"(?:\s*\n\s*&|\s*,)', mquery)
    if match:
        return match.group(1).replace('""', '"')
    return None


def inject_fixed_sql_into_mquery(mquery: str, fixed_sql: str) -> str:
    escaped = fixed_sql.strip().replace('"', '""')
    return re.sub(
        r'(query\s*=\s*")([\s\S]+?)("(?:\s*\n\s*&|\s*,))',
        lambda m: f"{m.group(1)}{escaped}{m.group(3)}",
        mquery,
        flags=re.DOTALL,
    )
