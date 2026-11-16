import React, { useState } from 'react';
import { Layers, Plus, ToggleLeft, ToggleRight, Trash2, X } from 'lucide-react';
import type {
  EstimateRow,
  JobRecord,
  OptionPackage,
  VariationRecord,
} from '../../types/cubit';
import { LOCKED_JOB_STATUSES } from '../../utils/estimateCalc';

interface OptionsVariationsModalProps {
  job: JobRecord;
  initialTab: 'Options' | 'Variations';
  selectedRow: EstimateRow | null;
  onUpdateJob: (patch: Partial<JobRecord>) => void;
  onUpdateRow: (rowId: string, patch: Partial<EstimateRow>) => void;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

const VARIATION_CYCLE: VariationRecord['status'][] = ['Pending', 'Approved', 'Rejected'];

export const OptionsVariationsModal: React.FC<OptionsVariationsModalProps> = ({
  job,
  initialTab,
  selectedRow,
  onUpdateJob,
  onUpdateRow,
  onClose,
  onNotify,
}) => {
  const [tab, setTab] = useState<'Options' | 'Variations'>(initialTab);

  // New Option form
  const [optName, setOptName] = useState('');
  const [optDesc, setOptDesc] = useState('');

  // New Variation form
  const [varCode, setVarCode] = useState('');
  const [varName, setVarName] = useState('');
  const [varGroup, setVarGroup] = useState('');

  const optionsList = job.optionsPackages ?? [];
  const variationsList = job.variations ?? [];
  const freeze = job.freezeStates ?? ['None'];

  const isStatusLocked = LOCKED_JOB_STATUSES.has(job.status);
  const isJobFrozen = isStatusLocked || freeze.includes('Job') || freeze.includes('Estimate');
  const isOptionsFrozen =
    isJobFrozen ||
    freeze.includes('Options') ||
    freeze.includes('Option Values') ||
    freeze.includes('Option Configurations');

  const handleAddOption = () => {
    if (isOptionsFrozen) {
      onNotify(`Options are locked (${isStatusLocked ? `Status: ${job.status}` : 'Freeze active'}).`);
      return;
    }
    if (!optName.trim()) return;
    const next: OptionPackage = {
      id: `opt-${Date.now()}`,
      name: optName.trim(),
      description: optDesc.trim() || 'Alternate scope package',
      enabled: true,
    };
    onUpdateJob({ optionsPackages: [...optionsList, next] });
    setOptName('');
    setOptDesc('');
    onNotify(`Created Option Package "${next.name}".`);
  };

  const handleToggleOption = (id: string) => {
    if (isOptionsFrozen) {
      onNotify('Options are frozen and cannot be toggled.');
      return;
    }
    onUpdateJob({
      optionsPackages: optionsList.map((o) =>
        o.id === id ? { ...o, enabled: !o.enabled } : o
      ),
    });
  };

  const handleDeleteOption = (id: string) => {
    if (isOptionsFrozen) {
      onNotify('Options are frozen and cannot be deleted.');
      return;
    }
    onUpdateJob({
      optionsPackages: optionsList.filter((o) => o.id !== id),
      rows: job.rows.map((r) => (r.optionId === id ? { ...r, optionId: undefined } : r)),
    });
  };

  const handleAssignOption = (id: string | undefined) => {
    if (!selectedRow) return;
    if (isOptionsFrozen) {
      onNotify('Options assignment is locked by freeze state or job status.');
      return;
    }
    onUpdateRow(selectedRow.id, { optionId: id });
  };

  const handleAddVariation = () => {
    if (isJobFrozen) {
      onNotify(`Variations are locked (${isStatusLocked ? `Status: ${job.status}` : 'Freeze active'}).`);
      return;
    }
    if (!varName.trim()) return;
    const next: VariationRecord = {
      id: `var-${Date.now()}`,
      code: varCode.trim() || `V${String(variationsList.length + 1).padStart(2, '0')}`,
      name: varName.trim(),
      status: 'Pending',
      containerGroup: varGroup.trim() || undefined,
    };
    onUpdateJob({ variations: [...variationsList, next] });
    setVarCode('');
    setVarName('');
    setVarGroup('');
    onNotify(`Created Variation "${next.code} — ${next.name}".`);
  };

  const handleCycleVariation = (id: string) => {
    if (isJobFrozen) {
      onNotify('Job is locked; variation status cannot be changed.');
      return;
    }
    onUpdateJob({
      variations: variationsList.map((v) => {
        if (v.id !== id) return v;
        const idx = VARIATION_CYCLE.indexOf(v.status);
        return { ...v, status: VARIATION_CYCLE[(idx + 1) % VARIATION_CYCLE.length] };
      }),
    });
  };

  const handleDeleteVariation = (id: string) => {
    if (isJobFrozen) {
      onNotify('Job is locked; variation cannot be deleted.');
      return;
    }
    onUpdateJob({
      variations: variationsList.filter((v) => v.id !== id),
      rows: job.rows.map((r) => (r.variationId === id ? { ...r, variationId: undefined } : r)),
    });
  };

  const handleAssignVariation = (id: string | undefined) => {
    if (!selectedRow) return;
    if (isJobFrozen) {
      onNotify('Job is locked; row variation assignment blocked.');
      return;
    }
    onUpdateRow(selectedRow.id, { variationId: id });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" style={{ width: 760, maxWidth: '95vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Layers size={14} color="var(--brand-blue)" /> Options Packages &amp; Contract Variations — {job.name}
          </span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-tabs-bar">
          <button
            className={`modal-tab ${tab === 'Options' ? 'active' : ''}`}
            onClick={() => setTab('Options')}
          >
            Options Packages ({optionsList.length})
          </button>
          <button
            className={`modal-tab ${tab === 'Variations' ? 'active' : ''}`}
            onClick={() => setTab('Variations')}
          >
            Variations ({variationsList.length})
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              padding: '5px 8px',
              background: 'var(--bg-toolbar)',
              borderRadius: 4,
              border: '1px solid var(--border-main)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>
              Selected Estimate Row:{' '}
              <strong>
                {selectedRow
                  ? `${selectedRow.code || selectedRow.rowType} — ${selectedRow.description}`
                  : 'None selected'}
              </strong>
            </span>
            {isOptionsFrozen && (
              <span className="status-badge status-locked">Frozen / Locked</span>
            )}
          </div>

          {tab === 'Options' && (
            <>
              <div className="modal-table-wrap" style={{ maxHeight: 240 }}>
                <table className="cubit-grid">
                  <thead>
                    <tr>
                      <th>Enabled</th>
                      <th>Package Name</th>
                      <th>Description</th>
                      <th className="num">Rows</th>
                      <th style={{ width: 155 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optionsList.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 14 }}>
                          No Option Packages defined yet.
                        </td>
                      </tr>
                    ) : (
                      optionsList.map((o) => {
                        const rowCount = job.rows.filter((r) => r.optionId === o.id).length;
                        const isAssigned = selectedRow?.optionId === o.id;
                        return (
                          <tr key={o.id}>
                            <td>
                              <button
                                className="btn-secondary"
                                style={{ height: 22, padding: '0 6px', fontSize: 10.5 }}
                                onClick={() => handleToggleOption(o.id)}
                              >
                                {o.enabled ? (
                                  <ToggleRight size={13} color="#16a34a" style={{ marginRight: 3 }} />
                                ) : (
                                  <ToggleLeft size={13} color="#64748b" style={{ marginRight: 3 }} />
                                )}
                                {o.enabled ? 'On' : 'Off'}
                              </button>
                            </td>
                            <td style={{ fontWeight: 600 }}>{o.name}</td>
                            <td>{o.description}</td>
                            <td className="num mono">{rowCount}</td>
                            <td style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              {selectedRow && (
                                <button
                                  className={isAssigned ? 'btn-primary' : 'btn-secondary'}
                                  style={{ height: 22, padding: '0 7px', fontSize: 10.5 }}
                                  onClick={() => handleAssignOption(isAssigned ? undefined : o.id)}
                                >
                                  {isAssigned ? 'Unassign Row' : 'Assign Row'}
                                </button>
                              )}
                              <button
                                className="pane-icon-btn"
                                title="Delete Option Package"
                                onClick={() => handleDeleteOption(o.id)}
                              >
                                <Trash2 size={12} color="var(--accent-red)" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  className="form-input"
                  style={{ width: 200 }}
                  placeholder="Option Name (e.g. Solar Array)"
                  value={optName}
                  onChange={(e) => setOptName(e.target.value)}
                />
                <input
                  className="form-input"
                  style={{ flex: 1 }}
                  placeholder="Description"
                  value={optDesc}
                  onChange={(e) => setOptDesc(e.target.value)}
                />
                <button className="btn-primary" onClick={handleAddOption}>
                  <Plus size={12} style={{ marginRight: 3 }} /> Add Option
                </button>
              </div>
            </>
          )}

          {tab === 'Variations' && (
            <>
              <div className="modal-table-wrap" style={{ maxHeight: 240 }}>
                <table className="cubit-grid">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Variation Name</th>
                      <th>Container Group</th>
                      <th>Status (Click to Cycle)</th>
                      <th className="num">Rows</th>
                      <th style={{ width: 155 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variationsList.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 14 }}>
                          No Contract Variations defined yet.
                        </td>
                      </tr>
                    ) : (
                      variationsList.map((v) => {
                        const rowCount = job.rows.filter((r) => r.variationId === v.id).length;
                        const isAssigned = selectedRow?.variationId === v.id;
                        return (
                          <tr key={v.id}>
                            <td className="mono" style={{ fontWeight: 600 }}>{v.code}</td>
                            <td style={{ fontWeight: 600 }}>{v.name}</td>
                            <td>{v.containerGroup ?? '—'}</td>
                            <td>
                              <button
                                className={`status-badge ${
                                  v.status === 'Approved'
                                    ? 'status-won'
                                    : v.status === 'Pending'
                                    ? 'status-open'
                                    : 'status-locked'
                                }`}
                                style={{ border: 'none', cursor: 'pointer' }}
                                onClick={() => handleCycleVariation(v.id)}
                                title="Click to cycle Pending / Approved / Rejected"
                              >
                                {v.status}
                              </button>
                            </td>
                            <td className="num mono">{rowCount}</td>
                            <td style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              {selectedRow && (
                                <button
                                  className={isAssigned ? 'btn-primary' : 'btn-secondary'}
                                  style={{ height: 22, padding: '0 7px', fontSize: 10.5 }}
                                  onClick={() => handleAssignVariation(isAssigned ? undefined : v.id)}
                                >
                                  {isAssigned ? 'Unassign Row' : 'Assign Row'}
                                </button>
                              )}
                              <button
                                className="pane-icon-btn"
                                title="Delete Variation"
                                onClick={() => handleDeleteVariation(v.id)}
                              >
                                <Trash2 size={12} color="var(--accent-red)" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  className="form-input mono"
                  style={{ width: 90 }}
                  placeholder="V02"
                  value={varCode}
                  onChange={(e) => setVarCode(e.target.value)}
                />
                <input
                  className="form-input"
                  style={{ flex: 1 }}
                  placeholder="Variation Name (e.g. Client Partition Revision)"
                  value={varName}
                  onChange={(e) => setVarName(e.target.value)}
                />
                <input
                  className="form-input"
                  style={{ width: 150 }}
                  placeholder="Group (optional)"
                  value={varGroup}
                  onChange={(e) => setVarGroup(e.target.value)}
                />
                <button className="btn-primary" onClick={handleAddVariation}>
                  <Plus size={12} style={{ marginRight: 3 }} /> Add Variation
                </button>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
