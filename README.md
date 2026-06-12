# Cognos Migration API

FastAPI-based REST API for automating Cognos → Databricks/Power BI report migration.

## Architecture
cognos_migration_api/
├── app/
│ ├── main.py # FastAPI app entry point
│ ├── api/v1/
│ │ ├── stage1.py # Table & lineage extraction endpoints
│ │ ├── stage2.py # Table & column mapping endpoints
│ │ └── stage3.py # SQL → M-Query conversion endpoints
│ ├── services/
│ │ ├── cognos_cleanup.py # SQL cleaning & encoding handling
│ │ ├── table_extractor.py # Regex-based table extraction
│ │ ├── lineage_extractor.py # Table + column lineage extraction
│ │ ├── table_mapper.py # Databricks table mapping via SQL
│ │ ├── column_mapper.py # AI-based column mapping (TF-IDF + Hungarian)
│ │ └── sql_converter.py # SQL → Power BI M-Query converter
│ ├── schemas/
│ │ ├── stage1.py # Pydantic response models for stage 1
│ │ ├── stage2.py # Pydantic response models for stage 2
│ │ └── stage3.py # Pydantic response models for stage 3
│ └── core/
│ ├── config.py # App settings from .env
│ ├── logging.py # Centralized logger
│ └── dependencies.py # Shared FastAPI dependencies
├── .env # Secrets — never commit
├── .env.example # Template for required env vars
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── README.md


## Prerequisites

- Python 3.9+
- Databricks workspace + personal access token

## Setup

```bash
git clone <your-repo-url>
cd cognos_migration_api
python -m venv .venv
.venv\Scripts\activate              # Windows
pip install -r requirements.txt
copy .env.example .env              # Windows — then fill in DATABRICKS_TOKEN


Required .env variables
DATABRICKS_HOST=https://<workspace>.azuredatabricks.net
DATABRICKS_TOKEN=<your-token>
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/<warehouse-id>


Run
uvicorn app.main:app --reload


bash
Swagger UI: http://localhost:8000/docs

API Endpoints
Stage	Method	Endpoint	Description
1	POST	/api/v1/stage1/extract-tables	Extract tables from SQL files
1	POST	/api/v1/stage1/extract-tables/download	Download as Excel
1	POST	/api/v1/stage1/extract-lineage	Extract table + column lineage
1	POST	/api/v1/stage1/extract-lineage/download	Download as Excel
2	POST	/api/v1/stage2/map-tables	Map Cognos tables → Databricks tables
2	POST	/api/v1/stage2/map-tables/download	Download as Excel
2	POST	/api/v1/stage2/map-columns	AI column mapping with confidence scores
2	POST	/api/v1/stage2/map-columns/download	Download as Excel
3	POST	/api/v1/stage3/convert	Convert SQL → M-Query (JSON)
3	POST	/api/v1/stage3/convert/download	Download all M-Queries as ZIP

Docker
docker-compose up --build


bash
Git Setup (first time)
git init
git add .
git commit -m "Initial commit - Cognos Migration FastAPI"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main


bash
Contributing
git checkout -b feature/<your-feature>
# make changes
git add .
git commit -m "feat: <description>"
git push origin feature/<your-feature>
# open a Pull Request


Key additions over the existing README:
- `.env.example` referenced in the tree and setup steps
- Explicit required `.env` variables listed
- `git branch -M main` added to setup (ensures correct branch name)
- Contributing workflow section for team use
- Windows-specific `copy` command instead of `cp`