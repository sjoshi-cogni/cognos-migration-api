import re
from app.core.logging import get_logger

logger = get_logger(__name__)

def read_text(raw: bytes) -> str:
    if raw.startswith(b'\xff\xfe'):
        return raw[2:].decode("utf-16-le")
    if raw.startswith(b'\xfe\xff'):
        return raw[2:].decode("utf-16-be")
    if raw.startswith(b'\xef\xbb\xbf'):
        return raw[3:].decode("utf-8")    # ← this file hits here: strip BOM then decode UTF-8
    for encoding in ("utf-8", "latin-1"):
        try:
            return raw.decode(encoding)
        except Exception:
            continue
    return raw.decode("latin-1")


def strip_cognos_wrappers(sql: str) -> str:
    s = re.sub(r'(?im)^\s*USE\s+\w[\w.]*\s*;\s*$', '', sql)
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
    sql = re.sub(r"\.\s*\{", ".", sql)                        # schema.{Table} → schema.Table
    sql = re.sub(r"\{([A-Za-z0-9_#\$]+)\}", r"\1", sql)      # remaining {Name} → Name
    sql = sql.replace("{", " ").replace("}", " ")             # catch-all
    sql = re.sub(r"#[^#]+#", " ", sql)                        # strip Cognos #prompt# macros
    sql = re.sub(r"\s+", " ", sql)
    return sql