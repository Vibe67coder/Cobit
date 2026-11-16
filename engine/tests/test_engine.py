"""Unit and FastAPI integration tests for CobitX Python sidecar."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ENGINE_DIR = Path(__file__).resolve().parents[1]
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))


def test_storage_duckdb_and_mcp(tmp_path: Path) -> None:
    os.environ["COBITX_DATA_DIR"] = str(tmp_path)
    from db.storage import CobitXStorage
    from mcp_server import build_mcp_server, execute_mcp_tool, get_mcp_manifest

    store = CobitXStorage(tmp_path)
    sample_state = {
        "jobs": [
            {
                "id": "job-1",
                "name": "Test Medical Centre",
                "kind": "Job",
                "status": "Open",
                "markupPct": 10,
                "salesTaxPct": 10,
                "rows": [
                    {
                        "id": "r-1",
                        "parentId": None,
                        "rowType": "Item",
                        "code": "CONC-1",
                        "description": "Concrete Slab",
                        "resultType": "Area",
                        "quantity": 100,
                        "unit": "m2",
                        "conversion": 1,
                        "numberMultiplier": 1,
                        "factor": 1,
                        "wastagePct": 5,
                        "rate": 80,
                        "markupPct": 10,
                        "pricingMode": "INCL",
                        "groupingCode": "CONC-SLAB",
                    }
                ],
            },
            {
                "id": "pl-1",
                "name": "Master Price List",
                "kind": "PriceList",
                "status": "Open",
                "markupPct": 0,
                "salesTaxPct": 10,
                "rows": [
                    {
                        "id": "p-1",
                        "parentId": None,
                        "rowType": "Item",
                        "code": "CONC-1",
                        "description": "Concrete Slab",
                        "resultType": "Area",
                        "quantity": 0,
                        "unit": "m2",
                        "factor": 1,
                        "rate": 95,
                        "markupPct": 0,
                        "pricingMode": "INCL",
                        "rateRows": [],
                    }
                ],
            },
        ]
    }

    res = store.save_state(sample_state)
    assert res["ok"] is True
    assert res["jobCount"] == 2

    analytics = store.compute_boq_analytics("job-1")
    assert analytics["itemCount"] == 1
    assert analytics["totalCost"] == 8400.0
    assert analytics["totalSell"] == 9240.0
    assert analytics["byGroupingCode"][0]["code"] == "CONC-SLAB"

    # Price list propagation updates CONC-1 rate 80 -> 95
    prop = store.propagate_price_list("job-1", "pl-1")
    assert prop["updatedCount"] == 1
    analytics2 = store.compute_boq_analytics("job-1")
    assert analytics2["totalCost"] == 9975.0

    # MCP server & tool execution
    mcp_obj = build_mcp_server(store)
    assert mcp_obj.name == "CobitX Estimating MCP Server"
    manifest = get_mcp_manifest()
    assert len(manifest["tools"]) >= 5

    search_res = execute_mcp_tool(store, "cobitx_search_cost_libraries", {"query": "CONC"})
    assert len(search_res["result"]) == 1
    assert search_res["result"][0]["rate"] == 95


def test_fastapi_endpoints(tmp_path: Path) -> None:
    os.environ["COBITX_DATA_DIR"] = str(tmp_path)
    import main as engine_main

    engine_main.storage = engine_main.CobitXStorage(tmp_path)
    client = TestClient(engine_main.app)

    r_health = client.get("/health")
    assert r_health.status_code == 200
    assert r_health.json()["mcpReady"] is True

    r_op = client.get("/api/openings-library")
    assert r_op.status_code == 200
    assert len(r_op.json()["openings"]) >= 5

    r_manifest = client.get("/api/mcp/manifest")
    assert r_manifest.status_code == 200
    assert "cobitx_list_jobs" in [t["name"] for t in r_manifest.json()["tools"]]


def test_plan_processor_and_autoselect() -> None:
    import io
    import ezdxf
    from PIL import Image, ImageDraw
    from reportlab.pdfgen import canvas as rl_canvas
    from services.plan_processor import auto_select_room_polygon, process_uploaded_plan

    # 1. DXF CAD file with two layers and polyline
    dxf_doc = ezdxf.new("R2010")
    msp = dxf_doc.modelspace()
    msp.add_lwpolyline([(0, 0), (10, 0), (10, 6), (0, 6), (0, 0)], dxfattribs={"layer": "A-WALL"})
    msp.add_line((5, 0), (5, 6), dxfattribs={"layer": "A-PART"})
    sio = io.StringIO()
    dxf_doc.write(sio)
    dxf_res = process_uploaded_plan("floorplan.dxf", sio.getvalue().encode("utf-8"))
    assert dxf_res["kind"] == "DXF"
    assert len(dxf_res["vectorPaths"]) == 2
    assert len(dxf_res["snapNodes"]) >= 6
    assert {l["name"] for l in dxf_res["layers"]} == {"A-WALL", "A-PART"}

    # 2. Vector PDF generated via ReportLab with title block scale text
    pdf_buf = io.BytesIO()
    c = rl_canvas.Canvas(pdf_buf, pagesize=(842, 595))
    for x in range(15):
        c.line(50, 50 + x * 20, 450, 50 + x * 20)
    c.drawString(60, 550, "ARCHITECTURAL PLAN - SCALE 1:100 @ A3")
    c.showPage()
    c.save()
    pdf_res = process_uploaded_plan("arch_sheet.pdf", pdf_buf.getvalue(), page_number=1)
    assert pdf_res["kind"] == "Vector PDF"
    assert "1:100" in pdf_res["scaleLabel"]
    assert pdf_res["imageDataUrl"].startswith("data:image/png;base64,")
    assert len(pdf_res["snapNodes"]) >= 10

    # 3. Raster PNG with enclosed room + OpenCV floodFill auto-select
    img = Image.new("RGB", (400, 300), "white")
    draw = ImageDraw.Draw(img)
    draw.rectangle([80, 60, 320, 240], outline="black", width=6)
    png_buf = io.BytesIO()
    img.save(png_buf, format="PNG")
    img_res = process_uploaded_plan("scan.png", png_buf.getvalue())
    assert img_res["kind"] == "Image"

    poly = auto_select_room_polygon(img_res["imageDataUrl"], 420.0, 280.0)
    assert len(poly) >= 4
    mock_poly = auto_select_room_polygon(None, 400.0, 200.0)
    assert len(mock_poly) == 4


def test_ifc_bim_processor_and_endpoint(tmp_path: Path) -> None:
    os.environ["COBITX_DATA_DIR"] = str(tmp_path)
    import main as engine_main
    from services.ifc_processor import generate_sample_office_ifc, process_ifc_bytes

    ifc_bytes = generate_sample_office_ifc()
    parsed = process_ifc_bytes("SampleOffice.ifc", ifc_bytes)
    assert parsed["kind"] == "IFC"
    assert len(parsed["ifcElements"]) == 14
    assert set(parsed["levels"]) == {"Ground Floor", "Level 01"}
    classes = {c["ifcClass"] for c in parsed["classSummaries"]}
    assert {"IfcSlab", "IfcWall", "IfcColumn", "IfcBeam", "IfcDoor", "IfcWindow", "IfcRoof"}.issubset(classes)

    engine_main.storage = engine_main.CobitXStorage(tmp_path)
    client = TestClient(engine_main.app)
    r = client.post("/api/plans/sample-ifc")
    assert r.status_code == 200
    assert len(r.json()["ifcElements"]) == 14


def test_export_engine_excel_pdf_csv(tmp_path: Path) -> None:
    import io
    import openpyxl
    import main as engine_main

    sample_job = {
        "id": "job-exp-1",
        "name": "CobitX Medical Fitout",
        "builder": "Apex Build",
        "accountManager": "Estimator",
        "markupPct": 10,
        "salesTaxPct": 10,
        "gfaM2": 200,
        "rows": [
            {"id": "tr-1", "parentId": None, "rowType": "Trade", "code": "03", "description": "CONCRETE"},
            {
                "id": "it-1",
                "parentId": "tr-1",
                "rowType": "Item",
                "code": "C01",
                "description": "Slab on Ground 150mm",
                "resultType": "Area",
                "quantity": 120,
                "unit": "m2",
                "factor": 1,
                "rate": 140,
                "markupPct": 10,
                "pricingMode": "INCL",
                "groupingCode": "CONC",
                "calcRows": [{"id": "c1", "description": "Ground Floor", "quantity": 120, "factor": 1}],
                "rateRows": [{"id": "rr1", "description": "32MPa Concrete", "quantity": 0.15, "unit": "m3", "rate": 320, "total": 48}],
            },
        ],
        "shapes": [
            {"id": "s1", "name": "GF Slab", "planId": "p1", "resultType": "Area", "points": [{"x": 0, "y": 0}, {"x": 100, "y": 0}, {"x": 100, "y": 100}], "openings": []}
        ],
    }

    engine_main.storage = engine_main.CobitXStorage(tmp_path)
    client = TestClient(engine_main.app)

    rx = client.post("/api/export/excel", json={"job": sample_job, "reportKind": "BOQ"})
    assert rx.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(rx.content))
    assert set(wb.sheetnames) == {"Executive Summary", "BOQ Cost vs Sell", "CostX Datasheets"}

    rp = client.post("/api/export/pdf", json={"job": sample_job, "reportKind": "BOQ"})
    assert rp.status_code == 200
    assert rp.content[:4] == b"%PDF"

    rc = client.post("/api/export/csv", json={"job": sample_job, "reportKind": "livecosts"})
    assert rc.status_code == 200
    assert "Slab on Ground 150mm" in rc.text

    rxero = client.post("/api/export/csv", json={"job": sample_job, "reportKind": "xero"})
    assert rxero.status_code == 200
    assert "*InvoiceNumber" in rxero.text


def test_ai_takeoff_endpoints(tmp_path: Path) -> None:
    import base64
    import io
    from PIL import Image, ImageDraw
    import main as engine_main

    engine_main.storage = engine_main.CobitXStorage(tmp_path)
    client = TestClient(engine_main.app)

    # Synthetic 2-room plan image for OpenCV connected-components room segmentation
    img = Image.new("RGB", (400, 300), "white")
    draw = ImageDraw.Draw(img)
    draw.rectangle([40, 40, 200, 240], outline="black", width=6)
    draw.rectangle([200, 40, 360, 240], outline="black", width=6)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

    r_area = client.post("/api/ai/auto-area", json={"imageDataUrl": b64_url})
    assert r_area.status_code == 200
    assert r_area.json()["count"] >= 2

    r_sym = client.post("/api/ai/count-symbols", json={"symbolKind": "Door Swing"})
    assert r_sym.status_code == 200
    assert r_sym.json()["count"] == 3

    r_txt = client.post("/api/ai/scan-text", json={"query": "CONSULT", "planName": "A101"})
    assert r_txt.status_code == 200
    assert r_txt.json()["count"] >= 2

    r_scale = client.post(
        "/api/ai/auto-scale",
        json={"currentName": "Ground Floor Plan", "originalFileName": "A102_GF_1_50.pdf"},
    )
    assert r_scale.status_code == 200
    assert r_scale.json()["suggestedName"].startswith("A102")


def test_cbx_plx_e0x_roundtrip(tmp_path: Path) -> None:
    import main as engine_main

    engine_main.storage = engine_main.CobitXStorage(tmp_path)
    client = TestClient(engine_main.app)

    sample_job = {
        "id": "job-cbx-1",
        "name": "Warehouse Frame",
        "kind": "Job",
        "builder": "Cobit Builders",
        "markupPct": 12,
        "salesTaxPct": 10,
        "rows": [
            {"id": "t1", "parentId": None, "rowType": "Trade", "code": "03", "description": "CONCRETE"},
            {
                "id": "i1",
                "parentId": "t1",
                "rowType": "Item",
                "code": "S1",
                "description": "Slab 150mm",
                "resultType": "Area",
                "quantity": 250,
                "unit": "m2",
                "rate": 135,
                "rateRows": [{"code": "M1", "description": "Concrete Mix", "unit": "m3", "quantity": 0.15, "rate": 310, "kind": "Material"}],
                "calcRows": [{"description": "Bay 1", "quantity": 250, "factor": 1, "resultType": "Area"}],
            },
        ],
    }

    rexp = client.post("/api/export/cbx", json={"job": sample_job})
    assert rexp.status_code == 200
    assert rexp.content[:2] == b"PK"

    rimp = client.post(
        "/api/import/cbx",
        files={"file": ("Warehouse_Frame.cbx", rexp.content, "application/zip")},
    )
    assert rimp.status_code == 200
    imported = rimp.json()["job"]
    assert imported["name"].startswith("Warehouse Frame")
    assert len(imported["rows"]) == 2
    assert imported["rows"][1]["rate"] == 135

    # Test Buildsoft Global Estimating .e0x pipe-delimited import
    e0x_bytes = b"TRADE|04|MASONRY\nBW1|Face Brickwork|m2|180|92.5\n"
    re0x = client.post(
        "/api/import/cbx",
        files={"file": ("GlobalEstimate.e0x", e0x_bytes, "text/plain")},
    )
    assert re0x.status_code == 200
    e0x_job = re0x.json()["job"]
    assert len(e0x_job["rows"]) == 2
    assert e0x_job["rows"][1]["quantity"] == 180.0
    assert e0x_job["rows"][1]["rate"] == 92.5


def test_mcp_http_jsonrpc_and_new_tools(tmp_path: Path) -> None:
    os.environ["COBITX_DATA_DIR"] = str(tmp_path)
    import main as engine_main

    store = engine_main.CobitXStorage(tmp_path)
    store.save_state(
        {
            "jobs": [
                {
                    "id": "job-mcp-1",
                    "name": "MCP Audit Job",
                    "kind": "Job",
                    "status": "Open",
                    "markupPct": 10,
                    "salesTaxPct": 10,
                    "rows": [
                        {
                            "id": "tr-1",
                            "parentId": None,
                            "rowType": "Trade",
                            "code": "03",
                            "refCode": "03",
                            "description": "CONCRETE",
                            "quantity": 0,
                            "unit": "",
                            "factor": 1,
                            "rate": 0,
                            "markupPct": 0,
                            "pricingMode": "INCL",
                        },
                        {
                            "id": "it-1",
                            "parentId": "tr-1",
                            "rowType": "Item",
                            "code": "C1",
                            "refCode": "SLAB",
                            "description": "Slab 150mm",
                            "resultType": "Area",
                            "quantity": 50,
                            "unit": "m2",
                            "factor": 1,
                            "rate": 100,
                            "markupPct": 10,
                            "pricingMode": "INCL",
                            "rateRows": [],
                        },
                    ],
                }
            ]
        }
    )
    engine_main.storage = store
    client = TestClient(engine_main.app)

    # 1. initialize & notifications/initialized
    r_init = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
    assert r_init.status_code == 200
    assert r_init.json()["result"]["serverInfo"]["name"] == "CobitX Estimating MCP Server"

    r_notif = client.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert r_notif.status_code == 200
    assert r_notif.json()["result"] == {}

    # 2. tools/list
    r_tools = client.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
    tool_names = {t["name"] for t in r_tools.json()["result"]["tools"]}
    assert {
        "cobitx_insert_estimate_row",
        "cobitx_update_rate_sheet",
        "cobitx_run_formula_audit",
        "cobitx_trigger_ai_takeoff",
        "cobitx_export_boq",
    }.issubset(tool_names)

    # 3. tools/call -> cobitx_insert_estimate_row
    r_ins = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "cobitx_insert_estimate_row",
                "arguments": {
                    "job_id": "job-mcp-1",
                    "parent_id": "tr-1",
                    "row_type": "Item",
                    "code": "C2",
                    "description": "Edge Formwork",
                    "unit": "m",
                    "quantity": 25,
                    "rate": 40,
                },
            },
        },
    )
    assert r_ins.status_code == 200
    ins_payload = r_ins.json()["result"]["structuredContent"]
    assert ins_payload["code"] == "C2"
    new_row_id = ins_payload["id"]

    # 4. tools/call -> cobitx_update_rate_sheet (including % and + batch divisor)
    r_rate = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {
                "name": "cobitx_update_rate_sheet",
                "arguments": {
                    "job_id": "job-mcp-1",
                    "row_id": new_row_id,
                    "components": [
                        {"code": "MAT", "description": "Ply Form", "unit": "m", "quantity": 1, "rate": 300, "kind": "Material"},
                        {"code": "ONC", "description": "Margin", "unit": "%", "quantity": 10, "rate": 1, "fn": "%", "kind": "Plant"},
                        {"code": "LAB", "description": "Crew Shift", "unit": "m", "quantity": 20, "rate": 1000, "fn": "+", "kind": "Labour"},
                    ],
                },
            },
        },
    )
    assert r_rate.status_code == 200
    rate_res = r_rate.json()["result"]["structuredContent"]
    assert rate_res["unitRate"] == 380.0

    # 5. tools/call -> cobitx_run_formula_audit (detect broken ref & cycle)
    state = store.load_state()
    state["jobs"][0]["rows"].extend(
        [
            {"id": "f1", "parentId": "tr-1", "rowType": "Item", "code": "F1", "refCode": "CYC1", "description": "Cycle 1", "formula": "=@CYC2 + @MISSING", "quantity": 1, "rate": 1},
            {"id": "f2", "parentId": "tr-1", "rowType": "Item", "code": "F2", "refCode": "CYC2", "description": "Cycle 2", "rel": "@CYC1", "quantity": 1, "rate": 1},
        ]
    )
    store.save_state(state)

    r_audit = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {"name": "cobitx_run_formula_audit", "arguments": {"job_id": "job-mcp-1"}},
        },
    )
    audit_res = r_audit.json()["result"]["structuredContent"]
    assert audit_res["ok"] is False
    issue_types = {i["issueType"] for i in audit_res["issues"]}
    assert "broken_ref" in issue_types
    assert "circular_ref" in issue_types

    # 6. tools/call -> cobitx_trigger_ai_takeoff & cobitx_export_boq
    r_ai = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 6,
            "method": "tools/call",
            "params": {
                "name": "cobitx_trigger_ai_takeoff",
                "arguments": {"mode": "scan_text", "plan_name": "A101", "query_or_symbol": "CONSULT"},
            },
        },
    )
    assert r_ai.json()["result"]["structuredContent"]["count"] >= 2

    r_boq_csv = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 7,
            "method": "tools/call",
            "params": {"name": "cobitx_export_boq", "arguments": {"job_id": "job-mcp-1", "format": "csv"}},
        },
    )
    assert "Slab 150mm" in r_boq_csv.json()["result"]["structuredContent"]["csv"]

    r_boq_json = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 8,
            "method": "tools/call",
            "params": {"name": "cobitx_export_boq", "arguments": {"job_id": "job-mcp-1", "format": "summary_json"}},
        },
    )
    assert len(r_boq_json.json()["result"]["structuredContent"]["items"]) >= 2

    # 7. resources/list & resources/read
    r_res_list = client.post("/mcp", json={"jsonrpc": "2.0", "id": 9, "method": "resources/list", "params": {}})
    assert any(r["uri"] == "cobitx://jobs" for r in r_res_list.json()["result"]["resources"])
    r_res_read = client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 10, "method": "resources/read", "params": {"uri": "cobitx://jobs"}},
    )
    assert "MCP Audit Job" in r_res_read.json()["result"]["contents"][0]["text"]


def test_probe_external_mcp_loopback(monkeypatch) -> None:
    import asyncio
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from mcp_server import probe_external_mcp

    class _MockMcpHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(length).decode("utf-8"))
            method = req.get("method")
            if method == "initialize":
                res = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}}
            elif method == "tools/list":
                res = {"tools": [{"name": "t1"}, {"name": "t2"}, {"name": "t3"}]}
            elif method == "resources/list":
                res = {"resources": [{"uri": "cobitx://jobs"}]}
            else:
                res = {}
            body = json.dumps({"jsonrpc": "2.0", "id": req.get("id"), "result": res}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):  # noqa: A002
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), _MockMcpHandler)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        # Simulate broken proxy env vars that previously triggered "Invalid port: ':1]'"
        monkeypatch.setenv("HTTP_PROXY", "http://[::1]")
        monkeypatch.setenv("HTTPS_PROXY", "http://[::1]")
        result = asyncio.run(probe_external_mcp("http", f"http://127.0.0.1:{port}/mcp"))
        assert result["ok"] is True
        assert result["status"] == "Connected"
        assert result["toolsCount"] == 3
        assert result["resourcesCount"] == 1
    finally:
        server.shutdown()
        server.server_close()


def test_real_tesseract_ocr_ai_takeoff() -> None:
    import base64
    import io
    from PIL import Image, ImageDraw
    from services.ai_takeoff import ai_auto_scale_and_rename, ai_scan_text_labels

    # Render crisp oversized text on a white sheet so Tesseract OCR detects it reliably
    base = Image.new("RGB", (400, 220), "white")
    draw = ImageDraw.Draw(base)
    draw.text((20, 25), "CONSULT 1", fill="black")
    draw.text((220, 155), "SCALE 1:50", fill="black")
    draw.text((220, 175), "A204", fill="black")
    big = base.resize((1200, 660), Image.Resampling.NEAREST)

    buf = io.BytesIO()
    big.save(buf, format="PNG")
    b64_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

    matches = ai_scan_text_labels("CONSULT", "Sheet", image_data_url=b64_url)
    assert len(matches) >= 1
    assert any("CONSULT" in m["text"].upper() for m in matches)
    assert 40 <= matches[0]["x"] <= 800
    assert 30 <= matches[0]["y"] <= 530
    assert matches[0]["confidence"] > 0

    scale_res = ai_auto_scale_and_rename("Plan", "upload.png", image_data_url=b64_url)
    assert "1:50" in scale_res["detectedScaleLabel"]
    assert "A204" in scale_res["suggestedName"]


def test_pricelist_excel_and_csv_import(tmp_path: Path) -> None:
    import io
    import openpyxl
    import main as engine_main

    engine_main.storage = engine_main.CobitXStorage(tmp_path)
    client = TestClient(engine_main.app)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Code", "Description", "Unit", "Rate", "Markup", "Heading Ref Code", "Type"])
    ws.append(["03", "CONCRETE", "", "", "", "", "Trade"])
    ws.append(["H1", "Footings & Slabs", "", "", "", "03", "Heading"])
    ws.append(["C01", "32MPa Concrete Supply", "m3", 285.5, 10, "H1", "Item"])
    ws.append(["C02", "Slab Trowel Finish", "m2", 18.0, 5, "H1", "Item"])

    xbuf = io.BytesIO()
    wb.save(xbuf)
    r_xlsx = client.post(
        "/api/import/pricelist-excel",
        files={"file": ("MasterRates.xlsx", xbuf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r_xlsx.status_code == 200
    pl = r_xlsx.json()["job"]
    assert pl["kind"] == "PriceList"
    assert pl["useAsTemplate"] is True
    assert len(pl["rows"]) == 4
    trade, heading, item1, item2 = pl["rows"]
    assert trade["rowType"] == "Trade"
    assert heading["parentId"] == trade["id"]
    assert item1["parentId"] == heading["id"]
    assert item1["rate"] == 285.5
    assert item2["markupPct"] == 5.0

    csv_bytes = (
        b"Code,Description,Unit,Rate,Markup,Heading Ref Code,Type\n"
        b"09,FINISHES,,,, ,Trade\n"
        b"P01,Interior Acrylic Paint,m2,24.5,12,09,Item\n"
    )
    r_csv = client.post(
        "/api/import/pricelist-excel",
        files={"file": ("PaintRates.csv", csv_bytes, "text/csv")},
    )
    assert r_csv.status_code == 200
    pl_csv = r_csv.json()["job"]
    assert pl_csv["kind"] == "PriceList"
    assert pl_csv["rows"][1]["rate"] == 24.5

