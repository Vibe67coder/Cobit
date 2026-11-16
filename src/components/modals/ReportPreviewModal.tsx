import React, { useMemo, useState } from 'react';
import { Check, CloudUpload, FileBarChart2, FileSpreadsheet, Printer, Trash2, X } from 'lucide-react';
import type { EstimateRow, JobRecord } from '../../types/cubit';
import {
  computeEffectiveQuantity,
  computeItemCostTotal,
  computeItemTotal,
  computeJobSummary,
  computeRowRate,
  computeShapeMetrics,
  computeTradeAndHeadingTotals,
  formatCurrency,
  formatNumber,
  LOCKED_JOB_STATUSES,
} from '../../utils/estimateCalc';
import { downloadJobExport } from '../../services/engineClient';

export type ReportTabKind = 'BOQ' | 'Trade' | 'Shapes' | 'LiveCosts' | 'Xero';

interface ReportPreviewModalProps {
  job: JobRecord;
  initialTab: ReportTabKind;
  onUpdateRow?: (rowId: string, patch: Partial<EstimateRow>) => void;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

export const ReportPreviewModal: React.FC<ReportPreviewModalProps> = ({
  job,
  initialTab,
  onUpdateRow,
  onClose,
  onNotify,
}) => {
  const [tab, setTab] = useState<ReportTabKind>(initialTab);
  const [busy, setBusy] = useState(false);

  // Cubit Select Subcontractor Quote Quick-Pick state
  const itemRows = useMemo(() => job.rows.filter((r) => r.rowType === 'Item'), [job.rows]);
  const [quoteRowId, setQuoteRowId] = useState<string>(() => itemRows[0]?.id ?? '');
  const [quoteSupplier, setQuoteSupplier] = useState('Apex Subcontract Pty Ltd');
  const [quoteRate, setQuoteRate] = useState('');
  const [quoteRef, setQuoteRef] = useState('Q-2026-01');

  const totals = useMemo(() => computeTradeAndHeadingTotals(job.rows), [job.rows]);
  const summary = useMemo(() => computeJobSummary(job), [job]);
  const trades = useMemo(() => job.rows.filter((r) => r.rowType === 'Trade'), [job.rows]);

  const freeze = job.freezeStates ?? ['None'];
  const isRateLocked =
    LOCKED_JOB_STATUSES.has(job.status) ||
    freeze.includes('Job') ||
    freeze.includes('Estimate') ||
    freeze.includes('Rates');

  const handlePickSubcontractorQuote = () => {
    if (!onUpdateRow) return;
    if (isRateLocked) {
      onNotify(`Rates are locked (${job.status} / freeze active); cannot assign picked rate.`);
      return;
    }
    const target = itemRows.find((r) => r.id === quoteRowId) ?? itemRows[0];
    if (!target) return;
    const parsedRate = Number(quoteRate);
    if (!Number.isFinite(parsedRate) || parsedRate < 0) {
      onNotify('Enter a valid non-negative subcontractor quote rate.');
      return;
    }
    onUpdateRow(target.id, {
      pickedRate: {
        supplier: quoteSupplier.trim() || 'Subcontractor',
        rate: parsedRate,
        quoteRef: quoteRef.trim() || undefined,
        pickedDate: new Date().toISOString().slice(0, 10),
      },
    });
    onNotify(`Picked quote ${formatCurrency(parsedRate)} from "${quoteSupplier.trim() || 'Subcontractor'}" for ${target.code}.`);
  };

  const handleClearPickedRate = (rowId: string) => {
    if (!onUpdateRow) return;
    if (isRateLocked) {
      onNotify('Rates are locked; cannot clear picked rate.');
      return;
    }
    onUpdateRow(rowId, { pickedRate: undefined });
    onNotify('Cleared subcontractor picked rate.');
  };

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async (format: 'excel' | 'pdf' | 'csv', reportKind: string) => {
    setBusy(true);
    try {
      const blob = await downloadJobExport(job, format, reportKind);
      const ext = format === 'excel' ? 'xlsx' : format;
      const safe = job.name.replace(/[^A-Za-z0-9_-]+/g, '_');
      triggerBlobDownload(blob, `${safe}_${reportKind}.${ext}`);
      onNotify(`Exported ${reportKind} (${ext.toUpperCase()}) for "${job.name}".`);
    } catch (err) {
      onNotify(`Export error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" style={{ width: 920, maxWidth: '95vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FileBarChart2 size={14} color="var(--brand-blue)" /> Reports, CostX Datasheets &amp; Exports — {job.name}
          </span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-tabs-bar" style={{ justifyContent: 'space-between', paddingRight: 10 }}>
          <div style={{ display: 'flex' }}>
            {(['BOQ', 'Trade', 'Shapes', 'LiveCosts', 'Xero'] as ReportTabKind[]).map((t) => (
              <button
                key={t}
                className={`modal-tab ${tab === t ? 'active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'BOQ'
                  ? 'BOQ Detailed'
                  : t === 'Trade'
                  ? 'Trade Summary'
                  : t === 'Shapes'
                  ? 'Shapes Audit'
                  : t === 'LiveCosts'
                  ? 'LiveCosts CSV'
                  : 'Select / Xero'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => handleExport('excel', 'BOQ_Datasheets')}
            >
              <FileSpreadsheet size={12} color="#15803d" style={{ marginRight: 4 }} />
              Export Excel (.xlsx)
            </button>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() =>
                handleExport(
                  'pdf',
                  tab === 'Trade' ? 'TRADE' : tab === 'Shapes' ? 'SHAPES' : 'BOQ'
                )
              }
            >
              <Printer size={12} color="var(--brand-blue)" style={{ marginRight: 4 }} />
              Export PDF
            </button>
            {(tab === 'LiveCosts' || tab === 'Xero') && (
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => handleExport('csv', tab.toLowerCase())}
              >
                <CloudUpload size={12} style={{ marginRight: 4 }} />
                Download {tab} CSV
              </button>
            )}
          </div>
        </div>

        <div className="modal-body" style={{ maxHeight: 460, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tab === 'BOQ' && (
            <div className="modal-table-wrap">
              <table className="cubit-grid">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Description</th>
                    <th>Result Type</th>
                    <th className="num">Eff. Qty</th>
                    <th>Unit</th>
                    <th className="num">Rate</th>
                    <th className="num">Cost Total</th>
                    <th className="num">Sell Total</th>
                  </tr>
                </thead>
                <tbody>
                  {job.rows.map((r) => {
                    const isItem = r.rowType === 'Item';
                    const qty = isItem ? computeEffectiveQuantity(r) : 0;
                    const rate = isItem ? computeRowRate(r) : 0;
                    const cost = isItem ? computeItemCostTotal(r) : 0;
                    const sell = totals[r.id] ?? (isItem ? computeItemTotal(r) : 0);
                    return (
                      <tr key={r.id} className={r.rowType === 'Trade' ? 'row-trade' : r.rowType === 'Heading' ? 'row-heading' : ''}>
                        <td className="mono">{r.code}</td>
                        <td style={{ paddingLeft: r.rowType === 'Item' ? 22 : r.rowType === 'Heading' ? 12 : 6 }}>
                          {r.description}
                        </td>
                        <td>{r.resultType ?? r.rowType}</td>
                        <td className="num mono">{isItem ? formatNumber(qty) : ''}</td>
                        <td>{r.unit}</td>
                        <td className="num mono">{isItem ? formatCurrency(rate) : ''}</td>
                        <td className="num mono">{isItem ? formatCurrency(cost) : ''}</td>
                        <td className="num mono">{formatCurrency(sell)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'Trade' && (
            <div className="modal-table-wrap">
              <table className="cubit-grid">
                <thead>
                  <tr>
                    <th>Trade Code</th>
                    <th>Trade Description</th>
                    <th className="num">Total Excl Markup</th>
                    <th className="num">% Share</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((tr) => {
                    const val = totals[tr.id] ?? 0;
                    const share = summary.subtotal > 0 ? (val / summary.subtotal) * 100 : 0;
                    return (
                      <tr key={tr.id}>
                        <td className="mono">{tr.code}</td>
                        <td style={{ fontWeight: 600 }}>{tr.description}</td>
                        <td className="num mono">{formatCurrency(val)}</td>
                        <td className="num mono">{formatNumber(share, 1)}%</td>
                      </tr>
                    );
                  })}
                  <tr style={{ fontWeight: 700, background: 'var(--bg-toolbar)' }}>
                    <td />
                    <td>Grand Total (Incl Job Markup {job.markupPct}% &amp; GST {job.salesTaxPct}%)</td>
                    <td className="num mono">{formatCurrency(summary.grandTotal)}</td>
                    <td className="num mono">100.0%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {tab === 'Shapes' && (
            <div className="modal-table-wrap">
              <table className="cubit-grid">
                <thead>
                  <tr>
                    <th>Shape Description</th>
                    <th>Plan</th>
                    <th>Result Type</th>
                    <th className="num">Length (m)</th>
                    <th className="num">Area (m²)</th>
                    <th className="num">Vert. Area (m²)</th>
                    <th className="num">Openings</th>
                  </tr>
                </thead>
                <tbody>
                  {job.shapes.map((shp) => {
                    const plan = job.plans.find((p) => p.id === shp.planId);
                    const m = computeShapeMetrics(shp, plan?.scaleRatio ?? 28);
                    return (
                      <tr key={shp.id}>
                        <td style={{ fontWeight: 600 }}>{shp.name}</td>
                        <td>{plan?.name ?? shp.planId}</td>
                        <td>{shp.resultType}</td>
                        <td className="num mono">{formatNumber(m.lengthM)}</td>
                        <td className="num mono">{formatNumber(m.areaM2)}</td>
                        <td className="num mono">{formatNumber(m.verticalAreaM2)}</td>
                        <td className="num mono">{shp.openings?.length ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'Xero' && (
            <fieldset style={{ border: '1px solid var(--border-main)', padding: 10 }}>
              <legend style={{ fontWeight: 600, fontSize: 11, padding: '0 4px' }}>
                Cubit Select — Subcontractor Quote Comparison &amp; Picked Rates
              </legend>

              {onUpdateRow && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                  <select
                    className="form-select"
                    style={{ width: 220 }}
                    value={quoteRowId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setQuoteRowId(id);
                      const row = itemRows.find((r) => r.id === id);
                      if (row?.pickedRate) {
                        setQuoteSupplier(row.pickedRate.supplier);
                        setQuoteRate(String(row.pickedRate.rate));
                        setQuoteRef(row.pickedRate.quoteRef ?? '');
                      }
                    }}
                  >
                    {itemRows.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.code} — {r.description}
                      </option>
                    ))}
                  </select>
                  <input
                    className="form-input"
                    style={{ width: 170 }}
                    placeholder="Subcontractor"
                    value={quoteSupplier}
                    onChange={(e) => setQuoteSupplier(e.target.value)}
                  />
                  <input
                    type="number"
                    step="0.01"
                    className="form-input mono"
                    style={{ width: 95 }}
                    placeholder="Quote Rate"
                    value={quoteRate}
                    onChange={(e) => setQuoteRate(e.target.value)}
                  />
                  <input
                    className="form-input mono"
                    style={{ width: 95 }}
                    placeholder="Quote Ref"
                    value={quoteRef}
                    onChange={(e) => setQuoteRef(e.target.value)}
                  />
                  <button
                    className="btn-primary"
                    disabled={isRateLocked || itemRows.length === 0}
                    onClick={handlePickSubcontractorQuote}
                  >
                    <Check size={12} style={{ marginRight: 3 }} /> Pick Quote
                  </button>
                </div>
              )}

              <div className="modal-table-wrap" style={{ maxHeight: 175 }}>
                <table className="cubit-grid">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Item Description</th>
                      <th className="num">Est. Rate</th>
                      <th>Subcontractor</th>
                      <th>Quote Ref</th>
                      <th className="num">Picked Rate</th>
                      <th className="num">Variance</th>
                      <th style={{ width: 42 }}>Clear</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemRows.map((r) => {
                      const estRate = computeRowRate(r);
                      const picked = r.pickedRate;
                      const variance = picked ? picked.rate - estRate : 0;
                      return (
                        <tr key={r.id}>
                          <td className="mono">{r.code}</td>
                          <td>{r.description}</td>
                          <td className="num mono">{formatCurrency(estRate)}</td>
                          <td>{picked?.supplier ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                          <td className="mono">{picked?.quoteRef ?? '—'}</td>
                          <td className="num mono" style={{ fontWeight: picked ? 700 : 400, color: picked ? 'var(--brand-blue)' : 'var(--text-muted)' }}>
                            {picked ? formatCurrency(picked.rate) : '—'}
                          </td>
                          <td
                            className="num mono"
                            style={{
                              color: !picked
                                ? 'var(--text-muted)'
                                : variance <= 0
                                ? '#16a34a'
                                : 'var(--accent-red)',
                            }}
                          >
                            {picked ? `${variance >= 0 ? '+' : ''}${formatCurrency(variance)}` : '—'}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {picked && onUpdateRow && (
                              <button
                                className="pane-icon-btn"
                                title="Clear Picked Rate"
                                onClick={() => handleClearPickedRate(r.id)}
                              >
                                <Trash2 size={11} color="var(--accent-red)" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </fieldset>
          )}

          {(tab === 'LiveCosts' || tab === 'Xero') && (
            <div className="modal-table-wrap">
              <table className="cubit-grid">
                <thead>
                  <tr>
                    <th>{tab === 'LiveCosts' ? 'Cost Category' : '*AccountCode'}</th>
                    <th>{tab === 'LiveCosts' ? 'Item Code' : '*InvoiceNumber'}</th>
                    <th>*Description</th>
                    <th className="num">*Quantity</th>
                    <th className="num">{tab === 'LiveCosts' ? 'Cost Rate' : '*UnitAmount'}</th>
                    <th className="num">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {job.rows
                    .filter((r) => r.rowType === 'Item' && r.pricingMode !== 'EXCL')
                    .map((r) => {
                      const q = computeEffectiveQuantity(r);
                      const unitAmt =
                        tab === 'LiveCosts'
                          ? computeRowRate(r)
                          : computeRowRate(r) * (1 + r.markupPct / 100);
                      return (
                        <tr key={r.id}>
                          <td className="mono">{r.groupingCode || '200'}</td>
                          <td className="mono">{tab === 'LiveCosts' ? r.code : `COBITX-${job.id.slice(0, 8).toUpperCase()}`}</td>
                          <td>{r.description}</td>
                          <td className="num mono">{formatNumber(q)}</td>
                          <td className="num mono">{formatCurrency(unitAmt)}</td>
                          <td className="num mono">{formatCurrency(q * unitAmt)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
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
