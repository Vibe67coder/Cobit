import React, { useState } from 'react';
import { Calculator, X } from 'lucide-react';
import type { JobRecord } from '../../types/cubit';
import { computeJobSummary, formatCurrency } from '../../utils/estimateCalc';

interface TaxAdjustmentsModalProps {
  job: JobRecord;
  onSave: (patch: Partial<JobRecord>) => void;
  onClose: () => void;
}

export const TaxAdjustmentsModal: React.FC<TaxAdjustmentsModalProps> = ({
  job,
  onSave,
  onClose,
}) => {
  const [markupPct, setMarkupPct] = useState(job.markupPct);
  const [salesTaxPct, setSalesTaxPct] = useState(job.salesTaxPct);
  const [adjustmentPct, setAdjustmentPct] = useState(job.adjustmentPct ?? 0);
  const [adjustmentFixed, setAdjustmentFixed] = useState(job.adjustmentFixed ?? 0);
  const [gfaM2, setGfaM2] = useState(job.gfaM2 ?? 0);
  const [jobMode, setJobMode] = useState<'Simple' | 'MaterialLabour'>(
    job.jobMode ?? 'Simple'
  );

  const previewSummary = computeJobSummary({
    ...job,
    markupPct,
    salesTaxPct,
    adjustmentPct,
    adjustmentFixed,
    gfaM2,
    jobMode,
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" style={{ width: 520, maxWidth: '94vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Calculator size={14} color="#16a34a" /> Adjustments, Markup, GST &amp; Job Mode
          </span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-grid" style={{ gridTemplateColumns: '175px 1fr' }}>
            <span className="form-label">Job Markup (%):</span>
            <input
              type="number"
              className="form-input mono"
              value={markupPct}
              onChange={(e) => setMarkupPct(Number(e.target.value) || 0)}
            />

            <span className="form-label">Sales Tax / GST (%):</span>
            <input
              type="number"
              className="form-input mono"
              value={salesTaxPct}
              onChange={(e) => setSalesTaxPct(Number(e.target.value) || 0)}
            />

            <span className="form-label">Global Adjustment (%):</span>
            <input
              type="number"
              className="form-input mono"
              value={adjustmentPct}
              onChange={(e) => setAdjustmentPct(Number(e.target.value) || 0)}
            />

            <span className="form-label">Fixed Adjustment ($):</span>
            <input
              type="number"
              className="form-input mono"
              value={adjustmentFixed}
              onChange={(e) => setAdjustmentFixed(Number(e.target.value) || 0)}
            />

            <span className="form-label">Gross Floor Area (GFA m²):</span>
            <input
              type="number"
              className="form-input mono"
              value={gfaM2}
              onChange={(e) => setGfaM2(Number(e.target.value) || 0)}
            />

            <span className="form-label">Job Mode (Convert):</span>
            <select
              className="form-select"
              value={jobMode}
              onChange={(e) => setJobMode(e.target.value as 'Simple' | 'MaterialLabour')}
            >
              <option value="Simple">Simple Rate Sheet</option>
              <option value="MaterialLabour">Material / Labour Breakdown</option>
            </select>
          </div>

          <div
            style={{
              background: 'var(--bg-toolbar)',
              border: '1px solid var(--border-main)',
              borderRadius: 4,
              padding: 10,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              fontSize: 11.5,
            }}
          >
            <div>Subtotal Excl Tax: <strong className="mono">{formatCurrency(previewSummary.subtotal)}</strong></div>
            <div>Markup Amount: <strong className="mono">{formatCurrency(previewSummary.markupAmount)}</strong></div>
            <div>Adjustment: <strong className="mono">{formatCurrency(previewSummary.adjustmentAmount)}</strong></div>
            <div>Sales Tax (GST): <strong className="mono">{formatCurrency(previewSummary.taxAmount)}</strong></div>
            <div style={{ fontSize: 12.5, color: 'var(--brand-blue)' }}>
              Grand Total: <strong className="mono">{formatCurrency(previewSummary.grandTotal)}</strong>
            </div>
            <div>
              Cost / m²:{' '}
              <strong className="mono">
                {previewSummary.costPerM2 !== null
                  ? `${formatCurrency(previewSummary.costPerM2)}/m²`
                  : 'Set GFA > 0'}
              </strong>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              onSave({ markupPct, salesTaxPct, adjustmentPct, adjustmentFixed, gfaM2, jobMode });
              onClose();
            }}
          >
            Apply Pricing Settings
          </button>
        </div>
      </div>
    </div>
  );
};
