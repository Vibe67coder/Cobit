import React, { useRef, useState } from 'react';
import { FilePlus, X } from 'lucide-react';
import type { PlanDocument } from '../../types/cubit';
import { previewPdfPages, uploadPdfPages, uploadPlanFile, type PdfPagePreview, type UploadedPlanResponse } from '../../services/engineClient';

interface InsertPlanModalProps {
  promptScalingOnInsert: boolean;
  onInsertPlans: (plans: PlanDocument[], startCalibration: boolean) => void;
  onClose: () => void;
}

interface DrawingSelection {
  id: string;
  file: File;
  pdf: boolean;
  pages: PdfPagePreview[];
  selected: Set<number>;
  error?: string;
}

function makePlan(parsed: UploadedPlanResponse): PlanDocument {
  const { totalPages: _totalPages, ...plan } = parsed;
  return {
    ...plan,
    id: crypto.randomUUID(),
    visible: true,
    revision: 'Rev A',
    rotationDeg: 0,
    snapshots: [{ id: crypto.randomUUID(), name: 'Full Sheet', zoom: 1, panX: 30, panY: 20, isDefault: true }],
  };
}

async function readDrawing(file: File): Promise<PlanDocument> {
  try {
    return makePlan(await uploadPlanFile(file));
  } catch (error) {
    if (!file.type.startsWith('image/')) throw error;
    const imageDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    return makePlan({
      name: file.name.replace(/\.[^.]+$/, ''),
      originalFileName: file.name,
      pageNumber: 1,
      totalPages: 1,
      kind: 'Image',
      scaleLabel: 'Unscaled Image',
      scaleRatio: 28,
      imageDataUrl,
      layers: [{ id: 'lay-1', name: 'RASTER-IMAGE', visible: true, color: '#475569' }],
    });
  }
}

