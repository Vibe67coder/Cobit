"""ISO-10303-21 STEP IFC BIM parser and sample generator for CobitX BIM Takeoff."""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

ENTITY_RE = re.compile(r"#(\d+)\s*=\s*([A-Z0-9_]+)\s*\((.*)\)\s*;")

IFC_PALETTE: dict[str, str] = {
    "IfcSlab": "#64748b",
    "IfcWall": "#2563eb",
    "IfcWallStandardCase": "#2563eb",
    "IfcColumn": "#dc2626",
    "IfcBeam": "#ea580c",
    "IfcDoor": "#b45309",
    "IfcWindow": "#0891b2",
    "IfcRoof": "#7c3aed",
    "IfcStair": "#0d9488",
    "IfcSpace": "#16a34a",
}

DEFAULT_RESULT_MAPPING: dict[str, tuple[str, str]] = {
    "IfcSlab": ("Area", "m²"),
    "IfcWall": ("Vertical Area Less Openings", "m²"),
    "IfcWallStandardCase": ("Vertical Area Less Openings", "m²"),
    "IfcColumn": ("Volume", "m³"),
    "IfcBeam": ("Length", "m"),
    "IfcDoor": ("Door Counts", "No."),
    "IfcWindow": ("Window Counts", "No."),
    "IfcRoof": ("Area", "m²"),
    "IfcStair": ("Count", "No."),
    "IfcSpace": ("Area", "m²"),
}

TARGET_IFC_CLASSES = {
    "IFCSLAB": "IfcSlab",
    "IFCWALL": "IfcWall",
    "IFCWALLSTANDARDCASE": "IfcWallStandardCase",
    "IFCCOLUMN": "IfcColumn",
    "IFCBEAM": "IfcBeam",
    "IFCDOOR": "IfcDoor",
    "IFCWINDOW": "IfcWindow",
    "IFCROOF": "IfcRoof",
    "IFCSTAIR": "IfcStair",
    "IFCSPACE": "IfcSpace",
}


def _split_step_args(arg_str: str) -> list[str]:
    args: list[str] = []
    cur: list[str] = []
    depth = 0
    in_str = False
    i = 0
    while i < len(arg_str):
        ch = arg_str[i]
        if ch == "'":
            in_str = not in_str
            cur.append(ch)
        elif not in_str:
            if ch == "(":
                depth += 1
                cur.append(ch)
            elif ch == ")":
                depth = max(0, depth - 1)
                cur.append(ch)
            elif ch == "," and depth == 0:
                args.append("".join(cur).strip())
                cur = []
            else:
                cur.append(ch)
        else:
            cur.append(ch)
        i += 1
    if cur:
        args.append("".join(cur).strip())
    return args


def _unquote(val: str) -> str:
    val = val.strip()
    if val == "$" or val == "*":
        return ""
    if val.startswith("'") and val.endswith("'"):
        return val[1:-1]
    return val


def _parse_ref(token: str) -> int | None:
    token = token.strip()
    if token.startswith("#"):
        try:
            return int(token[1:])
        except ValueError:
            return None
    return None


def _parse_ref_list(token: str) -> list[int]:
    return [int(m) for m in re.findall(r"#(\d+)", token)]


