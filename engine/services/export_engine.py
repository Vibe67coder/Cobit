"""CostX / Cubit BOQ Report & Integration Export Engine (Excel openpyxl, ReportLab PDF, LiveCosts/Xero CSV)."""

from __future__ import annotations

import csv
import io
from typing import Any

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _compute_row_rate(row: dict[str, Any]) -> float:
    rate_rows = row.get("rateRows") or []
    if not rate_rows:
        return float(row.get("rate") or 0.0)
    total = 0.0
    prev = 0.0
    for rr in rate_rows:
        qty = float(rr.get("quantity") or 0.0)
        rate = float(rr.get("rate") or 0.0)
        conv = float(rr.get("conversion") if rr.get("conversion") is not None else 1.0)
        fac = float(rr.get("factor") if rr.get("factor") is not None else 1.0)
        waste = 1.0 + float(rr.get("wastagePct") or 0.0) / 100.0
        fn = rr.get("fn")
        if fn == "%":
            row_tot = prev * (qty / 100.0) * (rate if rate > 0 else 1.0)
        elif fn == "+":
            denom = qty if qty != 0 else 1.0
            row_tot = (rate * conv * fac * waste) / denom
        else:
            row_tot = qty * rate * conv * fac * waste
        prev = row_tot
        total += row_tot
    return total


def _compute_eff_qty(row: dict[str, Any]) -> float:
    base = float(row.get("quantity") or 0.0)
    conv = float(row.get("conversion") if row.get("conversion") is not None else 1.0)
    num = float(row.get("numberMultiplier") if row.get("numberMultiplier") is not None else 1.0)
    fac = float(row.get("factor") if row.get("factor") is not None else 1.0)
    waste = 1.0 + float(row.get("wastagePct") or 0.0) / 100.0
    return base * conv * num * fac * waste


def _is_excluded(row: dict[str, Any]) -> bool:
    rt = str(row.get("resultType") or "")
    return (
        row.get("pricingMode") == "EXCL"
        or bool(row.get("excludeFromTotal"))
        or rt in ("Exclude from total", "Note")
    )


def _compute_trade_totals(rows: list[dict[str, Any]]) -> dict[str, float]:
    children: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        pid = r.get("parentId") or "__root__"
        children.setdefault(pid, []).append(r)

    totals: dict[str, float] = {}

    def walk(node: dict[str, Any]) -> float:
        if node.get("rowType") == "Item":
            if _is_excluded(node):
                val = 0.0
            else:
                cost = _compute_eff_qty(node) * _compute_row_rate(node)
                val = cost * (1.0 + float(node.get("markupPct") or 0.0) / 100.0)
            totals[node["id"]] = val
            return val
        s = sum(walk(child) for child in children.get(node["id"], []))
        totals[node["id"]] = s
        return s

    for root in children.get("__root__", []):
        walk(root)
    return totals


