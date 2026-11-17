"""Buildsoft Cubit (.cbx / .plx) & Global Estimating (.e0x) Archive Adapter for CobitX."""

from __future__ import annotations

import csv
import io
import json
import time
import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Iterable, Iterator, Sequence
from math import isfinite
from typing import Any
from uuid import uuid4


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        return float(val) if val not in (None, "") else default
    except (TypeError, ValueError):
        return default


def export_cbx_archive(job: dict[str, Any]) -> bytes:
    """Serialize a CobitX Job or PriceList into a ZIP+XML+JSON .cbx / .plx archive."""
    root = ET.Element("CubitJob", attrib={"Format": "CobitX-CBX-15.1", "Kind": str(job.get("kind", "Job"))})
    details = ET.SubElement(root, "Details")
    for k in ("id", "name", "description", "builder", "accountManager", "status", "markupPct", "salesTaxPct"):
        el = ET.SubElement(details, k)
        el.text = str(job.get(k, ""))

    rows_el = ET.SubElement(root, "EstimateRows")
    for row in job.get("rows", []) or []:
        r_el = ET.SubElement(
            rows_el,
            "Row",
            attrib={
                "id": str(row.get("id", "")),
                "parentId": str(row.get("parentId") or ""),
                "rowType": str(row.get("rowType", "Item")),
                "code": str(row.get("code", "")),
            },
        )
        ET.SubElement(r_el, "Description").text = str(row.get("description", ""))
        ET.SubElement(r_el, "ResultType").text = str(row.get("resultType", ""))
        ET.SubElement(r_el, "Quantity").text = str(row.get("quantity", 0))
        ET.SubElement(r_el, "Unit").text = str(row.get("unit", ""))
        ET.SubElement(r_el, "Rate").text = str(row.get("rate", 0))
        ET.SubElement(r_el, "MarkupPct").text = str(row.get("markupPct", 0))
        ET.SubElement(r_el, "WastagePct").text = str(row.get("wastagePct", 0))
        ET.SubElement(r_el, "PricingMode").text = str(row.get("pricingMode", "INCL"))
        ET.SubElement(r_el, "GroupingCode").text = str(row.get("groupingCode", ""))

        rate_sheet = ET.SubElement(r_el, "RateSheet")
        for rr in row.get("rateRows", []) or []:
            ET.SubElement(
                rate_sheet,
                "RateComponent",
                attrib={
                    "code": str(rr.get("code", "")),
                    "description": str(rr.get("description", "")),
                    "unit": str(rr.get("unit", "")),
                    "quantity": str(rr.get("quantity", 1)),
                    "rate": str(rr.get("rate", 0)),
                    "kind": str(rr.get("kind", "Material")),
                },
            )

        calc_sheet = ET.SubElement(r_el, "CalculationSheet")
        for cr in row.get("calcRows", []) or []:
            ET.SubElement(
                calc_sheet,
                "CalcLine",
                attrib={
                    "description": str(cr.get("description", "")),
                    "quantity": str(cr.get("quantity", 0)),
                    "factor": str(cr.get("factor", 1)),
                    "resultType": str(cr.get("resultType", "Area")),
                },
            )

    xml_bytes = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("CubitJob.xml", xml_bytes)
        zf.writestr("job.json", json.dumps(job, indent=2))
    return buf.getvalue()


def _normalize_imported_job(raw_job: dict[str, Any], filename: str, kind_override: str | None = None) -> dict[str, Any]:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    inferred_kind = kind_override or (
        "PriceList" if ext == "plx" or raw_job.get("kind") == "PriceList" else "Job"
    )
    base_name = str(raw_job.get("name") or filename.rsplit(".", 1)[0] or "Imported Job")
    return {
        "id": f"{'pl' if inferred_kind == 'PriceList' else 'job'}-imp-{uuid4().hex}",
        "kind": inferred_kind,
        "projectId": raw_job.get("projectId"),
        "folderId": None,
        "name": f"{base_name} (Imported)",
        "description": str(raw_job.get("description") or f"Imported from {filename}"),
        "builder": str(raw_job.get("builder") or ""),
        "startDate": str(raw_job.get("startDate") or time.strftime("%Y-%m-%d")),
        "lastUpdated": time.strftime("%Y-%m-%d %H:%M"),
        "useAsTemplate": bool(raw_job.get("useAsTemplate", inferred_kind == "PriceList")),
        "status": str(raw_job.get("status") or "Open"),
        "freezeStates": raw_job.get("freezeStates") or ["None"],
        "siteAddress": raw_job.get("siteAddress")
        or {"street": "", "suburb": "", "state": "NSW", "postcode": "", "country": "Australia"},
        "companyId": None,
        "contactId": None,
        "accountManager": str(raw_job.get("accountManager") or "Estimator"),
        "markupPct": _safe_float(raw_job.get("markupPct"), 10.0),
        "salesTaxPct": _safe_float(raw_job.get("salesTaxPct"), 10.0),
        "gfaM2": raw_job.get("gfaM2"),
        "rows": raw_job.get("rows") or [],
        "plans": raw_job.get("plans") or [],
        "shapes": raw_job.get("shapes") or [],
        "optionsPackages": raw_job.get("optionsPackages") or [],
        "variations": raw_job.get("variations") or [],
        "externalRefs": raw_job.get("externalRefs") or [],
    }


