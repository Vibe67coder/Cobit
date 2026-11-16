import React, { useState } from 'react';
import { GitBranch, Ruler, Upload, X } from 'lucide-react';
import type { PlanDocument, RevisionOverlay } from '../../types/cubit';
import { uploadPlanFile } from '../../services/engineClient';

interface PlanRevisionModalProps {
  activePlan: PlanDocument | null;
  onSaveOverlay: (planId: string, overlay: RevisionOverlay | undefined, newRevLabel?: string) => void;
  onStartViewportAlign: () => void;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

export const PlanRevisionModal: React.FC<PlanRevisionModalProps> = ({
  activePlan,
  onSaveOverlay,
  onStartViewportAlign,
  onClose,
  onNotify,
}) => {
  const existing = activePlan?.revisionOverlay;
  const [label, setLabel] = useState(existing?.label ?? 'Rev B Overlay');
  const [offsetX, setOffsetX] = useState(existing?.offsetX ?? 0);
  const [offsetY, setOffsetY] = useState(existing?.offsetY ?? 0);
  const [scaleFactor, setScaleFactor] = useState(existing?.scaleFactor ?? 1);
  const [rotationDeg, setRotationDeg] = useState(existing?.rotationDeg ?? 0);
  const [opacity, setOpacity] = useState(existing?.opacity ?? 0.55);
  const [visible, setVisible] = useState(existing?.visible ?? true);
  const [overlayData, setOverlayData] = useState<Pick<RevisionOverlay, 'originalFileName' | 'imageDataUrl' | 'vectorPaths'> | null>(
    existing
      ? {
          originalFileName: existing.originalFileName,
          imageDataUrl: existing.imageDataUrl,
          vectorPaths: existing.vectorPaths,
        }
      : null
  );
  const [busy, setBusy] = useState(false);

  if (!activePlan) return null;

  const handleUploadRevision = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await uploadPlanFile(file, 1);
      setOverlayData({
        originalFileName: res.originalFileName,
        imageDataUrl: res.imageDataUrl,
        vectorPaths: res.vectorPaths,
      });
      onNotify(`Loaded revision "${res.originalFileName}" for comparison overlay.`);
    } catch (err) {
      onNotify(`Revision load error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleApply = () => {
    if (!overlayData) {
      // Allow creating an offset clone comparison overlay even on the active blueprint
      const clone: RevisionOverlay = {
        label,
        originalFileName: activePlan.originalFileName,
        imageDataUrl: activePlan.imageDataUrl,
        vectorPaths: activePlan.vectorPaths,
        offsetX,
        offsetY,
        scaleFactor,
        rotationDeg,
        opacity,
        visible,
      };
      onSaveOverlay(activePlan.id, clone, label);
    } else {
      onSaveOverlay(
        activePlan.id,
        {
          label,
          originalFileName: overlayData.originalFileName,
          imageDataUrl: overlayData.imageDataUrl,
          vectorPaths: overlayData.vectorPaths,
          offsetX,
          offsetY,
          scaleFactor,
          rotationDeg,
          opacity,
          visible,
        },
        label
      );
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" style={{ width: 540, maxWidth: '95vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <GitBranch size={14} color="#d97706" /> Plan Change &amp; Revision Overlay — {activePlan.name}
          </span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <Upload size={13} color="var(--brand-blue)" />
              {busy ? 'Uploading...' : 'Upload Revised PDF / DXF / PNG'}
              <input
                type="file"
                accept=".pdf,.dxf,.png,.jpg,.jpeg,.tif,.tiff"
                style={{ display: 'none' }}
                onChange={(e) => handleUploadRevision(e.target.files?.[0] ?? null)}
              />
            </label>
            <button
              className="btn-secondary"
              onClick={() => {
                handleApply();
                onStartViewportAlign();
              }}
            >
              <Ruler size={13} color="#d97706" style={{ marginRight: 4 }} />
              2-Point Align in Viewport
            </button>
          </div>

          {overlayData && (
            <div style={{ fontSize: 11, color: '#0d9488', fontWeight: 600 }}>
              Revision File: {overlayData.originalFileName}
            </div>
          )}

          <div className="form-grid" style={{ gridTemplateColumns: '150px 1fr' }}>
            <span className="form-label">Revision Label:</span>
            <input
              className="form-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />

            <span className="form-label">Visible in Viewport:</span>
            <label className="form-checkbox-row" style={{ fontSize: 11.5 }}>
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) => setVisible(e.target.checked)}
              />
              Show tinted revision overlay on top of {activePlan.revision}
            </label>

            <span className="form-label">Offset X / Y (px):</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="number"
                className="form-input mono"
                value={offsetX}
                onChange={(e) => setOffsetX(Number(e.target.value) || 0)}
              />
              <input
                type="number"
                className="form-input mono"
                value={offsetY}
                onChange={(e) => setOffsetY(Number(e.target.value) || 0)}
              />
            </div>

            <span className="form-label">Scale Multiplier:</span>
            <input
              type="number"
              step="0.01"
              className="form-input mono"
              value={scaleFactor}
              onChange={(e) => setScaleFactor(Math.max(0.1, Number(e.target.value) || 1))}
            />

            <span className="form-label">Rotation (°):</span>
            <input
              type="number"
              className="form-input mono"
              value={rotationDeg}
              onChange={(e) => setRotationDeg(Number(e.target.value) || 0)}
            />

            <span className="form-label">Overlay Opacity:</span>
            <input
              type="range"
              min={0.1}
              max={0.95}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          {existing ? (
            <button
              className="btn-secondary"
              style={{ color: 'var(--accent-red)' }}
              onClick={() => {
                onSaveOverlay(activePlan.id, undefined);
                onNotify('Cleared revision overlay from active plan.');
                onClose();
              }}
            >
              Remove Overlay
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleApply}>
              Apply Revision Overlay
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
