import React, { useState } from 'react';
import { Box, Layers, Sparkles, Upload, X } from 'lucide-react';
import type {
  EstimateRow,
  IfcResultMappingRule,
  PlanDocument,
  ResultType,
  TakeoffShape,
} from '../../types/cubit';
import {
  importIfcFile,
  loadSampleIfc,
  type ImportedIfcResponse,
} from '../../services/engineClient';
import { formatNumber } from '../../utils/estimateCalc';

interface IfcImportModalProps {
  existingShapesCount: number;
  onImportIfc: (payload: {
    plan: PlanDocument;
    newRows: EstimateRow[];
    newShapes: TakeoffShape[];
  }) => void;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

const RESULT_TYPE_CHOICES: ResultType[] = [
  'Area',
  'Vertical Area',
  'Vertical Area Less Openings',
  'Length',
  'Volume',
  'Count',
  'Door Counts',
  'Window Counts',
  'Exclude from total',
];

export const IfcImportModal: React.FC<IfcImportModalProps> = ({
  existingShapesCount,
  onImportIfc,
  onClose,
  onNotify,
}) => {
  const [parsed, setParsed] = useState<ImportedIfcResponse | null>(null);
  const [rules, setRules] = useState<IfcResultMappingRule[]>([]);
  const [generateRows, setGenerateRows] = useState(true);
  const [groupByLevel, setGroupByLevel] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadParsed = (res: ImportedIfcResponse) => {
    setParsed(res);
    setRules(
      res.classSummaries.map((cs) => ({
        ifcClass: cs.ifcClass,
        resultType: cs.defaultResultType,
        unit: cs.defaultUnit,
        include: true,
      }))
    );
  };

  const handleFileChange = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await importIfcFile(file);
      loadParsed(res);
      onNotify(
        `Parsed IFC BIM "${res.name}" (${res.ifcElements.length} elements across ${res.levels.length} storey(s)).`
      );
    } catch (err) {
      onNotify(`IFC import error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleLoadSample = async () => {
    setBusy(true);
    try {
      const res = await loadSampleIfc();
      loadParsed(res);
      onNotify(
        `Loaded sample 2-storey IFC BIM "${res.name}" (${res.ifcElements.length} 3D BIM elements).`
      );
    } catch (err) {
      onNotify(`Sample IFC error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleApplyImport = () => {
    if (!parsed) return;
    const planId = `plan-ifc-${Date.now()}`;
    const plan: PlanDocument = {
      id: planId,
      name: parsed.name,
      originalFileName: parsed.originalFileName,
      pageNumber: 1,
      kind: 'IFC',
      scaleLabel: parsed.scaleLabel,
      scaleRatio: parsed.scaleRatio,
      visible: true,
      revision: 'BIM v1',
      ifcElements: parsed.ifcElements,
      vectorPaths: parsed.vectorPaths,
      snapNodes: parsed.snapNodes,
      layers: parsed.layers,
      snapshots: [
        {
          id: `snap-ifc-${Date.now()}`,
          name: 'BIM 3D Iso',
          zoom: 1,
          panX: 30,
          panY: 20,
          isDefault: true,
        },
      ],
    };

    const newRows: EstimateRow[] = [];
    const newShapes: TakeoffShape[] = [];

    if (generateRows) {
      const ruleMap = new Map(rules.map((r) => [r.ifcClass, r]));
      const tradeId = `row-bim-trade-${Date.now()}`;
      newRows.push({
        id: tradeId,
        parentId: null,
        rowType: 'Trade',
        code: 'BIM',
        description: `BIM TAKEOFF — ${parsed.name.toUpperCase()}`,
        quantity: 0,
        unit: '',
        factor: 1,
        rate: 0,
        markupPct: 0,
        pricingMode: 'INCL',
        groupingCode: '',
        calcRows: [],
        rateRows: [],
      });

      // Compute normalized canvas footprint coordinates for linked 2D/3D shapes
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const el of parsed.ifcElements) {
        minX = Math.min(minX, el.xM);
        maxX = Math.max(maxX, el.xM + el.widthM);
        minY = Math.min(minY, el.yM);
        maxY = Math.max(maxY, el.yM + el.depthM);
      }
      const scalePx = parsed.scaleRatio || 28;

      const buckets = new Map<string, typeof parsed.ifcElements>();
      for (const el of parsed.ifcElements) {
        const rule = ruleMap.get(el.ifcClass);
        if (!rule?.include || rule.resultType === 'Exclude from total') continue;
        const key = groupByLevel ? `${el.level}::${el.ifcClass}` : el.ifcClass;
        const arr = buckets.get(key) ?? [];
        arr.push(el);
        buckets.set(key, arr);
      }

      let idx = 0;
      const headingByLevel = new Map<string, string>();
      for (const [, els] of buckets.entries()) {
        idx++;
        const first = els[0];
        const rule = ruleMap.get(first.ifcClass)!;

        let parentId = tradeId;
        if (groupByLevel) {
          let hId = headingByLevel.get(first.level);
          if (!hId) {
            hId = `row-bim-lvl-${Date.now()}-${headingByLevel.size}`;
            headingByLevel.set(first.level, hId);
            newRows.push({
              id: hId,
              parentId: tradeId,
              rowType: 'Heading',
              code: first.level.slice(0, 6).toUpperCase(),
              description: first.level,
              quantity: 0,
              unit: '',
              factor: 1,
              rate: 0,
              markupPct: 0,
              pricingMode: 'INCL',
              groupingCode: '',
              calcRows: [],
              rateRows: [],
            });
          }
          parentId = hId;
        }

        const itemId = `row-bim-item-${Date.now()}-${idx}`;
        const calcRows = [];
        let totalQty = 0;

        for (const el of els) {
          const sx = 80 + (el.xM - (Number.isFinite(minX) ? minX : 0)) * scalePx;
          const sy = 70 + (el.yM - (Number.isFinite(minY) ? minY : 0)) * scalePx;
          const sw = Math.max(6, el.widthM * scalePx);
          const sd = Math.max(6, el.depthM * scalePx);

          const shapeId = `shp-bim-${Date.now()}-${existingShapesCount + newShapes.length}`;
          newShapes.push({
            id: shapeId,
            name: el.name,
            planId,
            itemId,
            resultType: rule.resultType,
            color: el.color,
            points: [
              { x: sx, y: sy },
              { x: sx + sw, y: sy },
              { x: sx + sw, y: sy + sd },
              { x: sx, y: sy + sd },
            ],
            closed: true,
            heightMm: Math.round(el.heightM * 1000),
            depthMm: Math.round(el.heightM * 1000),
            ifcLevel: el.level,
          });

          const q = rule.resultType.includes('Count')
            ? 1
            : rule.resultType === 'Volume'
            ? el.volumeM3
            : rule.resultType.includes('Length')
            ? el.lengthM
            : el.areaM2;

          totalQty += q;
          calcRows.push({
            id: `calc-bim-${Date.now()}-${newShapes.length}`,
            description: `${el.name} (${el.level})`,
            shapeId,
            planId,
            resultType: rule.resultType,
            length: Number(el.lengthM.toFixed(2)),
            height: Math.round(el.heightM * 1000),
            factor: 1,
            quantity: Number(q.toFixed(2)),
            rounding: 'None' as const,
          });
        }

        newRows.push({
          id: itemId,
          parentId,
          rowType: 'Item',
          code: `BIM-${idx}`,
          description: `${first.ifcClass} (${els.length})`,
          resultType: rule.resultType,
          quantity: Number(totalQty.toFixed(2)),
          unit: rule.unit,
          factor: 1,
          rate: first.ifcClass.includes('Slab') ? 145 : first.ifcClass.includes('Wall') ? 195 : 85,
          markupPct: 10,
          pricingMode: 'INCL',
          groupingCode: first.ifcClass.toUpperCase(),
          calcRows,
          rateRows: [],
        });
      }
    }

    onImportIfc({ plan, newRows, newShapes });
    onNotify(
      `Imported IFC BIM "${parsed.name}" (${parsed.ifcElements.length} 3D objects, ${newRows.length} BOQ row(s)).`
    );
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" style={{ width: 780, maxWidth: '95vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Box size={14} color="#0d9488" /> Import IFC BIM &amp; Result Type Mapping Manager
          </span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <Upload size={13} color="var(--brand-blue)" /> Choose .IFC File (IFC2X3 / IFC4)
              <input
                type="file"
                accept=".ifc"
                style={{ display: 'none' }}
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              />
            </label>
            <button className="btn-secondary" disabled={busy} onClick={handleLoadSample}>
              <Sparkles size={13} color="#7c3aed" style={{ marginRight: 4 }} />
              {busy ? 'Parsing IFC...' : 'Load Sample 2-Storey Office BIM (.ifc)'}
            </button>
            {parsed && (
              <span style={{ fontSize: 11, color: '#0d9488', fontWeight: 600 }}>
                Loaded: {parsed.name} · {parsed.ifcElements.length} objects · {parsed.levels.length} storey(s)
              </span>
            )}
          </div>

          {parsed ? (
            <>
              <div style={{ display: 'flex', gap: 16, padding: '6px 8px', background: 'var(--bg-toolbar)', borderRadius: 4, border: '1px solid var(--border-main)' }}>
                <label className="form-checkbox-row" style={{ fontSize: 11.5 }}>
                  <input
                    type="checkbox"
                    checked={generateRows}
                    onChange={(e) => setGenerateRows(e.target.checked)}
                  />
                  Generate Estimate Trade &amp; Items + Linked Takeoff Shapes
                </label>
                <label className="form-checkbox-row" style={{ fontSize: 11.5 }}>
                  <input
                    type="checkbox"
                    checked={groupByLevel}
                    onChange={(e) => setGroupByLevel(e.target.checked)}
                    disabled={!generateRows}
                  />
                  <Layers size={12} color="var(--brand-blue)" /> Group BIM Hierarchy by IFC Storey Level
                </label>
              </div>

              <div className="modal-table-wrap" style={{ maxHeight: 290 }}>
                <table className="cubit-grid">
                  <thead>
                    <tr>
                      <th style={{ width: 34, textAlign: 'center' }}>Use</th>
                      <th>IFC Entity Class</th>
                      <th className="num">Objects</th>
                      <th className="num">Total Area (m²)</th>
                      <th className="num">Total Vol (m³)</th>
                      <th>Mapped Result Type</th>
                      <th style={{ width: 70 }}>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.classSummaries.map((cs) => {
                      const rule = rules.find((r) => r.ifcClass === cs.ifcClass);
                      if (!rule) return null;
                      return (
                        <tr key={cs.ifcClass}>
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={rule.include}
                              onChange={(e) =>
                                setRules((prev) =>
                                  prev.map((r) =>
                                    r.ifcClass === cs.ifcClass ? { ...r, include: e.target.checked } : r
                                  )
                                )
                              }
                            />
                          </td>
                          <td style={{ fontWeight: 600 }}>{cs.ifcClass}</td>
                          <td className="num mono">{cs.count}</td>
                          <td className="num mono">{formatNumber(cs.totalAreaM2)}</td>
                          <td className="num mono">{formatNumber(cs.totalVolumeM3)}</td>
                          <td>
                            <select
                              className="form-select"
                              style={{ height: 22, fontSize: 11 }}
                              value={rule.resultType}
                              onChange={(e) =>
                                setRules((prev) =>
                                  prev.map((r) =>
                                    r.ifcClass === cs.ifcClass
                                      ? { ...r, resultType: e.target.value as ResultType }
                                      : r
                                  )
                                )
                              }
                            >
                              {RESULT_TYPE_CHOICES.map((rt) => (
                                <option key={rt} value={rt}>
                                  {rt}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="form-input"
                              style={{ height: 22, fontSize: 11 }}
                              value={rule.unit}
                              onChange={(e) =>
                                setRules((prev) =>
                                  prev.map((r) =>
                                    r.ifcClass === cs.ifcClass ? { ...r, unit: e.target.value } : r
                                  )
                                )
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border-dark)', borderRadius: 4 }}>
              Select an <code>.ifc</code> model or load the built-in 2-storey office BIM to configure Result Type Mappings and inspect 3D quantities.
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!parsed || busy} onClick={handleApplyImport}>
            Import BIM Model &amp; Switch to 3D View
          </button>
        </div>
      </div>
    </div>
  );
};