def _parse_cubit_xml(xml_bytes: bytes, filename: str) -> dict[str, Any]:
    root = ET.fromstring(xml_bytes)
    details = root.find("Details")
    job_name = (
        details.findtext("name")
        if details is not None and details.findtext("name")
        else root.attrib.get("Name") or filename.rsplit(".", 1)[0]
    )
    kind = root.attrib.get("Kind") or ("PriceList" if filename.lower().endswith(".plx") else "Job")

    rows: list[dict[str, Any]] = []
    # Support CobitX XML <EstimateRows><Row> or Buildsoft/Global <Trade>/<Item>
    row_nodes = root.findall(".//EstimateRows/Row")
    if row_nodes:
        for idx, rn in enumerate(row_nodes):
            rate_rows = [
                {
                    "id": f"rr-imp-{idx}-{j}",
                    "code": rc.attrib.get("code", ""),
                    "description": rc.attrib.get("description", "Component"),
                    "unit": rc.attrib.get("unit", "ea"),
                    "quantity": _safe_float(rc.attrib.get("quantity"), 1.0),
                    "rate": _safe_float(rc.attrib.get("rate"), 0.0),
                    "kind": rc.attrib.get("kind", "Material"),
                    "total": round(_safe_float(rc.attrib.get("quantity"), 1.0) * _safe_float(rc.attrib.get("rate"), 0.0), 2),
                }
                for j, rc in enumerate(rn.findall("./RateSheet/RateComponent"))
            ]
            calc_rows = [
                {
                    "id": f"cr-imp-{idx}-{j}",
                    "description": cc.attrib.get("description", "Line"),
                    "resultType": cc.attrib.get("resultType", "Area"),
                    "quantity": _safe_float(cc.attrib.get("quantity"), 0.0),
                    "factor": _safe_float(cc.attrib.get("factor"), 1.0),
                    "rounding": "None",
                }
                for j, cc in enumerate(rn.findall("./CalculationSheet/CalcLine"))
            ]
            rows.append(
                {
                    "id": rn.attrib.get("id") or f"row-imp-{idx}",
                    "parentId": rn.attrib.get("parentId") or None,
                    "rowType": rn.attrib.get("rowType") or "Item",
                    "code": rn.attrib.get("code") or "",
                    "description": rn.findtext("Description") or "Imported Item",
                    "resultType": rn.findtext("ResultType") or ("Area" if rn.attrib.get("rowType") == "Item" else None),
                    "quantity": _safe_float(rn.findtext("Quantity"), 0.0),
                    "unit": rn.findtext("Unit") or "",
                    "conversion": 1,
                    "numberMultiplier": 1,
                    "factor": 1,
                    "wastagePct": _safe_float(rn.findtext("WastagePct"), 0.0),
                    "rate": _safe_float(rn.findtext("Rate"), 0.0),
                    "markupPct": _safe_float(rn.findtext("MarkupPct"), 0.0),
                    "pricingMode": rn.findtext("PricingMode") or "INCL",
                    "groupingCode": rn.findtext("GroupingCode") or "",
                    "calcRows": calc_rows,
                    "rateRows": rate_rows,
                }
            )
    else:
        # Generic Global Estimating / XML Trade -> Item hierarchy
        trade_nodes = root.findall(".//Trade")
        if trade_nodes:
            for ti, tr in enumerate(trade_nodes):
                tid = f"tr-imp-{ti}"
                rows.append(
                    {
                        "id": tid,
                        "parentId": None,
                        "rowType": "Trade",
                        "code": tr.attrib.get("code") or tr.findtext("Code") or f"{ti + 1:02d}",
                        "description": tr.attrib.get("name") or tr.findtext("Description") or f"TRADE {ti + 1}",
                        "quantity": 0,
                        "unit": "",
                        "factor": 1,
                        "rate": 0,
                        "markupPct": 0,
                        "pricingMode": "INCL",
                        "calcRows": [],
                        "rateRows": [],
                    }
                )
                for ii, it in enumerate(tr.findall(".//Item")):
                    rows.append(
                        {
                            "id": f"it-imp-{ti}-{ii}",
                            "parentId": tid,
                            "rowType": "Item",
                            "code": it.attrib.get("code") or it.findtext("Code") or f"I{ii + 1}",
                            "description": it.attrib.get("description") or it.findtext("Description") or "Global Item",
                            "resultType": "Area",
                            "quantity": _safe_float(it.attrib.get("quantity") or it.findtext("Quantity"), 0.0),
                            "unit": it.attrib.get("unit") or it.findtext("Unit") or "m2",
                            "conversion": 1,
                            "numberMultiplier": 1,
                            "factor": 1,
                            "wastagePct": 0,
                            "rate": _safe_float(it.attrib.get("rate") or it.findtext("Rate"), 0.0),
                            "markupPct": 0,
                            "pricingMode": "INCL",
                            "calcRows": [],
                            "rateRows": [],
                        }
                    )

    return _normalize_imported_job(
        {
            "name": job_name,
            "kind": kind,
            "builder": details.findtext("builder") if details is not None else "",
            "markupPct": _safe_float(details.findtext("markupPct") if details is not None else 10, 10.0),
            "salesTaxPct": _safe_float(details.findtext("salesTaxPct") if details is not None else 10, 10.0),
            "rows": rows,
        },
        filename,
        kind_override=kind,
    )


