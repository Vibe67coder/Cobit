import React, { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Flag,
  Indent,
  Outdent,
  Plus,
  PlusSquare,
  ListPlus,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  Lock,
  Trash2,
} from 'lucide-react';
import type {
  CalcRow,
  EstimateRow,
  OptionPackage,
  RateRow,
  ResultType,
  VariationRecord,
} from '../../types/cubit';
import {
  applyRounding,
  computeItemCostTotal,
  computeItemMarkupAmount,
  computeItemTotal,
  computeRowRate,
  computeTradeAndHeadingTotals,
  evaluateCubitFormula,
  evaluateRateSheetRows,
  formatCurrency,
  formatNumber,
} from '../../utils/estimateCalc';
import { ColumnChooserModal, type ColumnDef } from '../modals/ColumnChooserModal';

import { clickWorksheet, focusWorksheet, navigateWorksheet } from './worksheetKeyboard';

function WorksheetInput({ value, onCommit, label, disabled }: {
  value: string | number;
  onCommit: (value: string) => void;
  label: string;
  disabled: boolean;
}) {
  if (disabled) return <>{value}</>;
  return <input
    key={String(value)}
    aria-label={label}
    className="inline-cell-input"
    defaultValue={value}
    onBlur={(event) => {
      const input = event.currentTarget;
      const next = input.value;
      if (next !== input.defaultValue) {
        input.value = input.defaultValue;
        onCommit(next);
      }
    }}
  />;
}

const ESTIMATE_ALL_COLUMNS: ColumnDef[] = [
  { key: 'lockedBy', label: 'Lock', width: 42 },
  { key: 'code', label: 'Code', width: 64 },
  { key: 'refCode', label: 'Ref Code', width: 70 },
  { key: 'description', label: 'Description', width: 250, required: true },
  { key: 'resultType', label: 'Result', width: 130 },
  { key: 'quantity', label: 'Quantity', width: 76 },
  { key: 'unit', label: 'Unit', width: 50 },
  { key: 'conversion', label: 'Conv.', width: 52 },
  { key: 'numberMultiplier', label: 'No.', width: 46 },
  { key: 'factor', label: 'Factor', width: 54 },
  { key: 'wastagePct', label: 'Waste %', width: 58 },
  { key: 'rate', label: 'Rate', width: 88 },
  { key: 'costTotal', label: 'Cost Total', width: 96 },
  { key: 'markupPct', label: 'Markup %', width: 68 },
  { key: 'markupAmt', label: 'Markup $', width: 84 },
  { key: 'total', label: 'Total', width: 102, required: true },
  { key: 'jobPct', label: 'Job %', width: 62 },
  { key: 'pricingMode', label: 'INCL/EXCL', width: 68 },
  { key: 'excludeFromTotal', label: 'Σ Excl', width: 52 },
  { key: 'excludeFromTax', label: 'Tax Excl', width: 58 },
  { key: 'groupingCode', label: 'Group Code', width: 88 },
  { key: 'rel', label: 'Rel', width: 60 },
  { key: 'note', label: 'Notes', width: 150 },
];

const RESULT_TYPES: ResultType[] = [
  'Area',
  'Length',
  'Volume',
  'Volume by Length',
  'Vertical Area',
  'Vertical Area Less Openings',
  'Length Less Openings',
  'Length by Centres',
  'Count',
  'Door Counts',
  'Window Counts',
  'Note',
  'Exclude from total',
];

const ROUNDING_MODES: NonNullable<CalcRow['rounding']>[] = [
  'None',
  'Round',
  'Round Up',
  'Round Down',
  'Near to 0.1',
  'Roundup to 0.01',
];

interface EstimatePaneProps {
  rows: EstimateRow[];
  selectedRowId: string | null;
  selectedCalcRowId: string | null;
  lowerTab: 'Calc' | 'Rate';
  onChangeLowerTab: (tab: 'Calc' | 'Rate') => void;
  onSelectRow: (id: string) => void;
  onChangeResultType: (row: EstimateRow, result: ResultType) => void;
  onDeleteRows: (ids: string[]) => void;
  onSelectCalcRow: (id: string) => void;
  onUpdateRow: (id: string, patch: Partial<EstimateRow>) => void;
  onToggleCollapse: (id: string) => void;
  onExpandAll: (expand: boolean) => void;
  onInsertTrade: () => void;
  onInsertHeading: () => void;
  onInsertItem: () => void;
  onAddItemEnd: () => void;
  onIndentRow: () => void;
  onUnindentRow: () => void;
  onViewShapeInViewport: (shapeId: string, planId?: string) => void;
  hidePickedRates: boolean;
  isPriceList?: boolean;
  isReadOnly?: boolean;
  optionsPackages?: OptionPackage[];
  variations?: VariationRecord[];
  onToggleOption?: (optId: string) => void;
  onCycleVariationStatus?: (varId: string) => void;
  onNotify?: (msg: string) => void;
  calcSheetRef?: React.RefObject<HTMLDivElement | null>;
}