export const InsertPlanModal: React.FC<InsertPlanModalProps> = ({
  promptScalingOnInsert,
  onInsertPlans,
  onClose,
}) => {
  const [drawings, setDrawings] = useState<DrawingSelection[]>([]);
  const [calibrateAfter, setCalibrateAfter] = useState(promptScalingOnInsert);
  const [status, setStatus] = useState('');
  const busy = useRef(false);
  const count = drawings.reduce((sum, drawing) => sum + drawing.selected.size, 0);

  const addFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!files.length || busy.current) return;
    busy.current = true;
    try {
      for (const file of files) {
        setStatus(`Opening ${file.name}…`);
        const drawing: DrawingSelection = {
          id: crypto.randomUUID(), file, pdf: /\.pdf$/i.test(file.name), pages: [], selected: new Set([1]),
        };
        if (drawing.pdf) {
          try {
            drawing.pages = await previewPdfPages(file);
            drawing.selected = new Set(drawing.pages.map((page) => page.number));
          } catch (error) {
            drawing.selected.clear();
            drawing.error = error instanceof Error ? error.message : String(error);
          }
        }
        setDrawings((previous) => [...previous, drawing]);
      }
    } finally {
      busy.current = false;
      setStatus('');
    }
  };

  const setPages = (id: string, update: (selected: Set<number>) => void) => {
    setDrawings((previous) => previous.map((drawing) => {
      if (drawing.id !== id) return drawing;
      const selected = new Set(drawing.selected);
      update(selected);
      return { ...drawing, selected };
    }));
  };

  const handleUpload = async () => {
    if (!count || busy.current) return;
    busy.current = true;
    const plans: PlanDocument[] = [];
    const imported = new Set<string>();
    const failed = new Map<string, string>();
    try {
      for (const drawing of drawings) {
        if (!drawing.selected.size) continue;
        setStatus(`Importing ${drawing.file.name}…`);
        try {
          const next = drawing.pdf
            ? (await uploadPdfPages(drawing.file, [...drawing.selected].sort((a, b) => a - b))).map(makePlan)
            : [await readDrawing(drawing.file)];
          for (const plan of next) plans.push(plan);
          imported.add(drawing.id);
        } catch (error) {
          failed.set(drawing.id, error instanceof Error ? error.message : String(error));
        }
      }
      if (plans.length) {
        onInsertPlans(plans, calibrateAfter && !failed.size);
      }
      if (!failed.size) {
        onClose();
      } else {
        setDrawings((previous) => previous
          .filter((drawing) => !imported.has(drawing.id))
          .map((drawing) => failed.has(drawing.id) ? { ...drawing, error: failed.get(drawing.id) } : drawing));
      }
    } finally {
      busy.current = false;
      setStatus('');
    }
  };

  const close = () => {
    if (!busy.current) onClose();
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal-window drawing-import" role="dialog" aria-modal="true" aria-labelledby="drawing-import-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
        if (event.key === 'Escape') close();
        event.stopPropagation();
      }}>
        <div className="modal-header">
          <span id="drawing-import-title"><FilePlus size={14} /> Insert Drawings</span>
          <button className="modal-close" aria-label="Close" disabled={!!status} onClick={close}><X size={14} /></button>
        </div>
        <div className="modal-body">
          <label className="drawing-file-picker">
            <span>Add drawing files</span>
            <input
              type="file"
              multiple
              accept=".pdf,.dxf,.png,.jpg,.jpeg,.tif,.tiff,.bmp"
              disabled={!!status}
              onChange={addFiles}
            />
          </label>
          <div className="drawing-import-list">
            {drawings.map(({ id, file, pdf, pages, selected, error }) => (
              <section key={id} className="drawing-import-file" aria-label={file.name}>
                <div className="drawing-import-heading">
                  {!pdf && <input type="checkbox" aria-label={`Import ${file.name}`} checked={selected.has(1)} disabled={!!status} onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setPages(id, (selection) => { if (checked) selection.add(1); else selection.delete(1); });
                  }} />}
                  <strong title={file.name}>{file.name}</strong>
                  {pages.length > 0 && <>
                    <span>{selected.size} of {pages.length} selected</span>
                    <button className="btn-secondary" disabled={!!status} onClick={() => setPages(id, (selection) => {
                      if (selected.size === pages.length) selection.clear();
                      else for (const page of pages) selection.add(page.number);
                    })}>{selected.size === pages.length ? 'Clear all' : 'Select all'}</button>
                  </>}
                  <button className="pane-icon-btn" aria-label={`Remove ${file.name}`} disabled={!!status} onClick={() => setDrawings((previous) => previous.filter((drawing) => drawing.id !== id))}><X size={14} /></button>
                </div>
                {error && <p role="alert" className="drawing-import-error">{error}</p>}
                {pages.length > 0 && <div className="drawing-page-grid">
                  {pages.map(({ number, thumbnail }) => (
                    <label key={number} className={`drawing-page ${selected.has(number) ? 'selected' : ''}`}>
                      <img src={thumbnail} alt="" loading="lazy" />
                      <span><input type="checkbox" checked={selected.has(number)} disabled={!!status} onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setPages(id, (selection) => { if (checked) selection.add(number); else selection.delete(number); });
                      }} /> Page {number}</span>
                    </label>
                  ))}
                </div>}
              </section>
            ))}
          </div>
        </div>
        <div className="modal-footer drawing-import-footer">
          <label className="form-checkbox-row">
            <input type="checkbox" checked={calibrateAfter} disabled={!!status} onChange={(event) => setCalibrateAfter(event.target.checked)} />
            Calibrate first imported drawing
          </label>
          <span role="status">{status}</span>
          <button className="btn-secondary" disabled={!!status} onClick={close}>Cancel</button>
          <button className="btn-primary" disabled={!count || !!status} onClick={handleUpload}>Import {count} {count === 1 ? 'drawing' : 'drawings'}</button>
        </div>
      </div>
    </div>
  );
};
