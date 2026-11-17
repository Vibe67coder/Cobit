"""SQLite transactional storage + DuckDB analytical BOQ rollup engine for CobitX."""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import duckdb


def resolve_data_dir() -> Path:
    custom = os.environ.get("COBITX_DATA_DIR")
    base = Path(custom) if custom else Path.home() / ".cobitx"
    base.mkdir(parents=True, exist_ok=True)
    return base


class CobitXStorage:
    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = data_dir or resolve_data_dir()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.sqlite_path = self.data_dir / "cobitx.db"
        self.duckdb_path = self.data_dir / "analytics.duckdb"
        self._init_sqlite()
        self._init_duckdb()

    def _connect_sqlite(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.sqlite_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_sqlite(self) -> None:
        with self._connect_sqlite() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS workspace_kv (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS jobs_index (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    name TEXT NOT NULL,
                    project_id TEXT,
                    status TEXT NOT NULL,
                    markup_pct REAL NOT NULL,
                    sales_tax_pct REAL NOT NULL,
                    updated_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS openings_library (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    name TEXT NOT NULL,
                    width_mm REAL NOT NULL,
                    height_mm REAL NOT NULL,
                    offset_mm REAL NOT NULL DEFAULT 0,
                    deduct_area INTEGER NOT NULL DEFAULT 1
                );

                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts TEXT NOT NULL,
                    action TEXT NOT NULL,
                    detail TEXT NOT NULL
                );
                """
            )
            # Seed default Openings Library if empty
            existing = conn.execute("SELECT COUNT(*) AS cnt FROM openings_library").fetchone()["cnt"]
            if existing == 0:
                defaults = [
                    ("op-d820", "Door", "Single Timber Door 820x2040", 820, 2040, 0, 1),
                    ("op-d920", "Door", "Accessible Entry Door 920x2040", 920, 2040, 0, 1),
                    ("op-d1800", "Door", "Double Entry Glazed Door 1800x2100", 1800, 2100, 0, 1),
                    ("op-w1200", "Window", "Aluminium Sliding Window 1200x1200", 1200, 1200, 900, 1),
                    ("op-w2400", "Window", "Commercial Curtain Glazing 2400x1800", 2400, 1800, 600, 1),
                ]
                conn.executemany(
                    "INSERT INTO openings_library (id, kind, name, width_mm, height_mm, offset_mm, deduct_area) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    defaults,
                )

    def _init_duckdb(self) -> None:
        con = duckdb.connect(str(self.duckdb_path))
        try:
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS estimate_items (
                    job_id VARCHAR,
                    job_name VARCHAR,
                    job_kind VARCHAR,
                    row_id VARCHAR,
                    parent_id VARCHAR,
                    row_type VARCHAR,
                    code VARCHAR,
                    ref_code VARCHAR,
                    description VARCHAR,
                    result_type VARCHAR,
                    quantity DOUBLE,
                    unit VARCHAR,
                    conversion DOUBLE,
                    number_multiplier DOUBLE,
                    factor DOUBLE,
                    wastage_pct DOUBLE,
                    rate DOUBLE,
                    markup_pct DOUBLE,
                    pricing_mode VARCHAR,
                    grouping_code VARCHAR,
                    exclude_from_total BOOLEAN,
                    exclude_from_tax BOOLEAN,
                    cost_total DOUBLE,
                    sell_total DOUBLE
                )
                """
            )
        finally:
            con.close()

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def load_state(self) -> dict[str, Any] | None:
        with self._connect_sqlite() as conn:
            row = conn.execute(
                "SELECT value_json, updated_at FROM workspace_kv WHERE key = 'workspace_state'"
            ).fetchone()
            if not row:
                return None
            data = json.loads(row["value_json"])
            data["_persistedAt"] = row["updated_at"]
            return data

    def mcp_enabled(self) -> bool:
        with self._connect_sqlite() as conn:
            row = conn.execute(
                "SELECT json_extract(value_json, '$.options.mcpServerEnabled') AS enabled "
                "FROM workspace_kv WHERE key = 'workspace_state'"
            ).fetchone()
        return row is None or row["enabled"] is None or bool(row["enabled"])

    def save_state(self, state: dict[str, Any]) -> dict[str, Any]:
        ts = self._now_iso()
        clean = {k: v for k, v in state.items() if not k.startswith("_")}
        jobs = clean.get("jobs", [])

        with self._connect_sqlite() as conn:
            conn.execute(
                """
                INSERT INTO workspace_kv (key, value_json, updated_at)
                VALUES ('workspace_state', ?, ?)
                ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
                """,
                (json.dumps(clean), ts),
            )
            conn.execute("DELETE FROM jobs_index")
            for j in jobs:
                conn.execute(
                    """
                    INSERT INTO jobs_index (id, kind, name, project_id, status, markup_pct, sales_tax_pct, updated_at, payload_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        j.get("id", ""),
                        j.get("kind", "Job"),
                        j.get("name", "Untitled"),
                        j.get("projectId"),
                        j.get("status", "Open"),
                        float(j.get("markupPct", 10)),
                        float(j.get("salesTaxPct", 10)),
                        ts,
                        json.dumps(j),
                    ),
                )
            conn.execute(
                "INSERT INTO audit_log (ts, action, detail) VALUES (?, 'SAVE_STATE', ?)",
                (ts, f"Saved {len(jobs)} jobs/price lists"),
            )

        self._sync_duckdb(jobs)
        return {"ok": True, "updatedAt": ts, "jobCount": len(jobs)}

    def _sync_duckdb(self, jobs: list[dict[str, Any]]) -> None:
        con = duckdb.connect(str(self.duckdb_path))
        try:
            con.execute("DELETE FROM estimate_items")
            batch: list[tuple[Any, ...]] = []
            for j in jobs:
                jid = j.get("id", "")
                jname = j.get("name", "")
                jkind = j.get("kind", "Job")
                for r in j.get("rows", []):
                    qty = float(r.get("quantity", 0) or 0)
                    conv = float(r.get("conversion", 1) or 1)
                    num_mult = float(r.get("numberMultiplier", 1) or 1)
                    factor = float(r.get("factor", 1) or 1)
                    wastage = float(r.get("wastagePct", 0) or 0)
                    rate = float(r.get("rate", 0) or 0)
                    markup_pct = float(r.get("markupPct", 0) or 0)
                    excl_total = bool(r.get("excludeFromTotal", False))
                    excl_tax = bool(r.get("excludeFromTax", False))
                    pm = r.get("pricingMode", "INCL")
                    rt = r.get("resultType") or ""
                    eff_qty = qty * conv * num_mult * factor * (1.0 + wastage / 100.0)
                    is_incl = (
                        r.get("rowType") == "Item"
                        and pm == "INCL"
                        and not excl_total
                        and rt not in ("Note", "Exclude from total")
                    )
                    cost_total = eff_qty * rate if is_incl else 0.0
                    sell_total = cost_total * (1.0 + markup_pct / 100.0)
                    batch.append(
                        (
                            jid,
                            jname,
                            jkind,
                            r.get("id", ""),
                            r.get("parentId"),
                            r.get("rowType", "Item"),
                            r.get("code", ""),
                            r.get("refCode", ""),
                            r.get("description", ""),
                            rt,
                            qty,
                            r.get("unit", ""),
                            conv,
                            num_mult,
                            factor,
                            wastage,
                            rate,
                            markup_pct,
                            pm,
                            r.get("groupingCode", ""),
                            excl_total,
                            excl_tax,
                            round(cost_total, 4),
                            round(sell_total, 4),
                        )
                    )
            if batch:
                con.executemany(
                    """
                    INSERT INTO estimate_items VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                    )
                    """,
                    batch,
                )
        finally:
            con.close()

    def compute_boq_analytics(self, job_id: str) -> dict[str, Any]:
        con = duckdb.connect(str(self.duckdb_path))
        try:
            totals_row = con.execute(
                """
                SELECT
                    COUNT(*) FILTER (WHERE row_type = 'Item') AS item_count,
                    COALESCE(SUM(cost_total), 0) AS total_cost,
                    COALESCE(SUM(sell_total), 0) AS total_sell,
                    COALESCE(SUM(sell_total - cost_total), 0) AS item_markup
                FROM estimate_items
                WHERE job_id = ?
                """,
                [job_id],
            ).fetchone()

            group_rows = con.execute(
                """
                SELECT
                    CASE WHEN COALESCE(grouping_code, '') = '' THEN 'UNASSIGNED' ELSE grouping_code END AS group_code,
                    COUNT(*) AS item_count,
                    ROUND(COALESCE(SUM(cost_total), 0), 2) AS cost_total,
                    ROUND(COALESCE(SUM(sell_total), 0), 2) AS sell_total
                FROM estimate_items
                WHERE job_id = ? AND row_type = 'Item'
                GROUP BY 1
                ORDER BY sell_total DESC
                """,
                [job_id],
            ).fetchall()

            return {
                "jobId": job_id,
                "itemCount": int(totals_row[0] or 0),
                "totalCost": round(float(totals_row[1] or 0), 2),
                "totalSell": round(float(totals_row[2] or 0), 2),
                "itemMarkup": round(float(totals_row[3] or 0), 2),
                "byGroupingCode": [
                    {
                        "code": r[0],
                        "itemCount": int(r[1]),
                        "costTotal": float(r[2]),
                        "sellTotal": float(r[3]),
                    }
                    for r in group_rows
                ],
            }
        finally:
            con.close()

    def run_sql_query(self, sql: str) -> dict[str, Any]:
        clean = sql.strip()
        if not clean.lower().startswith("select"):
            raise ValueError("Only read-only SELECT queries are permitted via DuckDB SQL analytics tool.")
        con = duckdb.connect(str(self.duckdb_path), read_only=True)
        try:
            statements = con.extract_statements(clean)
            if len(statements) != 1 or statements[0].type != duckdb.StatementType.SELECT:
                raise ValueError("Submit a single SELECT query.")
            con.execute("SET enable_external_access = false")
            rel = con.execute(clean)
            cols = [d[0] for d in (rel.description or [])]
            rows = rel.fetchmany(200)
            return {
                "columns": cols,
                "rows": [list(r) for r in rows],
                "rowCount": len(rows),
            }
        finally:
            con.close()

    def list_openings_library(self) -> list[dict[str, Any]]:
        with self._connect_sqlite() as conn:
            rows = conn.execute("SELECT * FROM openings_library ORDER BY kind, width_mm").fetchall()
            return [
                {
                    "id": r["id"],
                    "kind": r["kind"],
                    "name": r["name"],
                    "widthMm": r["width_mm"],
                    "heightMm": r["height_mm"],
                    "offsetMm": r["offset_mm"],
                    "deductArea": bool(r["deduct_area"]),
                }
                for r in rows
            ]

    def propagate_price_list(
        self,
        target_job_id: str,
        source_pricelist_id: str,
        codes: list[str] | None = None,
    ) -> dict[str, Any]:
        state = self.load_state()
        if not state:
            raise ValueError("Workspace state not initialized in SQLite yet.")
        jobs = state.get("jobs", [])
        target = next((j for j in jobs if j.get("id") == target_job_id), None)
        source = next((j for j in jobs if j.get("id") == source_pricelist_id), None)
        if not target or not source:
            raise ValueError("Target job or source Price List not found.")

        src_by_code = {
            (r.get("code") or "").strip().upper(): r
            for r in source.get("rows", [])
            if r.get("rowType") == "Item" and r.get("code")
        }
        filter_set = {c.strip().upper() for c in codes} if codes else None

        updated_rows = []
        for r in target.get("rows", []):
            code_key = (r.get("code") or "").strip().upper()
            if r.get("rowType") == "Item" and code_key in src_by_code:
                if filter_set is None or code_key in filter_set:
                    src = src_by_code[code_key]
                    r = {
                        **r,
                        "rate": src.get("rate", r.get("rate", 0)),
                        "rateRows": src.get("rateRows", r.get("rateRows", [])),
                    }
                    updated_rows.append({"rowId": r.get("id"), "code": r.get("code"), "newRate": r["rate"]})
            # Persist change in target list
        # Apply in-place into target['rows']
        new_target_rows = []
        for r in target.get("rows", []):
            code_key = (r.get("code") or "").strip().upper()
            if (
                r.get("rowType") == "Item"
                and code_key in src_by_code
                and (filter_set is None or code_key in filter_set)
            ):
                src = src_by_code[code_key]
                new_target_rows.append(
                    {
                        **r,
                        "rate": src.get("rate", r.get("rate", 0)),
                        "rateRows": src.get("rateRows", r.get("rateRows", [])),
                    }
                )
            else:
                new_target_rows.append(r)
        target["rows"] = new_target_rows
        target["lastUpdated"] = datetime.now().strftime("%Y-%m-%d %H:%M")
        self.save_state(state)
        return {
            "targetJobId": target_job_id,
            "sourcePriceListId": source_pricelist_id,
            "updatedCount": len(updated_rows),
            "updatedItems": updated_rows,
            "state": state,
        }