def _parse_e0x_text(text: str, filename: str) -> dict[str, Any]:
    """Parse Buildsoft Global Estimating (.e0x) pipe/CSV/XML BOQ interchange into CobitX Job."""
    stripped = text.lstrip()
    if stripped.startswith("<"):
        return _parse_cubit_xml(text.encode("utf-8"), filename)

    rows: list[dict[str, Any]] = []
    cur_trade_id: str | None = None
    reader = csv.reader(io.StringIO(text), delimiter="|" if "|" in text else ",")
    for idx, cols in enumerate(reader):
        if not cols or all(not c.strip() for c in cols):
            continue
        head = cols[0].strip().upper()
        if head in ("TRADE", "T") and len(cols) >= 3:
            cur_trade_id = f"tr-e0x-{idx}"
            rows.append(
                {
                    "id": cur_trade_id,
                    "parentId": None,
                    "rowType": "Trade",
                    "code": cols[1].strip() or f"{idx + 1:02d}",
                    "description": cols[2].strip(),
                    "quantity": 0,
                    "unit": "",
                    "factor": 1,
                    "rate": 0,
                    "markupPct": 0,
                    "pricingMode": "INCL",
                    "calcRows": [],
                    "rateRows": [],
                }
            )
        else:
            if head in ("CODE", "ITEMCODE") and idx == 0:
                continue
            code = cols[0].strip() if len(cols) > 0 else f"G{idx}"
            desc = cols[1].strip() if len(cols) > 1 else code
            unit = cols[2].strip() if len(cols) > 2 else "ea"
            qty = _safe_float(cols[3] if len(cols) > 3 else 0, 0.0)
            rate = _safe_float(cols[4] if len(cols) > 4 else 0, 0.0)
            rows.append(
                {
                    "id": f"it-e0x-{idx}",
                    "parentId": cur_trade_id,
                    "rowType": "Item",
                    "code": code,
                    "description": desc,
                    "resultType": "Count" if unit.lower() in ("ea", "no", "item") else "Area",
                    "quantity": qty,
                    "unit": unit,
                    "conversion": 1,
                    "numberMultiplier": 1,
                    "factor": 1,
                    "wastagePct": 0,
                    "rate": rate,
                    "markupPct": 0,
                    "pricingMode": "INCL",
                    "calcRows": [],
                    "rateRows": [],
                }
            )

    return _normalize_imported_job({"name": filename.rsplit(".", 1)[0], "rows": rows}, filename, kind_override="Job")


