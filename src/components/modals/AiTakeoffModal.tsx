import React, { useState } from 'react';
import { Bot, Check, Compass, ScanText, Sparkles, X } from 'lucide-react';
import type { EstimateRow, JobRecord, PlanDocument } from '../../types/cubit';
import {
  callMcpTool,
  runAiAutoArea,
  runAiAutoScale,
  runAiCountSymbols,
  runAiScanText,
  type AiMarkerResult,
  type AiZoneResult,
} from '../../services/engineClient';
import { formatNumber } from '../../utils/estimateCalc';

export type AiModeTab = 'AutoArea' | 'CountSymbols' | 'ScanText' | 'AutoScale' | 'Copilot';

interface AiTakeoffModalProps {
  initialTab: AiModeTab;
  job: JobRecord;
  activePlan: PlanDocument | null;
  selectedItem: EstimateRow | null;
  onApplyAreaZones: (zones: AiZoneResult[]) => void;
  onApplyCountMarkers: (label: string, points: { x: number; y: number }[]) => void;
  onApplyAutoScale: (planId: string, name: string, scaleLabel: string, scaleRatio: number) => void;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

export const AiTakeoffModal: React.FC<AiTakeoffModalProps> = ({
  initialTab,
  job,
  activePlan,
  selectedItem,
  onApplyAreaZones,
  onApplyCountMarkers,
  onApplyAutoScale,
  onClose,
  onNotify,
}) => {
  const [tab, setTab] = useState<AiModeTab>(initialTab);
  const [busy, setBusy] = useState(false);

  // Auto Area
  const [zones, setZones] = useState<AiZoneResult[]>([]);
  const [selectedZones, setSelectedZones] = useState<Record<number, boolean>>({});

  // Count Symbols
  const [symbolKind, setSymbolKind] = useState('Door Swing');
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.72);
  const [markers, setMarkers] = useState<AiMarkerResult[]>([]);

  // Scan Text
  const [textQuery, setTextQuery] = useState('CONSULT');
  const [textHits, setTextHits] = useState<AiMarkerResult[]>([]);

  // Auto Scale
  const [scalePreview, setScalePreview] = useState<{
    suggestedName: string;
    detectedScaleLabel: string;
    suggestedScaleRatio: number;
    confidence: number;
  } | null>(null);

  // AI MCP Copilot
  const [copilotAction, setCopilotAction] = useState<
    'summary' | 'search' | 'sql' | 'formula_audit' | 'ai_takeoff'
  >('summary');
  const [copilotQuery, setCopilotQuery] = useState('Concrete');
  const [copilotOutput, setCopilotOutput] = useState('');

