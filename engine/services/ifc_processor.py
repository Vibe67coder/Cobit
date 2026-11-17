"""Decode IFC model geometry and construct a metre-based takeoff preview."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from math import dist
from pathlib import Path
from typing import Any

from shapely.geometry import MultiPoint

IFC_MAPPING = {
    "IfcSlab": ("Area", "m²", "#64748b"),
    "IfcWall": ("Vertical Area Less Openings", "m²", "#2563eb"),
    "IfcColumn": ("Volume", "m³", "#dc2626"),
    "IfcBeam": ("Length", "m", "#ea580c"),
    "IfcDoor": ("Door Counts", "No.", "#b45309"),
    "IfcWindow": ("Window Counts", "No.", "#0891b2"),
    "IfcRoof": ("Area", "m²", "#7c3aed"),
    "IfcStair": ("Count", "No.", "#0d9488"),
    "IfcFooting": ("Volume", "m³", "#64748b"),
    "IfcPile": ("Volume", "m³", "#78716c"),
    "IfcMember": ("Length", "m", "#64748b"),
    "IfcPlate": ("Area", "m²", "#64748b"),
}


def process_ifc_bytes(filename: str, raw_bytes: bytes) -> dict[str, Any]:
    if Path(filename).suffix.lower() != ".ifc":
        raise ValueError("Export the model to IFC in Revit, then select the .ifc file.")
    if not raw_bytes.lstrip(b"\xef\xbb\xbf \r\n\t").startswith(b"ISO-10303-21;"):
        raise ValueError("This file is not an IFC STEP model. Export a valid .ifc from the authoring application.")

    node = os.environ.get("COBITX_IFC_NODE") or shutil.which("node")
    script = os.environ.get("COBITX_IFC_SCRIPT") or str(Path(__file__).with_name("ifc_geometry.cjs"))
    if not node or not Path(script).is_file():
        raise ValueError("The IFC geometry reader is missing. Restart or reinstall the current CobitX build.")
    env = os.environ.copy()
    if env.get("COBITX_IFC_NODE"):
        env["ELECTRON_RUN_AS_NODE"] = "1"
    with tempfile.TemporaryDirectory(prefix="cobitx-ifc-") as folder:
        file = Path(folder) / "model.ifc"
        output = Path(folder) / "geometry.json"
        file.write_bytes(raw_bytes)
        result = subprocess.run(
            [node, script, str(file), str(output)], capture_output=True, check=False, timeout=180,
            env=env, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        if result.returncode or not output.is_file():
            raise ValueError(result.stderr.decode("utf-8", errors="replace").strip() or "IFC geometry conversion failed.")
        elements = json.loads(output.read_text(encoding="utf-8"))
    if not elements:
        raise ValueError("This IFC contains no renderable 3D body geometry. Re-export with model elements visible.")

    min_x = min(element["xM"] for element in elements)
    min_y = min(element["yM"] for element in elements)
    span_x = max(element["xM"] + element["widthM"] for element in elements) - min_x
    span_y = max(element["yM"] + element["depthM"] for element in elements) - min_y
    scale = min(680 / max(span_x, 0.01), 420 / max(span_y, 0.01))
    levels = sorted({element["level"] for element in elements})
    summaries: dict[str, dict[str, Any]] = {}
    paths = []
    snap_nodes = []

    for element in elements:
        ifc_class = element["ifcClass"]
        family = next((name for name in IFC_MAPPING if ifc_class.startswith(name)), ifc_class)
        result_type, unit, color = IFC_MAPPING.get(family, ("Exclude from total", "", "#64748b"))
        verts = element["vertices"]
        hull = MultiPoint(list(zip(verts[::3], verts[2::3]))).convex_hull
        if hull.geom_type == "Polygon":
            coords = list(hull.exterior.coords)[:-1]
            rectangle = list(hull.minimum_rotated_rectangle.exterior.coords)
            length = max(dist(rectangle[0], rectangle[1]), dist(rectangle[1], rectangle[2]))
        elif hull.geom_type == "LineString":
            coords = list(hull.coords)
            length = hull.length
        else:
            coords = []
            length = 0.0

        if family in ("IfcWall", "IfcDoor", "IfcWindow"):
            element["areaM2"] = element["sideAreaM2"]
        element["lengthM"] = length
        element["color"] = color
        element.pop("sideAreaM2")
        footprint = [{"x": round(80 + (x - min_x) * scale, 2), "y": round(70 + (y - min_y) * scale, 2)} for x, y in coords]
        element["footprint"] = footprint
        if len(footprint) >= 2:
            path = "M " + " L ".join(f'{point["x"]} {point["y"]}' for point in footprint)
            if len(footprint) > 2:
                path += " Z"
            paths.append({"d": path, "stroke": color, "layer": element["level"]})
            snap_nodes.extend(footprint)

        summary = summaries.setdefault(ifc_class, {
            "ifcClass": ifc_class, "count": 0, "totalAreaM2": 0.0, "totalLengthM": 0.0,
            "totalVolumeM3": 0.0, "defaultResultType": result_type, "defaultUnit": unit,
        })
        summary["count"] += 1
        for key, source in (("totalAreaM2", "areaM2"), ("totalLengthM", "lengthM"), ("totalVolumeM3", "volumeM3")):
            summary[key] += element[source]

    return {
        "name": Path(filename).stem, "originalFileName": filename, "kind": "IFC",
        "scaleLabel": "IFC model units (metres)", "scaleRatio": scale, "levels": levels,
        "layers": [{"id": f"lay-ifc-{i}", "name": level, "visible": True, "color": "#0d9488"} for i, level in enumerate(levels)],
        "ifcElements": elements, "vectorPaths": paths, "snapNodes": snap_nodes[:2000],
        "classSummaries": sorted(summaries.values(), key=lambda row: row["ifcClass"]),
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
        "#10=IFCDIRECTION((1.,0.,0.));",
        "#11=IFCDIRECTION((0.,0.,1.));",
        "#12=IFCCARTESIANPOINT((0.,0.,0.));",
        "#13=IFCAXIS2PLACEMENT3D(#12,#11,#10);",
        "#14=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.00001,#13,$);",
        "#15=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);",
        "#16=IFCUNITASSIGNMENT((#15));",
        "#17=IFCPROJECT('SampleProject',$,'CobitX sample',$,$,$,$,(#14),#16);",
        "#18=IFCBUILDING('SampleBuilding',$,'Office',$,$,$,$,$,.ELEMENT.,$,$,$);",
        "#19=IFCRELAGGREGATES('ProjectBuilding',$,$,$,#17,(#18));",
        "#22=IFCRELAGGREGATES('BuildingStoreys',$,$,$,#18,(#20,#21));",
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
        lines.append(f"#{ext_id}=IFCEXTRUDEDAREASOLID(#{prof_id},#13,#11,{h});")
        lines.append(f"#{srep_id}=IFCSHAPEREPRESENTATION(#14,'Body','SweptSolid',(#{ext_id}));")
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
