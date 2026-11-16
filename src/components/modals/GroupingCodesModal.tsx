import React, { useMemo, useState } from 'react';
import { GitFork, Plus, Tags, Trash2, X } from 'lucide-react';
import type { EstimateRow, GroupingCodeDef } from '../../types/cubit';
import { computeItemTotal, formatCurrency } from '../../utils/estimateCalc';

interface GroupingCodesModalProps {
  groupingCodes: GroupingCodeDef[];
  rows: EstimateRow[];
  selectedRow: EstimateRow | null;
  onSaveCodes: (next: GroupingCodeDef[]) => void;
  onAssignRowCode: (rowId: string, code: string) => void;
  onGenerateGroupedJob: () => void;
  onClose: () => void;
}

export const GroupingCodesModal: React.FC<GroupingCodesModalProps> = ({
  groupingCodes,
  rows,
  selectedRow,
  onSaveCodes,
  onAssignRowCode,
  onGenerateGroupedJob,
  onClose,
}) => {
  const [codes, setCodes] = useState<GroupingCodeDef[]>(groupingCodes);
  const [newCode, setNewCode] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newKind, setNewKind] = useState<'Quantity' | 'Rate'>('Quantity');

  const summaryByCode = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    for (const r of rows) {
      if (r.rowType !== 'Item') continue;
      const gc = r.groupingCode || 'UNASSIGNED';
      if (!map[gc]) map[gc] = { count: 0, total: 0 };
      map[gc].count += 1;
      map[gc].total += computeItemTotal(r);
    }
    return map;
  }, [rows]);

  const handleAdd = () => {
    if (!newCode.trim()) return;
    setCodes((prev) => [
      ...prev,
      {
        id: `gc-${Date.now()}`,
        kind: newKind,
        code: newCode.trim().toUpperCase(),
        description: newDesc.trim() || newCode.trim(),
      },
    ]);
    setNewCode('');
    setNewDesc('');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" style={{ width: 720, maxWidth: '94vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Tags size={14} color="#7c3aed" /> Grouping Codes &amp; Group Job Manager
          </span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {selectedRow && selectedRow.rowType === 'Item' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-toolbar)', borderRadius: 4, border: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>Assign Selected Item ({selectedRow.code}):</span>
              <select
                className="form-select"
                style={{ width: 220 }}
                value={selectedRow.groupingCode}
                onChange={(e) => onAssignRowCode(selectedRow.id, e.target.value)}
              >
                <option value="">-- Unassigned --</option>
                {codes.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.code} — {c.description}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border-main)' }}>
            <table className="cubit-table">
              <thead>
                <tr>
                  <th style={{ width: 80 }}>Kind</th>
                  <th style={{ width: 110 }}>Code</th>
                  <th>Description</th>
                  <th className="num" style={{ width: 70 }}>Items</th>
                  <th className="num" style={{ width: 115 }}>BOQ Total</th>
                  <th style={{ width: 34 }}></th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => {
                  const stat = summaryByCode[c.code] ?? { count: 0, total: 0 };
                  return (
                    <tr key={c.id}>
                      <td>{c.kind}</td>
                      <td className="mono" style={{ fontWeight: 700, color: '#7c3aed' }}>{c.code}</td>
                      <td>{c.description}</td>
                      <td className="num mono">{stat.count}</td>
                      <td className="num mono">{formatCurrency(stat.total)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className="pane-icon-btn"
                          onClick={() => setCodes((prev) => prev.filter((x) => x.id !== c.id))}
                        >
                          <Trash2 size={12} color="#dc2626" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '100px 120px 1fr auto', gap: 6 }}>
            <select
              className="form-select"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as 'Quantity' | 'Rate')}
            >
              <option value="Quantity">Quantity</option>
              <option value="Rate">Rate</option>
            </select>
            <input
              className="form-input mono"
              placeholder="CODE"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
            />
            <input
              className="form-input"
              placeholder="Grouping Code Description"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
            <button className="btn-secondary" onClick={handleAdd} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Plus size={12} /> Add Code
            </button>
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <button
            className="btn-secondary"
            onClick={() => {
              onSaveCodes(codes);
              onGenerateGroupedJob();
              onClose();
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <GitFork size={13} color="var(--brand-blue)" /> Generate Grouped Job
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                onSaveCodes(codes);
                onClose();
              }}
            >
              Save Codes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
