# BI Step Pipeline UI

This static app provides a step-driven interface for:
- Extracting metadata from `.sql`
- Rationalizing report data into a `.pbix` placeholder
- Generating lineage output into `.xlsx`
- Mapping legacy tables/columns into `.xlsx` or `.csv`
- Creating a Power Query placeholder `.pbix`
- Comparing source and target files with downloadable validation output

## Usage
1. Open `index.html` in your browser, or run a local server in this folder:
   - `python -m http.server 8000`
2. Open `http://localhost:8000`

## Notes
- The `.pbix` files generated here are placeholder text exports with metadata and query text.
- `.xlsx` and `.csv` processing uses the browser's `xlsx` library.
