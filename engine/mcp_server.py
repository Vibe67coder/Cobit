"""Real Model Context Protocol (MCP) server & client prober for CobitX."""

from __future__ import annotations

import re
import shutil
import time
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

import httpx
from mcp.server.mcpserver import MCPServer

from db.storage import CobitXStorage
from services.ai_takeoff import (
    ai_auto_area_segmentation,
    ai_auto_scale_and_rename,
    ai_count_symbols,
    ai_scan_text_labels,
)
from services.export_engine import _compute_eff_qty, _compute_row_rate, _compute_trade_totals, export_job_csv

_REF_TOKEN_RE = re.compile(r"@([A-Za-z0-9_-]+)")


def _compute_rate_sheet(components: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], float]:
    running_total = 0.0
    prev_total = 0.0
    computed_rows: list[dict[str, Any]] = []
    for idx, raw in enumerate(components):
        qty = float(raw.get("quantity") if raw.get("quantity") is not None else 1.0)
        rate = float(raw.get("rate") or 0.0)
        conv = float(raw.get("conversion") if raw.get("conversion") is not None else 1.0)
        fac = float(raw.get("factor") if raw.get("factor") is not None else 1.0)
        wastage_pct = float(raw.get("wastagePct") or 0.0)
        waste = 1.0 + wastage_pct / 100.0
        fn = raw.get("fn")
        if fn == "%":
            total = prev_total * (qty / 100.0) * (rate if rate > 0 else 1.0)
        elif fn == "+":
            denom = qty if qty != 0 else 1.0
            total = (rate * conv * fac * waste) / denom
        else:
            total = qty * rate * conv * fac * waste
        prev_total = total
        running_total += total
        row_obj: dict[str, Any] = {
            "id": str(raw.get("id") or f"rr-mcp-{int(time.time() * 1000)}-{idx}"),
            "code": str(raw.get("code") or f"C{idx + 1}"),
            "description": str(raw.get("description") or "Component"),
            "unit": str(raw.get("unit") or "ea"),
            "quantity": qty,
            "rate": rate,
            "conversion": conv,
            "factor": fac,
            "wastagePct": wastage_pct,
            "kind": str(raw.get("kind") or "Material"),
            "total": round(total, 4),
        }
        if fn in ("+", "%"):
            row_obj["fn"] = fn
        computed_rows.append(row_obj)
    return computed_rows, round(running_total, 4)