export const EstimatePane: React.FC<EstimatePaneProps> = ({
  rows,
  selectedRowId,
  selectedCalcRowId,
  lowerTab,
  onChangeLowerTab,
  onSelectRow,
  onChangeResultType,
  onDeleteRows,
  onSelectCalcRow,
  onUpdateRow,
  onToggleCollapse,
  onExpandAll,
  onInsertTrade,
  onInsertHeading,
  onInsertItem,
  onAddItemEnd,
  onIndentRow,
  onUnindentRow,
  onViewShapeInViewport,
  hidePickedRates,
  isPriceList,
  isReadOnly,
  optionsPackages = [],
  variations = [],
  onToggleOption,
  onCycleVariationStatus,
  onNotify,
  calcSheetRef,
}) => {
  const [upperTab, setUpperTab] = useState<'Estimate' | 'Grouped'>('Estimate');
  const [visibleColKeys, setVisibleColKeys] = useState<string[]>([
    'lockedBy',
    'code',
    'refCode',
    'description',
    'resultType',
    'quantity',
    'unit',
    'rate',
    'total',
    'pricingMode',
  ]);
  const [showColumnChooser, setShowColumnChooser] = useState(false);
  const [splitPct, setSplitPct] = useState(64);
  const [selection, setSelection] = useState<{ rowId: string; column?: number } | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: string; field: string } | null>(null);
  const [calcContextMenu, setCalcContextMenu] = useState<{
    x: number;
    y: number;
    shapeId: string;
    planId?: string;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const activeColumns = ESTIMATE_ALL_COLUMNS.filter((c) => {
    if (isPriceList && (c.key === 'quantity' || c.key === 'total' || c.key === 'jobPct' || c.key === 'costTotal')) {
      return false;
    }
    return visibleColKeys.includes(c.key);
  });

  const totalsMap = useMemo(() => computeTradeAndHeadingTotals(rows), [rows]);
  const jobSubtotal = useMemo(
    () => rows.reduce((acc, r) => acc + computeItemTotal(r), 0),
    [rows]
  );

  // Build visible flattened rows respecting collapsed trades/headings
  const visibleRows = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const depthOf = (r: EstimateRow): number => {
      let d = 0;
      let cur = r.parentId;
      while (cur && d < 6) {
        d++;
        cur = byId.get(cur)?.parentId ?? null;
      }
      return d;
    };
    const isHidden = (r: EstimateRow): boolean => {
      let cur = r.parentId;
      let guard = 0;
      while (cur && guard < 6) {
        const p = byId.get(cur);
        if (!p) break;
        if (p.collapsed) return true;
        cur = p.parentId;
        guard++;
      }
      return false;
    };
    return rows
      .filter((r) => !isHidden(r))
      .map((r) => ({ row: r, depth: depthOf(r) }));
  }, [rows]);

  const tradeForRow = (rowId: string) => {
    let row = rows.find((item) => item.id === rowId);
    const visited = new Set<string>();
    while (row?.parentId && !visited.has(row.id)) {
      visited.add(row.id);
      row = rows.find((item) => item.id === row?.parentId);
    }
    return row?.rowType === 'Trade' ? row.id : rowId;
  };

  const handleEstimateKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.matches('input, select, textarea') && (event.code === 'Space' || event.key === 'Delete')) {
      const cell = target.closest<HTMLTableCellElement>('td');
      const rowId = cell?.parentElement?.dataset.worksheetRow ?? selectedRowId;
      if (rowId && event.code === 'Space' && (event.shiftKey || event.ctrlKey) && cell) {
        event.preventDefault();
        event.stopPropagation();
        setSelection(event.ctrlKey ? { rowId: tradeForRow(rowId), column: cell.cellIndex } : { rowId });
        return;
      }
      if (rowId && event.ctrlKey && event.key === 'Delete') {
        event.preventDefault();
        event.stopPropagation();
        if (!isReadOnly && !event.repeat) onDeleteRows([rowId]);
        return;
      }
    }
    if (event.key === 'Escape' && selection && !editingCell) {
      setSelection(null);
      event.preventDefault();
    }
    navigateWorksheet(
      event,
      upperTab === 'Estimate' && !isReadOnly ? onInsertItem : undefined,
      () => {
        if (!editingCell) return false;
        setEditingCell(null);
        return true;
      },
    );
  };

  const groupedByCode = useMemo(() => {
    const map: Record<string, { code: string; items: EstimateRow[]; total: number }> = {};
    for (const r of rows) {
      if (r.rowType !== 'Item') continue;
      const code = r.groupingCode || 'UNASSIGNED';
      if (!map[code]) map[code] = { code, items: [], total: 0 };
      map[code].items.push(r);
      map[code].total += computeItemTotal(r);
    }
    return Object.values(map).sort((a, b) => a.code.localeCompare(b.code));
  }, [rows]);

  const selectedRow = rows.find((r) => r.id === selectedRowId) ?? null;
  const lowerReadOnly = Boolean(isReadOnly || selectedRow?.lockedBy);

  const commitNumericOrFormula = (
    row: EstimateRow,
    field: 'quantity' | 'rate' | 'factor' | 'conversion' | 'numberMultiplier' | 'wastagePct' | 'markupPct',
    rawInput: string
  ) => {
    const trimmed = rawInput.trim();
    if (trimmed.startsWith('=') && (field === 'quantity' || field === 'rate')) {
      const evaluated = evaluateCubitFormula(trimmed, rows, row[field] ?? 0);
      if (evaluated.error) {
        onNotify?.(`Formula warning: ${evaluated.error}`);
      } else {
        onUpdateRow(row.id, {
          [field]: Number(evaluated.value.toFixed(4)),
          formula: trimmed,
        });
      }
      return;
    }
    const parsed = Number(trimmed);
    onUpdateRow(row.id, {
      [field]: Number.isFinite(parsed) ? parsed : 0,
      ...(field === 'quantity' || field === 'rate' ? { formula: undefined } : {}),
    });
  };

  const handleAddManualCalcLine = () => {
    if (!selectedRow || lowerReadOnly) return;
    const nextLine: CalcRow = {
      id: `calc-${Date.now()}`,
      description: 'Manual Dimension Line',
      resultType: selectedRow.resultType ?? 'Area',
      length: 1,
      width: 1,
      factor: 1,
      quantity: 1,
      rounding: 'None',
    };
    const nextCalcs = [...selectedRow.calcRows, nextLine];
    const nextQty = nextCalcs.reduce((acc, c) => acc + c.quantity * c.factor, 0);
    onUpdateRow(selectedRow.id, {
      calcRows: nextCalcs,
      quantity: Number(nextQty.toFixed(2)),
    });
  };

  const handleUpdateCalcLine = (calcId: string, patch: Partial<CalcRow>) => {
    if (!selectedRow || lowerReadOnly) return;
    const nextCalcs = selectedRow.calcRows.map((c) => {
      if (c.id !== calcId) return c;
      const merged = { ...c, ...patch };
      const rawQty =
        patch.quantity !== undefined
          ? patch.quantity
          : merged.quantity;
      const rounded = applyRounding(rawQty, merged.rounding);
      return { ...merged, quantity: rounded };
    });
    const nextQty = nextCalcs.reduce((acc, c) => acc + c.quantity * c.factor, 0);
    onUpdateRow(selectedRow.id, {
      calcRows: nextCalcs,
      quantity: Number(nextQty.toFixed(2)),
    });
  };

  const handleAddRateRow = () => {
    if (!selectedRow || lowerReadOnly) return;
    const nextRow: RateRow = {
      id: `rr-${Date.now()}`,
      code: `R${selectedRow.rateRows.length + 1}`,
      description: 'New Rate Component',
      unit: selectedRow.unit || 'm²',
      quantity: 1,
      rate: 25,
      kind: 'Material',
      total: 25,
    };
    const { computedRows, unitRate } = evaluateRateSheetRows([
      ...selectedRow.rateRows,
      nextRow,
    ]);
    onUpdateRow(selectedRow.id, {
      rateRows: computedRows,
      rate: Number(unitRate.toFixed(2)),
    });
  };

  const handleUpdateRateRow = (rateId: string, patch: Partial<RateRow>) => {
    if (!selectedRow || lowerReadOnly) return;
    const updated = selectedRow.rateRows.map((r) =>
      r.id === rateId ? { ...r, ...patch } : r
    );
    const { computedRows, unitRate } = evaluateRateSheetRows(updated);
    onUpdateRow(selectedRow.id, {
      rateRows: computedRows,
      rate: Number(unitRate.toFixed(2)),
    });
  };

  const handleDeleteRateRow = (rateId: string) => {
    if (!selectedRow || lowerReadOnly) return;
    const remaining = selectedRow.rateRows.filter((r) => r.id !== rateId);
    const { computedRows, unitRate } = evaluateRateSheetRows(remaining);
    onUpdateRow(selectedRow.id, {
      rateRows: computedRows,
      rate: remaining.length > 0 ? Number(unitRate.toFixed(2)) : selectedRow.rate,
    });
  };

  const startSplitDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startPct = splitPct;
    const height = containerRef.current?.clientHeight || 600;
    const onMove = (ev: MouseEvent) => {
      const deltaPct = ((ev.clientY - startY) / height) * 100;
      setSplitPct(Math.max(25, Math.min(82, startPct + deltaPct)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={containerRef}
      className="estimate-pane"
      onClick={() => setCalcContextMenu(null)}
    >
      {/* UPPER SHEET: ESTIMATE / GROUPED VIEWS */}
      <div style={{ height: `${splitPct}%`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="pane-tabs-bar worksheet-toolbar">
          <div className="pane-tabs-left">
            <button
              className={`pane-tab ${upperTab === 'Estimate' ? 'active' : ''}`}
              onClick={() => setUpperTab('Estimate')}
            >
              {isPriceList ? 'Price List Sheet' : 'Estimate'}
            </button>
            {!isPriceList && (
              <button
                className={`pane-tab ${upperTab === 'Grouped' ? 'active' : ''}`}
                onClick={() => setUpperTab('Grouped')}
              >
                Grouped Views
              </button>
            )}
          </div>
          <span className="worksheet-summary" title="Arrow keys to move • F2 to edit • Right-click a header to choose columns">
            Arrows to move · F2 to edit
          </span>
        </div>

        {/* Estimate Window Button Bar + Quick Options/Variations Bar */}
        <div className="estimate-toolbar" style={{ flexWrap: 'wrap', gap: 4 }}>
          <button className="tool-btn-mini" disabled={isReadOnly} onClick={onInsertTrade} title="Insert Trade (Ctrl+T)">
            <PlusSquare size={12} color="var(--brand-blue)" /> Trade
          </button>
          <button className="tool-btn-mini" disabled={isReadOnly} onClick={onInsertHeading} title="Insert Heading (Ctrl+H)">
            <Plus size={12} color="#d97706" /> Heading
          </button>
          <button className="tool-btn-mini" disabled={isReadOnly} onClick={onInsertItem} title="Insert Item (Ctrl+I)">
            <ListPlus size={12} color="#16a34a" /> Insert New
          </button>
          <button className="tool-btn-mini" disabled={isReadOnly} onClick={onAddItemEnd} title="Add Item at End (Ctrl+Shift+I)">
            <Plus size={12} color="#0284c7" /> Add New
          </button>
          <button className="tool-btn-mini" disabled={isReadOnly || !selectedRowId} onClick={() => selectedRowId && onDeleteRows([selectedRowId])} title="Delete estimate row (Ctrl+Delete)">
            <Trash2 size={12} /> Delete
          </button>
          <button className="tool-btn-mini" disabled={isReadOnly} onClick={onUnindentRow} title="Unindent (Ctrl+>)">
            <Outdent size={12} />
          </button>
          <button className="tool-btn-mini" disabled={isReadOnly} onClick={onIndentRow} title="Indent (Ctrl+<)">
            <Indent size={12} />
          </button>
          <button className="tool-btn-mini" onClick={() => onExpandAll(true)} title="Expand All (Ctrl++)">
            <ChevronsUpDown size={12} />
          </button>
          <button className="tool-btn-mini" onClick={() => onExpandAll(false)} title="Collapse to Trades (Ctrl+-)">
            <ChevronsDownUp size={12} />
          </button>

          {!isPriceList && optionsPackages.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
              {optionsPackages.map((op) => (
                <button
                  key={op.id}
                  className={`tool-btn-mini ${op.enabled ? 'active' : ''}`}
                  style={{
                    fontSize: 10,
                    background: op.enabled ? 'var(--brand-blue-light)' : undefined,
                    borderColor: op.enabled ? 'var(--brand-blue)' : undefined,
                  }}
                  onClick={() => onToggleOption?.(op.id)}
                  title={`${op.description} (Click to toggle Option Package)`}
                >
                  Opt: {op.name.split(' ')[0]} {op.enabled ? 'ON' : 'OFF'}
                </button>
              ))}
              {variations.map((v) => (
                <button
                  key={v.id}
                  className="tool-btn-mini"
                  style={{ fontSize: 10 }}
                  onClick={() => onCycleVariationStatus?.(v.id)}
                  title={`${v.name} — Click to cycle Pending / Approved / Rejected`}
                >
                  {v.code}: {v.status}
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          className="estimate-grid-scroll worksheet-grid"
          tabIndex={0}
          aria-label={isPriceList ? 'Price list worksheet' : 'Estimate worksheet'}
          onFocus={(event) => focusWorksheet(event, onSelectRow)}
          onClick={(event) => { setSelection(null); clickWorksheet(event); }}
          onKeyDownCapture={handleEstimateKey}
          data-selected-column={selection?.column === undefined ? undefined : selection.column + 1}
        >
          {upperTab === 'Estimate' ? (
            <table className="cubit-table" style={{ minWidth: activeColumns.reduce((width, column) => width + (column.width ?? 0), 0) }}>
              <thead>
                <tr>
                  {activeColumns.map((col) => (
                    <th
                      key={col.key}
                      style={{ width: col.width }}
                      className={[
                        'quantity',
                        'conversion',
                        'numberMultiplier',
                        'factor',
                        'wastagePct',
                        'rate',
                        'costTotal',
                        'markupPct',
                        'markupAmt',
                        'total',
                        'jobPct',
                      ].includes(col.key)
                        ? 'num'
                        : ''}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setShowColumnChooser(true);
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(({ row, depth }) => {
                  const isSelected = row.id === selectedRowId;
                  const rowLocked = Boolean(isReadOnly || row.lockedBy);
                  const effectiveRate =
                    !hidePickedRates && row.pickedRate ? row.pickedRate.rate : computeRowRate(row);
                  const effectiveRow = { ...row, rate: effectiveRate };
                  const rowCostTotal =
                    row.rowType === 'Item' ? computeItemCostTotal(effectiveRow) : 0;
                  const rowMarkupAmt =
                    row.rowType === 'Item' ? computeItemMarkupAmount(effectiveRow) : 0;
                  const rowTotal =
                    row.rowType === 'Item'
                      ? computeItemTotal(effectiveRow)
                      : totalsMap[row.id] ?? 0;
                  const jobPct = jobSubtotal > 0 ? (rowTotal / jobSubtotal) * 100 : 0;

                  const rowCls = [
                    row.rowType === 'Trade' ? 'row-trade' : '',
                    row.rowType === 'Heading' || row.rowType === 'Subheading' ? 'row-heading' : '',
                    isSelected ? 'selected' : '',
                    !hidePickedRates && row.pickedRate ? 'row-item-picked' : '',
                    row.pricingMode === 'EXCL' || row.excludeFromTotal ? 'row-excluded' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <tr
                      key={row.id}
                      data-worksheet-row={row.id}
                      data-keyboard-row={selection?.rowId === row.id && selection.column === undefined ? true : undefined}
                      data-keyboard-trade={selection?.column !== undefined && selection.rowId === tradeForRow(row.id) ? true : undefined}
                      className={rowCls}
                      onClick={() => onSelectRow(row.id)}
                    >
                      {activeColumns.map((col) => {
                        const isEditing =
                          !rowLocked &&
                          editingCell?.rowId === row.id &&
                          editingCell.field === col.key;

                        if (col.key === 'lockedBy') {
                          return (
                            <td
                              key={col.key}
                              style={{ textAlign: 'center' }}
                              title={row.lockedBy ? `Locked by ${row.lockedBy}` : 'Unlocked (Ctrl+L on Trade)'}
                            >
                              {row.lockedBy && <Lock size={11} color="#b45309" />}
                            </td>
                          );
                        }

                        if (col.key === 'code') {
                          return (
                            <td
                              key={col.key}
                              className="mono"
                              onDoubleClick={() => !rowLocked && setEditingCell({ rowId: row.id, field: 'code' })}
                            >
                              {(row.flagged || row.flagStatus) && row.flagStatus !== 'Resolved' && (
                                <Flag
                                  size={10}
                                  color={row.flagStatus === 'Review' ? '#7e22ce' : 'var(--accent-red)'}
                                  fill={row.flagStatus === 'Review' ? '#7e22ce' : 'var(--accent-red)'}
                                  style={{ marginRight: 3 }}
                                />
                              )}
                              {isEditing ? (
                                <input
                                  autoFocus
                                  className="inline-cell-input mono"
                                  defaultValue={row.code}
                                  onBlur={(e) => {
                                    onUpdateRow(row.id, { code: e.target.value });
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      onUpdateRow(row.id, { code: (e.target as HTMLInputElement).value });
                                      setEditingCell(null);
                                    }
                                  }}
                                />
                              ) : (
                                row.code
                              )}
                            </td>
                          );
                        }

                        if (col.key === 'refCode') {
                          return (
                            <td
                              key={col.key}
                              className="mono"
                              onDoubleClick={() => !rowLocked && setEditingCell({ rowId: row.id, field: 'refCode' })}
                            >
                              {isEditing ? (
                                <input
                                  autoFocus
                                  className="inline-cell-input mono"
                                  defaultValue={row.refCode ?? ''}
                                  onBlur={(e) => {
                                    onUpdateRow(row.id, { refCode: e.target.value.trim() || undefined });
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      onUpdateRow(row.id, {
                                        refCode: (e.target as HTMLInputElement).value.trim() || undefined,
                                      });
                                      setEditingCell(null);
                                    }
                                  }}
                                />
                              ) : (
                                row.refCode ?? ''
                              )}
                            </td>
                          );
                        }

                        if (col.key === 'description') {
                          return (
                            <td
                              key={col.key}
                              onDoubleClick={() =>
                                !rowLocked && setEditingCell({ rowId: row.id, field: 'description' })
                              }
                              title={row.formula ? `${row.description} (Formula: ${row.formula})` : row.description}
                            >
                              {isEditing ? (
                                <input
                                  autoFocus
                                  className="inline-cell-input"
                                  defaultValue={row.description}
                                  onBlur={(e) => {
                                    onUpdateRow(row.id, { description: e.target.value });
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      onUpdateRow(row.id, {
                                        description: (e.target as HTMLInputElement).value,
                                      });
                                      setEditingCell(null);
                                    } else if (e.key === 'Escape') {
                                      setEditingCell(null);
                                    }
                                  }}
                                />
                              ) : (
                                <div className="tree-cell" style={{ paddingLeft: depth * 14 }}>
                                  {row.rowType !== 'Item' && (
                                    <button
                                      className="tree-toggle"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleCollapse(row.id);
                                      }}
                                    >
                                      {row.collapsed ? (
                                        <ChevronRight size={12} />
                                      ) : (
                                        <ChevronDown size={12} />
                                      )}
                                    </button>
                                  )}
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {row.description}
                                  </span>
                                </div>
                              )}
                            </td>
                          );
                        }

                        if (col.key === 'resultType') {
                          return (
                            <td key={col.key}>
                              {row.rowType === 'Item' && (
                                <select
                                  disabled={rowLocked}
                                  className="form-select"
                                  style={{ height: 20, fontSize: 10.5, padding: '0 2px' }}
                                  value={row.resultType ?? 'Area'}
                                  onChange={(e) =>
                                    onChangeResultType(row, e.target.value as ResultType)
                                  }
                                >
                                  {RESULT_TYPES.map((rt) => (
                                    <option key={rt} value={rt}>
                                      {rt}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                          );
                        }

                        if (col.key === 'quantity') {
                          return (
                            <td
                              key={col.key}
                              className="num mono"
                              title={row.formula ? `Formula: ${row.formula}` : 'Double-click to edit or enter =SUM / =TSUM formula'}
                              onDoubleClick={() =>
                                !rowLocked &&
                                row.rowType === 'Item' &&
                                setEditingCell({ rowId: row.id, field: 'quantity' })
                              }
                            >
                              {row.rowType !== 'Item' ? (
                                ''
                              ) : isEditing ? (
                                <input
                                  autoFocus
                                  className="inline-cell-input mono"
                                  defaultValue={row.formula ?? String(row.quantity)}
                                  onBlur={(e) => {
                                    commitNumericOrFormula(row, 'quantity', e.target.value);
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      commitNumericOrFormula(
                                        row,
                                        'quantity',
                                        (e.target as HTMLInputElement).value
                                      );
                                      setEditingCell(null);
                                    } else if (e.key === 'Escape') {
                                      setEditingCell(null);
                                    }
                                  }}
                                />
                              ) : (
                                formatNumber(row.quantity)
                              )}
                            </td>
                          );
                        }

                        if (col.key === 'unit') {
                          return (
                            <td
                              key={col.key}
                              onDoubleClick={() =>
                                !rowLocked &&
                                row.rowType === 'Item' &&
                                setEditingCell({ rowId: row.id, field: 'unit' })
                              }
                            >
                              {row.rowType !== 'Item' ? (
                                ''
                              ) : isEditing ? (
                                <input
                                  autoFocus
                                  className="inline-cell-input"
                                  defaultValue={row.unit}
                                  onBlur={(e) => {
                                    onUpdateRow(row.id, { unit: e.target.value });
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      onUpdateRow(row.id, {
                                        unit: (e.target as HTMLInputElement).value,
                                      });
                                      setEditingCell(null);
                                    }
                                  }}
                                />
                              ) : (
                                row.unit
                              )}
                            </td>
                          );
                        }

                        if (
                          col.key === 'conversion' ||
                          col.key === 'numberMultiplier' ||
                          col.key === 'factor' ||
                          col.key === 'wastagePct'
                        ) {
                          const numericField = col.key as
                            | 'conversion'
                            | 'numberMultiplier'
                            | 'factor'
                            | 'wastagePct';
                          const displayVal =
                            numericField === 'factor' || numericField === 'conversion' || numericField === 'numberMultiplier'
                              ? row[numericField] ?? 1
                              : row[numericField] ?? 0;
                          return (
                            <td
                              key={col.key}
                              className="num mono"
                              onDoubleClick={() =>
                                !rowLocked &&
                                row.rowType === 'Item' &&
                                setEditingCell({ rowId: row.id, field: numericField })
                              }
                            >
                              {row.rowType !== 'Item' ? (
                                ''
                              ) : isEditing ? (
                                <input
                                  autoFocus
                                  type="number"
                                  className="inline-cell-input mono"
                                  defaultValue={displayVal}
                                  onBlur={(e) => {
                                    commitNumericOrFormula(row, numericField, e.target.value);
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      commitNumericOrFormula(
                                        row,
                                        numericField,
                                        (e.target as HTMLInputElement).value
                                      );
                                      setEditingCell(null);
                                    }
                                  }}
                                />
                              ) : numericField === 'wastagePct' ? (
                                `${formatNumber(displayVal, 1)}%`
                              ) : (
                                formatNumber(displayVal, 2)
                              )}
                            </td>
                          );
                        }

                        if (col.key === 'rate') {
                          return (
                            <td
                              key={col.key}
                              className="num mono rate-cell"
                              title={
                                row.pickedRate && !hidePickedRates
                                  ? `Picked Rate: ${row.pickedRate.supplier} (${row.pickedRate.pickedDate})`
                                  : undefined
                              }
                              onDoubleClick={() =>
                                !rowLocked &&
                                row.rowType === 'Item' &&
                                row.rateRows.length === 0 &&
                                setEditingCell({ rowId: row.id, field: 'rate' })
                              }
                            >
                              {row.rowType !== 'Item' ? (
                                ''
                              ) : isEditing ? (
                                <input
                                  autoFocus
                                  className="inline-cell-input mono"
                                  defaultValue={row.formula ?? String(row.rate)}
                                  onBlur={(e) => {
                                    commitNumericOrFormula(row, 'rate', e.target.value);
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      commitNumericOrFormula(
                                        row,
                                        'rate',
                                        (e.target as HTMLInputElement).value
                                      );
                                      setEditingCell(null);
                                    }
                                  }}
                                />
                              ) : (
                                formatCurrency(effectiveRate)
                              )}
                            </td>
                          );
                        }

                        if (col.key === 'costTotal') {
                          return (
                            <td key={col.key} className="num mono">
                              {row.rowType === 'Item' ? formatCurrency(rowCostTotal) : ''}
                            </td>
                          );
                        }

                        if (col.key === 'markupPct') {
                          return (
                            <td
                              key={col.key}
                              className="num mono"
                              onDoubleClick={() =>
                                !rowLocked &&
                                row.rowType === 'Item' &&
                                setEditingCell({ rowId: row.id, field: 'markupPct' })
                              }
                            >
                              {row.rowType !== 'Item' ? (
                                ''
                              ) : isEditing ? (
                                <input
                                  autoFocus
                                  type="number"
                                  className="inline-cell-input mono"
                                  defaultValue={row.markupPct}
                                  onBlur={(e) => {
                                    commitNumericOrFormula(row, 'markupPct', e.target.value);
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      commitNumericOrFormula(
                                        row,
                                        'markupPct',
                                        (e.target as HTMLInputElement).value
                                      );
                                      setEditingCell(null);
                                    }
                                  }}
                                />
                              ) : (
                                `${row.markupPct}%`
                              )}
                            </td>
                          );
                        }

                        if (col.key === 'markupAmt') {
                          return (
                            <td key={col.key} className="num mono">
                              {row.rowType === 'Item' ? formatCurrency(rowMarkupAmt) : ''}
                            </td>
                          );
                        }

                        if (col.key === 'total') {
                          return (
                            <td key={col.key} className="num mono">
                              {formatCurrency(rowTotal)}
                            </td>
                          );
                        }

                        if (col.key === 'jobPct') {
                          return (
                            <td key={col.key} className="num mono">
                              {formatNumber(jobPct, 1)}%
                            </td>
                          );
                        }

                        if (col.key === 'pricingMode') {
                          return (
                            <td key={col.key} style={{ textAlign: 'center' }}>
                              {row.rowType === 'Item' && (
                                <button
                                  disabled={rowLocked}
                                  className={`incl-badge ${row.pricingMode === 'INCL' ? 'incl' : 'excl'}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onUpdateRow(row.id, {
                                      pricingMode: row.pricingMode === 'INCL' ? 'EXCL' : 'INCL',
                                    });
                                  }}
                                  title="Shortcut: I for INCL, E for EXCL"
                                >
                                  {row.pricingMode}
                                </button>
                              )}
                            </td>
                          );
                        }

                        if (col.key === 'excludeFromTotal') {
                          return (
                            <td key={col.key} style={{ textAlign: 'center' }}>
                              {row.rowType === 'Item' && (
                                <input
                                  disabled={rowLocked}
                                  type="checkbox"
                                  checked={!!row.excludeFromTotal}
                                  onChange={(e) =>
                                    onUpdateRow(row.id, { excludeFromTotal: e.target.checked })
                                  }
                                />
                              )}
                            </td>
                          );
                        }

                        if (col.key === 'excludeFromTax') {
                          return (
                            <td key={col.key} style={{ textAlign: 'center' }}>
                              {row.rowType === 'Item' && (
                                <input
                                  disabled={rowLocked}
                                  type="checkbox"
                                  checked={!!row.excludeFromTax}
                                  onChange={(e) =>
                                    onUpdateRow(row.id, { excludeFromTax: e.target.checked })
                                  }
                                />
                              )}
                            </td>
                          );
                        }

                        if (col.key === 'groupingCode') {
                          return (
                            <td key={col.key} className="mono">
                              {row.groupingCode}
                            </td>
                          );
                        }

                        if (col.key === 'rel') {
                          return <td key={col.key}>{row.rel ?? ''}</td>;
                        }

                        if (col.key === 'note') {
                          return (
                            <td
                              key={col.key}
                              onDoubleClick={() =>
                                !rowLocked && setEditingCell({ rowId: row.id, field: 'note' })
                              }
                            >
                              {isEditing ? (
                                <input
                                  autoFocus
                                  className="inline-cell-input"
                                  defaultValue={row.note ?? ''}
                                  onBlur={(e) => {
                                    onUpdateRow(row.id, { note: e.target.value });
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      onUpdateRow(row.id, {
                                        note: (e.target as HTMLInputElement).value,
                                      });
                                      setEditingCell(null);
                                    }
                                  }}
                                />
                              ) : (
                                row.note ?? ''
                              )}
                            </td>
                          );
                        }

                        return <td key={col.key} />;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="cubit-table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Grouping Code</th>
                  <th>Grouped Items Summary</th>
                  <th style={{ width: 70 }} className="num">Items</th>
                  <th style={{ width: 110 }} className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {groupedByCode.map((g) => (
                  <React.Fragment key={g.code}>
                    <tr className="row-trade">
                      <td className="mono">{g.code}</td>
                      <td>{g.code} Group</td>
                      <td className="num mono">{g.items.length}</td>
                      <td className="num mono">{formatCurrency(g.total)}</td>
                    </tr>
                    {g.items.map((item) => (
                      <tr
                        key={item.id}
                        data-worksheet-row={item.id}
                        className={item.id === selectedRowId ? 'selected' : ''}
                        onClick={() => onSelectRow(item.id)}
                      >
                        <td className="mono">{item.code}</td>
                        <td style={{ paddingLeft: 18 }}>{item.description}</td>
                        <td className="num mono">
                          {formatNumber(item.quantity)} {item.unit}
                        </td>
                        <td className="num mono">{formatCurrency(computeItemTotal(item))}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Horizontal Split Resizer */}
      <div className="resizer-h" onMouseDown={startSplitDrag} />

      {/* LOWER SHEET: CALCULATION SHEET (F9) & RATE SHEET / DATASHEET */}
      <div
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, outline: 'none' }}
      >
        <div className="pane-tabs-bar worksheet-toolbar">
          <div className="pane-tabs-left">
            {!isPriceList && (
              <button
                className={`pane-tab ${lowerTab === 'Calc' ? 'active' : ''}`}
                onClick={() => onChangeLowerTab('Calc')}
              >
                Calculation Sheet (F9)
              </button>
            )}
            <button
              className={`pane-tab ${lowerTab === 'Rate' ? 'active' : ''}`}
              onClick={() => onChangeLowerTab('Rate')}
            >
              Rate Sheet / Datasheet {selectedRow?.rateRows.length ? `(${selectedRow.rateRows.length})` : ''}
            </button>
          </div>
          <div className="worksheet-toolbar-actions">
            <span className="worksheet-summary" title={selectedRow?.description}>
              {selectedRow ? selectedRow.description : 'Select an Estimate Item'}
            </span>
            {lowerTab === 'Calc' && selectedRow?.rowType === 'Item' && !lowerReadOnly && (
              <button className="tool-btn-mini" onClick={handleAddManualCalcLine}>
                <Plus size={11} color="var(--brand-blue)" /> Manual Line
              </button>
            )}
            {lowerTab === 'Rate' && selectedRow?.rowType === 'Item' && !lowerReadOnly && (
              <button className="tool-btn-mini" onClick={handleAddRateRow}>
                <Plus size={11} color="#16a34a" /> Add Rate Line
              </button>
            )}
          </div>
        </div>

        <div
          ref={calcSheetRef}
          className="estimate-grid-scroll worksheet-grid"
          tabIndex={0}
          aria-label={lowerTab === 'Rate' || isPriceList ? 'Rate worksheet' : 'Calculation worksheet'}
          onFocus={(event) => focusWorksheet(event, lowerTab === 'Calc' && !isPriceList ? onSelectCalcRow : undefined)}
          onClick={clickWorksheet}
          onKeyDownCapture={(event) => navigateWorksheet(
            event,
            selectedRow?.rowType === 'Item' && !lowerReadOnly
              ? lowerTab === 'Rate' || isPriceList ? handleAddRateRow : handleAddManualCalcLine
              : undefined,
          )}
        >
          {lowerTab === 'Calc' && !isPriceList ? (
            <table className="cubit-table worksheet-detail-table">
              <thead>
                <tr>
                  <th>Shape / Calc Description</th>
                  <th style={{ width: 95 }}>Result</th>
                  <th style={{ width: 58 }} className="num">Length</th>
                  <th style={{ width: 56 }} className="num">Width</th>
                  <th style={{ width: 56 }} className="num">Height</th>
                  <th style={{ width: 54 }} className="num">Depth</th>
                  <th style={{ width: 52 }} className="num">Factor</th>
                  <th style={{ width: 96 }}>Rounding</th>
                  <th style={{ width: 72 }} className="num">Qty</th>
                </tr>
              </thead>
              <tbody>
                {(selectedRow?.calcRows ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ color: 'var(--text-muted)', padding: 10 }}>
                      No shapes or manual calculation rows linked yet. Draw a shape on the Viewport or click &quot;+ Manual Line&quot;.
                    </td>
                  </tr>
                ) : (
                  selectedRow?.calcRows.map((c) => (
                    <tr
                      key={c.id}
                      data-worksheet-row={c.id}
                      className={selectedCalcRowId === c.id ? 'selected' : ''}
                      onClick={() => onSelectCalcRow(c.id)}
                      onContextMenu={(e) => {
                        if (c.shapeId) {
                          e.preventDefault();
                          setCalcContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            shapeId: c.shapeId,
                            planId: c.planId,
                          });
                        }
                      }}
                    >
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          {c.shapeId ? <span>{c.description}</span> : <WorksheetInput
                            label="Calculation description" value={c.description} disabled={lowerReadOnly}
                            onCommit={(description) => handleUpdateCalcLine(c.id, { description })}
                          />}
                          {c.shapeId && (
                            <button
                              className="pane-icon-btn"
                              title="View in Viewport"
                              onClick={(e) => {
                                e.stopPropagation();
                                onViewShapeInViewport(c.shapeId!, c.planId);
                              }}
                            >
                              <Eye size={12} color="var(--brand-blue)" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="result-chip">{c.resultType}</span>
                      </td>
                      <td className="num mono">{c.length ? formatNumber(c.length) : ''}</td>
                      <td className="num mono">{c.width ?? ''}</td>
                      <td className="num mono">{c.height ?? ''}</td>
                      <td className="num mono">{c.depth ?? ''}</td>
                      <td className="num mono"><WorksheetInput
                        label="Calculation factor" value={c.factor} disabled={lowerReadOnly}
                        onCommit={(value) => {
                          const factor = Number(value);
                          if (value.trim() && Number.isFinite(factor)) handleUpdateCalcLine(c.id, { factor });
                        }}
                      /></td>
                      <td>
                        <select
                          disabled={lowerReadOnly}
                          className="form-select"
                          style={{ height: 20, fontSize: 10.5, padding: '0 2px' }}
                          value={c.rounding ?? 'None'}
                          onChange={(e) =>
                            handleUpdateCalcLine(c.id, {
                              rounding: e.target.value as CalcRow['rounding'],
                            })
                          }
                        >
                          {ROUNDING_MODES.map((rm) => (
                            <option key={rm} value={rm}>
                              {rm}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="num mono" style={{ fontWeight: 600 }}>
                        {c.shapeId ? formatNumber(c.quantity) : <WorksheetInput
                          label="Manual quantity" value={c.quantity} disabled={lowerReadOnly}
                          onCommit={(value) => {
                            const quantity = Number(value);
                            if (value.trim() && Number.isFinite(quantity)) handleUpdateCalcLine(c.id, { quantity });
                          }}
                        />}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="cubit-table worksheet-detail-table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Code</th>
                  <th>Component Description (Datasheet Build-Up)</th>
                  <th style={{ width: 82 }}>Type</th>
                  <th style={{ width: 46 }}>Fn</th>
                  <th style={{ width: 46 }}>Unit</th>
                  <th style={{ width: 58 }} className="num">Qty</th>
                  <th style={{ width: 78 }} className="num">Rate</th>
                  <th style={{ width: 84 }} className="num">Total</th>
                  <th style={{ width: 28 }}></th>
                </tr>
              </thead>
              <tbody>
                {(selectedRow?.rateRows ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ color: 'var(--text-muted)', padding: 10 }}>
                      Simple Rate item. Click &quot;+ Add Rate Line&quot; or &quot;Price List → Add Rate&quot; to build a composite Rate Sheet.
                    </td>
                  </tr>
                ) : (
                  selectedRow?.rateRows.map((rr) => (
                    <tr key={rr.id} data-worksheet-row={rr.id}>
                      <td className="mono"><WorksheetInput label="Rate code" value={rr.code} disabled={lowerReadOnly}
                        onCommit={(code) => handleUpdateRateRow(rr.id, { code })} /></td>
                      <td><WorksheetInput label="Rate description" value={rr.description} disabled={lowerReadOnly}
                        onCommit={(description) => handleUpdateRateRow(rr.id, { description })} /></td>
                      <td>
                        <select
                          disabled={lowerReadOnly}
                          className="form-select"
                          style={{ height: 20, fontSize: 10.5 }}
                          value={rr.kind}
                          onChange={(e) =>
                            handleUpdateRateRow(rr.id, {
                              kind: e.target.value as RateRow['kind'],
                            })
                          }
                        >
                          <option value="Material">Material</option>
                          <option value="Labour">Labour</option>
                          <option value="Subcontract">Subcontract</option>
                        </select>
                      </td>
                      <td>
                        <select
                          disabled={lowerReadOnly}
                          className="form-select mono"
                          style={{ height: 20, fontSize: 10.5 }}
                          value={rr.fn ?? ''}
                          title="Cubit Rate Sheet functions: + divides cost by Qty, % takes % of prior row"
                          onChange={(e) =>
                            handleUpdateRateRow(rr.id, {
                              fn: (e.target.value || undefined) as RateRow['fn'],
                            })
                          }
                        >
                          <option value="">×</option>
                          <option value="+">+</option>
                          <option value="%">%</option>
                        </select>
                      </td>
                      <td><WorksheetInput label="Rate unit" value={rr.unit} disabled={lowerReadOnly}
                        onCommit={(unit) => handleUpdateRateRow(rr.id, { unit })} /></td>
                      <td className="num mono">
                        <WorksheetInput
                          label="Rate quantity" value={rr.quantity} disabled={lowerReadOnly}
                          onCommit={(value) => {
                            const quantity = Number(value);
                            if (Number.isFinite(quantity)) handleUpdateRateRow(rr.id, { quantity });
                          }}
                        />
                      </td>
                      <td className="num mono">
                        <WorksheetInput
                          label="Component rate" value={rr.rate} disabled={lowerReadOnly}
                          onCommit={(value) => {
                            const rate = Number(value);
                            if (Number.isFinite(rate)) handleUpdateRateRow(rr.id, { rate });
                          }}
                        />
                      </td>
                      <td className="num mono" style={{ fontWeight: 600 }}>
                        {formatCurrency(rr.total)}
                      </td>
                      <td>
                        {!lowerReadOnly && (
                          <button
                            className="pane-icon-btn"
                            title="Delete rate line"
                            onClick={() => handleDeleteRateRow(rr.id)}
                          >
                            <Trash2 size={11} color="var(--accent-red)" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Calculation Sheet Context Menu */}
      {calcContextMenu && (
        <div
          className="context-menu"
          style={{ left: calcContextMenu.x, top: calcContextMenu.y }}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              onViewShapeInViewport(calcContextMenu.shapeId, calcContextMenu.planId);
              setCalcContextMenu(null);
            }}
          >
            <span>View in Viewport</span>
          </button>
        </div>
      )}

      {showColumnChooser && (
        <ColumnChooserModal
          title="Estimate Sheet"
          allColumns={ESTIMATE_ALL_COLUMNS}
          visibleKeys={visibleColKeys}
          onToggleColumn={(k) =>
            setVisibleColKeys((prev) =>
              prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
            )
          }
          onClose={() => setShowColumnChooser(false)}
        />
      )}
    </div>
  );
};

