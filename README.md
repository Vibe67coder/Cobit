# CobitX Estimating & Construction Takeoff Suite (v15.1.0)

**CobitX** is a standalone Windows desktop application (`.exe` installer & portable bundle built with Electron + React/TypeScript + Three.js + bundled Python FastAPI/SQLite/DuckDB/OpenCV/PyMuPDF/ezdxf/MCP sidecar) engineered for full UI and functional parity with Buildsoft Cubit Estimating (v7–v15.1) alongside CostX-style live datasheets, 2D/3D IFC BIM takeoff, AI plan automation, and Model Context Protocol (MCP) integrations.

## Core Capabilities Implemented
- **Job Manager & Multi-Job Tab Shell**: Hierarchical Projects / Folders / Jobs / Price Lists, Column Chooser, multi-flag Freeze States, Copy/Paste/Merge/Group Job, Client Manager (`Company` & `Contacts`), and Cubit Light / Dark / Designer Black themes.
- **Estimate, Calculation & CostX Rate Sheets**: Full Trade → Heading → Subheading → Item hierarchy, interactive `=SUM(@Start, @End, Col)`, `TSUM(...)`, and `@RefCode.Col` formulas, composite Rate Sheets with `%` and `+` batch divisors, Wastage/Factor/Conversion multipliers, Options Packages, Variations, External Live Referencing (`Sync Refs`), Grouping Codes, Price List insertion & propagation, Flags, and Job Markup/GST/GFA `$/m²`.
- **Plan Ingestion, Calibration & 2D/3D Takeoff**: Vector/Raster PDF (`PyMuPDF`), `.DXF` (`ezdxf`), and image ingestion, 2-point scale calibration, 90° rotation, layer visibility, viewport snapshots, snap nodes, `Auto Select` flood-fill room polygon extraction, `Length by Centres`, Door/Window opening deductions (`Vertical Area Less Openings`), Plan Revisions & 2-Point Alignment overlays.
- **3D Visual Estimating & IFC BIM Takeoff**: Interactive Three.js WebGL 3D scene (`OrbitControls`, raycasting click-to-select, X-Ray BIM mode) + ISO-10303-21 `.ifc` STEP parser and customizable IFC Class → Result Type mapping rules.
- **AI Estimating Suite**: OpenCV connected-components Auto Area room segmentation, template/Hough Count Symbols detector, text callout scanner, AI Auto Scale & Plan Rename, and MCP Copilot.
- **CostX/Cubit Exports & Legacy Compatibility**: Multi-sheet `.xlsx` workbook (`Executive Summary`, `BOQ Cost vs Sell`, `CostX Datasheets`), `.pdf` BOQ/Trade/Shapes reports, `.csv` (`LiveCosts` / `Xero`), plus `.cbx` / `.plx` / `.e0x` archive import & export.
- **MCP Server & Client**: Built-in MCP server (`cobitx_list_jobs`, `cobitx_get_job_summary`, `cobitx_search_cost_libraries`, `cobitx_run_boq_sql`, `cobitx_list_plans_and_bim`) over HTTP or `--stdio-mcp`, plus configurable external MCP client probes.

## Development & Verification
```bash
# Frontend TypeScript check & Vite build
npm run build

# Electron main/preload + renderer build
npm run build:electron

# Lint & TypeScript formula/calculation unit tests
npm run lint
npm test

# Python sidecar tests (FastAPI, SQLite/DuckDB, MCP, DXF/PDF/IFC, Exports, AI, .cbx/.e0x)
engine/.venv/bin/pytest -v
```

## Building Windows `.exe` Installer & Portable Bundle
Automated builds run via GitHub Actions ([`.github/workflows/build-windows-exe.yml`](.github/workflows/build-windows-exe.yml)) on `windows-latest`, or locally on Windows:
```powershell
pip install -r engine/requirements.txt pyinstaller
pyinstaller --onefile --name cobitx-engine --distpath engine/dist engine/main.py
npm ci
npm run package:win
```
Outputs are written to `release/CobitX-Setup-15.1.0-x64.exe` and the portable `.exe`.
