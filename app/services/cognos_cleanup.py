import re
from app.core.logging import get_logger

logger = get_logger(__name__)

def read_text(raw: bytes) -> str:
    for encoding in ("utf-16-le", "utf-16-be", "utf-8", "latin-1"):
        try:
            return raw.decode(encoding)
        except Exception:
            continue
    return raw.decode("latin-1")

def strip_cognos_wrappers(sql: str) -> str:
    s = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    s = re.sub(r"(?m)^\s*--.*?$", " ", s)
    s = s.replace("[", "").replace("]", "").replace('"', "")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\s*\n\s*", "\n", s)
    s = s.replace("\r\n", "\n").strip()
    s = re.sub(r";+\s*$", "", s)
    return s.strip() + "\n"

def clean_sql_for_parsing(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    sql = re.sub(r"--.*$", "", sql, flags=re.M)
    sql = re.sub(r"[A-Za-z_]+\.{2,}\{", " ", sql)
    sql = sql.replace("}", " ")
    sql = re.sub(r"\s+", " ", sql)
    return sql