def import_legacy_archive(filename: str, raw_bytes: bytes, kind_hint: str | None = None) -> dict[str, Any]:
    """Import .cbx, .plx, .e0x, .xml, or .json Buildsoft/CobitX job archive."""
    if zipfile.is_zipfile(io.BytesIO(raw_bytes)):
        with zipfile.ZipFile(io.BytesIO(raw_bytes), "r") as zf:
            names = zf.namelist()
            if "job.json" in names:
                parsed = json.loads(zf.read("job.json").decode("utf-8"))
                return _normalize_imported_job(parsed, filename, kind_hint)
            xml_names = [n for n in names if n.lower().endswith(".xml")]
            if xml_names:
                return _parse_cubit_xml(zf.read(xml_names[0]), filename)

    text = raw_bytes.decode("utf-8", errors="ignore").strip()
    if text.startswith("{"):
        parsed = json.loads(text)
        if isinstance(parsed, dict) and "state" in parsed and isinstance(parsed["state"], dict):
            jobs = parsed["state"].get("jobs") or []
            if jobs:
                return _normalize_imported_job(jobs[0], filename, kind_hint)
        return _normalize_imported_job(parsed, filename, kind_hint)
    if text.startswith("<"):
        return _parse_cubit_xml(raw_bytes, filename)
    return _parse_e0x_text(text, filename)


def _norm_header(h: Any) -> str:
    return "".join(ch for ch in str(h or "").strip().lower() if ch.isalnum())


