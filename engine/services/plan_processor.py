"""Blueprint plan processor for PDF, DXF CAD, and Raster images (PyMuPDF + ezdxf + OpenCV + Pillow)."""

from __future__ import annotations

import base64
import io
import re
from pathlib import Path
from typing import Any

import cv2
import ezdxf
import pymupdf as fitz
import numpy as np
from PIL import Image

SCALE_REGEX = re.compile(r"\b1\s*:\s*(20|25|50|75|100|125|150|200|250|500|1000)\b")


def _encode_png_b64(png_bytes: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")


def _detect_scale_from_text(text: str) -> tuple[str, float]:
    m = SCALE_REGEX.search(text)
    if not m:
        return ("1:100 @ A3 (Calibrate)", 28.0)
    denom = int(m.group(1))
    # Baseline calibrated visual px/m around 1:100 -> 28px/m on 800px canvas
    ratio = round(28.0 * (100.0 / denom), 3)
    return (f"1:{denom} (Detected)", ratio)


def _extract_image_snap_nodes(img_bgr: np.ndarray, target_w: int, target_h: int) -> list[dict[str, float]]:
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    corners = cv2.goodFeaturesToTrack(gray, maxCorners=180, qualityLevel=0.04, minDistance=14)
    if corners is None:
        return []
    h, w = gray.shape[:2]
    sx = target_w / max(1, w)
    sy = target_h / max(1, h)
    nodes: list[dict[str, float]] = []
    for pt in corners:
        x, y = float(pt[0][0]) * sx, float(pt[0][1]) * sy
        nodes.append({"x": round(x, 1), "y": round(y, 1)})
    return nodes


def process_uploaded_plan(
    filename: str,
    raw_bytes: bytes,
    page_number: int = 1,
) -> dict[str, Any]:
    ext = Path(filename).suffix.lower()
    canvas_w, canvas_h = 760, 500
    offset_x, offset_y = 40, 30

    if ext == ".pdf":
        doc = fitz.open(stream=raw_bytes, filetype="pdf")
        total_pages = len(doc)
        idx = max(0, min(total_pages - 1, page_number - 1))
        page = doc[idx]
        drawings = page.get_drawings()
        text = page.get_text("text")
        is_vector = len(drawings) >= 12
        scale_label, scale_ratio = _detect_scale_from_text(text)

        # Render PDF page at crisp resolution fitting ~1100px width
        rect = page.rect
        zoom = min(2.0, 1100.0 / max(1.0, rect.width))
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        png_bytes = pix.tobytes("png")
        img_arr = np.frombuffer(png_bytes, dtype=np.uint8)
        bgr = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)

        # Extract real vector endpoints scaled to SVG sheet rect (40,30,760,500)
        snap_nodes: list[dict[str, float]] = []
        sx = canvas_w / max(1.0, rect.width)
        sy = canvas_h / max(1.0, rect.height)
        for d in drawings[:300]:
            for item in d.get("items", []):
                if item[0] == "l":
                    p1, p2 = item[1], item[2]
                    snap_nodes.append({"x": round(offset_x + p1.x * sx, 1), "y": round(offset_y + p1.y * sy, 1)})
                    snap_nodes.append({"x": round(offset_x + p2.x * sx, 1), "y": round(offset_y + p2.y * sy, 1)})
                elif item[0] == "re":
                    r = item[1]
                    snap_nodes.append({"x": round(offset_x + r.x0 * sx, 1), "y": round(offset_y + r.y0 * sy, 1)})
                    snap_nodes.append({"x": round(offset_x + r.x1 * sx, 1), "y": round(offset_y + r.y1 * sy, 1)})
        if not snap_nodes and bgr is not None:
            raw_nodes = _extract_image_snap_nodes(bgr, canvas_w, canvas_h)
            snap_nodes = [{"x": round(offset_x + n["x"], 1), "y": round(offset_y + n["y"], 1)} for n in raw_nodes]

        return {
            "name": Path(filename).stem + (f" (p.{idx + 1})" if total_pages > 1 else ""),
            "originalFileName": filename,
            "pageNumber": idx + 1,
            "totalPages": total_pages,
            "kind": "Vector PDF" if is_vector else "Raster PDF",
            "scaleLabel": scale_label,
            "scaleRatio": scale_ratio,
            "imageDataUrl": _encode_png_b64(png_bytes),
            "widthPx": pix.width,
            "heightPx": pix.height,
            "snapNodes": snap_nodes[:350],
            "layers": [
                {"id": "lay-pdf-base", "name": "PDF-UNDERLAY", "visible": True, "color": "#1e293b"},
                {"id": "lay-pdf-vec", "name": "VECTOR-GEOMETRY", "visible": True, "color": "#0284c7"},
            ],
        }

    if ext == ".dxf":
        text_stream = io.StringIO(raw_bytes.decode("utf-8", errors="ignore"))
        doc = ezdxf.read(text_stream)
        msp = doc.modelspace()
        xs: list[float] = []
        ys: list[float] = []
        raw_entities: list[tuple[str, str, list[tuple[float, float]]]] = []

        for ent in msp:
            dxftype = ent.dxftype()
            layer = str(getattr(ent.dxf, "layer", "0"))
            if dxftype == "LINE":
                p1 = (float(ent.dxf.start.x), float(ent.dxf.start.y))
                p2 = (float(ent.dxf.end.x), float(ent.dxf.end.y))
                xs.extend([p1[0], p2[0]])
                ys.extend([p1[1], p2[1]])
                raw_entities.append(("line", layer, [p1, p2]))
            elif dxftype == "LWPOLYLINE":
                pts = [(float(p[0]), float(p[1])) for p in ent.get_points("xy")]
                if len(pts) >= 2:
                    xs.extend(p[0] for p in pts)
                    ys.extend(p[1] for p in pts)
                    raw_entities.append(("poly", layer, pts))

        min_x = min(xs) if xs else 0.0
        max_x = max(xs) if xs else 100.0
        min_y = min(ys) if ys else 0.0
        max_y = max(ys) if ys else 100.0
        span = max(1e-3, max(max_x - min_x, max_y - min_y))
        scale = min((canvas_w - 40) / max(1e-3, max_x - min_x), (canvas_h - 40) / max(1e-3, max_y - min_y))

        def tx(x: float) -> float:
            return round(offset_x + 20 + (x - min_x) * scale, 1)

        def ty(y: float) -> float:
            return round(offset_y + canvas_h - 20 - (y - min_y) * scale, 1)

        vector_paths: list[dict[str, str]] = []
        snap_nodes: list[dict[str, float]] = []
        layer_names: set[str] = set()
        for kind, layer, pts in raw_entities[:1200]:
            layer_names.add(layer)
            mapped = [(tx(p[0]), ty(p[1])) for p in pts]
            for mx, my in mapped:
                snap_nodes.append({"x": mx, "y": my})
            d_str = "M " + " L ".join(f"{mx} {my}" for mx, my in mapped)
            vector_paths.append({"d": d_str, "stroke": "#1e293b", "layer": layer})

        palette = ["#1e293b", "#0284c7", "#16a34a", "#9333ea", "#ea580c"]
        layers = [
            {"id": f"lay-dxf-{i}", "name": ln, "visible": True, "color": palette[i % len(palette)]}
            for i, ln in enumerate(sorted(layer_names) or ["0"])
        ]
        # DXF coordinates may be mm or m; provide reasonable default scale
        approx_scale_ratio = round(scale * (1000.0 if span > 1000 else 1.0), 2)
        return {
            "name": Path(filename).stem,
            "originalFileName": filename,
            "pageNumber": 1,
            "totalPages": 1,
            "kind": "DXF",
            "scaleLabel": f"CAD DXF (1m ≈ {approx_scale_ratio}px)",
            "scaleRatio": max(5.0, min(150.0, approx_scale_ratio)),
            "vectorPaths": vector_paths,
            "snapNodes": snap_nodes[:400],
            "layers": layers,
        }

    # Raster Image (PNG, JPG, TIFF, BMP)
    img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()
    bgr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    raw_nodes = _extract_image_snap_nodes(bgr, canvas_w, canvas_h)
    snap_nodes = [{"x": round(offset_x + n["x"], 1), "y": round(offset_y + n["y"], 1)} for n in raw_nodes]

    return {
        "name": Path(filename).stem,
        "originalFileName": filename,
        "pageNumber": 1,
        "totalPages": 1,
        "kind": "Image",
        "scaleLabel": "Unscaled Image (Calibrate)",
        "scaleRatio": 28.0,
        "imageDataUrl": _encode_png_b64(png_bytes),
        "widthPx": img.width,
        "heightPx": img.height,
        "snapNodes": snap_nodes[:350],
        "layers": [
            {"id": "lay-img-1", "name": "RASTER-IMAGE", "visible": True, "color": "#475569"},
        ],
    }


