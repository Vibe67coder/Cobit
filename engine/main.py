"""CobitX Desktop Engine Sidecar: FastAPI + SQLite + DuckDB + MCP Server."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from typing import Any

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from db.storage import CobitXStorage
from mcp_server import (
    build_mcp_server,
    execute_mcp_tool,
    get_mcp_manifest,
    probe_external_mcp,
)
from services.ai_takeoff import (
    ai_auto_area_segmentation,
    ai_auto_scale_and_rename,
    ai_count_symbols,
    ai_scan_text_labels,
)
from services.cbx_compat import export_cbx_archive, import_costx_estimate, import_legacy_archive, import_pricelist_spreadsheet
from services.export_engine import export_job_csv, export_job_excel, export_job_pdf
from services.ifc_processor import generate_sample_office_ifc, process_ifc_bytes
from services.plan_processor import auto_select_room_polygon, preview_pdf_pages, process_pdf_pages, process_uploaded_plan

storage = CobitXStorage()
app = FastAPI(title="CobitX Estimating Engine", version="15.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PropagateRequest(BaseModel):
    sourcePriceListId: str
    codes: list[str] | None = None


class McpCallRequest(BaseModel):
    tool: str
    arguments: dict[str, Any] | None = None


class McpProbeRequest(BaseModel):
    transport: str
    endpointOrCommand: str


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "cobitx-engine",
        "version": "15.1.0",
        "sqlitePath": str(storage.sqlite_path),
        "duckdbPath": str(storage.duckdb_path),
        "mcpReady": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/state")
def get_state() -> dict[str, Any]:
    state = storage.load_state()
    return {"initialized": state is not None, "state": state}


@app.put("/api/state")
def put_state(payload: dict[str, Any]) -> dict[str, Any]:
    return storage.save_state(payload)


@app.get("/api/openings-library")
def get_openings_library() -> dict[str, Any]:
    return {"openings": storage.list_openings_library()}


@app.get("/api/jobs/{job_id}/boq-analytics")
def get_boq_analytics(job_id: str) -> dict[str, Any]:
    return storage.compute_boq_analytics(job_id)


@app.post("/api/jobs/{job_id}/propagate-pricelist")
def post_propagate_pricelist(job_id: str, body: PropagateRequest) -> dict[str, Any]:
    try:
        return storage.propagate_price_list(job_id, body.sourcePriceListId, body.codes)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/backup")
def post_backup() -> dict[str, Any]:
    state = storage.load_state()
    if state is None:
        raise HTTPException(status_code=404, detail="No persisted workspace state yet.")
    return {
        "format": "cobitx-backup-v1",
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "state": state,
    }


@app.post("/api/restore")
def post_restore(payload: dict[str, Any]) -> dict[str, Any]:
    state = payload.get("state", payload)
    if not isinstance(state, dict) or "jobs" not in state:
        raise HTTPException(status_code=400, detail="Invalid CobitX backup file structure.")
    res = storage.save_state(state)
    return {**res, "state": state}


@app.get("/api/mcp/manifest")
def mcp_manifest() -> dict[str, Any]:
    return get_mcp_manifest()


@app.post("/api/mcp/call")
def mcp_call(body: McpCallRequest) -> dict[str, Any]:
    try:
        return execute_mcp_tool(storage, body.tool, body.arguments)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/mcp/test")
async def mcp_test(body: McpProbeRequest) -> dict[str, Any]:
    return await probe_external_mcp(body.transport, body.endpointOrCommand)


@app.post("/mcp")
def mcp_jsonrpc(payload: dict[str, Any]) -> dict[str, Any]:
    rpc_id = payload.get("id")
    method = str(payload.get("method") or "")
    params = payload.get("params") or {}
    manifest = get_mcp_manifest()

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": {
                "protocolVersion": manifest["protocolVersion"],
                "capabilities": {"tools": {"listChanged": False}, "resources": {"listChanged": False}},
                "serverInfo": {"name": manifest["serverName"], "version": "15.1.0"},
            },
        }
    if method == "notifications/initialized":
        return {"jsonrpc": "2.0", "id": rpc_id, "result": {}}
    if method == "tools/list":
        tools = [
            {
                "name": t["name"],
                "description": t["description"],
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        k: {"type": "string", "description": str(v)}
                        for k, v in (t.get("argsSchema") or {}).items()
                    },
                },
            }
            for t in manifest["tools"]
        ]
        return {"jsonrpc": "2.0", "id": rpc_id, "result": {"tools": tools}}
    if method == "tools/call":
        tool_name = str(params.get("name") or "")
        arguments = params.get("arguments") or {}
        try:
            out = execute_mcp_tool(storage, tool_name, arguments)
            return {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(out["result"])}],
                    "structuredContent": out["result"],
                    "isError": False,
                },
            }
        except ValueError as exc:
            return {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": -32602, "message": str(exc)}}
    if method == "resources/list":
        return {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": {
                "resources": [
                    {"uri": "cobitx://jobs", "name": "CobitX Jobs & Price Lists", "mimeType": "application/json"},
                    {"uri": "cobitx://openings", "name": "CobitX Openings Library", "mimeType": "application/json"},
                ]
            },
        }
    if method == "resources/read":
        uri = str(params.get("uri") or "")
        if uri == "cobitx://jobs":
            data = execute_mcp_tool(storage, "cobitx_list_jobs", {})["result"]
        elif uri == "cobitx://openings":
            data = storage.list_openings_library()
        else:
            return {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": -32602, "message": f"Unknown resource URI: {uri}"}}
        return {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": {
                "contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(data)}],
            },
        }
    return {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}


class AutoSelectRequest(BaseModel):
    imageDataUrl: str | None = None
    seedX: float
    seedY: float


@app.post("/api/plans/upload")
async def upload_plan(
    file: UploadFile = File(...),
    page_number: int = Form(1),
) -> dict[str, Any]:
    raw = await file.read()
    try:
        return process_uploaded_plan(file.filename or "plan.pdf", raw, page_number=page_number)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse plan: {exc}") from exc


@app.post("/api/plans/pdf-preview")
async def get_pdf_preview(file: UploadFile = File(...)) -> dict[str, Any]:
    try:
        return {"pages": preview_pdf_pages(await file.read())}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to open PDF: {exc}") from exc


@app.post("/api/plans/upload-pages")
async def upload_pdf_pages(
    file: UploadFile = File(...),
    page_numbers: list[int] = Form(...),
) -> dict[str, Any]:
    try:
        return {"plans": process_pdf_pages(file.filename or "plan.pdf", await file.read(), page_numbers)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to import PDF pages: {exc}") from exc


@app.post("/api/plans/auto-select")
def auto_select_polygon(body: AutoSelectRequest) -> dict[str, Any]:
    pts = auto_select_room_polygon(body.imageDataUrl, body.seedX, body.seedY)
    return {"points": pts, "count": len(pts)}


@app.post("/api/plans/import-ifc")
async def import_ifc_plan(file: UploadFile = File(...)) -> dict[str, Any]:
    raw = await file.read()
    try:
        return process_ifc_bytes(file.filename or "model.ifc", raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse IFC BIM model: {exc}") from exc


@app.post("/api/plans/sample-ifc")
def parse_sample_ifc() -> dict[str, Any]:
    raw = generate_sample_office_ifc()
    return process_ifc_bytes("CobitX_Office_BIM.ifc", raw)


class ExportRequest(BaseModel):
    job: dict[str, Any]
    reportKind: str = "BOQ"


@app.post("/api/export/excel")
def post_export_excel(body: ExportRequest) -> Response:
    xlsx_bytes = export_job_excel(body.job)
    safe_name = (body.job.get("name") or "CobitX_Estimate").replace(" ", "_")
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}_BOQ.xlsx"'},
    )


@app.post("/api/export/pdf")
def post_export_pdf(body: ExportRequest) -> Response:
    pdf_bytes = export_job_pdf(body.job, report_kind=body.reportKind)
    safe_name = (body.job.get("name") or "CobitX_Estimate").replace(" ", "_")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}_{body.reportKind}.pdf"'},
    )


@app.post("/api/export/csv")
def post_export_csv(body: ExportRequest) -> Response:
    csv_text = export_job_csv(body.job, format_kind=body.reportKind)
    safe_name = (body.job.get("name") or "CobitX_Estimate").replace(" ", "_")
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}_{body.reportKind}.csv"'},
    )


class AiAutoAreaReq(BaseModel):
    imageDataUrl: str | None = None


class AiSymbolReq(BaseModel):
    symbolKind: str = "LED Downlight"
    imageDataUrl: str | None = None
    seedBox: dict[str, float] | None = None
    confidenceThreshold: float = 0.72


class AiScanTextReq(BaseModel):
    query: str = ""
    planName: str = ""
    imageDataUrl: str | None = None


class AiAutoScaleReq(BaseModel):
    currentName: str
    originalFileName: str = ""
    imageDataUrl: str | None = None


@app.post("/api/ai/auto-area")
def post_ai_auto_area(body: AiAutoAreaReq) -> dict[str, Any]:
    zones = ai_auto_area_segmentation(body.imageDataUrl)
    return {"zones": zones, "count": len(zones)}


@app.post("/api/ai/count-symbols")
def post_ai_count_symbols(body: AiSymbolReq) -> dict[str, Any]:
    markers = ai_count_symbols(
        body.symbolKind,
        body.imageDataUrl,
        body.seedBox,
        confidence_threshold=body.confidenceThreshold,
    )
    return {"markers": markers, "count": len(markers)}


@app.post("/api/ai/scan-text")
def post_ai_scan_text(body: AiScanTextReq) -> dict[str, Any]:
    matches = ai_scan_text_labels(body.query, body.planName, body.imageDataUrl)
    return {"matches": matches, "count": len(matches)}


@app.post("/api/ai/auto-scale")
def post_ai_auto_scale(body: AiAutoScaleReq) -> dict[str, Any]:
    return ai_auto_scale_and_rename(body.currentName, body.originalFileName, body.imageDataUrl)


@app.post("/api/import/cbx")
async def post_import_cbx(
    file: UploadFile = File(...),
    kind_hint: str | None = Form(None),
) -> dict[str, Any]:
    raw = await file.read()
    try:
        job = import_legacy_archive(file.filename or "import.cbx", raw, kind_hint=kind_hint)
        return {"ok": True, "job": job}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to import archive: {exc}") from exc


@app.post("/api/import/pricelist-excel")
async def post_import_pricelist_excel(file: UploadFile = File(...)) -> dict[str, Any]:
    raw = await file.read()
    try:
        job = import_pricelist_spreadsheet(file.filename or "pricelist.xlsx", raw)
        return {"ok": True, "job": job}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to import price list spreadsheet: {exc}") from exc


@app.post("/api/import/costx-estimate")
async def post_import_costx_estimate(file: UploadFile = File(...)) -> dict[str, Any]:
    try:
        job = import_costx_estimate(file.filename or "estimate.xlsx", await file.read())
        return {"ok": True, "job": job}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to import CostX export: {exc}") from exc


@app.post("/api/export/cbx")
def post_export_cbx(body: ExportRequest) -> Response:
    archive_bytes = export_cbx_archive(body.job)
    ext = "plx" if body.job.get("kind") == "PriceList" else "cbx"
    safe_name = (body.job.get("name") or "CobitX_Job").replace(" ", "_")
    return Response(
        content=archive_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.{ext}"'},
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="CobitX Estimating Desktop Engine")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=47820)
    parser.add_argument(
        "--stdio-mcp",
        action="store_true",
        help="Run CobitX as a standalone stdio MCP server for external AI clients",
    )
    args = parser.parse_args()

    if args.stdio_mcp:
        mcp = build_mcp_server(storage)
        mcp.run(transport="stdio")
    else:
        uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