def import_pricelist_spreadsheet(filename: str, raw_bytes: bytes) -> dict[str, Any]:
    """Parse .xlsx or .csv Price List into a nested Trade -> Heading -> Item PriceList JobRecord."""
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    table_rows: list[list[Any]] = []

    if ext == "xlsx":
        import openpyxl

        wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), data_only=True)
        ws = wb.active
        for r in ws.iter_rows(values_only=True):
            if any(c is not None and str(c).strip() != "" for c in r):
                table_rows.append(list(r))
    else:
        text = raw_bytes.decode("utf-8-sig", errors="ignore")
        reader = csv.reader(io.StringIO(text))
        for r in reader:
            if any(c.strip() != "" for c in r):
                table_rows.append(r)

    if not table_rows:
        raise ValueError("Price list spreadsheet contains no rows.")

    headers = [_norm_header(h) for h in table_rows[0]]

    def _find_col(*aliases: str) -> int | None:
        for alias in aliases:
            if alias in headers:
                return headers.index(alias)
        return None

    col_code = _find_col("code", "itemcode", "ref")
    col_desc = _find_col("description", "desc", "name", "itemdescription")
    col_unit = _find_col("unit", "uom")
    col_rate = _find_col("rate", "unitrate", "price", "cost")
    col_markup = _find_col("markup", "markuppct", "markup%")
    col_heading = _find_col("headingrefcode", "headingref", "headingcode", "parentcode", "section", "trade", "rategroup")
    col_type = _find_col("type", "rowtype")

    # If first row does not look like a header row, fall back to positional columns
    has_header = col_code is not None or col_desc is not None or col_rate is not None
    data_rows = table_rows[1:] if has_header else table_rows
    if not has_header:
        col_code, col_desc, col_unit, col_rate, col_markup, col_heading = 0, 1, 2, 3, 4, 5

    def _cell(row_vals: list[Any], idx: int | None) -> str:
        if idx is None or idx >= len(row_vals) or row_vals[idx] is None:
            return ""
        return str(row_vals[idx]).strip()

    rows: list[dict[str, Any]] = []
    container_by_code: dict[str, str] = {}
    current_trade_id: str | None = None
    current_heading_id: str | None = None

    def _ensure_default_trade() -> str:
        nonlocal current_trade_id
        if current_trade_id:
            return current_trade_id
        tid = "tr-pl-default"
        rows.append(
            {
                "id": tid,
                "parentId": None,
                "rowType": "Trade",
                "code": "01",
                "refCode": "01",
                "description": filename.rsplit(".", 1)[0].upper() or "IMPORTED PRICE LIST",
                "quantity": 0,
                "unit": "",
                "factor": 1,
                "rate": 0,
                "markupPct": 0,
                "pricingMode": "INCL",
                "groupingCode": "",
                "calcRows": [],
                "rateRows": [],
            }
        )
        container_by_code["01"] = tid
        current_trade_id = tid
        return tid

    for idx, vals in enumerate(data_rows):
        code = _cell(vals, col_code)
        desc = _cell(vals, col_desc)
        unit = _cell(vals, col_unit)
        rate_str = _cell(vals, col_rate)
        markup_str = _cell(vals, col_markup)
        heading_ref = _cell(vals, col_heading)
        explicit_type = _cell(vals, col_type).lower()

        if not code and not desc:
            continue

        is_trade = explicit_type == "trade" or (not explicit_type and unit == "" and rate_str == "" and heading_ref == "")
        is_heading = explicit_type in ("heading", "subheading") or (
            not explicit_type and unit == "" and rate_str == "" and heading_ref != ""
        )

        if is_trade:
            tid = f"tr-xlsx-{idx}"
            rows.append(
                {
                    "id": tid,
                    "parentId": None,
                    "rowType": "Trade",
                    "code": code or f"{len(rows) + 1:02d}",
                    "refCode": code or f"{len(rows) + 1:02d}",
                    "description": desc or code or f"TRADE {idx + 1}",
                    "quantity": 0,
                    "unit": "",
                    "factor": 1,
                    "rate": 0,
                    "markupPct": 0,
                    "pricingMode": "INCL",
                    "groupingCode": "",
                    "calcRows": [],
                    "rateRows": [],
                }
            )
            if code:
                container_by_code[code.upper()] = tid
            current_trade_id = tid
            current_heading_id = None
            continue

        if is_heading:
            parent_tid = container_by_code.get(heading_ref.upper()) if heading_ref else None
            if not parent_tid:
                parent_tid = _ensure_default_trade()
            hid = f"hd-xlsx-{idx}"
            rows.append(
                {
                    "id": hid,
                    "parentId": parent_tid,
                    "rowType": "Subheading" if explicit_type == "subheading" else "Heading",
                    "code": code or f"H{idx + 1}",
                    "refCode": code or f"H{idx + 1}",
                    "description": desc or code or f"Heading {idx + 1}",
                    "quantity": 0,
                    "unit": "",
                    "factor": 1,
                    "rate": 0,
                    "markupPct": 0,
                    "pricingMode": "INCL",
                    "groupingCode": "",
                    "calcRows": [],
                    "rateRows": [],
                }
            )
            if code:
                container_by_code[code.upper()] = hid
            current_heading_id = hid
            continue

        # Item row
        parent_id: str | None = None
        if heading_ref:
            key = heading_ref.upper()
            parent_id = container_by_code.get(key)
            if not parent_id:
                trade_id = _ensure_default_trade()
                hid = f"hd-auto-{len(rows)}-{idx}"
                rows.append(
                    {
                        "id": hid,
                        "parentId": trade_id,
                        "rowType": "Heading",
                        "code": heading_ref,
                        "refCode": heading_ref,
                        "description": f"Section {heading_ref}",
                        "quantity": 0,
                        "unit": "",
                        "factor": 1,
                        "rate": 0,
                        "markupPct": 0,
                        "pricingMode": "INCL",
                        "groupingCode": "",
                        "calcRows": [],
                        "rateRows": [],
                    }
                )
                container_by_code[key] = hid
                parent_id = hid
                current_heading_id = hid
        else:
            parent_id = current_heading_id or _ensure_default_trade()

        unit_val = unit or "ea"
        rate_val = _safe_float(rate_str.replace("$", "").replace(",", ""), 0.0)
        markup_val = _safe_float(markup_str.replace("%", ""), 0.0)
        item_code = code or f"P{idx + 1}"
        rows.append(
            {
                "id": f"it-xlsx-{idx}",
                "parentId": parent_id,
                "rowType": "Item",
                "code": item_code,
                "refCode": item_code,
                "description": desc or item_code,
                "resultType": "Count" if unit_val.lower() in ("ea", "no", "item") else "Area",
                "quantity": 0,
                "unit": unit_val,
                "conversion": 1,
                "numberMultiplier": 1,
                "factor": 1,
                "wastagePct": 0,
                "rate": rate_val,
                "markupPct": markup_val,
                "pricingMode": "INCL",
                "groupingCode": heading_ref or "",
                "calcRows": [],
                "rateRows": [],
            }
        )

    return _normalize_imported_job(
        {
            "name": filename.rsplit(".", 1)[0],
            "kind": "PriceList",
            "useAsTemplate": True,
            "rows": rows,
        },
        filename,
        kind_override="PriceList",
    )