def auto_select_room_polygon(
    image_data_url: str | None,
    seed_x: float,
    seed_y: float,
) -> list[dict[str, float]]:
    """Use OpenCV floodFill from a seed click on sheet coordinates (40..800, 30..530) to detect room polygon."""
    offset_x, offset_y = 40.0, 30.0
    canvas_w, canvas_h = 760.0, 500.0

    if not image_data_url or "," not in image_data_url:
        # Built-in mock blueprint room boundary helper
        rooms = [
            (140, 120, 320, 420),  # Reception
            (320, 120, 500, 270),  # Consult 1
            (500, 120, 660, 270),  # Consult 2
            (320, 270, 500, 420),  # Treatment
            (500, 270, 660, 420),  # Sterilisation
        ]
        for x1, y1, x2, y2 in rooms:
            if x1 <= seed_x <= x2 and y1 <= seed_y <= y2:
                return [
                    {"x": float(x1), "y": float(y1)},
                    {"x": float(x2), "y": float(y1)},
                    {"x": float(x2), "y": float(y2)},
                    {"x": float(x1), "y": float(y2)},
                ]
        return []

    b64_part = image_data_url.split(",", 1)[1]
    raw = base64.b64decode(b64_part)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return []

    h, w = img.shape[:2]
    px = int(round(((seed_x - offset_x) / canvas_w) * w))
    py = int(round(((seed_y - offset_y) / canvas_h) * h))
    if px < 1 or px >= w - 1 or py < 1 or py >= h - 1:
        return []

    mask = np.zeros((h + 2, w + 2), np.uint8)
    work = img.copy()
    cv2.floodFill(work, mask, (px, py), 128, loDiff=18, upDiff=18, flags=4 | (255 << 8))
    filled = mask[1:-1, 1:-1]
    contours, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []

    largest = max(contours, key=cv2.contourArea)
    eps = 0.012 * cv2.arcLength(largest, True)
    approx = cv2.approxPolyDP(largest, max(2.0, eps), True)
    pts: list[dict[str, float]] = []
    for p in approx:
        wx = offset_x + (float(p[0][0]) / max(1, w)) * canvas_w
        wy = offset_y + (float(p[0][1]) / max(1, h)) * canvas_h
        pts.append({"x": round(wx, 1), "y": round(wy, 1)})
    return pts
