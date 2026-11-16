import React from 'react';
import { X, Plus, Check } from 'lucide-react';

export interface ColumnDef {
  key: string;
  label: string;
  width: number;
  required?: boolean;
}

interface ColumnChooserModalProps {
  title: string;
  allColumns: ColumnDef[];
  visibleKeys: string[];
  onToggleColumn: (key: string) => void;
  onClose: () => void;
}

export const ColumnChooserModal: React.FC<ColumnChooserModalProps> = ({
  title,
  allColumns,
  visibleKeys,
  onToggleColumn,
  onClose,
}) => {
  const availableColumns = allColumns.filter((c) => !visibleKeys.includes(c.key));
  const activeColumns = allColumns.filter((c) => visibleKeys.includes(c.key));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-window"
        style={{ width: 320 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>Customization — {title}</span>
          <button className="modal-close" onClick={onClose} title="Close">
            <X size={14} />
          </button>
        </div>
        <div className="modal-body" style={{ padding: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Double-click a column below to add it to the grid, or toggle active columns.
          </div>

          <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 4 }}>
            Available Columns ({availableColumns.length})
          </div>
          <div
            style={{
              border: '1px solid var(--border-main)',
              borderRadius: 2,
              maxHeight: 150,
              overflowY: 'auto',
              marginBottom: 10,
              background: '#fff',
            }}
          >
            {availableColumns.length === 0 ? (
              <div style={{ padding: 8, color: 'var(--text-muted)', fontSize: 11 }}>
                All columns are currently visible.
              </div>
            ) : (
              availableColumns.map((col) => (
                <div
                  key={col.key}
                  onDoubleClick={() => onToggleColumn(col.key)}
                  onClick={() => onToggleColumn(col.key)}
                  style={{
                    padding: '5px 8px',
                    borderBottom: '1px solid var(--border-light)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                  }}
                >
                  <span>{col.label}</span>
                  <Plus size={12} color="var(--brand-blue)" />
                </div>
              ))
            )}
          </div>

          <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 4 }}>
            Visible Columns ({activeColumns.length})
          </div>
          <div
            style={{
              border: '1px solid var(--border-main)',
              borderRadius: 2,
              maxHeight: 160,
              overflowY: 'auto',
              background: '#fff',
            }}
          >
            {activeColumns.map((col) => (
              <div
                key={col.key}
                onClick={() => !col.required && onToggleColumn(col.key)}
                style={{
                  padding: '5px 8px',
                  borderBottom: '1px solid var(--border-light)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: col.required ? 'default' : 'pointer',
                  opacity: col.required ? 0.7 : 1,
                }}
              >
                <span>
                  {col.label} {col.required ? '(Default)' : ''}
                </span>
                <Check size={12} color="var(--accent-green)" />
              </div>
            ))}
          </div>
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
