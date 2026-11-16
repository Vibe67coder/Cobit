import React, { useEffect, useState } from 'react';
import { AppWindow, DoorOpen, Plus, Trash2, X } from 'lucide-react';
import type { ShapeOpening, TakeoffShape } from '../../types/cubit';
import { fetchOpeningsLibrary, type OpeningPreset } from '../../services/engineClient';
import { computeShapeMetrics, formatNumber } from '../../utils/estimateCalc';

interface OpeningsModalProps {
  initialKind: 'Door' | 'Window';
  selectedShape: TakeoffShape | null;
  scaleRatio: number;
  onApplyOpenings: (shapeId: string, openings: ShapeOpening[]) => void;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

export const OpeningsModal: React.FC<OpeningsModalProps> = ({
  initialKind,
  selectedShape,
  scaleRatio,
  onApplyOpenings,
  onClose,
  onNotify,
}) => {
  const [library, setLibrary] = useState<OpeningPreset[]>([]);
  const [openings, setOpenings] = useState<ShapeOpening[]>(selectedShape?.openings ?? []);
  const [kind, setKind] = useState<'Door' | 'Window'>(initialKind);
  const [name, setName] = useState(initialKind === 'Door' ? 'Single Door 820x2040' : 'Window 1200x1200');
  const [widthMm, setWidthMm] = useState(initialKind === 'Door' ? 820 : 1200);
  const [heightMm, setHeightMm] = useState(initialKind === 'Door' ? 2040 : 1200);
  const [offsetMm, setOffsetMm] = useState(initialKind === 'Door' ? 0 : 900);

  useEffect(() => {
    fetchOpeningsLibrary().then(setLibrary);
  }, []);

  const addOpening = (op: Omit<ShapeOpening, 'id'>) => {
    setOpenings((prev) => [...prev, { ...op, id: `op-${Date.now()}-${prev.length}` }]);
  };

  const previewShape = selectedShape ? { ...selectedShape, openings } : null;
  const previewMetrics = previewShape ? computeShapeMetrics(previewShape, scaleRatio) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" style={{ width: 690, maxWidth: '94vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {initialKind === 'Door' ? <DoorOpen size={14} /> : <AppWindow size={14} />}
            Openings Library &amp; Wall Deductions
          </span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!selectedShape ? (
            <div style={{ padding: 12, background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 4, fontSize: 11.5 }}>
              No takeoff shape is currently selected. Select a Wall / Vertical / Line shape in the Viewport or Shapes pane to attach openings.
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-toolbar)', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border-light)' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{selectedShape.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Result Type: {selectedShape.resultType} · Wall Length: {formatNumber(previewMetrics?.lengthM ?? 0)} m
                </div>
              </div>
              {previewMetrics && (
                <div style={{ textAlign: 'right', fontSize: 11 }}>
                  <div>Deduction: <strong className="mono">-{formatNumber(previewMetrics.openingDeductionM2)} m²</strong></div>
                  <div>Net Vertical Area: <strong className="mono" style={{ color: 'var(--brand-blue)' }}>{formatNumber(previewMetrics.verticalAreaM2)} m²</strong></div>
                </div>
              )}
            </div>
          )}

          {/* Standard Library Presets */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: 'var(--text-secondary)' }}>
              Standard Openings Library (SQLite)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {library.map((preset) => (
                <button
                  key={preset.id}
                  className="btn-secondary"
                  style={{ fontSize: 10.5, padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  disabled={!selectedShape}
                  onClick={() =>
                    addOpening({
                      kind: preset.kind,
                      name: preset.name,
                      widthMm: preset.widthMm,
                      heightMm: preset.heightMm,
                      offsetMm: preset.offsetMm,
                      thicknessMm: 110,
                      positionRatio: 0.5,
                    })
                  }
                >
                  <Plus size={11} color="var(--brand-blue)" />
                  {preset.kind}: {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Opening Builder */}
          <div style={{ display: 'grid', gridTemplateColumns: '85px 1fr 78px 78px 78px auto', gap: 6, alignItems: 'center' }}>
            <select
              className="form-select"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'Door' | 'Window')}
            >
              <option value="Door">Door</option>
              <option value="Window">Window</option>
            </select>
            <input
              className="form-input"
              placeholder="Opening Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              type="number"
              className="form-input mono"
              title="Width (mm)"
              value={widthMm}
              onChange={(e) => setWidthMm(Number(e.target.value) || 0)}
            />
            <input
              type="number"
              className="form-input mono"
              title="Height (mm)"
              value={heightMm}
              onChange={(e) => setHeightMm(Number(e.target.value) || 0)}
            />
            <input
              type="number"
              className="form-input mono"
              title="Offset along wall (mm)"
              value={offsetMm}
              onChange={(e) => setOffsetMm(Number(e.target.value) || 0)}
            />
            <button
              className="btn-primary"
              disabled={!selectedShape}
              onClick={() =>
                addOpening({
                  kind,
                  name,
                  widthMm,
                  heightMm,
                  offsetMm,
                  thicknessMm: 110,
                  positionRatio: 0.5,
                })
              }
            >
              + Add
            </button>
          </div>

          {/* Attached Openings List */}
          <div style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid var(--border-main)' }}>
            <table className="cubit-table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Kind</th>
                  <th>Name</th>
                  <th className="num" style={{ width: 80 }}>Width (mm)</th>
                  <th className="num" style={{ width: 80 }}>Height (mm)</th>
                  <th className="num" style={{ width: 80 }}>Offset (mm)</th>
                  <th className="num" style={{ width: 80 }}>Area (m²)</th>
                  <th style={{ width: 34 }}></th>
                </tr>
              </thead>
              <tbody>
                {openings.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 14 }}>
                      No openings added to this shape yet.
                    </td>
                  </tr>
                ) : (
                  openings.map((op) => (
                    <tr key={op.id}>
                      <td>{op.kind}</td>
                      <td>{op.name}</td>
                      <td className="num mono">{op.widthMm}</td>
                      <td className="num mono">{op.heightMm}</td>
                      <td className="num mono">{op.offsetMm}</td>
                      <td className="num mono">{formatNumber((op.widthMm / 1000) * (op.heightMm / 1000))}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className="pane-icon-btn"
                          onClick={() => setOpenings((prev) => prev.filter((x) => x.id !== op.id))}
                        >
                          <Trash2 size={12} color="#dc2626" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!selectedShape}
            onClick={() => {
              if (!selectedShape) return;
              onApplyOpenings(selectedShape.id, openings);
              onNotify(`Applied ${openings.length} opening(s) to "${selectedShape.name}".`);
              onClose();
            }}
          >
            Apply Openings &amp; Recalculate
          </button>
        </div>
      </div>
    </div>
  );
};
