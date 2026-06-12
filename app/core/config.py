from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "Cognos Migration API"
    VERSION: str = "1.0.0"
    DATABRICKS_HOST: str = "https://adb-80371074517305.5.azuredatabricks.net"
    DATABRICKS_TOKEN: str = ""
    DATABRICKS_HTTP_PATH: str = "/sql/1.0/warehouses/0c867214ce8eb461"
    DATABRICKS_SERVER_HOSTNAME: str = "adb-80371074517305.5.azuredatabricks.net"
    UPLOAD_DIR: str = "uploads"
    OUTPUT_DIR: str = "outputs"
    CONFIDENCE_THRESHOLD: int = 40

    class Config:
        env_file = ".env"

settings = Settings()
