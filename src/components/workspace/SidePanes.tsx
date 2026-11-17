import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown,
  Box,
  Square,
  Minus,
  Hash,
  Camera,
  FileCode2,
  Flag,
  RefreshCw,
  Pause,
  Play,
} from 'lucide-react';
import type {
  DrawingTool,
  EstimateRow,
  ExternalReference,
  FlagStatus,
  ImperialDisplayMode,
  PlanDocument,
  ResultType,
  TakeoffShape,
} from '../../types/cubit';
import { computeShapeMetrics, formatDimension, formatNumber } from '../../utils/estimateCalc';
import type { PaneVisibility } from './JobRibbon';

interface SidePanesProps {
  paneVisibility: PaneVisibility;
  plans: PlanDocument[];
  activePlanId: string;
  onSelectPlan: (id: string) => void;
  onTogglePlanVisibility: (planId: string) => void;
  onToggleLayerVisibility: (planId: string, layerId: string) => void;
  onApplySnapshot: (zoom: number, panX: number, panY: number) => void;
  shapes: TakeoffShape[];
  selectedShapeId: string | null;
  onSelectShape: (id: string) => void;
  onUpdateShape: (id: string, patch: Partial<TakeoffShape>) => void;
  activeTool: DrawingTool;
  newShapeParams: {
    description: string;
    heightMm: number;
    startHeightMm: number;
    endHeightMm: number;
    pitchDeg: number;
    depthMm: number;
    trenchWidthMm: number;
    centresSpacingMm: number;
  };
  onChangeNewShapeParams: (next: SidePanesProps['newShapeParams']) => void;
  activeResultType: ResultType;
  zoom: number;
  pan: { x: number; y: number };
  onChangePan: (p: { x: number; y: number }) => void;
  rows: EstimateRow[];
  onSelectEstimateRow: (rowId: string) => void;
  onUpdateEstimateRow: (rowId: string, patch: Partial<EstimateRow>) => void;
  externalRefs: ExternalReference[];
  onTogglePauseRef: (refId: string) => void;
  onRecalculateRefs: () => void;
  measurementUnit?: 'Metric' | 'Imperial';
  imperialDisplayMode?: ImperialDisplayMode;
}

const FLAG_STATUS_OPTIONS: FlagStatus[] = [
  'Incomplete',
  'Attention',
  'Review',
  'FollowUp',
  'Resolved',
];

