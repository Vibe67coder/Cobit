import React, { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import {
  Crosshair,
  Search,
  ZoomIn,
  Hand,
  Rotate3d,
  Maximize2,
  FilePlus,
  Box,
  Square,
} from 'lucide-react';
import type {
  DrawingTool,
  ImperialDisplayMode,
  PlanDocument,
  ResultType,
  TakeoffShape,
} from '../../types/cubit';
import { computeShapeMetrics, formatDimension, formatNumber } from '../../utils/estimateCalc';
import type { OptimisePdfState, TakeoffDisplayState } from './JobRibbon';
import { ThreeViewport } from './ThreeViewport';

interface ViewportPaneProps {
  plans: PlanDocument[];
  activePlanId: string;
  onSelectPlan: (planId: string) => void;
  shapes: TakeoffShape[];
  selectedShapeId: string | null;
  onSelectShape: (shapeId: string | null) => void;
  activeTool: DrawingTool;
  viewMode: '2D' | '3D';
  onSetViewMode: (m: '2D' | '3D') => void;
  isolateSelected: boolean;
  snappingEnabled: boolean;
  snapColor: string;
  orthoEnabled: boolean;
  phantomEnabled: boolean;
  optimisePdf: OptimisePdfState;
  takeoffDisplay: TakeoffDisplayState;
  zoom: number;
  pan: { x: number; y: number };
  onChangeZoom: (z: number) => void;
  onChangePan: (p: { x: number; y: number }) => void;
  draftPoints: { x: number; y: number }[];
  onAddDraftPoint: (pt: { x: number; y: number }) => void;
  onFinishDraftShape: (closed?: boolean) => void;
  calibratingScale: boolean;
  onCompleteScaleCalibration: (pixelDistance: number, realMeters: number) => void;
  onCancelScaleCalibration: () => void;
  aligningRevision?: boolean;
  onCompleteRevisionAlign?: (dx: number, dy: number) => void;
  onCancelRevisionAlign?: () => void;
  onOpenInsertPlan: () => void;
  onAutoSelectAtPoint: (pt: { x: number; y: number }, imageDataUrl?: string) => void;
  activeResultType: ResultType;
  measurementUnit?: 'Metric' | 'Imperial';
  imperialDisplayMode?: ImperialDisplayMode;
  onNotify: (msg: string) => void;
}

const VECTOR_SNAP_NODES: { x: number; y: number }[] = [
  { x: 140, y: 120 },
  { x: 320, y: 120 },
  { x: 500, y: 120 },
  { x: 660, y: 120 },
  { x: 140, y: 270 },
  { x: 320, y: 270 },
  { x: 500, y: 270 },
  { x: 660, y: 270 },
  { x: 140, y: 420 },
  { x: 320, y: 420 },
  { x: 500, y: 420 },
  { x: 660, y: 420 },
  { x: 146, y: 126 },
  { x: 654, y: 126 },
  { x: 654, y: 414 },
  { x: 146, y: 414 },
  { x: 320, y: 126 },
  { x: 320, y: 414 },
];

export const ViewportPane: React.FC<ViewportPaneProps> = ({
  plans,
  activePlanId,
  onSelectPlan,
  shapes,
  selectedShapeId,
  onSelectShape,
  activeTool,
  viewMode,
  onSetViewMode,
  isolateSelected,
  snappingEnabled,
  snapColor,
  orthoEnabled,
  phantomEnabled,
  optimisePdf,
  takeoffDisplay,
  zoom,
  pan,
  onChangeZoom,
  onChangePan,
  draftPoints,
  onAddDraftPoint,
  onFinishDraftShape,
  calibratingScale,
  onCompleteScaleCalibration,
  onCancelScaleCalibration,
  aligningRevision,
  onCompleteRevisionAlign,
  onCancelRevisionAlign,
  onOpenInsertPlan,
  onAutoSelectAtPoint,
  activeResultType,
  measurementUnit = 'Metric',
  imperialDisplayMode = 'Decimal',
  onNotify,
}) => {
  const [navTool, setNavTool] = useState<'none' | 'Pan' | 'ZoomWindow' | 'Rotate'>('none');
  const [cursorWorld, setCursorWorld] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [snappedPt, setSnappedPt] = useState<{ x: number; y: number } | null>(null);
  const [rectStart, setRectStart] = useState<{ x: number; y: number } | null>(null);
  const [zoomWindowDrag, setZoomWindowDrag] = useState<{
    start: { x: number; y: number };
    end: { x: number; y: number };
  } | null>(null);
  const [rulerPoints, setRulerPoints] = useState<{ x: number; y: number }[]>([]);
  const [scalePoints, setScalePoints] = useState<{ x: number; y: number }[]>([]);
  const [alignPoints, setAlignPoints] = useState<{ x: number; y: number }[]>([]);
  const [knownMetersInput, setKnownMetersInput] = useState('10');

  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<{ startX: number; startY: number; origPan: { x: number; y: number } } | null>(null);

  const activePlan = plans.find((p) => p.id === activePlanId) ?? plans[0] ?? null;

  const planShapes = useMemo(() => {
    const list = shapes.filter((s) => s.planId === activePlan?.id && !s.hidden);
    if (isolateSelected && selectedShapeId) {
      return list.filter((s) => s.id === selectedShapeId);
    }
    return list;
  }, [shapes, activePlan, isolateSelected, selectedShapeId]);

  const isLayerVisible = (layerName: string) => {
    if (!activePlan) return true;
    const found = activePlan.layers.find((l) => l.name === layerName);
    return found ? found.visible : true;
  };

  const toWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - pan.x) / zoom,
      y: (sy - pan.y) / zoom,
    };
  };

  const applySnapAndOrtho = (raw: { x: number; y: number }) => {
    let pt = { ...raw };
    let foundSnap: { x: number; y: number } | null = null;

    if (snappingEnabled) {
      const candidates = [
        ...(activePlan?.snapNodes && activePlan.snapNodes.length > 0
          ? activePlan.snapNodes
          : VECTOR_SNAP_NODES),
      ];
      for (const s of planShapes) {
        candidates.push(...s.points);
      }
      let bestDist = 14 / zoom;
      for (const c of candidates) {
        const d = Math.hypot(c.x - pt.x, c.y - pt.y);
        if (d < bestDist) {
          bestDist = d;
          foundSnap = c;
        }
      }
      if (foundSnap) {
        pt = { ...foundSnap };
      }
    }

    if (orthoEnabled && draftPoints.length > 0 && !foundSnap) {
      const prev = draftPoints[draftPoints.length - 1];
      const dx = Math.abs(pt.x - prev.x);
      const dy = Math.abs(pt.y - prev.y);
      if (dx > dy) pt.y = prev.y;
      else pt.x = prev.x;
    }

    return { pt, foundSnap };
  };

  const formatArea = (m2: number) =>
    measurementUnit === 'Imperial'
      ? `${formatNumber(m2 * 10.7639)} SF`
      : `${formatNumber(m2)} m²`;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (draggingRef.current) {
      const dx = e.clientX - draggingRef.current.startX;
      const dy = e.clientY - draggingRef.current.startY;
      onChangePan({
        x: draggingRef.current.origPan.x + dx,
        y: draggingRef.current.origPan.y + dy,
      });
      return;
    }

    const raw = toWorld(e.clientX, e.clientY);
    if (zoomWindowDrag) {
      setZoomWindowDrag((prev) => (prev ? { ...prev, end: raw } : null));
      setCursorWorld(raw);
      return;
    }

    const { pt, foundSnap } = applySnapAndOrtho(raw);
    setCursorWorld(pt);
    setSnappedPt(foundSnap);
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // Middle mouse button or Pan tool
    if (e.button === 1 || navTool === 'Pan') {
      e.preventDefault();
      draggingRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origPan: { ...pan },
      };
      return;
    }

    if (e.button === 2) {
      if (draftPoints.length >= 2) {
        onFinishDraftShape(false);
      }
      setRectStart(null);
      setRulerPoints([]);
      setZoomWindowDrag(null);
      return;
    }

    if (e.button !== 0) return;

    const raw = toWorld(e.clientX, e.clientY);
    if (navTool === 'ZoomWindow') {
      setZoomWindowDrag({ start: raw, end: raw });
      return;
    }

    const { pt } = applySnapAndOrtho(raw);

    if (calibratingScale) {
      setScalePoints((prev) => (prev.length >= 2 ? [pt] : [...prev, pt]));
      return;
    }

    if (aligningRevision) {
      setAlignPoints((prev) => (prev.length >= 2 ? [pt] : [...prev, pt]));
      return;
    }

    if (activeTool === 'Auto Select') {
      onAutoSelectAtPoint(pt, activePlan?.imageDataUrl);
      return;
    }

    if (activeTool === 'Select') {
      return;
    }

    if (activeTool === 'Ruler') {
      setRulerPoints((prev) => (prev.length >= 2 ? [pt] : [...prev, pt]));
      return;
    }

    if (activeTool === 'Rectangle') {
      if (!rectStart) {
        setRectStart(pt);
      } else {
        onAddDraftPoint(rectStart);
        onAddDraftPoint({ x: pt.x, y: rectStart.y });
        onAddDraftPoint(pt);
        onAddDraftPoint({ x: rectStart.x, y: pt.y });
        setTimeout(() => onFinishDraftShape(true), 0);
        setRectStart(null);
      }
      return;
    }

    if (activeTool === 'Polyline' || activeTool === 'Line' || activeTool === 'Count') {
      // Close shape if clicking start point of Polyline
      if (
        activeTool === 'Polyline' &&
        draftPoints.length >= 3 &&
        Math.hypot(pt.x - draftPoints[0].x, pt.y - draftPoints[0].y) < 12 / zoom
      ) {
        onFinishDraftShape(true);
        return;
      }
      onAddDraftPoint(pt);
      if (activeTool === 'Line' && draftPoints.length === 1) {
        setTimeout(() => onFinishDraftShape(false), 0);
      }
    }
  };

  const handleMouseUp = () => {
    draggingRef.current = null;
    if (zoomWindowDrag) {
      const minX = Math.min(zoomWindowDrag.start.x, zoomWindowDrag.end.x);
      const maxX = Math.max(zoomWindowDrag.start.x, zoomWindowDrag.end.x);
      const minY = Math.min(zoomWindowDrag.start.y, zoomWindowDrag.end.y);
      const maxY = Math.max(zoomWindowDrag.start.y, zoomWindowDrag.end.y);
      const boxW = maxX - minX;
      const boxH = maxY - minY;
      setZoomWindowDrag(null);
      if (boxW > 8 && boxH > 8) {
        const rect = svgRef.current?.getBoundingClientRect();
        const viewW = rect?.width ?? 700;
        const viewH = rect?.height ?? 480;
        const nextZoom = Math.max(0.35, Math.min(5, Math.min(viewW / boxW, viewH / boxH) * 0.92));
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        onChangeZoom(nextZoom);
        onChangePan({ x: viewW / 2 - cx * nextZoom, y: viewH / 2 - cy * nextZoom });
        setNavTool('none');
      }
    }
  };

  const zoomAt = (factor: number, x: number, y: number) => {
    const nextZoom = Math.max(0.35, Math.min(5, zoom * factor));
    const ratio = nextZoom / zoom;
    onChangeZoom(nextZoom);
    onChangePan({ x: x - (x - pan.x) * ratio, y: y - (y - pan.y) * ratio });
  };

  const handleWheel = useEffectEvent((event: WheelEvent, svg: SVGSVGElement) => {
    if (!event.deltaY) return;
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top);
  });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => handleWheel(event, svg);
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, [viewMode]);

  const handleZoomFit = () => {
    onChangeZoom(1);
    onChangePan({ x: 30, y: 20 });
  };

  const handleZoomSelected = () => {
    const shp = planShapes.find((s) => s.id === selectedShapeId);
    if (!shp || shp.points.length === 0) return;
    const xs = shp.points.map((p) => p.x);
    const ys = shp.points.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const rect = svgRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 700;
    const h = rect?.height ?? 480;
    const z = 1.45;
    onChangeZoom(z);
    onChangePan({ x: w / 2 - cx * z, y: h / 2 - cy * z });
  };

  const rulerDistM =
    rulerPoints.length === 2 && activePlan
      ? Math.hypot(rulerPoints[1].x - rulerPoints[0].x, rulerPoints[1].y - rulerPoints[0].y) /
        activePlan.scaleRatio
      : null;

  return (
    <div className="viewport-pane">
      <div className="viewport-canvas-area">
        {/* Floating Viewport Toolbar */}
        <div className="viewport-floating-toolbar">
          <button
            className="vp-tool-btn"
            onClick={handleZoomSelected}
            title="Zoom Selected"
          >
            <Crosshair size={13} color="var(--brand-blue)" /> Zoom Selected
          </button>
          <button
            className={`vp-tool-btn ${navTool === 'ZoomWindow' ? 'active' : ''}`}
            onClick={() => {
              setNavTool(navTool === 'ZoomWindow' ? 'none' : 'ZoomWindow');
              onNotify('Zoom Window active.');
            }}
            title="Zoom Window"
          >
            <Search size={13} /> Window
          </button>
          <button
            className="vp-tool-btn"
            onClick={() => {
              const rect = svgRef.current?.getBoundingClientRect();
              if (rect) zoomAt(1.2, rect.width / 2, rect.height / 2);
            }}
            disabled={viewMode === '3D'}
            title="Zoom In"
          >
            <ZoomIn size={13} /> Zoom
          </button>
          <button
            className={`vp-tool-btn ${navTool === 'Pan' ? 'active' : ''}`}
            onClick={() => setNavTool(navTool === 'Pan' ? 'none' : 'Pan')}
            title="Pan (or hold Middle Mouse Button)"
          >
            <Hand size={13} /> Pan
          </button>
          <button
            className={`vp-tool-btn ${viewMode === '3D' ? 'active' : ''}`}
            onClick={() => onSetViewMode(viewMode === '3D' ? '2D' : '3D')}
            title="Rotate / Toggle 3D Visual Estimating"
          >
            <Rotate3d size={13} color={viewMode === '3D' ? '#fff' : '#0d9488'} /> Rotate
          </button>
          <button className="vp-tool-btn" onClick={handleZoomFit} title="Zoom Fit">
            <Maximize2 size={13} /> Fit
          </button>

          <div className="vp-divider" />

          <button
            className={`vp-tool-btn ${viewMode === '2D' ? 'active' : ''}`}
            onClick={() => onSetViewMode('2D')}
          >
            <Square size={12} /> 2D
          </button>
          <button
            className={`vp-tool-btn ${viewMode === '3D' ? 'active' : ''}`}
            onClick={() => onSetViewMode('3D')}
          >
            <Box size={12} /> 3D
          </button>

          <div className="vp-divider" />

          <button
            className="vp-tool-btn"
            onClick={onOpenInsertPlan}
          >
            <FilePlus size={13} color="var(--brand-blue)" /> Insert
          </button>
        </div>

        {/* Interactive 2-Point Scale Calibration Banner */}
        {calibratingScale && (
          <div
            style={{
              position: 'absolute',
              top: 44,
              left: 10,
              zIndex: 12,
              background: '#0f172a',
              color: '#ffffff',
              padding: '6px 10px',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <span>
              <strong>Scale Calibration:</strong>{' '}
              {scalePoints.length === 0
                ? 'Click Start Point (A) on known dimension'
                : scalePoints.length === 1
                ? 'Click End Point (B) on known dimension'
                : `Line = ${formatNumber(
                    Math.hypot(
                      scalePoints[1].x - scalePoints[0].x,
                      scalePoints[1].y - scalePoints[0].y
                    ),
                    1
                  )} px`}
            </span>
            {scalePoints.length === 2 && (
              <>
                <input
                  type="number"
                  className="form-input mono"
                  style={{ width: 68, height: 22, color: '#0f172a', background: '#fff' }}
                  value={knownMetersInput}
                  onChange={(e) => setKnownMetersInput(e.target.value)}
                />
                <span>m</span>
                <button
                  className="btn-primary"
                  style={{ padding: '2px 8px', fontSize: 10.5 }}
                  onClick={() => {
                    const pxDist = Math.hypot(
                      scalePoints[1].x - scalePoints[0].x,
                      scalePoints[1].y - scalePoints[0].y
                    );
                    const realM = Number(knownMetersInput) || 1;
                    if (pxDist > 2 && realM > 0) {
                      onCompleteScaleCalibration(pxDist, realM);
                      setScalePoints([]);
                    }
                  }}
                >
                  Apply Scale
                </button>
              </>
            )}
            <button
              className="btn-secondary"
              style={{ padding: '2px 7px', fontSize: 10.5 }}
              onClick={() => {
                setScalePoints([]);
                onCancelScaleCalibration();
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Interactive 2-Point Plan Revision Alignment Banner */}
        {aligningRevision && (
          <div
            style={{
              position: 'absolute',
              top: 44,
              left: 10,
              zIndex: 12,
              background: '#7c2d12',
              color: '#ffffff',
              padding: '6px 10px',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <span>
              <strong>2-Point Align:</strong>{' '}
              {alignPoints.length === 0
                ? 'Click Base Plan Anchor (Point 1)'
                : alignPoints.length === 1
                ? 'Click Matching Revision Anchor (Point 2)'
                : `Shift = (${Math.round(alignPoints[0].x - alignPoints[1].x)}px, ${Math.round(
                    alignPoints[0].y - alignPoints[1].y
                  )}px)`}
            </span>
            {alignPoints.length === 2 && (
              <button
                className="btn-primary"
                style={{ padding: '2px 8px', fontSize: 10.5 }}
                onClick={() => {
                  const dx = alignPoints[0].x - alignPoints[1].x;
                  const dy = alignPoints[0].y - alignPoints[1].y;
                  onCompleteRevisionAlign?.(dx, dy);
                  setAlignPoints([]);
                }}
              >
                Align Revision
              </button>
            )}
            <button
              className="btn-secondary"
              style={{ padding: '2px 7px', fontSize: 10.5 }}
              onClick={() => {
                setAlignPoints([]);
                onCancelRevisionAlign?.();
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* 2D Vector CAD / PDF Canvas OR Real Three.js 3D Visual Estimating Viewport */}
        {viewMode === '3D' ? (
          <ThreeViewport
            activePlan={activePlan ?? undefined}
            shapes={planShapes}
            selectedShapeId={selectedShapeId}
            isolateSelected={isolateSelected}
            onSelectShape={onSelectShape}
          />
        ) : (
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{
            cursor:
              navTool === 'Pan'
                ? 'grab'
                : navTool === 'ZoomWindow'
                ? 'zoom-in'
                : calibratingScale || aligningRevision || activeTool !== 'Select'
                ? 'crosshair'
                : 'default',
            display: 'block',
            background: '#ffffff',
          }}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onContextMenu={(e) => e.preventDefault()}
        >
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* Paper Sheet Background */}
              <rect
                x={40}
                y={30}
                width={760}
                height={500}
                fill="#ffffff"
                stroke="#cbd5e1"
                strokeWidth={1.5}
              />

              {/* Title Block Border */}
              <rect
                x={58}
                y={46}
                width={724}
                height={468}
                fill="none"
                stroke="#94a3b8"
                strokeWidth={0.9}
              />
              <rect
                x={622}
                y={438}
                width={160}
                height={76}
                fill="#f8fafc"
                stroke="#94a3b8"
                strokeWidth={0.8}
              />
              <text x={630} y={456} fontSize={9.5} fontWeight={700} fill="#1e293b">
                COBITX ARCHITECTURAL
              </text>
              <text x={630} y={472} fontSize={8.5} fill="#475569">
                {activePlan?.name ?? 'No Plan Loaded'}
              </text>
              <text x={630} y={488} fontSize={8} fill="#64748b" fontFamily="monospace">
                SCALE {activePlan?.scaleLabel} · {activePlan?.revision}
              </text>
              <text x={630} y={503} fontSize={7.5} fill="#0066b3">
                {activePlan?.kind} ({activePlan?.originalFileName})
              </text>

              {/* Architectural Plan Underlay (Uploaded PDF/Image, DXF CAD Vectors, OR Built-In Sheet) */}
              {activePlan && activePlan.visible && (
                <g
                  transform={`rotate(${activePlan.rotationDeg ?? 0} 420 280)`}
                  style={{
                    filter: optimisePdf.singleColour
                      ? 'grayscale(1) contrast(1.2)'
                      : undefined,
                    opacity: optimisePdf.flattenPdf ? 0.92 : 1,
                  }}
                >
                  {activePlan.imageDataUrl ? (
                    <image
                      href={activePlan.imageDataUrl}
                      x={40}
                      y={30}
                      width={760}
                      height={500}
                      preserveAspectRatio="xMidYMid meet"
                    />
                  ) : activePlan.vectorPaths && activePlan.vectorPaths.length > 0 ? (
                    <g fill="none" strokeWidth={1.1}>
                      {activePlan.vectorPaths.map((vp, idx) =>
                        isLayerVisible(vp.layer) ? (
                          <path key={idx} d={vp.d} stroke={vp.stroke} />
                        ) : null
                      )}
                    </g>
                  ) : (
                    <>
                      {/* Structural Gridlines (S-GRID) */}
                      {isLayerVisible('S-GRID') && (
                        <g stroke="#cbd5e1" strokeWidth={0.7} strokeDasharray="6 4">
                          {[140, 320, 500, 660].map((gx, i) => (
                            <g key={gx}>
                              <line x1={gx} y1={85} x2={gx} y2={455} />
                              <circle cx={gx} cy={76} r={9} fill="#fff" stroke="#94a3b8" strokeDasharray="none" />
                              <text x={gx} y={79} textAnchor="middle" fontSize={8.5} fill="#475569">
                                {i + 1}
                              </text>
                            </g>
                          ))}
                          {[120, 270, 420].map((gy, i) => (
                            <g key={gy}>
                              <line x1={105} y1={gy} x2={700} y2={gy} />
                              <circle cx={96} cy={gy} r={9} fill="#fff" stroke="#94a3b8" strokeDasharray="none" />
                              <text x={96} y={gy + 3} textAnchor="middle" fontSize={8.5} fill="#475569">
                                {String.fromCharCode(65 + i)}
                              </text>
                            </g>
                          ))}
                        </g>
                      )}

                      {/* Architectural Walls (A-WALL / S-CONC-SLAB / A-ROOF) */}
                      {(isLayerVisible('A-WALL') || isLayerVisible('S-CONC-SLAB') || isLayerVisible('A-ROOF')) && (
                        <g>
                          <rect
                            x={140}
                            y={120}
                            width={520}
                            height={300}
                            fill="none"
                            stroke="#1e293b"
                            strokeWidth={5}
                          />
                          <line x1={320} y1={120} x2={320} y2={420} stroke="#1e293b" strokeWidth={3} />
                          <line x1={320} y1={270} x2={660} y2={270} stroke="#334155" strokeWidth={2.5} />
                          <line x1={500} y1={120} x2={500} y2={420} stroke="#334155" strokeWidth={2.5} />
                        </g>
                      )}

                      {/* Doors (A-DOOR) */}
                      {isLayerVisible('A-DOOR') && (
                        <g stroke="#0284c7" strokeWidth={1.3} fill="none">
                          <path d="M 370 120 A 26 26 0 0 1 396 146 L 370 146 Z" fill="rgba(2,132,199,0.08)" />
                          <path d="M 320 250 A 22 22 0 0 1 342 272 L 320 272 Z" fill="rgba(2,132,199,0.08)" />
                          <path d="M 500 185 A 22 22 0 0 1 522 207 L 500 207 Z" fill="rgba(2,132,199,0.08)" />
                        </g>
                      )}

                      {/* Glazing (A-GLAZ) */}
                      {isLayerVisible('A-GLAZ') && (
                        <g stroke="#0d9488" strokeWidth={3}>
                          <line x1={470} y1={120} x2={560} y2={120} />
                          <line x1={180} y1={420} x2={270} y2={420} />
                        </g>
                      )}

                      {/* Room Labels (A-AREA-IDEN) */}
                      {isLayerVisible('A-AREA-IDEN') && (
                        <g
                          fill="#475569"
                          fontSize={10}
                          fontWeight={600}
                          textAnchor="middle"
                          style={{
                            fontFamily: optimisePdf.rasteriseText ? 'monospace' : undefined,
                          }}
                        >
                          <text x={230} y={265}>RECEPTION &amp; WAITING</text>
                          <text x={230} y={279} fontSize={8.5} fill="#64748b">ROOM 101</text>
                          <text x={410} y={195}>CONSULT 1</text>
                          <text x={580} y={195}>CONSULT 2</text>
                          <text x={410} y={345}>TREATMENT</text>
                          <text x={580} y={345}>STERILISATION</text>
                        </g>
                      )}
                    </>
                  )}
                </g>
              )}

              {/* Plan Revision Comparison Overlay */}
              {activePlan?.revisionOverlay?.visible && (
                <g
                  transform={`translate(${activePlan.revisionOverlay.offsetX}, ${activePlan.revisionOverlay.offsetY}) scale(${activePlan.revisionOverlay.scaleFactor}) rotate(${activePlan.revisionOverlay.rotationDeg} 420 280)`}
                  style={{ opacity: activePlan.revisionOverlay.opacity }}
                  pointerEvents="none"
                >
                  {activePlan.revisionOverlay.imageDataUrl ? (
                    <image
                      href={activePlan.revisionOverlay.imageDataUrl}
                      x={40}
                      y={30}
                      width={760}
                      height={500}
                      preserveAspectRatio="xMidYMid meet"
                      style={{ filter: 'hue-rotate(150deg) saturate(1.8)' }}
                    />
                  ) : activePlan.revisionOverlay.vectorPaths && activePlan.revisionOverlay.vectorPaths.length > 0 ? (
                    <g fill="none" strokeWidth={1.3}>
                      {activePlan.revisionOverlay.vectorPaths.map((vp, idx) => (
                        <path key={idx} d={vp.d} stroke="#dc2626" />
                      ))}
                    </g>
                  ) : (
                    <rect
                      x={140}
                      y={120}
                      width={520}
                      height={300}
                      fill="none"
                      stroke="#dc2626"
                      strokeWidth={3}
                      strokeDasharray="8 4"
                    />
                  )}
                </g>
              )}

              {/* 2-Point Revision Alignment Vector Guide */}
              {aligningRevision && alignPoints.length > 0 && (
                <g pointerEvents="none">
                  <line
                    x1={alignPoints[0].x}
                    y1={alignPoints[0].y}
                    x2={alignPoints[1]?.x ?? cursorWorld.x}
                    y2={alignPoints[1]?.y ?? cursorWorld.y}
                    stroke="#ea580c"
                    strokeWidth={2.5}
                    strokeDasharray="5 3"
                  />
                  {alignPoints.map((ap, i) => (
                    <circle key={i} cx={ap.x} cy={ap.y} r={5} fill="#ea580c" stroke="#fff" strokeWidth={1.5} />
                  ))}
                </g>
              )}

              {/* Calibration Line Overlay */}
              {calibratingScale && scalePoints.length > 0 && (
                <g pointerEvents="none">
                  <line
                    x1={scalePoints[0].x}
                    y1={scalePoints[0].y}
                    x2={scalePoints[1]?.x ?? cursorWorld.x}
                    y2={scalePoints[1]?.y ?? cursorWorld.y}
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    strokeDasharray="6 3"
                  />
                  {scalePoints.map((sp, i) => (
                    <circle key={i} cx={sp.x} cy={sp.y} r={4.5} fill="#f59e0b" stroke="#0f172a" strokeWidth={1.2} />
                  ))}
                </g>
              )}

              {/* Drawn Takeoff Shapes */}
              {planShapes.map((shp) => {
                const isSel = shp.id === selectedShapeId;
                const ptsStr = shp.points.map((p) => `${p.x},${p.y}`).join(' ');
                const metrics = computeShapeMetrics(shp, activePlan?.scaleRatio ?? 28);
                const centroidX =
                  shp.points.reduce((acc, p) => acc + p.x, 0) / Math.max(1, shp.points.length);
                const centroidY =
                  shp.points.reduce((acc, p) => acc + p.y, 0) / Math.max(1, shp.points.length);

                if (shp.resultType === 'Count' || shp.resultType === 'Door Counts' || shp.resultType === 'Window Counts') {
                  return (
                    <g
                      key={shp.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectShape(shp.id);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      {shp.points.map((pt, idx) => (
                        <g key={idx}>
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r={isSel ? 8 : 6.5}
                            fill={shp.color}
                            fillOpacity={0.28}
                            stroke={isSel ? '#0f172a' : shp.color}
                            strokeWidth={isSel ? 2.2 : 1.5}
                          />
                          <circle cx={pt.x} cy={pt.y} r={2.2} fill={shp.color} />
                        </g>
                      ))}
                      {takeoffDisplay.names && shp.points[0] && (
                        <text
                          x={centroidX}
                          y={centroidY - 12}
                          textAnchor="middle"
                          fontSize={9}
                          fontWeight={700}
                          fill={shp.color}
                          stroke="#ffffff"
                          strokeWidth={2.5}
                          paintOrder="stroke"
                        >
                          {shp.name} ({shp.points.length})
                        </text>
                      )}
                    </g>
                  );
                }

                return (
                  <g
                    key={shp.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectShape(shp.id);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {shp.closed ? (
                      <polygon
                        points={ptsStr}
                        fill={shp.color}
                        fillOpacity={isSel ? 0.28 : 0.14}
                        stroke={shp.color}
                        strokeWidth={isSel ? 3 : 2}
                      />
                    ) : (
                      <polyline
                        points={ptsStr}
                        fill="none"
                        stroke={shp.color}
                        strokeWidth={isSel ? 3.5 : 2.2}
                      />
                    )}

                    {/* View -> Takeoff: Edge Dimensions Overlay */}
                    {takeoffDisplay.dimensions &&
                      shp.points.map((pt, idx) => {
                        const next = shp.points[idx + 1] ?? (shp.closed ? shp.points[0] : null);
                        if (!next) return null;
                        const segM =
                          Math.hypot(next.x - pt.x, next.y - pt.y) /
                          (activePlan?.scaleRatio ?? 28);
                        if (segM < 0.25) return null;
                        const mx = (pt.x + next.x) / 2;
                        const my = (pt.y + next.y) / 2;
                        return (
                          <g key={`dim-${idx}`} pointerEvents="none">
                            <rect
                              x={mx - 27}
                              y={my - 7}
                              width={54}
                              height={13}
                              rx={2}
                              fill="rgba(255,255,255,0.9)"
                              stroke={shp.color}
                              strokeWidth={0.7}
                            />
                            <text
                              x={mx}
                              y={my + 2.5}
                              textAnchor="middle"
                              fontSize={8}
                              fontFamily="monospace"
                              fontWeight={700}
                              fill="#0f172a"
                            >
                              {formatDimension(segM, measurementUnit, imperialDisplayMode)}
                            </text>
                          </g>
                        );
                      })}

                    {/* View -> Takeoff: Shape Names Overlay */}
                    {takeoffDisplay.names && (
                      <text
                        x={centroidX}
                        y={centroidY}
                        textAnchor="middle"
                        fontSize={9.5}
                        fontWeight={700}
                        fill={shp.color}
                        stroke="#ffffff"
                        strokeWidth={3}
                        paintOrder="stroke"
                        pointerEvents="none"
                      >
                        {shp.name} (
                        {shp.resultType.includes('Length')
                          ? formatDimension(metrics.lengthM, measurementUnit, imperialDisplayMode)
                          : shp.resultType.includes('Vertical')
                          ? formatArea(metrics.verticalAreaM2)
                          : formatArea(metrics.areaM2)}
                        )
                      </text>
                    )}

                    {/* Vertices on Selected Shape */}
                    {isSel &&
                      shp.points.map((pt, idx) => (
                        <rect
                          key={idx}
                          x={pt.x - 3.5}
                          y={pt.y - 3.5}
                          width={7}
                          height={7}
                          fill="#ffffff"
                          stroke="#0f172a"
                          strokeWidth={1.5}
                        />
                      ))}
                  </g>
                );
              })}

              {/* Active Draft Drawing Preview */}
              {draftPoints.length > 0 && (
                <g pointerEvents="none">
                  <polyline
                    points={[...draftPoints, cursorWorld].map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#0066b3"
                    strokeWidth={2}
                    strokeDasharray="5 3"
                  />
                  {draftPoints.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#0066b3" />
                  ))}
                </g>
              )}

              {/* Rectangle Tool Preview */}
              {rectStart && (
                <rect
                  x={Math.min(rectStart.x, cursorWorld.x)}
                  y={Math.min(rectStart.y, cursorWorld.y)}
                  width={Math.abs(cursorWorld.x - rectStart.x)}
                  height={Math.abs(cursorWorld.y - rectStart.y)}
                  fill="rgba(0, 102, 179, 0.14)"
                  stroke="#0066b3"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  pointerEvents="none"
                />
              )}

              {/* Zoom Window Drag Marquee */}
              {zoomWindowDrag && (
                <rect
                  x={Math.min(zoomWindowDrag.start.x, zoomWindowDrag.end.x)}
                  y={Math.min(zoomWindowDrag.start.y, zoomWindowDrag.end.y)}
                  width={Math.abs(zoomWindowDrag.end.x - zoomWindowDrag.start.x)}
                  height={Math.abs(zoomWindowDrag.end.y - zoomWindowDrag.start.y)}
                  fill="rgba(2, 132, 199, 0.14)"
                  stroke="#0284c7"
                  strokeWidth={1.5 / zoom}
                  strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                  pointerEvents="none"
                />
              )}

              {/* Ruler Measurement Overlay */}
              {rulerPoints.length > 0 && (
                <g pointerEvents="none">
                  <line
                    x1={rulerPoints[0].x}
                    y1={rulerPoints[0].y}
                    x2={rulerPoints[1]?.x ?? cursorWorld.x}
                    y2={rulerPoints[1]?.y ?? cursorWorld.y}
                    stroke="#dc2626"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                  />
                  {rulerDistM !== null && (
                    <text
                      x={(rulerPoints[0].x + rulerPoints[1].x) / 2}
                      y={(rulerPoints[0].y + rulerPoints[1].y) / 2 - 8}
                      fill="#dc2626"
                      fontSize={11}
                      fontWeight={700}
                      fontFamily="monospace"
                    >
                      {formatDimension(rulerDistM, measurementUnit, imperialDisplayMode)}
                    </text>
                  )}
                </g>
              )}

              {/* Ortho & Phantom Crosshair Guides */}
              {(orthoEnabled || phantomEnabled) && activeTool !== 'Select' && (
                <g pointerEvents="none" stroke="#94a3b8" strokeWidth={0.6} strokeDasharray="3 3">
                  <line x1={cursorWorld.x} y1={0} x2={cursorWorld.x} y2={600} />
                  <line x1={0} y1={cursorWorld.y} x2={860} y2={cursorWorld.y} />
                </g>
              )}

              {/* Signature Cubit Orange Vector Snap Box */}
              {snappingEnabled && snappedPt && activeTool !== 'Select' && (
                <rect
                  x={snappedPt.x - 5.5}
                  y={snappedPt.y - 5.5}
                  width={11}
                  height={11}
                  fill="none"
                  stroke={snapColor}
                  strokeWidth={2}
                  pointerEvents="none"
                />
              )}
            </g>
        </svg>
        )}

        {/* View -> Takeoff: Interactive Takeoff Legend Box */}
        {takeoffDisplay.legend && planShapes.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 46,
              right: 10,
              width: 225,
              maxHeight: 220,
              overflowY: 'auto',
              background: 'rgba(255, 255, 255, 0.94)',
              border: '1px solid var(--border-dark)',
              borderRadius: 4,
              boxShadow: 'var(--shadow-sm)',
              padding: '6px 8px',
              fontSize: 10.5,
              zIndex: 8,
            }}
          >
            <div
              style={{
                fontWeight: 700,
                color: '#0f172a',
                borderBottom: '1px solid var(--border-light)',
                paddingBottom: 3,
                marginBottom: 4,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>Takeoff Legend</span>
              <span style={{ color: '#64748b' }}>{planShapes.length} shape(s)</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {planShapes.map((shp) => {
                const m = computeShapeMetrics(shp, activePlan?.scaleRatio ?? 28);
                const qtyText =
                  shp.resultType.includes('Count')
                    ? `${shp.points.length} no`
                    : shp.resultType.includes('Length')
                    ? formatDimension(m.lengthM, measurementUnit, imperialDisplayMode)
                    : shp.resultType.includes('Vertical')
                    ? formatArea(m.verticalAreaM2)
                    : formatArea(m.areaM2);
                return (
                  <div
                    key={shp.id}
                    onClick={() => onSelectShape(shp.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                      padding: '2px 4px',
                      borderRadius: 3,
                      cursor: 'pointer',
                      background: shp.id === selectedShapeId ? '#e0f2fe' : 'transparent',
                      color: '#1e293b',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                      <span
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: 2,
                          background: shp.color,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {shp.name}
                      </span>
                    </span>
                    <span className="mono" style={{ fontWeight: 600, flexShrink: 0 }}>
                      {qtyText}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bottom-Left Scale Indicator (v15.1 parity) */}
        <div className="vp-scale-overlay">
          <span>Scale: {activePlan?.scaleLabel ?? 'Unscaled'}</span>
          <span>|</span>
          <span>
            Tool: {activeTool} ({activeResultType})
          </span>
          {activePlan && (
            <>
              <span>|</span>
              <span>
                X: {formatDimension(cursorWorld.x / activePlan.scaleRatio, measurementUnit, imperialDisplayMode)}, Y:{' '}
                {formatDimension(cursorWorld.y / activePlan.scaleRatio, measurementUnit, imperialDisplayMode)}
              </span>
            </>
          )}
        </div>

        {/* Bottom-Right Quick Help Hint */}
        <div className="vp-mode-hint">
          {viewMode === '3D'
            ? 'Drag to rotate 3D model · Click shapes to inspect'
            : draftPoints.length > 0
            ? 'Left-click points · Press J to close · Right-click to finish'
            : 'Wheel to zoom · Middle-drag to pan · Select tool or Ctrl+2 Polyline'}
        </div>
      </div>

      {/* Bottom Plan Tabs */}
      <div className="vp-plan-tabs">
        {plans.map((p) => (
          <button
            key={p.id}
            className={`vp-plan-tab ${p.id === activePlan?.id ? 'active' : ''}`}
            onClick={() => onSelectPlan(p.id)}
          >
            <span>{p.name}</span>
            <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>({p.kind})</span>
          </button>
        ))}
      </div>
    </div>
  );
};
