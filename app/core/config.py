from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "Cognos Migration API"
    VERSION: str = "1.0.0"
    DATABRICKS_HOST: str = ""
    DATABRICKS_TOKEN: str = ""
    DATABRICKS_HTTP_PATH: str = ""
    DATABRICKS_SERVER_HOSTNAME: str = ""
    UPLOAD_DIR: str = "uploads"
    OUTPUT_DIR: str = "outputs"
    CONFIDENCE_THRESHOLD: int = 40
    CORPFIN_VIEW_TABLE: str = ""
    SLV_SRC_OBJ_REL_TABLE: str = ""

    class Config:
        env_file = ".env"

settings = Settings()