def export_job_excel(job: dict[str, Any]) -> bytes:
    """Export a formatted multi-sheet Excel workbook (Summary, BOQ Cost vs Sell, CostX Datasheets)."""
    wb = openpyxl.Workbook()
    ws_sum = wb.active
    ws_sum.title = "Executive Summary"

    rows = job.get("rows") or []
    totals = _compute_trade_totals(rows)

    header_fill = PatternFill("solid", fgColor="1E3A5F")
    trade_fill = PatternFill("solid", fgColor="DBEAFE")
    head_fill = PatternFill("solid", fgColor="F1F5F9")
    white_bold = Font(color="FFFFFF", bold=True, size=11)
    title_font = Font(color="0F172A", bold=True, size=14)
    bold_font = Font(bold=True, size=10)

    ws_sum["A1"] = f"COBITX ESTIMATING — {job.get('name', 'Estimate')}"
    ws_sum["A1"].font = title_font
    ws_sum["A2"] = f"Builder: {job.get('builder', '')} | Manager: {job.get('accountManager', '')} | Status: {job.get('status', 'Open')}"
    ws_sum["A3"] = f"Job Markup: {job.get('markupPct', 0)}% | GST/Tax: {job.get('salesTaxPct', 10)}% | GFA: {job.get('gfaM2') or 'N/A'} m2"

    ws_sum.append([])
    ws_sum.append(["Trade Code", "Trade Description", "Total Excl Job Markup (AUD)"])
    for col in ("A", "B", "C"):
        c = ws_sum[f"{col}5"]
        c.fill = header_fill
        c.font = white_bold

    subtotal = 0.0
    row_idx = 6
    for r in rows:
        if r.get("rowType") == "Trade":
            t_val = totals.get(r["id"], 0.0)
            subtotal += t_val
            ws_sum.append([r.get("code", ""), r.get("description", ""), round(t_val, 2)])
            ws_sum[f"C{row_idx}"].number_format = "$#,##0.00"
            row_idx += 1

    markup_pct = float(job.get("markupPct") or 0.0)
    tax_pct = float(job.get("salesTaxPct") or 10.0)
    adj_pct = float(job.get("adjustmentPct") or 0.0)
    adj_fixed = float(job.get("adjustmentFixed") or 0.0)
    markup_amt = subtotal * (markup_pct / 100.0)
    adj_amt = subtotal * (adj_pct / 100.0) + adj_fixed
    pre_tax = subtotal + markup_amt + adj_amt
    tax_amt = pre_tax * (tax_pct / 100.0)
    grand = pre_tax + tax_amt

    ws_sum.append([])
    for label, val in [
        ("Subtotal (Trades)", subtotal),
        (f"Job Markup ({markup_pct}%)", markup_amt),
        ("Commercial Adjustments", adj_amt),
        (f"GST / Tax ({tax_pct}%)", tax_amt),
        ("GRAND TOTAL (INCL TAX)", grand),
    ]:
        ws_sum.append(["", label, round(val, 2)])
        curr = ws_sum.max_row
        ws_sum[f"B{curr}"].font = bold_font
        ws_sum[f"C{curr}"].font = bold_font
        ws_sum[f"C{curr}"].number_format = "$#,##0.00"

    ws_sum.column_dimensions["A"].width = 16
    ws_sum.column_dimensions["B"].width = 44
    ws_sum.column_dimensions["C"].width = 24

    # Sheet 2: Bill of Quantities (Cost vs Sell)
    ws_boq = wb.create_sheet("BOQ Cost vs Sell")
    boq_headers = [
        "Type",
        "Code",
        "Description",
        "Result Type",
        "Eff. Qty",
        "Unit",
        "Cost Rate",
        "Cost Total",
        "Markup %",
        "Sell Total",
        "Mode",
        "Group Code",
    ]
    ws_boq.append(boq_headers)
    for col_i in range(1, len(boq_headers) + 1):
        cell = ws_boq.cell(row=1, column=col_i)
        cell.fill = header_fill
        cell.font = white_bold

    for r in rows:
        rt = r.get("rowType")
        if rt == "Item":
            eff_q = _compute_eff_qty(r)
            eff_rate = _compute_row_rate(r)
            cost_tot = 0.0 if _is_excluded(r) else eff_q * eff_rate
            sell_tot = totals.get(r["id"], 0.0)
            ws_boq.append([
                "Item",
                r.get("code", ""),
                f"    {r.get('description', '')}",
                r.get("resultType", "Area"),
                round(eff_q, 2),
                r.get("unit", ""),
                round(eff_rate, 2),
                round(cost_tot, 2),
                float(r.get("markupPct") or 0.0),
                round(sell_tot, 2),
                r.get("pricingMode", "INCL"),
                r.get("groupingCode", ""),
            ])
            cur = ws_boq.max_row
            for ci in (7, 8, 10):
                ws_boq.cell(cur, ci).number_format = "$#,##0.00"
        else:
            indent = "" if rt == "Trade" else "  "
            ws_boq.append([
                rt,
                r.get("code", ""),
                f"{indent}{r.get('description', '')}",
                "",
                "",
                "",
                "",
                "",
                "",
                round(totals.get(r["id"], 0.0), 2),
                "",
                "",
            ])
            cur = ws_boq.max_row
            fill = trade_fill if rt == "Trade" else head_fill
            for ci in range(1, 13):
                c = ws_boq.cell(cur, ci)
                c.fill = fill
                c.font = bold_font
            ws_boq.cell(cur, 10).number_format = "$#,##0.00"

    for col_letter, width in [
        ("A", 10), ("B", 12), ("C", 40), ("D", 18), ("E", 11), ("F", 8),
        ("G", 13), ("H", 14), ("I", 10), ("J", 14), ("K", 8), ("L", 14),
    ]:
        ws_boq.column_dimensions[col_letter].width = width

    # Sheet 3: CostX Datasheets (Calc Sheet + Rate Sheet Breakdown)
    ws_ds = wb.create_sheet("CostX Datasheets")
    ds_headers = ["Item Code", "Item Description", "Sheet Kind", "Component / Shape", "Length/Qty", "Unit", "Rate", "Subtotal"]
    ws_ds.append(ds_headers)
    for col_i in range(1, len(ds_headers) + 1):
        cell = ws_ds.cell(row=1, column=col_i)
        cell.fill = header_fill
        cell.font = white_bold

    for r in rows:
        if r.get("rowType") != "Item":
            continue
        for c in r.get("calcRows") or []:
            ws_ds.append([
                r.get("code", ""),
                r.get("description", ""),
                "Calc Sheet",
                c.get("description", ""),
                round(float(c.get("quantity") or 0.0), 2),
                r.get("unit", ""),
                "-",
                round(float(c.get("quantity") or 0.0) * float(c.get("factor") or 1.0), 2),
            ])
        for rr in r.get("rateRows") or []:
            ws_ds.append([
                r.get("code", ""),
                r.get("description", ""),
                f"Rate ({rr.get('kind', 'Material')})",
                rr.get("description", ""),
                round(float(rr.get("quantity") or 0.0), 3),
                rr.get("unit", ""),
                round(float(rr.get("rate") or 0.0), 2),
                round(float(rr.get("total") or 0.0), 2),
            ])
            ws_ds.cell(ws_ds.max_row, 7).number_format = "$#,##0.00"
            ws_ds.cell(ws_ds.max_row, 8).number_format = "$#,##0.00"

    for col_letter, width in [("A", 12), ("B", 32), ("C", 18), ("D", 32), ("E", 12), ("F", 8), ("G", 12), ("H", 14)]:
        ws_ds.column_dimensions[col_letter].width = width

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def export_job_pdf(job: dict[str, Any], report_kind: str = "BOQ") -> bytes:
    """Generate a ReportLab PDF for BOQ, Trade Summary, or Shapes Takeoff Audit."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        leftMargin=28,
        rightMargin=28,
        topMargin=28,
        bottomMargin=28,
    )
    styles = getSampleStyleSheet()
    story: list[Any] = []

    kind = report_kind.upper()
    title = (
        "BOQ Detailed Estimate Report"
        if kind == "BOQ"
        else "Executive Trade Summary Report"
        if kind == "TRADE"
        else "Takeoff Shapes & Openings Audit Report"
    )
    story.append(Paragraph(f"<b>CobitX Estimating — {title}</b>", styles["Title"]))
    story.append(
        Paragraph(
            f"Job: <b>{job.get('name', '')}</b> | Builder: {job.get('builder', '')} | Manager: {job.get('accountManager', '')} | Markup: {job.get('markupPct', 0)}% | GST: {job.get('salesTaxPct', 10)}%",
            styles["Normal"],
        )
    )
    story.append(Spacer(1, 12))

    rows = job.get("rows") or []
    totals = _compute_trade_totals(rows)

    if kind == "SHAPES":
        data = [["Shape Name", "Plan ID", "Result Type", "Height/Depth (mm)", "Points", "Openings", "IFC Level"]]
        for shp in job.get("shapes") or []:
            dim_mm = shp.get("heightMm") or shp.get("depthMm") or "-"
            data.append([
                shp.get("name", ""),
                shp.get("planId", ""),
                shp.get("resultType", ""),
                str(dim_mm),
                str(len(shp.get("points") or [])),
                str(len(shp.get("openings") or [])),
                shp.get("ifcLevel") or "-",
            ])
        tbl = Table(data, colWidths=[180, 100, 140, 100, 55, 65, 95])
    elif kind == "TRADE":
        data = [["Trade Code", "Trade Description", "Excl Tax (AUD)", "% of Subtotal"]]
        sub = sum(totals.get(r["id"], 0.0) for r in rows if r.get("rowType") == "Trade")
        for r in rows:
            if r.get("rowType") == "Trade":
                val = totals.get(r["id"], 0.0)
                pct = (val / sub * 100.0) if sub > 0 else 0.0
                data.append([r.get("code", ""), r.get("description", ""), f"${val:,.2f}", f"{pct:.1f}%"])
        data.append(["", "SUBTOTAL (EXCL TAX & JOB MARKUP)", f"${sub:,.2f}", "100.0%"])
        tbl = Table(data, colWidths=[90, 360, 140, 110])
    else:
        data = [["Code", "Description", "Result Type", "Qty", "Unit", "Rate", "Markup %", "Total (AUD)"]]
        for r in rows:
            rt = r.get("rowType")
            if rt == "Item":
                q = _compute_eff_qty(r)
                rate = _compute_row_rate(r)
                tot = totals.get(r["id"], 0.0)
                data.append([
                    r.get("code", ""),
                    f"  {r.get('description', '')}",
                    r.get("resultType", ""),
                    f"{q:,.2f}",
                    r.get("unit", ""),
                    f"${rate:,.2f}",
                    f"{float(r.get('markupPct') or 0.0):.1f}%",
                    f"${tot:,.2f}",
                ])
            else:
                data.append([
                    r.get("code", ""),
                    r.get("description", ""),
                    rt.upper(),
                    "",
                    "",
                    "",
                    "",
                    f"${totals.get(r['id'], 0.0):,.2f}",
                ])
        tbl = Table(data, colWidths=[65, 250, 115, 65, 45, 75, 60, 95])

    tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    story.append(tbl)
    doc.build(story)
    return buf.getvalue()


def export_job_csv(job: dict[str, Any], format_kind: str = "livecosts") -> str:
    """Export job rows as LiveCosts CSV or Xero/Cubit Select Import CSV."""
    rows = job.get("rows") or []
    totals = _compute_trade_totals(rows)
    out = io.StringIO()
    writer = csv.writer(out)

    if format_kind.lower() == "xero":
        writer.writerow(["*ContactName", "*InvoiceNumber", "*Description", "*Quantity", "*UnitAmount", "*AccountCode", "*TaxType"])
        contact = job.get("builder") or "Head Contractor Client"
        inv = f"COBITX-{job.get('id', 'JOB')[:10].upper()}"
        for r in rows:
            if r.get("rowType") != "Item" or _is_excluded(r):
                continue
            q = round(_compute_eff_qty(r), 2)
            unit_sell = round(_compute_row_rate(r) * (1.0 + float(r.get("markupPct") or 0.0) / 100.0), 2)
            writer.writerow([contact, inv, f"{r.get('code', '')} - {r.get('description', '')}", q, unit_sell, r.get("groupingCode") or "200", "GST on Income"])
    else:
        # LiveCosts Import CSV (Trades -> Headings -> Cost Codes)
        writer.writerow(["JobName", "CostCategoryCode", "Trade", "ItemCode", "Description", "Quantity", "Unit", "CostRate", "NetCost", "SellTotal"])
        trade_by_id = {r["id"]: r.get("description", "") for r in rows if r.get("rowType") == "Trade"}
        for r in rows:
            if r.get("rowType") != "Item" or _is_excluded(r):
                continue
            eff_q = _compute_eff_qty(r)
            eff_rate = _compute_row_rate(r)
            writer.writerow([
                job.get("name", ""),
                r.get("groupingCode") or "GENERAL",
                trade_by_id.get(r.get("parentId") or "", "Estimate"),
                r.get("code", ""),
                r.get("description", ""),
                round(eff_q, 2),
                r.get("unit", ""),
                round(eff_rate, 2),
                round(eff_q * eff_rate, 2),
                round(totals.get(r["id"], 0.0), 2),
            ])

    return out.getvalue()
