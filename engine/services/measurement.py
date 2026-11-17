"""Read-only drawing context and takeoff geometry for local clients."""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, Field, FiniteFloat, ValidationError
from shapely.geometry import Polygon


class Point(BaseModel):
    x: FiniteFloat
    y: FiniteFloat


class MeasurementRequest(BaseModel):
    job_id: str
    plan_id: str
    points: list[Point] = Field(min_length=1, max_length=2000)
    result_type: Literal["Area", "Length", "Volume", "Volume by Length", "Vertical Area",
                         "Vertical Area Less Openings", "Length Less Openings", "Length by Centres",
                         "Count", "Door Counts", "Window Counts"]
    closed: bool = False
    pitch_deg: FiniteFloat = Field(default=0, ge=0, lt=90)
    height_mm: FiniteFloat = Field(default=2700, gt=0)
    depth_mm: FiniteFloat = Field(default=150, gt=0)
    width_mm: FiniteFloat = Field(default=450, gt=0)
    centres_mm: FiniteFloat = Field(default=450, ge=50)
    opening_area_m2: FiniteFloat = Field(default=0, ge=0)


def find_plan(state: dict, job_id: str, plan_id: str) -> dict:
    for job in state.get("jobs", []):
        if job.get("id") == job_id:
            for plan in job.get("plans", []):
                if plan.get("id") == plan_id:
                    return plan
            break
    raise ValueError("Drawing not found in the requested job. List jobs and plans to get their IDs.")


def plan_context(plan: dict) -> dict:
    return {
        "name": plan.get("name"), "kind": plan.get("kind"), "pageNumber": plan.get("pageNumber", 1),
        "scaleLabel": plan.get("scaleLabel"), "pixelsPerMetre": plan.get("scaleRatio"),
        "needsCalibration": plan.get("kind") != "IFC" and not str(plan.get("scaleLabel", "")).startswith("Calibrated"),
        "coordinates": {"origin": "top-left of viewport drawing, x right, y down",
                        "imageBounds": {"left": 40, "top": 30, "width": 760, "height": 500}},
        "imageAvailable": bool(plan.get("imageDataUrl")),
        "snapPoints": (plan.get("snapNodes") or [])[:350],
        "modelElementCount": len(plan.get("ifcElements") or []),
    }


def measure_points(state: dict, arguments: dict) -> dict:
    try:
        request = MeasurementRequest.model_validate(arguments)
    except ValidationError as error:
        raise ValueError(str(error)) from error
    plan = find_plan(state, request.job_id, request.plan_id)
    if plan.get("kind") == "IFC":
        raise ValueError("Use the IFC model’s metre-based quantities for BIM takeoff.")
    scale = float(plan.get("scaleRatio") or 0)
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError("Calibrate the drawing before measuring.")
    result = request.result_type
    points = [(point.x, point.y) for point in request.points]
    counting = "Count" in result
    closed = not counting and (request.closed or result in ("Area", "Volume"))
    if len(set(points)) < (1 if counting else 3 if closed else 2):
        raise ValueError("Add enough distinct points for the selected measurement type.")
    area = 0.0
    length = 0.0
    if not counting:
        length = sum(math.dist(a, b) for a, b in zip(points, points[1:])) / scale
    if closed:
        polygon = Polygon(points)
        if not polygon.is_valid or polygon.area <= 0:
            raise ValueError("Use a closed area with non-crossing edges.")
        length += math.dist(points[0], points[-1]) / scale
        area = polygon.area / scale ** 2 / math.cos(math.radians(request.pitch_deg))

    if counting:
        quantity, unit = len(points), "No."
    elif result == "Area":
        quantity, unit = area, "m²"
    elif result == "Volume":
        quantity, unit = area * request.depth_mm / 1000, "m³"
    elif result == "Volume by Length":
        quantity, unit = length * request.width_mm * request.depth_mm / 1_000_000, "m³"
    elif result.startswith("Vertical Area"):
        deduction = request.opening_area_m2 if result.endswith("Less Openings") else 0
        quantity, unit = max(0, length * request.height_mm / 1000 - deduction), "m²"
    elif result == "Length by Centres":
        quantity, unit = math.ceil(length * 1000 / request.centres_mm) + 1, "No."
    else:
        quantity, unit = length, "m"
    return {
        "resultType": result, "quantity": round(quantity, 3), "unit": unit,
        "lengthM": round(length, 3), "areaM2": round(area, 3),
        "scaleLabel": plan.get("scaleLabel"), "needsCalibration": plan_context(plan)["needsCalibration"],
    }