  const handleRunAutoArea = async () => {
    setBusy(true);
    try {
      const z = await runAiAutoArea(activePlan?.imageDataUrl);
      setZones(z);
      const sel: Record<number, boolean> = {};
      z.forEach((_, idx) => {
        sel[idx] = true;
      });
      setSelectedZones(sel);
    } catch (err) {
      onNotify(`AI Auto Area error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRunSymbols = async () => {
    setBusy(true);
    try {
      const m = await runAiCountSymbols(
        symbolKind,
        activePlan?.imageDataUrl,
        confidenceThreshold
      );
      setMarkers(m);
    } catch (err) {
      onNotify(`AI Count Symbols error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRunTextScan = async () => {
    setBusy(true);
    try {
      const hits = await runAiScanText(
        textQuery,
        activePlan?.name ?? '',
        activePlan?.imageDataUrl
      );
      setTextHits(hits);
    } catch (err) {
      onNotify(`AI Scan Text error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRunAutoScale = async () => {
    if (!activePlan) return;
    setBusy(true);
    try {
      const res = await runAiAutoScale(
        activePlan.name,
        activePlan.originalFileName,
        activePlan.imageDataUrl
      );
      setScalePreview(res);
    } catch (err) {
      onNotify(`AI Auto Scale error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRunCopilot = async () => {
    setBusy(true);
    try {
      let res;
      if (copilotAction === 'summary') {
        res = await callMcpTool('cobitx_get_job_summary', { job_id: job.id });
      } else if (copilotAction === 'search') {
        res = await callMcpTool('cobitx_search_cost_libraries', { query: copilotQuery });
      } else if (copilotAction === 'formula_audit') {
        res = await callMcpTool('cobitx_run_formula_audit', { job_id: job.id });
      } else if (copilotAction === 'ai_takeoff') {
        res = await callMcpTool('cobitx_trigger_ai_takeoff', {
          mode: 'scan_text',
          plan_name: activePlan?.name ?? '',
          image_data_url: activePlan?.imageDataUrl ?? null,
          query_or_symbol: copilotQuery,
        });
      } else {
        res = await callMcpTool('cobitx_run_boq_sql', {
          sql: `SELECT code, description, quantity, unit, rate FROM estimate_items WHERE job_id = '${job.id.replace(/'/g, "''")}' ORDER BY sell_total DESC LIMIT 10`,
        });
      }
      setCopilotOutput(JSON.stringify(res.result, null, 2));
    } catch (err) {
      setCopilotOutput(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" style={{ width: 760, maxWidth: '95vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={14} color="#7c3aed" /> CobitX AI Estimating Suite — {activePlan?.name ?? 'No Plan'}
          </span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-tabs-bar">
          <button className={`modal-tab ${tab === 'AutoArea' ? 'active' : ''}`} onClick={() => setTab('AutoArea')}>
            Auto Area
          </button>
          <button className={`modal-tab ${tab === 'CountSymbols' ? 'active' : ''}`} onClick={() => setTab('CountSymbols')}>
            Count Symbols
          </button>
          <button className={`modal-tab ${tab === 'ScanText' ? 'active' : ''}`} onClick={() => setTab('ScanText')}>
            Scan Text
          </button>
          <button className={`modal-tab ${tab === 'AutoScale' ? 'active' : ''}`} onClick={() => setTab('AutoScale')}>
            Auto Scale &amp; Rename
          </button>
          <button className={`modal-tab ${tab === 'Copilot' ? 'active' : ''}`} onClick={() => setTab('Copilot')}>
            AI MCP Copilot
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '5px 8px', background: 'var(--bg-toolbar)', borderRadius: 4, border: '1px solid var(--border-main)' }}>
            Target Estimate Item: <strong>{selectedItem ? `${selectedItem.code} — ${selectedItem.description}` : 'First Item in Estimate'}</strong>
          </div>

          {tab === 'AutoArea' && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn-primary" disabled={busy} onClick={handleRunAutoArea}>
                  <Sparkles size={12} style={{ marginRight: 4 }} />
                  {busy ? 'Segmenting Rooms...' : 'Detect Room Boundaries (OpenCV / SAM 2)'}
                </button>
                {zones.length > 0 && (
                  <span style={{ fontSize: 11, color: '#0d9488', fontWeight: 600 }}>
                    Found {zones.length} room polygon(s)
                  </span>
                )}
              </div>

              {zones.length > 0 && (
                <div className="modal-table-wrap" style={{ maxHeight: 240 }}>
                  <table className="cubit-grid">
                    <thead>
                      <tr>
                        <th style={{ width: 34, textAlign: 'center' }}>Use</th>
                        <th>Detected Room / Zone</th>
                        <th className="num">Vertices</th>
                        <th className="num">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zones.map((z, idx) => (
                        <tr key={idx}>
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={!!selectedZones[idx]}
                              onChange={(e) =>
                                setSelectedZones((p) => ({ ...p, [idx]: e.target.checked }))
                              }
                            />
                          </td>
                          <td style={{ fontWeight: 600 }}>{z.label}</td>
                          <td className="num mono">{z.points.length}</td>
                          <td className="num mono">{formatNumber(z.confidence * 100, 0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'CountSymbols' && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  className="form-select"
                  style={{ width: 200 }}
                  value={symbolKind}
                  onChange={(e) => setSymbolKind(e.target.value)}
                >
                  <option value="Door Swing">Door Swing</option>
                  <option value="Window Tag">Window Tag</option>
                  <option value="LED Downlight">LED Downlight</option>
                  <option value="Double GPO">Double GPO</option>
                  <option value="Fire Sprinkler">Fire Sprinkler</option>
                </select>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <span>Confidence:</span>
                  <input
                    type="range"
                    min={0.55}
                    max={0.95}
                    step={0.01}
                    value={confidenceThreshold}
                    onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                    style={{ width: 100 }}
                  />
                  <span className="mono" style={{ width: 34 }}>{Math.round(confidenceThreshold * 100)}%</span>
                </label>
                <button className="btn-primary" disabled={busy} onClick={handleRunSymbols}>
                  <Sparkles size={12} style={{ marginRight: 4 }} />
                  {busy ? 'Scanning Sheet...' : 'Run Symbol Detector'}
                </button>
              </div>
              {markers.length > 0 && (
                <div style={{ fontSize: 11.5, color: '#0d9488', fontWeight: 600 }}>
                  Detected {markers.length} "{symbolKind}" symbol instance(s) ready for Count takeoff.
                </div>
              )}
            </>
          )}

          {tab === 'ScanText' && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="form-input"
                  style={{ width: 240 }}
                  value={textQuery}
                  onChange={(e) => setTextQuery(e.target.value)}
                  placeholder="Enter tag or room text (e.g. D01, CONSULT)"
                />
                <button className="btn-primary" disabled={busy} onClick={handleRunTextScan}>
                  <ScanText size={12} style={{ marginRight: 4 }} />
                  {busy ? 'Scanning Labels...' : 'Scan Text Labels'}
                </button>
              </div>
              {textHits.length > 0 && (
                <div className="modal-table-wrap" style={{ maxHeight: 210 }}>
                  <table className="cubit-grid">
                    <thead>
                      <tr>
                        <th>Matched Text</th>
                        <th className="num">X (px)</th>
                        <th className="num">Y (px)</th>
                        <th className="num">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {textHits.map((h, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{h.text}</td>
                          <td className="num mono">{h.x}</td>
                          <td className="num mono">{h.y}</td>
                          <td className="num mono">{formatNumber(h.confidence * 100, 0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'AutoScale' && (
            <>
              <button className="btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy || !activePlan} onClick={handleRunAutoScale}>
                <Compass size={12} style={{ marginRight: 4 }} />
                {busy ? 'Analysing Title Block...' : 'Run AI Auto Scale & Plan Rename'}
              </button>
              {scalePreview && (
                <div className="form-grid" style={{ gridTemplateColumns: '150px 1fr' }}>
                  <span className="form-label">Suggested Name:</span>
                  <span style={{ fontWeight: 600 }}>{scalePreview.suggestedName}</span>
                  <span className="form-label">Scale Label:</span>
                  <span className="mono">{scalePreview.detectedScaleLabel}</span>
                  <span className="form-label">Scale Ratio:</span>
                  <span className="mono">{scalePreview.suggestedScaleRatio} px/m ({formatNumber(scalePreview.confidence * 100, 0)}% conf.)</span>
                </div>
              )}
            </>
          )}

          {tab === 'Copilot' && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  className="form-select"
                  style={{ width: 245 }}
                  value={copilotAction}
                  onChange={(e) =>
                    setCopilotAction(
                      e.target.value as 'summary' | 'search' | 'sql' | 'formula_audit' | 'ai_takeoff'
                    )
                  }
                >
                  <option value="summary">Audit Job Summary (MCP)</option>
                  <option value="search">Search Cost Libraries (MCP)</option>
                  <option value="sql">Top 10 Highest Cost Items (DuckDB SQL)</option>
                  <option value="formula_audit">Run Formula &amp; Reference Audit (cobitx_run_formula_audit)</option>
                  <option value="ai_takeoff">Trigger AI Takeoff OCR Scan (cobitx_trigger_ai_takeoff)</option>
                </select>
                {(copilotAction === 'search' || copilotAction === 'ai_takeoff') && (
                  <input
                    className="form-input"
                    style={{ width: 180 }}
                    value={copilotQuery}
                    onChange={(e) => setCopilotQuery(e.target.value)}
                    placeholder={copilotAction === 'ai_takeoff' ? 'Text query / symbol' : 'Material / trade keyword'}
                  />
                )}
                <button className="btn-primary" disabled={busy} onClick={handleRunCopilot}>
                  <Bot size={12} style={{ marginRight: 4 }} />
                  {busy ? 'Querying MCP...' : 'Execute via MCP'}
                </button>
              </div>
              {copilotOutput && (
                <pre
                  className="mono"
                  style={{
                    margin: 0,
                    padding: 10,
                    background: '#0f172a',
                    color: '#e2e8f0',
                    borderRadius: 4,
                    maxHeight: 220,
                    overflow: 'auto',
                    fontSize: 10.5,
                  }}
                >
                  {copilotOutput}
                </pre>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
          {tab === 'AutoArea' && zones.length > 0 && (
            <button
              className="btn-primary"
              onClick={() => {
                const picked = zones.filter((_, i) => selectedZones[i]);
                if (picked.length > 0) {
                  onApplyAreaZones(picked);
                  onClose();
                }
              }}
            >
              <Check size={12} style={{ marginRight: 4 }} />
              Create Area Takeoff Shapes ({zones.filter((_, i) => selectedZones[i]).length})
            </button>
          )}
          {tab === 'CountSymbols' && markers.length > 0 && (
            <button
              className="btn-primary"
              onClick={() => {
                onApplyCountMarkers(
                  `AI ${symbolKind}`,
                  markers.map((m) => ({ x: m.x, y: m.y }))
                );
                onClose();
              }}
            >
              <Check size={12} style={{ marginRight: 4 }} />
              Add {markers.length} Symbol Count Markers
            </button>
          )}
          {tab === 'ScanText' && textHits.length > 0 && (
            <button
              className="btn-primary"
              onClick={() => {
                onApplyCountMarkers(
                  `AI Text "${textQuery}"`,
                  textHits.map((m) => ({ x: m.x, y: m.y }))
                );
                onClose();
              }}
            >
              <Check size={12} style={{ marginRight: 4 }} />
              Add {textHits.length} Text Count Markers
            </button>
          )}
          {tab === 'AutoScale' && scalePreview && activePlan && (
            <button
              className="btn-primary"
              onClick={() => {
                onApplyAutoScale(
                  activePlan.id,
                  scalePreview.suggestedName,
                  scalePreview.detectedScaleLabel,
                  scalePreview.suggestedScaleRatio
                );
                onClose();
              }}
            >
              <Check size={12} style={{ marginRight: 4 }} />
              Apply AI Scale &amp; Plan Name
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