def _parse_float_tuple(token: str) -> list[float]:
    return [float(x) for x in re.findall(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", token)]


def _parse_float(token: str, default: float = 0.0) -> float:
    token = token.strip()
    if not token or token in ("$", "*"):
        return default
    try:
        return float(token)
    except ValueError:
        return default


def process_ifc_bytes(filename: str, raw_bytes: bytes) -> dict[str, Any]:
    """Parse an ISO-10303-21 STEP .ifc file into storeys, 3D geometries, quantities, and mapping defaults."""
    text = raw_bytes.decode("utf-8", errors="ignore")
    # Collapse multi-line STEP records cleanly
    cleaned_lines: list[str] = []
    for line in text.splitlines():
        s = line.strip()
        if s and not s.startswith("/*"):
            cleaned_lines.append(s)
    joined = " ".join(cleaned_lines)

    entities: dict[int, tuple[str, list[str]]] = {}
    for stmt in joined.split(";"):
        stmt = stmt.strip()
        if not stmt.startswith("#"):
            continue
        m = ENTITY_RE.match(stmt + ";")
        if m:
            eid = int(m.group(1))
            etype = m.group(2).upper()
            args = _split_step_args(m.group(3))
            entities[eid] = (etype, args)

    def resolve_point(eid: int | None) -> tuple[float, float, float]:
        if not eid or eid not in entities:
            return (0.0, 0.0, 0.0)
        et, args = entities[eid]
        if et == "IFCCARTESIANPOINT" and args:
            coords = _parse_float_tuple(args[0])
            x = coords[0] if len(coords) > 0 else 0.0
            y = coords[1] if len(coords) > 1 else 0.0
            z = coords[2] if len(coords) > 2 else 0.0
            return (x, y, z)
        return (0.0, 0.0, 0.0)

    def resolve_direction(eid: int | None) -> tuple[float, float, float]:
        if not eid or eid not in entities:
            return (1.0, 0.0, 0.0)
        et, args = entities[eid]
        if et == "IFCDIRECTION" and args:
            coords = _parse_float_tuple(args[0])
            x = coords[0] if len(coords) > 0 else 1.0
            y = coords[1] if len(coords) > 1 else 0.0
            z = coords[2] if len(coords) > 2 else 0.0
            return (x, y, z)
        return (1.0, 0.0, 0.0)

    def resolve_placement(eid: int | None, depth_guard: int = 0) -> tuple[float, float, float, float]:
        if not eid or eid not in entities or depth_guard > 8:
            return (0.0, 0.0, 0.0, 0.0)
        et, args = entities[eid]
        if et != "IFCLOCALPLACEMENT":
            return (0.0, 0.0, 0.0, 0.0)
        parent_ref = _parse_ref(args[0]) if len(args) > 0 else None
        rel_ref = _parse_ref(args[1]) if len(args) > 1 else None
        px, py, pz, prot = resolve_placement(parent_ref, depth_guard + 1)

        lx, ly, lz, lrot = 0.0, 0.0, 0.0, 0.0
        if rel_ref and rel_ref in entities:
            ret, rargs = entities[rel_ref]
            if ret in ("IFCAXIS2PLACEMENT3D", "IFCAXIS2PLACEMENT2D"):
                loc_ref = _parse_ref(rargs[0]) if len(rargs) > 0 else None
                lx, ly, lz = resolve_point(loc_ref)
                if ret == "IFCAXIS2PLACEMENT3D" and len(rargs) > 2:
                    dir_ref = _parse_ref(rargs[2])
                    dx, dy, _ = resolve_direction(dir_ref)
                    lrot = math.atan2(dy, dx) if (dx or dy) else 0.0
        # Rotate local offset by parent rotation
        rx = px + lx * math.cos(prot) - ly * math.sin(prot)
        ry = py + lx * math.sin(prot) + ly * math.cos(prot)
        return (rx, ry, pz + lz, prot + lrot)

    def resolve_extruded_dims(rep_eid: int | None) -> tuple[float, float, float]:
        """Extract (widthM, depthM, heightM) from IfcProductDefinitionShape -> IfcExtrudedAreaSolid."""
        if not rep_eid or rep_eid not in entities:
            return (0.0, 0.0, 0.0)
        et, args = entities[rep_eid]
        rep_ids = _parse_ref_list(args[2]) if et == "IFCPRODUCTDEFINITIONSHAPE" and len(args) > 2 else [rep_eid]
        for rid in rep_ids:
            if rid not in entities:
                continue
            rt, rargs = entities[rid]
            items = _parse_ref_list(rargs[3]) if rt == "IFCSHAPEREPRESENTATION" and len(rargs) > 3 else [rid]
            for item_id in items:
                if item_id not in entities:
                    continue
                it, iargs = entities[item_id]
                if it == "IFCEXTRUDEDAREASOLID":
                    prof_id = _parse_ref(iargs[0]) if len(iargs) > 0 else None
                    depth = _parse_float(iargs[3], 3.0) if len(iargs) > 3 else 3.0
                    # Handle mm units cleanly if values look > 50
                    if prof_id and prof_id in entities:
                        pt, pargs = entities[prof_id]
                        if pt == "IFCRECTANGLEPROFILEDEF":
                            xdim = _parse_float(pargs[3], 1.0) if len(pargs) > 3 else 1.0
                            ydim = _parse_float(pargs[4], 0.2) if len(pargs) > 4 else 0.2
                            return (xdim, ydim, depth)
                        if pt == "IFCCIRCLEPROFILEDEF":
                            rad = _parse_float(pargs[3], 0.2) if len(pargs) > 3 else 0.2
                            return (rad * 2.0, rad * 2.0, depth)
        return (0.0, 0.0, 0.0)

    # 1. Detect coordinate unit scale (mm -> m if IFCUNITASSIGNMENT specifies MILLI METRE)
    unit_scale = 1.0
    for _, (et, args) in entities.items():
        if et == "IFCSIUNIT" and len(args) >= 4:
            if "LENGTHUNIT" in args[1].upper() and "MILLI" in args[2].upper():
                unit_scale = 0.001
                break

    # 2. Parse storeys and spatial containment
    storey_names: dict[int, tuple[str, float]] = {}
    for eid, (et, args) in entities.items():
        if et == "IFCBUILDINGSTOREY":
            name = _unquote(args[2]) if len(args) > 2 else f"Level {len(storey_names)}"
            elev = _parse_float(args[9], 0.0) * unit_scale if len(args) > 9 else 0.0
            storey_names[eid] = (name or f"Level {len(storey_names)}", elev)

    elem_to_level: dict[int, str] = {}
    for _, (et, args) in entities.items():
        if et == "IFCRELCONTAINEDINSPATIALSTRUCTURE" and len(args) >= 6:
            related = _parse_ref_list(args[4])
            relating_id = _parse_ref(args[5])
            if relating_id and relating_id in storey_names:
                lvl = storey_names[relating_id][0]
                for rid in related:
                    elem_to_level[rid] = lvl

    # 3. Parse Element Quantities (IfcElementQuantity) attached via IfcRelDefinesByProperties
    elem_quantities: dict[int, dict[str, float]] = {}
    for _, (et, args) in entities.items():
        if et == "IFCRELDEFINESBYPROPERTIES" and len(args) >= 6:
            related = _parse_ref_list(args[4])
            prop_def_id = _parse_ref(args[5])
            if not prop_def_id or prop_def_id not in entities:
                continue
            p_et, p_args = entities[prop_def_id]
            if p_et == "IFCELEMENTQUANTITY" and len(p_args) >= 6:
                qty_ids = _parse_ref_list(p_args[5])
                qmap: dict[str, float] = {}
                for qid in qty_ids:
                    if qid not in entities:
                        continue
                    q_et, q_args = entities[qid]
                    q_name = _unquote(q_args[0]) if q_args else q_et
                    val = _parse_float(q_args[3], 0.0) if len(q_args) > 3 else 0.0
                    qmap[q_name] = val
                for rid in related:
                    elem_quantities.setdefault(rid, {}).update(qmap)

    # 4. Extract building elements
    elements: list[dict[str, Any]] = []
    class_stats: dict[str, dict[str, Any]] = {}

    for eid, (et, args) in entities.items():
        if et not in TARGET_IFC_CLASSES:
            continue
        ifc_class = TARGET_IFC_CLASSES[et]
        global_id = _unquote(args[0]) if len(args) > 0 else f"GID-{eid}"
        name = (_unquote(args[2]) if len(args) > 2 else "") or f"{ifc_class} #{eid}"
        place_id = _parse_ref(args[5]) if len(args) > 5 else None
        rep_id = _parse_ref(args[6]) if len(args) > 6 else None

        x, y, z, rot = resolve_placement(place_id)
        x_m, y_m, z_m = x * unit_scale, y * unit_scale, z * unit_scale

        w_raw, d_raw, h_raw = resolve_extruded_dims(rep_id)
        w_m = w_raw * unit_scale
        d_m = d_raw * unit_scale
        h_m = h_raw * unit_scale

        # Sensible BIM defaults if BRep omitted rectangle profile
        if w_m <= 0.01:
            w_m = 0.92 if ifc_class == "IfcDoor" else (1.5 if ifc_class == "IfcWindow" else (0.4 if ifc_class == "IfcColumn" else 4.0))
        if d_m <= 0.01:
            d_m = 0.12 if ifc_class in ("IfcDoor", "IfcWindow") else (0.4 if ifc_class == "IfcColumn" else (4.0 if ifc_class in ("IfcSlab", "IfcRoof", "IfcSpace") else 0.2))
        if h_m <= 0.01:
            h_m = 0.2 if ifc_class == "IfcSlab" else (2.04 if ifc_class == "IfcDoor" else (1.2 if ifc_class == "IfcWindow" else 2.8))

        qdict = elem_quantities.get(eid, {})
        length_m = qdict.get("Length") or max(w_m, d_m)
        if ifc_class in ("IfcWall", "IfcWallStandardCase"):
            area_m2 = qdict.get("NetSideArea") or qdict.get("GrossSideArea") or (length_m * h_m)
            volume_m3 = qdict.get("NetVolume") or qdict.get("GrossVolume") or (w_m * d_m * h_m)
        elif ifc_class in ("IfcSlab", "IfcRoof", "IfcSpace"):
            area_m2 = qdict.get("NetArea") or qdict.get("GrossArea") or qdict.get("NetFloorArea") or (w_m * d_m)
            volume_m3 = qdict.get("NetVolume") or qdict.get("GrossVolume") or (w_m * d_m * h_m)
        elif ifc_class in ("IfcDoor", "IfcWindow"):
            area_m2 = qdict.get("Area") or (w_m * h_m)
            volume_m3 = w_m * d_m * h_m
        else:
            area_m2 = qdict.get("CrossSectionArea") or (w_m * d_m)
            volume_m3 = qdict.get("NetVolume") or (w_m * d_m * h_m)

        level = elem_to_level.get(eid) or "Level 00"
        color = IFC_PALETTE.get(ifc_class, "#2563eb")
        elements.append(
            {
                "id": f"ifc-{eid}",
                "globalId": global_id,
                "ifcClass": ifc_class,
                "name": name,
                "level": level,
                "xM": round(x_m, 3),
                "yM": round(y_m, 3),
                "zM": round(z_m, 3),
                "widthM": round(w_m, 3),
                "depthM": round(d_m, 3),
                "heightM": round(h_m, 3),
                "rotationRad": round(rot, 4),
                "areaM2": round(area_m2, 3),
                "lengthM": round(length_m, 3),
                "volumeM3": round(volume_m3, 3),
                "color": color,
                "properties": qdict,
            }
        )

        st = class_stats.setdefault(
            ifc_class,
            {
                "ifcClass": ifc_class,
                "count": 0,
                "totalAreaM2": 0.0,
                "totalLengthM": 0.0,
                "totalVolumeM3": 0.0,
                "defaultResultType": DEFAULT_RESULT_MAPPING.get(ifc_class, ("Area", "m²"))[0],
                "defaultUnit": DEFAULT_RESULT_MAPPING.get(ifc_class, ("Area", "m²"))[1],
            },
        )
        st["count"] += 1
        st["totalAreaM2"] = round(st["totalAreaM2"] + area_m2, 2)
        st["totalLengthM"] = round(st["totalLengthM"] + length_m, 2)
        st["totalVolumeM3"] = round(st["totalVolumeM3"] + volume_m3, 2)

    levels = sorted({el["level"] for el in elements} or {"Level 00"})
    layers = [
        {"id": f"lay-ifc-{i}", "name": lv, "visible": True, "color": "#0d9488"}
        for i, lv in enumerate(levels)
    ]

    # Build orthographic 2D footprint vector paths mapped onto 840x560 sheet so 2D & 3D both work!
    if elements:
        xs = [el["xM"] for el in elements] + [el["xM"] + el["widthM"] for el in elements]
        ys = [el["yM"] for el in elements] + [el["yM"] + el["depthM"] for el in elements]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
    else:
        min_x, max_x, min_y, max_y = 0.0, 20.0, 0.0, 14.0

    span_x = max(1.0, max_x - min_x)
    span_y = max(1.0, max_y - min_y)
    scale_px = min(680.0 / span_x, 420.0 / span_y)

    vector_paths: list[dict[str, str]] = []
    snap_nodes: list[dict[str, float]] = []
    for el in elements[:500]:
        sx = 80.0 + (el["xM"] - min_x) * scale_px
        sy = 70.0 + (el["yM"] - min_y) * scale_px
        sw = max(3.0, el["widthM"] * scale_px)
        sd = max(3.0, el["depthM"] * scale_px)
        d = f"M {sx:.1f} {sy:.1f} L {sx + sw:.1f} {sy:.1f} L {sx + sw:.1f} {sy + sd:.1f} L {sx:.1f} {sy + sd:.1f} Z"
        vector_paths.append({"d": d, "stroke": el["color"], "layer": el["level"]})
        snap_nodes.append({"x": round(sx, 1), "y": round(sy, 1)})
        snap_nodes.append({"x": round(sx + sw, 1), "y": round(sy + sd, 1)})

    return {
        "name": Path(filename).stem,
        "originalFileName": filename,
        "kind": "IFC",
        "scaleLabel": f"BIM IFC ({round(scale_px, 1)} px/m)",
        "scaleRatio": round(scale_px, 2),
        "levels": levels,
        "layers": layers,
        "ifcElements": elements,
        "vectorPaths": vector_paths,
        "snapNodes": snap_nodes[:400],
        "classSummaries": sorted(class_stats.values(), key=lambda c: c["ifcClass"]),
    }


def generate_sample_office_ifc() -> bytes:
    """Create a realistic 2-storey IFC4 STEP model for one-click BIM testing."""
    lines = [
        "ISO-10303-21;",
        "HEADER;",
        "FILE_DESCRIPTION(('CobitX Sample BIM Office'),'2;1');",
        "FILE_NAME('CobitX_Office_BIM.ifc','2026-11-16T10:00:00',('Estimator'),('CobitX'),'','','');",
        "FILE_SCHEMA(('IFC4'));",
        "ENDSEC;",
        "DATA;",
        "#1=IFCDIR((1.,0.,0.));",
        "#10=IFCDIRECTION((1.,0.,0.));",
        "#11=IFCDIRECTION((0.,0.,1.));",
        "#12=IFCCARTESIANPOINT((0.,0.,0.));",
        "#20=IFCBUILDINGSTOREY('G-00',$,'Ground Floor',$,$,$,$,$,.ELEMENT.,0.0);",
        "#21=IFCBUILDINGSTOREY('L-01',$,'Level 01',$,$,$,$,$,.ELEMENT.,3.2);",
    ]
    next_id = 100
    storey_elements: dict[int, list[int]] = {20: [], 21: []}

    def add_box(
        ifc_type: str,
        gid: str,
        name: str,
        storey_ref: int,
        x: float,
        y: float,
        z: float,
        w: float,
        d: float,
        h: float,
        qty_type: str,
        qty_val: float,
    ) -> None:
        nonlocal next_id
        pt_id = next_id
        ax_id = next_id + 1
        lp_id = next_id + 2
        prof_id = next_id + 3
        ext_id = next_id + 4
        srep_id = next_id + 5
        prep_id = next_id + 6
        ent_id = next_id + 7
        qty_id = next_id + 8
        eq_id = next_id + 9
        relp_id = next_id + 10
        next_id += 11

        lines.append(f"#{pt_id}=IFCCARTESIANPOINT(({x},{y},{z}));")
        lines.append(f"#{ax_id}=IFCAXIS2PLACEMENT3D(#{pt_id},#11,#10);")
        lines.append(f"#{lp_id}=IFCLOCALPLACEMENT($,#{ax_id});")
        lines.append(f"#{prof_id}=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,{w},{d});")
        lines.append(f"#{ext_id}=IFCEXTRUDEDAREASOLID(#{prof_id},#{ax_id},#11,{h});")
        lines.append(f"#{srep_id}=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#{ext_id}));")
        lines.append(f"#{prep_id}=IFCPRODUCTDEFINITIONSHAPE($,$,(#{srep_id}));")
        lines.append(f"#{ent_id}={ifc_type}('{gid}',$,'{name}',$,$,#{lp_id},#{prep_id},$,$);")
        lines.append(f"#{qty_id}={qty_type}('NetArea',$,$,{qty_val});")
        lines.append(f"#{eq_id}=IFCELEMENTQUANTITY('EQ-{gid}',$,'BaseQuantities',$,$,(#{qty_id}));")
        lines.append(f"#{relp_id}=IFCRELDEFINESBYPROPERTIES('RP-{gid}',$,$,$,(#{ent_id}),#{eq_id});")
        storey_elements[storey_ref].append(ent_id)

    # Ground floor slab & walls & columns & doors/windows
    add_box("IFCSLAB", "SLAB-GF", "Ground Floor Slab 200mm", 20, 0.0, 0.0, 0.0, 18.0, 12.0, 0.2, "IFCQUANTITYAREA", 216.0)
    add_box("IFCWALL", "WALL-GF-N", "North Perimeter Precast Wall", 20, 0.0, 0.0, 0.2, 18.0, 0.25, 3.0, "IFCQUANTITYAREA", 54.0)
    add_box("IFCWALL", "WALL-GF-S", "South Perimeter Precast Wall", 20, 0.0, 11.75, 0.2, 18.0, 0.25, 3.0, "IFCQUANTITYAREA", 54.0)
    add_box("IFCWALL", "WALL-GF-W", "West Perimeter Wall", 20, 0.0, 0.25, 0.2, 0.25, 11.5, 3.0, "IFCQUANTITYAREA", 34.5)
    add_box("IFCWALL", "WALL-GF-E", "East Perimeter Wall", 20, 17.75, 0.25, 0.2, 0.25, 11.5, 3.0, "IFCQUANTITYAREA", 34.5)
    add_box("IFCWALL", "WALL-GF-INT", "Internal Fire Partition", 20, 9.0, 0.25, 0.2, 0.2, 11.5, 3.0, "IFCQUANTITYAREA", 34.5)
    add_box("IFCCOLUMN", "COL-GF-1", "Concrete Column C1", 20, 6.0, 6.0, 0.2, 0.45, 0.45, 3.0, "IFCQUANTITYVOLUME", 0.61)
    add_box("IFCCOLUMN", "COL-GF-2", "Concrete Column C2", 20, 12.0, 6.0, 0.2, 0.45, 0.45, 3.0, "IFCQUANTITYVOLUME", 0.61)
    add_box("IFCDOOR", "DOOR-GF-1", "Double Entry Glazed Door", 20, 8.2, 11.75, 0.2, 1.8, 0.15, 2.4, "IFCQUANTITYAREA", 4.32)
    add_box("IFCWINDOW", "WIN-GF-1", "North Facade Curtain Window", 20, 3.0, 0.0, 1.0, 4.5, 0.15, 1.6, "IFCQUANTITYAREA", 7.2)

    # Level 01 suspended slab, roof parapet & beams
    add_box("IFCSLAB", "SLAB-L1", "Level 01 Suspended Slab 180mm", 21, 0.0, 0.0, 3.2, 18.0, 12.0, 0.18, "IFCQUANTITYAREA", 216.0)
    add_box("IFCBEAM", "BEAM-L1-1", "Primary Steel Beam 410UB", 21, 0.0, 6.0, 2.9, 18.0, 0.25, 0.41, "IFCQUANTITYLENGTH", 18.0)
    add_box("IFCWALL", "WALL-L1-N", "Level 01 North Cladding Wall", 21, 0.0, 0.0, 3.38, 18.0, 0.2, 2.9, "IFCQUANTITYAREA", 52.2)
    add_box("IFCROOF", "ROOF-01", "Insulated Metal Roof Deck", 21, 0.0, 0.0, 6.28, 18.0, 12.0, 0.12, "IFCQUANTITYAREA", 216.0)

    for st_id, refs in storey_elements.items():
        ref_str = ",".join(f"#{r}" for r in refs)
        lines.append(f"#{next_id}=IFCRELCONTAINEDINSPATIALSTRUCTURE('RC-{st_id}',$,$,$,({ref_str}),#{st_id});")
        next_id += 1

    lines.extend(["ENDSEC;", "END-ISO-10303-21;"])
    return "\n".join(lines).encode("utf-8")
