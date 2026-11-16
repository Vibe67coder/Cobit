import React, { useState } from 'react';
import { Download, Plus, Trash2, Upload, X } from 'lucide-react';
import type { ConstantEntry } from '../../types/cubit';

interface ConstantsModalProps {
  constants: ConstantEntry[];
  onSave: (next: ConstantEntry[]) => void;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

export const ConstantsModal: React.FC<ConstantsModalProps> = ({
  constants,
  onSave,
  onClose,
  onNotify,
}) => {
  const [rows, setRows] = useState<ConstantEntry[]>(constants);
  const [groupFilter, setGroupFilter] = useState<string>('All');
  const [newEntry, setNewEntry] = useState<Omit<ConstantEntry, 'id'>>({
    group: 'Concrete',
    name: '',
    symbol: '',
    value: 1,
    unit: 'factor',
    notes: '',
  });

  const groups = ['All', ...Array.from(new Set(rows.map((r) => r.group)))];
  const filtered = rows.filter((r) => groupFilter === 'All' || r.group === groupFilter);

  const handleAdd = () => {
    if (!newEntry.name.trim() || !newEntry.symbol.trim()) {
      onNotify('Enter both a Constant Name and Symbol.');
      return;
    }
    const cleanSym = newEntry.symbol.trim().toUpperCase().replace(/\s+/g, '_');
    const created: ConstantEntry = {
      id: `const-${Date.now()}`,
      group: newEntry.group.trim() || 'General',
      name: newEntry.name.trim(),
      symbol: cleanSym,
      value: Number(newEntry.value) || 0,
      unit: newEntry.unit.trim() || 'factor',
      notes: newEntry.notes?.trim() || '',
    };
    setRows((prev) => [...prev, created]);
    setNewEntry({
      group: newEntry.group,
      name: '',
      symbol: '',
      value: 1,
      unit: 'factor',
      notes: '',
    });
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cobitx-constants.json';
    a.click();
    URL.revokeObjectURL(url);
    onNotify('Exported Constants library (cobitx-constants.json).');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (Array.isArray(parsed)) {
          setRows(parsed);
          onNotify(`Imported ${parsed.length} constant(s).`);
        }
      } catch {
        onNotify('Invalid JSON constants file.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" style={{ width: 760, maxWidth: '94vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Constants Manager (Reusable Formula Factors &amp; Densities)</span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Group:</span>
              <select
                className="form-select"
                style={{ width: 150 }}
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
              >
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <label className="btn-secondary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Upload size={12} /> Import JSON
                <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
              </label>
              <button className="btn-secondary" onClick={handleExport} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Download size={12} /> Export JSON
              </button>
            </div>
          </div>

          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border-main)' }}>
            <table className="cubit-table">
              <thead>
                <tr>
                  <th style={{ width: 95 }}>Group</th>
                  <th style={{ width: 105 }}>Symbol</th>
                  <th>Name</th>
                  <th className="num" style={{ width: 85 }}>Value</th>
                  <th style={{ width: 70 }}>Unit</th>
                  <th>Notes</th>
                  <th style={{ width: 34 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td>{c.group}</td>
                    <td className="mono" style={{ fontWeight: 600, color: 'var(--brand-blue)' }}>
                      {c.symbol}
                    </td>
                    <td>{c.name}</td>
                    <td className="num mono">
                      <input
                        type="number"
                        className="inline-cell-input mono"
                        value={c.value}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) =>
                              x.id === c.id ? { ...x, value: Number(e.target.value) || 0 } : x
                            )
                          )
                        }
                      />
                    </td>
                    <td>{c.unit}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{c.notes}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className="pane-icon-btn"
                        title="Delete Constant"
                        onClick={() => setRows((prev) => prev.filter((x) => x.id !== c.id))}
                      >
                        <Trash2 size={12} color="#dc2626" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '100px 100px 1fr 80px 70px 1fr auto',
              gap: 6,
              alignItems: 'center',
              padding: 8,
              background: 'var(--bg-toolbar)',
              border: '1px solid var(--border-light)',
              borderRadius: 4,
            }}
          >
            <input
              className="form-input"
              placeholder="Group"
              value={newEntry.group}
              onChange={(e) => setNewEntry((p) => ({ ...p, group: e.target.value }))}
            />
            <input
              className="form-input mono"
              placeholder="SYMBOL"
              value={newEntry.symbol}
              onChange={(e) => setNewEntry((p) => ({ ...p, symbol: e.target.value }))}
            />
            <input
              className="form-input"
              placeholder="Description"
              value={newEntry.name}
              onChange={(e) => setNewEntry((p) => ({ ...p, name: e.target.value }))}
            />
            <input
              type="number"
              className="form-input mono"
              placeholder="Value"
              value={newEntry.value}
              onChange={(e) => setNewEntry((p) => ({ ...p, value: Number(e.target.value) || 0 }))}
            />
            <input
              className="form-input"
              placeholder="Unit"
              value={newEntry.unit}
              onChange={(e) => setNewEntry((p) => ({ ...p, unit: e.target.value }))}
            />
            <input
              className="form-input"
              placeholder="Notes"
              value={newEntry.notes ?? ''}
              onChange={(e) => setNewEntry((p) => ({ ...p, notes: e.target.value }))}
            />
            <button
              className="btn-primary"
              onClick={handleAdd}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Plus size={12} /> Add
            </button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              onSave(rows);
              onClose();
            }}
          >
            Save Constants
          </button>
        </div>
      </div>
    </div>
  );
};