def import_costx_estimate(filename: str, raw_bytes: bytes) -> dict[str, Any]:
    """Import a tabular CostX estimate or dimension-group summary as saved values."""
    def find_table(sheets: Iterable[Iterator[Sequence[Any]]]):
        for sheet in sheets:
            for row_number, row in enumerate(sheet, 1):
                headers = {_norm_header(value): index for index, value in enumerate(row)}
                description = next((headers[key] for key in ("description", "itemdescription", "dimensiongroup") if key in headers), None)
                quantity = next((headers[key] for key in ("quantity", "qty") if key in headers), None)
                if description is not None and quantity is not None:
                    return sheet, row_number, headers, description, quantity
        raise ValueError("An estimate table must contain Description (or Dimension Group) and Quantity columns.")

    def number(value: str, row_number: int, field: str, default: float = 0.0) -> float:
        if not value:
            return default
        cleaned = value.replace(",", "").removeprefix("AUD").strip().removeprefix("$").strip()
        if cleaned.startswith("(") and cleaned.endswith(")"):
            cleaned = "-" + cleaned[1:-1].removeprefix("$")
        try:
            result = float(cleaned)
            if isfinite(result):
                return result
        except ValueError:
            pass
        raise ValueError(f"Row {row_number} has an invalid {field}: {value!r}.")

    def read(sheets: Iterable[Iterator[Sequence[Any]]]) -> list[dict[str, Any]]:
        table, start, headers, description, quantity = find_table(sheets)

        def column(*names: str) -> int | None:
            return next((headers[name] for name in names if name in headers), None)

        code = column("code", "itemcode", "refcode", "reference")
        group = column("trade", "section", "folder", "rategroup")
        unit = column("unit", "uom", "unitofmeasure")
        rate = column("rate", "unitrate", "price")
        factor = column("factor")
        row_type = column("type", "rowtype")
        trades: dict[str, list[dict[str, Any]]] = {}
        for row_number, row in enumerate(table, start + 1):
            def cell(index: int | None) -> str:
                return "" if index is None or index >= len(row) or row[index] is None else str(row[index]).strip()

            name, qty, unit_rate, units = cell(description), cell(quantity), cell(rate), cell(unit)
            if not name:
                continue
            kind = cell(row_type).casefold()
            if kind in ("total", "subtotal") or name.casefold() in ("total", "grand total", "subtotal", "sub-total"):
                continue
            trade = cell(group) or "Imported Estimate"
            if not qty and not unit_rate and not units:
                continue
            if trade not in trades:
                index = len(trades) + 1
                trades[trade] = [{
                    "id": f"tr-costx-{index}", "parentId": None, "rowType": "Trade", "code": f"{index:02d}",
                    "description": trade, "quantity": 0, "unit": "", "factor": 1,
                    "rate": 0, "markupPct": 0, "pricingMode": "INCL", "calcRows": [], "rateRows": [],
                }]
            item_code = cell(code) or f"I{row_number}"
            result = {
                "m": "Length", "lm": "Length", "m2": "Area", "m²": "Area", "m3": "Volume", "m³": "Volume",
            }.get(units.casefold(), "Count")
            trades[trade].append({
                "id": f"it-costx-{row_number}", "parentId": trades[trade][0]["id"], "rowType": "Item",
                "code": item_code, "refCode": item_code, "description": name,
                "resultType": result, "quantity": number(qty, row_number, "quantity"), "unit": units,
                "conversion": 1, "numberMultiplier": 1, "factor": number(cell(factor), row_number, "factor", 1),
                "wastagePct": 0, "rate": number(unit_rate, row_number, "rate"), "markupPct": 0,
                "pricingMode": "INCL", "calcRows": [], "rateRows": [],
            })
        if not trades:
            raise ValueError("No estimate or dimension rows were found.")
        return [row for trade_rows in trades.values() for row in trade_rows]

    suffix = filename.lower().rsplit(".", 1)[-1]
    if suffix == "xlsx":
        import openpyxl

        book = openpyxl.load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
        try:
            sheets = [book.active, *(sheet for sheet in book.worksheets if sheet != book.active)]
            rows = read(sheet.iter_rows(values_only=True) for sheet in sheets)
        finally:
            book.close()
    elif suffix == "csv":
        rows = read([csv.reader(io.StringIO(raw_bytes.decode("utf-8-sig")))])
    else:
        raise ValueError("Use a CostX Excel (.xlsx) or CSV export.")
    return _normalize_imported_job({"rows": rows, "markupPct": 0, "salesTaxPct": 0}, filename, "Job")

