import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { EstimateRow, JobRecord } from '../../types/cubit';
import { formatCurrency } from '../../utils/estimateCalc';

type CascadeMode = 'Down' | 'Up' | 'Up and Down' | 'None';

interface PriceListInsertModalProps {
  priceLists: JobRecord[];
  onInsertRows: (rows: EstimateRow[], action: 'Insert' | 'Replace' | 'Add Rate') => void;
  onClose: () => void;
}

export const PriceListInsertModal: React.FC<PriceListInsertModalProps> = ({
  priceLists,
  onInsertRows,
  onClose,
}) => {
  const [selectedListId, setSelectedListId] = useState<string>(priceLists[0]?.id ?? '');
  const [cascade, setCascade] = useState<CascadeMode>('Down');
  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});

  const activeList = priceLists.find((p) => p.id === selectedListId) ?? priceLists[0];

  const toggleRow = (row: EstimateRow) => {
    const next = { ...checkedIds };
    const newVal = !next[row.id];
    next[row.id] = newVal;

    if (activeList) {
      if (cascade === 'Down' || cascade === 'Up and Down') {
        const markChildren = (pid: string) => {
          activeList.rows
            .filter((r) => r.parentId === pid)
            .forEach((child) => {
              next[child.id] = newVal;
              markChildren(child.id);
            });
        };
        markChildren(row.id);
      }
      if ((cascade === 'Up' || cascade === 'Up and Down') && newVal) {
        let curParent = row.parentId;
        while (curParent) {
          next[curParent] = true;
          const parentRow = activeList.rows.find((r) => r.id === curParent);
          curParent = parentRow?.parentId ?? null;
        }
      }
    }
    setCheckedIds(next);
  };

  const getSelectedRows = (): EstimateRow[] => {
    if (!activeList) return [];
    return activeList.rows.filter((r) => checkedIds[r.id]);
  };

  const handleAction = (action: 'Insert' | 'Replace' | 'Add Rate') => {
    const picked = getSelectedRows();
    if (picked.length === 0) return;
    onInsertRows(picked, action);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-window"
        style={{ width: 760, height: 500 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>Insert from Price List</span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: 'var(--bg-panel)',
            borderBottom: '1px solid var(--border-main)',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="form-label">Price List:</span>
            <select
              className="form-select"
              style={{ width: 260 }}
              value={selectedListId}
              onChange={(e) => {
                setSelectedListId(e.target.value);
                setCheckedIds({});
              }}
            >
              {priceLists.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="form-label">Cascade Selection:</span>
            <select
              className="form-select"
              style={{ width: 150 }}
              value={cascade}
              onChange={(e) => setCascade(e.target.value as CascadeMode)}
            >
              <option value="Down">Down</option>
              <option value="Up">Up</option>
              <option value="Up and Down">Up and Down</option>
              <option value="None">None</option>
            </select>
          </div>
        </div>

        <div className="modal-body" style={{ padding: 0 }}>
          <table className="cubit-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th style={{ width: 85 }}>Code</th>
                <th>Description</th>
                <th style={{ width: 65 }}>Unit</th>
                <th style={{ width: 100 }} className="num">Rate</th>
              </tr>
            </thead>
            <tbody>
              {(activeList?.rows ?? []).map((r) => (
                <tr
                  key={r.id}
                  className={r.rowType === 'Trade' ? 'row-trade' : r.rowType === 'Heading' ? 'row-heading' : ''}
                  onClick={() => toggleRow(r)}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={!!checkedIds[r.id]}
                      onChange={() => {}}
                    />
                  </td>
                  <td className="mono">{r.code}</td>
                  <td style={{ paddingLeft: r.parentId ? 22 : 7 }}>{r.description}</td>
                  <td>{r.unit}</td>
                  <td className="num mono">{r.rowType === 'Item' ? formatCurrency(r.rate) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-secondary" onClick={() => handleAction('Add Rate')}>
            Add Rate
          </button>
          <button className="btn-secondary" onClick={() => handleAction('Replace')}>
            Replace
          </button>
          <button className="btn-primary" onClick={() => handleAction('Insert')}>
            Insert
          </button>
        </div>
      </div>
    </div>
  );
};
