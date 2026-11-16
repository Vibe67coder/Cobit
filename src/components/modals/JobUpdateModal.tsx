import React, { useMemo, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import type { JobRecord } from '../../types/cubit';
import { computeRowRate, formatCurrency } from '../../utils/estimateCalc';

interface JobUpdateModalProps {
  job: JobRecord;
  priceLists: JobRecord[];
  onApplyUpdates: (sourcePriceListId: string, selectedRowIds: string[]) => void;
  onClose: () => void;
}

export const JobUpdateModal: React.FC<JobUpdateModalProps> = ({
  job,
  priceLists,
  onApplyUpdates,
  onClose,
}) => {
  const [sourceId, setSourceId] = useState(priceLists[0]?.id ?? '');
  const sourceList = priceLists.find((p) => p.id === sourceId) ?? null;

  const diffs = useMemo(() => {
    if (!sourceList) return [];
    const byCode = new Map(
      sourceList.rows
        .filter((r) => r.rowType === 'Item' && r.code)
        .map((r) => [r.code.trim().toUpperCase(), r])
    );

    return job.rows
      .filter((r) => r.rowType === 'Item' && byCode.has(r.code.trim().toUpperCase()))
      .map((r) => {
        const src = byCode.get(r.code.trim().toUpperCase())!;
        const currentRate = computeRowRate(r);
        const newRate = computeRowRate(src);
        return {
          row: r,
          src,
          currentRate,
          newRate,
          changed: Math.abs(currentRate - newRate) > 0.005,
        };
      });
  }, [job.rows, sourceList]);

  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const d of diffs) {
      init[d.row.id] = d.changed;
    }
    return init;
  });

  const selectedIds = diffs.filter((d) => checkedIds[d.row.id] ?? d.changed).map((d) => d.row.id);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" style={{ width: 720, maxWidth: '94vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} color="var(--brand-blue)" /> Job Update &amp; Price List Rate Propagation
          </span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600 }}>Source Cost Library / Price List:</span>
            <select
              className="form-select"
              style={{ width: 320 }}
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
            >
              {priceLists.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name} ({pl.rows.filter((r) => r.rowType === 'Item').length} items)
                </option>
              ))}
            </select>
          </div>

          <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border-main)' }}>
            <table className="cubit-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>Sync</th>
                  <th style={{ width: 80 }}>Code</th>
                  <th>Item Description</th>
                  <th className="num" style={{ width: 100 }}>Current Rate</th>
                  <th className="num" style={{ width: 100 }}>Library Rate</th>
                  <th className="num" style={{ width: 90 }}>Delta</th>
                </tr>
              </thead>
              <tbody>
                {diffs.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)' }}>
                      No matching Item Codes found between "{job.name}" and selected Price List.
                    </td>
                  </tr>
                ) : (
                  diffs.map((d) => {
                    const delta = d.newRate - d.currentRate;
                    const isChecked = checkedIds[d.row.id] ?? d.changed;
                    return (
                      <tr key={d.row.id}>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) =>
                              setCheckedIds((prev) => ({ ...prev, [d.row.id]: e.target.checked }))
                            }
                          />
                        </td>
                        <td className="mono">{d.row.code}</td>
                        <td>{d.row.description}</td>
                        <td className="num mono">{formatCurrency(d.currentRate)}</td>
                        <td className="num mono" style={{ fontWeight: 700, color: 'var(--brand-blue)' }}>
                          {formatCurrency(d.newRate)}
                        </td>
                        <td
                          className="num mono"
                          style={{ color: delta > 0 ? '#dc2626' : delta < 0 ? '#16a34a' : 'var(--text-muted)' }}
                        >
                          {delta >= 0 ? '+' : ''}{formatCurrency(delta)}
                        </td>
                      </tr>
                    );
                  })
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
            disabled={!sourceId || selectedIds.length === 0}
            onClick={() => {
              onApplyUpdates(sourceId, selectedIds);
              onClose();
            }}
          >
            Update {selectedIds.length} Item Rate(s)
          </button>
        </div>
      </div>
    </div>
  );
};