export const SidePanes: React.FC<SidePanesProps> = ({
  paneVisibility,
  plans,
  activePlanId,
  onSelectPlan,
  onTogglePlanVisibility,
  onToggleLayerVisibility,
  onApplySnapshot,
  shapes,
  selectedShapeId,
  onSelectShape,
  onUpdateShape,
  activeTool,
  newShapeParams,
  onChangeNewShapeParams,
  activeResultType,
  zoom,
  pan,
  onChangePan,
  rows,
  onSelectEstimateRow,
  onUpdateEstimateRow,
  externalRefs,
  onTogglePauseRef,
  onRecalculateRefs,
  measurementUnit = 'Metric',
  imperialDisplayMode = 'Decimal',
}) => {
  const [expandedPlans, setExpandedPlans] = useState<Record<string, boolean>>({
    'plan-a101': true,
  });
  const [shapeGroupMode, setShapeGroupMode] = useState<'Type' | 'Hierarchy'>('Type');
  const [topTab, setTopTab] = useState<'Plans' | 'Shapes'>('Plans');
  const [bottomTab, setBottomTab] = useState<
    'Details' | 'Takeoff' | 'Navigation' | 'Flags' | 'Referencing'
  >('Details');
  const [flagFilter, setFlagFilter] = useState<'All' | FlagStatus>('All');

  const activePlan = plans.find((p) => p.id === activePlanId) ?? plans[0];
  const selectedShape = shapes.find((s) => s.id === selectedShapeId) ?? null;
  const activePlanShapes = shapes.filter((s) => s.planId === activePlan?.id);

  const flaggedRows = rows.filter((r) => {
    const isFlagged = Boolean(r.flagged || r.flagStatus);
    if (!isFlagged) return false;
    if (flagFilter === 'All') return true;
    return (r.flagStatus ?? 'Incomplete') === flagFilter;
  });

  const shapeIcon = (rt: ResultType) => {
    if (rt.includes('Volume')) return <Box size={12} color="#2563eb" />;
    if (rt.includes('Count')) return <Hash size={12} color="#ea580c" />;
    if (rt.includes('Length')) return <Minus size={12} color="#dc2626" />;
    return <Square size={12} color="#16a34a" />;
  };

  const showTop = paneVisibility.plans || paneVisibility.shapes;
  const showBottom =
    paneVisibility.details ||
    paneVisibility.takeoff ||
    paneVisibility.navigation ||
    paneVisibility.flags ||
    paneVisibility.references;
  if (!showTop && !showBottom) return null;

  const selectedMetrics =
    selectedShape && activePlan
      ? computeShapeMetrics(selectedShape, activePlan.scaleRatio)
      : null;

  return (
    <div className="right-dock" style={{ width: 310, flexShrink: 0 }}>
      {/* TOP DOCK: PLANS PANE / SHAPES PANE */}
      {showTop && (
        <div className="pane-frame" style={{ flex: 1.05 }}>
          <div className="pane-tabs-bar">
            <div className="pane-tabs-left">
              {paneVisibility.plans && (
                <button
                  className={`pane-tab ${topTab === 'Plans' ? 'active' : ''}`}
                  onClick={() => setTopTab('Plans')}
                >
                  Plans
                </button>
              )}
              {paneVisibility.shapes && (
                <button
                  className={`pane-tab ${topTab === 'Shapes' ? 'active' : ''}`}
                  onClick={() => setTopTab('Shapes')}
                >
                  Shapes ({activePlanShapes.length})
                </button>
              )}
            </div>
          </div>

          <div className="dock-section-body">
            {topTab === 'Plans' && paneVisibility.plans ? (
              <div>
                {plans.map((p) => {
                  const isExp = !!expandedPlans[p.id];
                  return (
                    <div key={p.id} style={{ marginBottom: 2 }}>
                      <div
                        className={`plan-tree-row ${p.id === activePlanId ? 'active' : ''}`}
                        onClick={() => onSelectPlan(p.id)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                          <button
                            className="tree-toggle"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedPlans((prev) => ({ ...prev, [p.id]: !isExp }));
                            }}
                          >
                            {isExp ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                          <FileCode2 size={12} color="var(--brand-blue)" />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.name}
                          </span>
                        </div>
                        <button
                          className="pane-icon-btn"
                          title={p.visible ? 'Hide Plan' : 'Show Plan'}
                          onClick={(e) => {
                            e.stopPropagation();
                            onTogglePlanVisibility(p.id);
                          }}
                        >
                          {p.visible ? <Eye size={12} color="var(--brand-blue)" /> : <EyeOff size={12} />}
                        </button>
                      </div>

                      {isExp && (
                        <div style={{ paddingLeft: 20 }}>
                          {p.layers.map((lay) => (
                            <div key={lay.id} className="plan-tree-row" style={{ padding: '2px 6px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: 1,
                                    background: lay.color,
                                    display: 'inline-block',
                                  }}
                                />
                                <span style={{ fontSize: 11 }}>{lay.name}</span>
                              </div>
                              <button
                                className="pane-icon-btn"
                                onClick={() => onToggleLayerVisibility(p.id, lay.id)}
                              >
                                {lay.visible ? (
                                  <Eye size={11} color="#475569" />
                                ) : (
                                  <EyeOff size={11} color="#94a3b8" />
                                )}
                              </button>
                            </div>
                          ))}

                          {p.snapshots.length > 0 && (
                            <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px dashed var(--border-light)' }}>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>
                                Snapshots
                              </div>
                              {p.snapshots.map((snap) => (
                                <div
                                  key={snap.id}
                                  className="plan-tree-row"
                                  style={{ padding: '2px 6px', fontSize: 11 }}
                                  onClick={() => {
                                    onSelectPlan(p.id);
                                    onApplySnapshot(snap.zoom, snap.panX, snap.panY);
                                  }}
                                >
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <Camera size={11} color="var(--brand-blue)" />
                                    {snap.name} {snap.isDefault ? '(Default)' : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>Group:</span>
                  <select
                    className="form-select"
                    style={{ height: 21, fontSize: 11 }}
                    value={shapeGroupMode}
                    onChange={(e) => setShapeGroupMode(e.target.value as 'Type' | 'Hierarchy')}
                  >
                    <option value="Type">By Type</option>
                    <option value="Hierarchy">By Hierarchy (Level)</option>
                  </select>
                </div>
                {activePlanShapes.map((shp) => (
                  <div
                    key={shp.id}
                    className={`shape-list-row ${shp.id === selectedShapeId ? 'active' : ''}`}
                    onClick={() => onSelectShape(shp.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      {shapeIcon(shp.resultType)}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {shp.name}
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {shapeGroupMode === 'Type' ? shp.resultType : shp.ifcLevel ?? 'Level 00'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* BOTTOM DOCK: DETAILS / TAKEOFF / NAVIGATION / FLAGS / REFERENCING */}
      {showBottom && (
        <div className="pane-frame" style={{ flex: 1 }}>
          <div className="pane-tabs-bar">
            <div className="pane-tabs-left" style={{ flexWrap: 'wrap' }}>
              {paneVisibility.details && (
                <button
                  className={`pane-tab ${bottomTab === 'Details' ? 'active' : ''}`}
                  onClick={() => setBottomTab('Details')}
                >
                  Details
                </button>
              )}
              {paneVisibility.takeoff && (
                <button
                  className={`pane-tab ${bottomTab === 'Takeoff' ? 'active' : ''}`}
                  onClick={() => setBottomTab('Takeoff')}
                >
                  Takeoff
                </button>
              )}
              {paneVisibility.navigation && (
                <button
                  className={`pane-tab ${bottomTab === 'Navigation' ? 'active' : ''}`}
                  onClick={() => setBottomTab('Navigation')}
                >
                  Nav
                </button>
              )}
              {paneVisibility.flags && (
                <button
                  className={`pane-tab ${bottomTab === 'Flags' ? 'active' : ''}`}
                  onClick={() => setBottomTab('Flags')}
                >
                  Flags ({flaggedRows.length})
                </button>
              )}
              {paneVisibility.references && (
                <button
                  className={`pane-tab ${bottomTab === 'Referencing' ? 'active' : ''}`}
                  onClick={() => setBottomTab('Referencing')}
                >
                  Refs ({externalRefs.length})
                </button>
              )}
            </div>
          </div>

          <div className="dock-section-body">
            {bottomTab === 'Details' && (
              <div>
                {selectedShape ? (
                  <div className="form-grid" style={{ gridTemplateColumns: '96px 1fr' }}>
                    <span className="form-label">Description:</span>
                    <input
                      className="form-input"
                      value={selectedShape.name}
                      onChange={(e) => onUpdateShape(selectedShape.id, { name: e.target.value })}
                    />

                    <span className="form-label">Result Type:</span>
                    <span style={{ fontSize: 11.5, fontWeight: 600 }}>{selectedShape.resultType}</span>

                    <span className="form-label">Colour:</span>
                    <input
                      type="color"
                      value={selectedShape.color}
                      onChange={(e) => onUpdateShape(selectedShape.id, { color: e.target.value })}
                      style={{ width: 34, height: 22, border: '1px solid var(--border-main)' }}
                    />

                    {selectedShape.resultType === 'Area' && (
                      <>
                        <span className="form-label">Area Pitch (°):</span>
                        <input
                          type="number"
                          className="form-input"
                          value={selectedShape.pitchDeg ?? 0}
                          onChange={(e) =>
                            onUpdateShape(selectedShape.id, { pitchDeg: Number(e.target.value) || 0 })
                          }
                        />
                      </>
                    )}

                    {(selectedShape.resultType === 'Volume' ||
                      selectedShape.resultType === 'Volume by Length') && (
                      <>
                        <span className="form-label">Depth (mm):</span>
                        <input
                          type="number"
                          className="form-input"
                          value={selectedShape.depthMm ?? 150}
                          onChange={(e) =>
                            onUpdateShape(selectedShape.id, { depthMm: Number(e.target.value) || 150 })
                          }
                        />
                      </>
                    )}

                    {selectedShape.resultType === 'Volume by Length' && (
                      <>
                        <span className="form-label">Trench W (mm):</span>
                        <input
                          type="number"
                          className="form-input"
                          value={selectedShape.trenchWidthMm ?? 450}
                          onChange={(e) =>
                            onUpdateShape(selectedShape.id, {
                              trenchWidthMm: Number(e.target.value) || 450,
                            })
                          }
                        />
                      </>
                    )}

                    {selectedShape.resultType.includes('Vertical') && (
                      <>
                        <span className="form-label">Height (mm):</span>
                        <input
                          type="number"
                          className="form-input"
                          value={selectedShape.heightMm ?? 2700}
                          onChange={(e) =>
                            onUpdateShape(selectedShape.id, { heightMm: Number(e.target.value) || 2700 })
                          }
                        />
                      </>
                    )}

                    {selectedShape.resultType === 'Length by Centres' && (
                      <>
                        <span className="form-label">Centres (mm):</span>
                        <input
                          type="number"
                          className="form-input"
                          value={selectedShape.centresSpacingMm ?? 450}
                          onChange={(e) =>
                            onUpdateShape(selectedShape.id, {
                              centresSpacingMm: Math.max(50, Number(e.target.value) || 450),
                            })
                          }
                        />
                      </>
                    )}

                    {selectedMetrics && (
                      <>
                        <span className="form-label">Length:</span>
                        <span className="mono">
                          {formatDimension(selectedMetrics.lengthM, measurementUnit, imperialDisplayMode)}
                        </span>
                        <span className="form-label">Flat Area:</span>
                        <span className="mono">
                          {measurementUnit === 'Imperial'
                            ? `${formatNumber(selectedMetrics.areaM2 * 10.7639)} SF`
                            : `${formatNumber(selectedMetrics.areaM2)} m²`}
                        </span>
                      </>
                    )}

                    {selectedShape.openings && selectedShape.openings.length > 0 && (
                      <>
                        <span className="form-label">Openings:</span>
                        <div style={{ fontSize: 11 }}>
                          {selectedShape.openings.map((op) => (
                            <div key={op.id} style={{ padding: '2px 0', color: 'var(--text-secondary)' }}>
                              {op.kind}: {op.name} ({op.widthMm}×{op.heightMm}, Offset {op.offsetMm}mm)
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ) : activePlan ? (
                  <div className="form-grid" style={{ gridTemplateColumns: '96px 1fr' }}>
                    <span className="form-label">Plan Name:</span>
                    <span style={{ fontWeight: 600 }}>{activePlan.name}</span>
                    <span className="form-label">Original File:</span>
                    <span className="mono" style={{ fontSize: 10.5 }}>{activePlan.originalFileName}</span>
                    <span className="form-label">Page #:</span>
                    <span className="mono">{activePlan.pageNumber}</span>
                    <span className="form-label">Scale:</span>
                    <span className="mono">{activePlan.scaleLabel}</span>
                    <span className="form-label">Revision:</span>
                    <span>{activePlan.revision}</span>
                  </div>
                ) : null}
              </div>
            )}

            {bottomTab === 'Takeoff' && (
              <div className="form-grid" style={{ gridTemplateColumns: '98px 1fr' }}>
                <span className="form-label">Active Tool:</span>
                <span style={{ fontWeight: 600 }}>{activeTool} ({activeResultType})</span>
                <span className="form-label">New Shape:</span>
                <input
                  className="form-input"
                  value={newShapeParams.description}
                  onChange={(e) =>
                    onChangeNewShapeParams({ ...newShapeParams, description: e.target.value })
                  }
                />
                <span className="form-label">Height (mm):</span>
                <input
                  type="number"
                  className="form-input"
                  value={newShapeParams.heightMm}
                  onChange={(e) =>
                    onChangeNewShapeParams({
                      ...newShapeParams,
                      heightMm: Number(e.target.value) || 2700,
                    })
                  }
                />
                <span className="form-label">Start H (mm):</span>
                <input
                  type="number"
                  className="form-input"
                  value={newShapeParams.startHeightMm}
                  onChange={(e) =>
                    onChangeNewShapeParams({
                      ...newShapeParams,
                      startHeightMm: Number(e.target.value) || 2700,
                    })
                  }
                />
                <span className="form-label">End H (mm):</span>
                <input
                  type="number"
                  className="form-input"
                  value={newShapeParams.endHeightMm}
                  onChange={(e) =>
                    onChangeNewShapeParams({
                      ...newShapeParams,
                      endHeightMm: Number(e.target.value) || 2700,
                    })
                  }
                />
                <span className="form-label">Area Pitch (°):</span>
                <input
                  type="number"
                  className="form-input"
                  value={newShapeParams.pitchDeg}
                  onChange={(e) =>
                    onChangeNewShapeParams({
                      ...newShapeParams,
                      pitchDeg: Number(e.target.value) || 0,
                    })
                  }
                />
                <span className="form-label">Depth (mm):</span>
                <input
                  type="number"
                  className="form-input"
                  value={newShapeParams.depthMm}
                  onChange={(e) =>
                    onChangeNewShapeParams({
                      ...newShapeParams,
                      depthMm: Number(e.target.value) || 150,
                    })
                  }
                />
                <span className="form-label">Trench W (mm):</span>
                <input
                  type="number"
                  className="form-input"
                  value={newShapeParams.trenchWidthMm}
                  onChange={(e) =>
                    onChangeNewShapeParams({
                      ...newShapeParams,
                      trenchWidthMm: Number(e.target.value) || 450,
                    })
                  }
                />
                <span className="form-label">Centres (mm):</span>
                <input
                  type="number"
                  className="form-input"
                  value={newShapeParams.centresSpacingMm}
                  onChange={(e) =>
                    onChangeNewShapeParams({
                      ...newShapeParams,
                      centresSpacingMm: Math.max(50, Number(e.target.value) || 450),
                    })
                  }
                />
              </div>
            )}

            {bottomTab === 'Navigation' && (
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Click or drag on minimap to pan Viewport
                </div>
                <svg
                  viewBox="0 0 840 560"
                  style={{
                    width: '100%',
                    height: 165,
                    border: '1px solid var(--border-main)',
                    background: '#ffffff',
                    cursor: 'pointer',
                  }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const wx = ((e.clientX - rect.left) / rect.width) * 840;
                    const wy = ((e.clientY - rect.top) / rect.height) * 560;
                    onChangePan({ x: 350 - wx * zoom, y: 240 - wy * zoom });
                  }}
                >
                  <rect x={40} y={30} width={760} height={500} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={4} />
                  <rect x={140} y={120} width={520} height={300} fill="none" stroke="#1e293b" strokeWidth={6} />
                  {activePlanShapes.map((shp) => (
                    <polygon
                      key={shp.id}
                      points={shp.points.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill={shp.color}
                      fillOpacity={0.25}
                      stroke={shp.color}
                      strokeWidth={4}
                    />
                  ))}
                  <rect
                    x={Math.max(0, -pan.x / zoom)}
                    y={Math.max(0, -pan.y / zoom)}
                    width={Math.min(840, 720 / zoom)}
                    height={Math.min(560, 480 / zoom)}
                    fill="rgba(0, 102, 179, 0.1)"
                    stroke="#0066b3"
                    strokeWidth={5}
                  />
                </svg>
              </div>
            )}

            {bottomTab === 'Flags' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Filter:</span>
                  <select
                    className="form-select"
                    style={{ height: 22, fontSize: 11 }}
                    value={flagFilter}
                    onChange={(e) => setFlagFilter(e.target.value as 'All' | FlagStatus)}
                  >
                    <option value="All">All Flags</option>
                    {FLAG_STATUS_OPTIONS.map((fs) => (
                      <option key={fs} value={fs}>
                        {fs}
                      </option>
                    ))}
                  </select>
                </div>

                {flaggedRows.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 6 }}>
                    No items match this flag filter. Press Ctrl+M on an item to flag it.
                  </div>
                ) : (
                  flaggedRows.map((fr) => {
                    const st: FlagStatus = fr.flagStatus ?? 'Incomplete';
                    return (
                      <div
                        key={fr.id}
                        style={{
                          border: '1px solid var(--border-main)',
                          borderRadius: 4,
                          padding: 6,
                          background: 'var(--bg-surface)',
                          cursor: 'pointer',
                        }}
                        onClick={() => onSelectEstimateRow(fr.id)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span className={`flag-pill flag-${st}`}>
                            <Flag size={10} /> {st}
                          </span>
                          <select
                            className="form-select"
                            style={{ width: 98, height: 20, fontSize: 10.5 }}
                            value={st}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              onUpdateEstimateRow(fr.id, {
                                flagged: e.target.value !== 'Resolved',
                                flagStatus: e.target.value as FlagStatus,
                              })
                            }
                          >
                            {FLAG_STATUS_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div style={{ fontSize: 11.5, fontWeight: 600 }}>
                          {fr.code} — {fr.description}
                        </div>
                        {fr.flagNote && (
                          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                            {fr.flagNote}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {bottomTab === 'Referencing' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                    Saved reference values
                  </span>
                  <button className="tool-btn-mini" onClick={onRecalculateRefs}>
                    <RefreshCw size={11} color="var(--brand-blue)" /> Apply values
                  </button>
                </div>
                {externalRefs.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    No external references attached to this job yet.
                  </div>
                ) : (
                  externalRefs.map((ref) => (
                    <div
                      key={ref.id}
                      style={{
                        border: '1px solid var(--border-main)',
                        borderRadius: 4,
                        padding: 6,
                        background: 'var(--bg-surface)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: 11 }}>{ref.sourceName}</span>
                        <button
                          className="pane-icon-btn"
                          title={ref.paused ? 'Include reference' : 'Pause reference'}
                          onClick={() => onTogglePauseRef(ref.id)}
                        >
                          {ref.paused ? <Play size={11} color="#16a34a" /> : <Pause size={11} color="#d97706" />}
                        </button>
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--brand-blue)' }}>
                        [{ref.sourceKind}] {ref.refKey}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                        Target: {ref.targetDescription} ({ref.targetField} = {ref.syncedValue})
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

