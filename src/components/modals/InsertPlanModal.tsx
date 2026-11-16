import React, { useState } from 'react';
import { FilePlus, Upload, X } from 'lucide-react';
import type { PlanDocument } from '../../types/cubit';
import { uploadPlanFile } from '../../services/engineClient';

interface InsertPlanModalProps {
  promptScalingOnInsert: boolean;
  onInsertPlan: (plan: PlanDocument, startCalibration: boolean) => void;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

export const InsertPlanModal: React.FC<InsertPlanModalProps> = ({
  promptScalingOnInsert,
  onInsertPlan,
  onClose,
  onNotify,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [calibrateAfter, setCalibrateAfter] = useState(promptScalingOnInsert);
  const [busy, setBusy] = useState(false);

  const handleUpload = async () => {
    if (!file) {
      onNotify('Select a PDF, DXF CAD, or Raster image plan first.');
      return;
    }
    setBusy(true);
    try {
      const parsed = await uploadPlanFile(file, pageNumber);
      const newPlan: PlanDocument = {
        id: `plan-${Date.now()}`,
        name: parsed.name,
        originalFileName: parsed.originalFileName,
        pageNumber: parsed.pageNumber,
        kind: parsed.kind,
        scaleLabel: parsed.scaleLabel,
        scaleRatio: parsed.scaleRatio,
        visible: true,
        revision: 'Rev A',
        rotationDeg: 0,
        imageDataUrl: parsed.imageDataUrl,
        widthPx: parsed.widthPx,
        heightPx: parsed.heightPx,
        snapNodes: parsed.snapNodes,
        vectorPaths: parsed.vectorPaths,
        layers: parsed.layers,
        snapshots: [
          {
            id: `snap-${Date.now()}`,
            name: 'Full Sheet',
            zoom: 1,
            panX: 30,
            panY: 20,
            isDefault: true,
          },
        ],
      };
      onInsertPlan(newPlan, calibrateAfter);
      onNotify(
        `Inserted "${newPlan.name}" (${newPlan.kind}, ${parsed.snapNodes?.length ?? 0} snap nodes detected).`
      );
      onClose();
    } catch (err) {
      // Graceful browser image fallback if engine offline
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          const fallbackPlan: PlanDocument = {
            id: `plan-${Date.now()}`,
            name: file.name.replace(/\.[^.]+$/, ''),
            originalFileName: file.name,
            pageNumber: 1,
            kind: 'Image',
            scaleLabel: 'Unscaled Image',
            scaleRatio: 28,
            visible: true,
            revision: 'Rev A',
            imageDataUrl: String(reader.result),
            layers: [{ id: 'lay-1', name: 'RASTER-IMAGE', visible: true, color: '#475569' }],
            snapshots: [{ id: `snap-${Date.now()}`, name: 'Full Sheet', zoom: 1, panX: 30, panY: 20, isDefault: true }],
          };
          onInsertPlan(fallbackPlan, calibrateAfter);
          onClose();
        };
        reader.readAsDataURL(file);
      } else {
        onNotify(`Plan parse error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" style={{ width: 480, maxWidth: '94vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FilePlus size={14} color="var(--brand-blue)" /> Insert Blueprint / CAD Plan
          </span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label
            style={{
              border: '2px dashed var(--border-dark)',
              borderRadius: 6,
              padding: 20,
              textAlign: 'center',
              cursor: 'pointer',
              background: 'var(--bg-toolbar)',
            }}
          >
            <Upload size={22} color="var(--brand-blue)" style={{ marginBottom: 6 }} />
            <div style={{ fontWeight: 600, fontSize: 12 }}>
              {file ? `${file.name} (${Math.round(file.size / 1024)} KB)` : 'Choose PDF, DXF CAD, PNG, JPG or TIFF Plan'}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
              Extracts vector snap vertices (PyMuPDF / ezdxf), CAD layers &amp; title block scale automatically
            </div>
            <input
              type="file"
              accept=".pdf,.dxf,.png,.jpg,.jpeg,.tif,.tiff,.bmp"
              style={{ display: 'none' }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <div className="form-grid" style={{ gridTemplateColumns: '150px 1fr' }}>
            <span className="form-label">PDF Page Number:</span>
            <input
              type="number"
              min={1}
              className="form-input mono"
              value={pageNumber}
              onChange={(e) => setPageNumber(Math.max(1, Number(e.target.value) || 1))}
            />

            <span className="form-label">Calibration:</span>
            <label className="form-checkbox-row" style={{ fontSize: 11.5 }}>
              <input
                type="checkbox"
                checked={calibrateAfter}
                onChange={(e) => setCalibrateAfter(e.target.checked)}
              />
              Start 2-Point Scale Calibration immediately after insert
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!file || busy} onClick={handleUpload}>
            {busy ? 'Processing Plan...' : 'Insert Plan'}
          </button>
        </div>
      </div>
    </div>
  );
};