def _insert_estimate_row_impl(
    storage: CobitXStorage,
    job_id: str,
    parent_id: str | None = None,
    row_type: str = "Item",
    code: str = "",
    description: str = "New Estimate Row",
    unit: str = "m2",
    quantity: float = 0.0,
    rate: float = 0.0,
) -> dict[str, Any]:
    state = storage.load_state()
    if not state:
        raise ValueError("Workspace state not initialized in SQLite yet.")
    jobs = state.get("jobs", [])
    job = next((j for j in jobs if j.get("id") == job_id), None)
    if not job:
        raise ValueError(f"Job not found: {job_id}")

    valid_types = ("Trade", "Heading", "Subheading", "Item")
    clean_type = row_type if row_type in valid_types else "Item"
    rows = list(job.get("rows") or [])
    new_id = f"row-mcp-{int(time.time() * 1000)}-{len(rows)}"
    new_row: dict[str, Any] = {
        "id": new_id,
        "parentId": parent_id or None,
        "rowType": clean_type,
        "code": code or f"R{len(rows) + 1}",
        "refCode": code or f"R{len(rows) + 1}",
        "description": description or "New Estimate Row",
        "resultType": "Area" if clean_type == "Item" else None,
        "quantity": float(quantity or 0.0) if clean_type == "Item" else 0.0,
        "unit": (unit or "m2") if clean_type == "Item" else "",
        "conversion": 1,
        "numberMultiplier": 1,
        "factor": 1,
        "wastagePct": 0,
        "rate": float(rate or 0.0) if clean_type == "Item" else 0.0,
        "markupPct": 0,
        "pricingMode": "INCL",
        "groupingCode": "",
        "calcRows": [],
        "rateRows": [],
    }

    if parent_id:
        parent_idx = next((i for i, r in enumerate(rows) if r.get("id") == parent_id), -1)
        if parent_idx >= 0:
            descendants = {parent_id}
            insert_at = parent_idx + 1
            while insert_at < len(rows) and rows[insert_at].get("parentId") in descendants:
                descendants.add(rows[insert_at]["id"])
                insert_at += 1
            rows.insert(insert_at, new_row)
        else:
            rows.append(new_row)
    else:
        rows.append(new_row)

    job["rows"] = rows
    job["lastUpdated"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    storage.save_state(state)
    return new_row


def _update_rate_sheet_impl(
    storage: CobitXStorage,
    job_id: str,
    row_id: str,
    components: list[dict[str, Any]],
) -> dict[str, Any]:
    state = storage.load_state()
    if not state:
        raise ValueError("Workspace state not initialized in SQLite yet.")
    jobs = state.get("jobs", [])
    job = next((j for j in jobs if j.get("id") == job_id), None)
    if not job:
        raise ValueError(f"Job not found: {job_id}")

    rows = list(job.get("rows") or [])
    target_idx = next(
        (i for i, r in enumerate(rows) if r.get("id") == row_id or (r.get("code") and r.get("code") == row_id)),
        -1,
    )
    if target_idx < 0:
        raise ValueError(f"Estimate row not found: {row_id}")

    computed_rows, unit_rate = _compute_rate_sheet(components)
    rows[target_idx] = {
        **rows[target_idx],
        "rateRows": computed_rows,
        "rate": unit_rate,
    }
    job["rows"] = rows
    job["lastUpdated"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    storage.save_state(state)
    return {
        "jobId": job_id,
        "rowId": rows[target_idx]["id"],
        "code": rows[target_idx].get("code", ""),
        "unitRate": unit_rate,
        "componentCount": len(computed_rows),
        "rateRows": computed_rows,
    }


def _run_formula_audit_impl(storage: CobitXStorage, job_id: str) -> dict[str, Any]:
    state = storage.load_state()
    if not state:
        raise ValueError("Workspace state not initialized in SQLite yet.")
    job = next((j for j in state.get("jobs", []) if j.get("id") == job_id), None)
    if not job:
        raise ValueError(f"Job not found: {job_id}")

    rows = job.get("rows") or []
    ref_lookup: dict[str, str] = {}
    row_by_id: dict[str, dict[str, Any]] = {}
    for r in rows:
        rid = str(r.get("id") or "")
        row_by_id[rid] = r
        for key in (r.get("refCode"), r.get("code"), rid):
            if key:
                ref_lookup[str(key).strip().lower()] = rid

    issues: list[dict[str, Any]] = []
    deps: dict[str, set[str]] = {}
    audited_rows = 0

    for r in rows:
        rid = str(r.get("id") or "")
        formula = str(r.get("formula") or "").strip()
        rel = str(r.get("rel") or "").strip()
        if not formula and not rel:
            continue
        audited_rows += 1
        row_deps: set[str] = set()

        for field_name, expr in (("formula", formula), ("rel", rel)):
            if not expr:
                continue
            for token in _REF_TOKEN_RE.findall(expr):
                target_rid = ref_lookup.get(token.strip().lower())
                if not target_rid:
                    issues.append(
                        {
                            "rowId": rid,
                            "code": r.get("code", ""),
                            "field": field_name,
                            "issueType": "broken_ref",
                            "target": f"@{token}",
                            "detail": f"Reference @{token} does not match any row refCode, code, or id.",
                        }
                    )
                else:
                    row_deps.add(target_rid)

            if field_name == "formula" and expr.startswith("="):
                body = expr[1:].strip()
                stripped = re.sub(r"TSUM\([^)]*\)|SUM\([^)]*\)|@[A-Za-z0-9_-]+\.[A-Za-z]+|@[A-Za-z0-9_-]+", "1", body, flags=re.IGNORECASE)
                if stripped.count("(") != stripped.count(")"):
                    issues.append(
                        {
                            "rowId": rid,
                            "code": r.get("code", ""),
                            "field": "formula",
                            "issueType": "syntax_error",
                            "target": expr,
                            "detail": "Unbalanced parentheses in formula.",
                        }
                    )
                elif not re.match(r"^[0-9+\-*/().\s]+$", stripped):
                    issues.append(
                        {
                            "rowId": rid,
                            "code": r.get("code", ""),
                            "field": "formula",
                            "issueType": "syntax_error",
                            "target": expr,
                            "detail": "Formula contains unsupported tokens or malformed reference.",
                        }
                    )

        if row_deps:
            deps[rid] = row_deps

    # Cycle detection via DFS
    visiting: set[str] = set()
    visited: set[str] = set()
    reported_cycles: set[tuple[str, ...]] = set()

    def dfs(node: str, path: list[str]) -> None:
        if node in visiting:
            idx = path.index(node)
            cycle = tuple(path[idx:] + [node])
            canon = tuple(sorted(set(cycle)))
            if canon not in reported_cycles:
                reported_cycles.add(canon)
                r_obj = row_by_id.get(node, {})
                issues.append(
                    {
                        "rowId": node,
                        "code": r_obj.get("code", ""),
                        "field": "formula",
                        "issueType": "circular_ref",
                        "cycle": list(cycle),
                        "detail": f"Circular reference detected: {' -> '.join(cycle)}",
                    }
                )
            return
        if node in visited:
            return
        visiting.add(node)
        for nxt in deps.get(node, ()):
            dfs(nxt, path + [nxt])
        visiting.remove(node)
        visited.add(node)

    for start in list(deps.keys()):
        if start not in visited:
            dfs(start, [start])

    return {
        "jobId": job_id,
        "auditedRows": audited_rows,
        "issueCount": len(issues),
        "ok": len(issues) == 0,
        "issues": issues,
    }


def _trigger_ai_takeoff_impl(
    mode: str,
    plan_name: str = "",
    image_data_url: str | None = None,
    query_or_symbol: str = "",
) -> dict[str, Any]:
    norm = mode.strip().lower().replace("-", "_")
    if norm in ("auto_area", "area", "segmentation"):
        zones = ai_auto_area_segmentation(image_data_url)
        return {"mode": "auto_area", "count": len(zones), "zones": zones}
    if norm in ("count_symbols", "symbols", "symbol_count"):
        sym = query_or_symbol or "LED Downlight"
        markers = ai_count_symbols(sym, image_data_url)
        return {"mode": "count_symbols", "symbolKind": sym, "count": len(markers), "markers": markers}
    if norm in ("scan_text", "ocr", "text_scan"):
        matches = ai_scan_text_labels(query_or_symbol, plan_name, image_data_url)
        return {"mode": "scan_text", "query": query_or_symbol, "count": len(matches), "matches": matches}
    if norm in ("auto_scale", "scale", "auto_scale_rename"):
        res = ai_auto_scale_and_rename(plan_name or "Plan Sheet", plan_name, image_data_url)
        return {"mode": "auto_scale", **res}
    raise ValueError(f"Unsupported AI takeoff mode: {mode}")


def _export_boq_impl(storage: CobitXStorage, job_id: str, format_name: str = "summary_json") -> dict[str, Any]:
    state = storage.load_state()
    if not state:
        raise ValueError("Workspace state not initialized in SQLite yet.")
    job = next((j for j in state.get("jobs", []) if j.get("id") == job_id), None)
    if not job:
        raise ValueError(f"Job not found: {job_id}")

    fmt = (format_name or "summary_json").strip().lower()
    if fmt in ("csv", "livecosts", "xero"):
        csv_kind = "xero" if fmt == "xero" else "livecosts"
        return {
            "jobId": job_id,
            "format": fmt,
            "csv": export_job_csv(job, format_kind=csv_kind),
        }

    analytics = storage.compute_boq_analytics(job_id)
    rows = job.get("rows") or []
    totals = _compute_trade_totals(rows)
    items = []
    for r in rows:
        if r.get("rowType") == "Item":
            items.append(
                {
                    "id": r.get("id"),
                    "code": r.get("code", ""),
                    "description": r.get("description", ""),
                    "unit": r.get("unit", ""),
                    "effectiveQuantity": round(_compute_eff_qty(r), 4),
                    "rate": round(_compute_row_rate(r), 2),
                    "sellTotal": round(totals.get(r["id"], 0.0), 2),
                }
            )
    return {
        "jobId": job_id,
        "jobName": job.get("name", ""),
        "format": "summary_json",
        "analytics": analytics,
        "items": items,
    }


def build_mcp_server(storage: CobitXStorage) -> MCPServer:
    mcp = MCPServer("CobitX Estimating MCP Server")

    @mcp.tool()
    def cobitx_list_jobs(kind: str | None = None) -> list[dict[str, Any]]:
        """List all open construction Jobs and Price Lists stored in CobitX."""
        state = storage.load_state() or {}
        jobs = state.get("jobs", [])
        if kind:
            jobs = [j for j in jobs if j.get("kind") == kind]
        return [
            {
                "id": j.get("id"),
                "name": j.get("name"),
                "kind": j.get("kind"),
                "status": j.get("status"),
                "rowCount": len(j.get("rows", [])),
                "shapeCount": len(j.get("shapes", [])),
                "markupPct": j.get("markupPct"),
                "salesTaxPct": j.get("salesTaxPct"),
            }
            for j in jobs
        ]

    @mcp.tool()
    def cobitx_get_job_summary(job_id: str) -> dict[str, Any]:
        """Return DuckDB analytical summary (cost, sell, markup, grouping breakdown) for a Job."""
        return storage.compute_boq_analytics(job_id)

    @mcp.tool()
    def cobitx_search_cost_libraries(query: str) -> list[dict[str, Any]]:
        """Search items across all CobitX Price Lists / Cost Libraries by code or description."""
        state = storage.load_state() or {}
        q = query.strip().lower()
        hits: list[dict[str, Any]] = []
        for j in state.get("jobs", []):
            if j.get("kind") != "PriceList":
                continue
            for r in j.get("rows", []):
                if r.get("rowType") != "Item":
                    continue
                if (
                    q in str(r.get("code", "")).lower()
                    or q in str(r.get("description", "")).lower()
                ):
                    hits.append(
                        {
                            "priceListId": j.get("id"),
                            "priceListName": j.get("name"),
                            "code": r.get("code"),
                            "description": r.get("description"),
                            "unit": r.get("unit"),
                            "rate": r.get("rate"),
                            "rateComponents": len(r.get("rateRows", [])),
                        }
                    )
        return hits[:50]

    @mcp.tool()
    def cobitx_run_boq_sql(sql: str) -> dict[str, Any]:
        """Run a read-only SELECT SQL query on CobitX's DuckDB estimate_items table."""
        return storage.run_sql_query(sql)

    @mcp.tool()
    def cobitx_propagate_pricelist(
        target_job_id: str,
        source_pricelist_id: str,
        codes: list[str] | None = None,
    ) -> dict[str, Any]:
        """Update item rates in a Target Job from a Source Price List / Cost Library."""
        res = storage.propagate_price_list(target_job_id, source_pricelist_id, codes)
        return {
            "targetJobId": res["targetJobId"],
            "sourcePriceListId": res["sourcePriceListId"],
            "updatedCount": res["updatedCount"],
            "updatedItems": res["updatedItems"],
        }

    @mcp.tool()
    def cobitx_insert_estimate_row(
        job_id: str,
        parent_id: str | None = None,
        row_type: str = "Item",
        code: str = "",
        description: str = "New Estimate Row",
        unit: str = "m2",
        quantity: float = 0.0,
        rate: float = 0.0,
    ) -> dict[str, Any]:
        """Insert a Trade, Heading, Subheading, or Item row into an Estimate Job and persist to SQLite + DuckDB."""
        return _insert_estimate_row_impl(
            storage,
            job_id=job_id,
            parent_id=parent_id,
            row_type=row_type,
            code=code,
            description=description,
            unit=unit,
            quantity=quantity,
            rate=rate,
        )

    @mcp.tool()
    def cobitx_update_rate_sheet(
        job_id: str,
        row_id: str,
        components: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Replace composite rateRows on an Item, compute unit rate (incl. % and +), and persist."""
        return _update_rate_sheet_impl(storage, job_id=job_id, row_id=row_id, components=components)

    @mcp.tool()
    def cobitx_run_formula_audit(job_id: str) -> dict[str, Any]:
        """Audit formula and relational references in a Job for broken @RefCode targets, syntax errors, and cycles."""
        return _run_formula_audit_impl(storage, job_id=job_id)

    @mcp.tool()
    def cobitx_trigger_ai_takeoff(
        mode: str,
        plan_name: str = "",
        image_data_url: str | None = None,
        query_or_symbol: str = "",
    ) -> dict[str, Any]:
        """Trigger AI takeoff bots (auto_area, count_symbols, scan_text, auto_scale) via MCP."""
        return _trigger_ai_takeoff_impl(
            mode=mode,
            plan_name=plan_name,
            image_data_url=image_data_url,
            query_or_symbol=query_or_symbol,
        )

    @mcp.tool()
    def cobitx_export_boq(job_id: str, format: str = "summary_json") -> dict[str, Any]:
        """Export Job BOQ payload as 'csv' or 'summary_json' directly via MCP."""
        return _export_boq_impl(storage, job_id=job_id, format_name=format)

    @mcp.resource("cobitx://jobs")
    def resource_jobs() -> list[dict[str, Any]]:
        return cobitx_list_jobs()

    @mcp.resource("cobitx://openings")
    def resource_openings() -> list[dict[str, Any]]:
        return storage.list_openings_library()

    return mcp


def get_mcp_manifest() -> dict[str, Any]:
    return {
        "serverName": "CobitX Estimating MCP Server",
        "protocolVersion": "2024-11-05",
        "tools": [
            {
                "name": "cobitx_list_jobs",
                "description": "List all Jobs and Price Lists in CobitX SQLite storage.",
                "argsSchema": {"kind": "optional 'Job' | 'PriceList'"},
            },
            {
                "name": "cobitx_get_job_summary",
                "description": "DuckDB BOQ analytical breakdown by Cost, Sell, Markup & Grouping Code.",
                "argsSchema": {"job_id": "string"},
            },
            {
                "name": "cobitx_search_cost_libraries",
                "description": "Search items and datasheets across Cost Libraries / Price Lists.",
                "argsSchema": {"query": "string"},
            },
            {
                "name": "cobitx_run_boq_sql",
                "description": "Execute read-only DuckDB SQL SELECT query on estimate_items.",
                "argsSchema": {"sql": "SELECT ... FROM estimate_items"},
            },
            {
                "name": "cobitx_propagate_pricelist",
                "description": "Sync Price List rates into an open Estimate Job.",
                "argsSchema": {
                    "target_job_id": "string",
                    "source_pricelist_id": "string",
                    "codes": "optional list[str]",
                },
            },
            {
                "name": "cobitx_insert_estimate_row",
                "description": "Insert a Trade, Heading, Subheading, or Item row into a Job and sync SQLite + DuckDB.",
                "argsSchema": {
                    "job_id": "string",
                    "parent_id": "optional string",
                    "row_type": "'Trade' | 'Heading' | 'Subheading' | 'Item'",
                    "code": "string",
                    "description": "string",
                    "unit": "string",
                    "quantity": "number",
                    "rate": "number",
                },
            },
            {
                "name": "cobitx_update_rate_sheet",
                "description": "Update composite rateRows on an Item, compute unit rate (% and + supported), and persist.",
                "argsSchema": {
                    "job_id": "string",
                    "row_id": "string",
                    "components": "list[{code, description, unit, quantity, rate, fn?, kind?}]",
                },
            },
            {
                "name": "cobitx_run_formula_audit",
                "description": "Audit formula and rel references in a Job for broken @RefCode targets and circular dependencies.",
                "argsSchema": {"job_id": "string"},
            },
            {
                "name": "cobitx_trigger_ai_takeoff",
                "description": "Trigger AI takeoff bots (auto_area, count_symbols, scan_text, auto_scale).",
                "argsSchema": {
                    "mode": "'auto_area' | 'count_symbols' | 'scan_text' | 'auto_scale'",
                    "plan_name": "optional string",
                    "image_data_url": "optional data URL",
                    "query_or_symbol": "optional string",
                },
            },
            {
                "name": "cobitx_export_boq",
                "description": "Generate a CSV or structured summary_json BOQ export directly via MCP.",
                "argsSchema": {
                    "job_id": "string",
                    "format": "'csv' | 'summary_json'",
                },
            },
        ],
        "resources": [
            "cobitx://jobs",
            "cobitx://openings",
        ],
    }


def execute_mcp_tool(
    storage: CobitXStorage,
    tool_name: str,
    arguments: dict[str, Any] | None = None,
) -> dict[str, Any]:
    args = arguments or {}
    state = storage.load_state() or {}
    if tool_name == "cobitx_list_jobs":
        kind = args.get("kind")
        jobs = state.get("jobs", [])
        if kind:
            jobs = [j for j in jobs if j.get("kind") == kind]
        return {
            "tool": tool_name,
            "result": [
                {
                    "id": j.get("id"),
                    "name": j.get("name"),
                    "kind": j.get("kind"),
                    "status": j.get("status"),
                    "rows": len(j.get("rows", [])),
                }
                for j in jobs
            ],
        }
    if tool_name == "cobitx_get_job_summary":
        jid = str(args.get("job_id") or "job-1")
        return {"tool": tool_name, "result": storage.compute_boq_analytics(jid)}
    if tool_name == "cobitx_search_cost_libraries":
        q = str(args.get("query") or "").strip().lower()
        hits = []
        for j in state.get("jobs", []):
            if j.get("kind") != "PriceList":
                continue
            for r in j.get("rows", []):
                if r.get("rowType") != "Item":
                    continue
                if q in str(r.get("code", "")).lower() or q in str(r.get("description", "")).lower():
                    hits.append(
                        {
                            "priceList": j.get("name"),
                            "code": r.get("code"),
                            "description": r.get("description"),
                            "unit": r.get("unit"),
                            "rate": r.get("rate"),
                        }
                    )
        return {"tool": tool_name, "result": hits[:50]}
    if tool_name == "cobitx_run_boq_sql":
        sql = str(
            args.get("sql")
            or "SELECT job_id, COUNT(*) AS items, ROUND(SUM(sell_total),2) AS sell FROM estimate_items WHERE row_type='Item' GROUP BY job_id"
        )
        return {"tool": tool_name, "result": storage.run_sql_query(sql)}
    if tool_name == "cobitx_propagate_pricelist":
        res = storage.propagate_price_list(
            str(args.get("target_job_id", "")),
            str(args.get("source_pricelist_id", "")),
            args.get("codes"),
        )
        return {
            "tool": tool_name,
            "result": {
                "updatedCount": res["updatedCount"],
                "updatedItems": res["updatedItems"],
            },
        }
    if tool_name == "cobitx_insert_estimate_row":
        created = _insert_estimate_row_impl(
            storage,
            job_id=str(args.get("job_id") or "job-1"),
            parent_id=args.get("parent_id"),
            row_type=str(args.get("row_type") or "Item"),
            code=str(args.get("code") or ""),
            description=str(args.get("description") or "New Estimate Row"),
            unit=str(args.get("unit") or "m2"),
            quantity=float(args.get("quantity") or 0.0),
            rate=float(args.get("rate") or 0.0),
        )
        return {"tool": tool_name, "result": created}
    if tool_name == "cobitx_update_rate_sheet":
        comps = args.get("components")
        if not isinstance(comps, list):
            raise ValueError("components must be a list of rate row objects.")
        updated = _update_rate_sheet_impl(
            storage,
            job_id=str(args.get("job_id") or "job-1"),
            row_id=str(args.get("row_id") or ""),
            components=comps,
        )
        return {"tool": tool_name, "result": updated}
    if tool_name == "cobitx_run_formula_audit":
        audit = _run_formula_audit_impl(storage, job_id=str(args.get("job_id") or "job-1"))
        return {"tool": tool_name, "result": audit}
    if tool_name == "cobitx_trigger_ai_takeoff":
        res = _trigger_ai_takeoff_impl(
            mode=str(args.get("mode") or "auto_area"),
            plan_name=str(args.get("plan_name") or ""),
            image_data_url=args.get("image_data_url"),
            query_or_symbol=str(args.get("query_or_symbol") or ""),
        )
        return {"tool": tool_name, "result": res}
    if tool_name == "cobitx_export_boq":
        res = _export_boq_impl(
            storage,
            job_id=str(args.get("job_id") or "job-1"),
            format_name=str(args.get("format") or "summary_json"),
        )
        return {"tool": tool_name, "result": res}
    raise ValueError(f"Unknown CobitX MCP tool: {tool_name}")


def _is_loopback_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").strip("[]").lower()
    return host in ("127.0.0.1", "localhost", "::1") or host.startswith("127.")


async def probe_external_mcp(transport: str, endpoint_or_command: str) -> dict[str, Any]:
    t0 = time.perf_counter()
    if transport == "stdio":
        exe = endpoint_or_command.strip().split()[0] if endpoint_or_command.strip() else ""
        found = shutil.which(exe) if exe else None
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        return {
            "ok": bool(found),
            "status": "Ready" if found else "Disconnected",
            "latencyMs": latency_ms,
            "toolsCount": 0,
            "resourcesCount": 0,
            "detail": f"Executable resolved at {found}" if found else f"Command '{exe}' not found in PATH",
        }

    # HTTP / SSE MCP endpoint probe
    url = endpoint_or_command.strip()
    if not url.startswith(("http://", "https://")):
        return {
            "ok": False,
            "status": "Disconnected",
            "latencyMs": 0,
            "toolsCount": 0,
            "resourcesCount": 0,
            "detail": "Endpoint must start with http:// or https://",
        }
    use_env_proxy = not _is_loopback_url(url)
    try:
        async with httpx.AsyncClient(timeout=2.5, trust_env=use_env_proxy) as client:
            resp = await client.post(
                url,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "CobitX", "version": "15.1.0"},
                    },
                },
            )
            tools_count = 0
            resources_count = 0
            init_response = {}
            if resp.is_success:
                try:
                    payload = resp.json()
                    if isinstance(payload, dict) and payload.get("jsonrpc") == "2.0" and payload.get("id") == 1 and "error" not in payload:
                        init_response = payload.get("result") or {}
                except ValueError:
                    pass
            is_mcp = (
                isinstance(init_response, dict)
                and isinstance(init_response.get("protocolVersion"), str)
                and isinstance(init_response.get("capabilities"), dict)
            )
            if is_mcp:
                try:
                    t_resp = await client.post(
                        url,
                        json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
                    )
                    if t_resp.status_code < 400:
                        t_data = t_resp.json()
                        tools_list = (t_data.get("result") or {}).get("tools") or []
                        if isinstance(tools_list, list):
                            tools_count = len(tools_list)
                except Exception:
                    pass
                try:
                    r_resp = await client.post(
                        url,
                        json={"jsonrpc": "2.0", "id": 3, "method": "resources/list", "params": {}},
                    )
                    if r_resp.status_code < 400:
                        r_data = r_resp.json()
                        res_list = (r_data.get("result") or {}).get("resources") or []
                        if isinstance(res_list, list):
                            resources_count = len(res_list)
                except Exception:
                    pass

            latency_ms = round((time.perf_counter() - t0) * 1000, 1)
            return {
                "ok": is_mcp,
                "status": "Connected" if is_mcp else "Disconnected",
                "latencyMs": latency_ms,
                "toolsCount": tools_count,
                "resourcesCount": resources_count,
                "detail": (
                    f"MCP handshake verified ({tools_count} tools, {resources_count} resources)"
                    if is_mcp else f"HTTP {resp.status_code}: no valid MCP initialize response"
                ),
            }
    except Exception as exc:
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        return {
            "ok": False,
            "status": "Disconnected",
            "latencyMs": latency_ms,
            "toolsCount": 0,
            "resourcesCount": 0,
            "detail": str(exc),
        }
