import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import type {
  ConstantEntry,
  CubitOptionsState,
  DrawingTool,
  EstimateRow,
  GroupingCodeDef,
  JobRecord,
  PlanDocument,
  ShapeOpening,
  TakeoffShape,
  VariationRecord,
  WorkspaceLayoutPreset,
} from '../../types/cubit';
import {
  computeJobSummary,
  computeRowRate,
  computeShapeMetrics,
  formatCurrency,
  LOCKED_JOB_STATUSES,
} from '../../utils/estimateCalc';
import {
  JobRibbon,
  type OptimisePdfState,
  type PaneVisibility,
  type RibbonTabKey,
  type TakeoffDisplayState,
} from './JobRibbon';
import { EstimatePane } from './EstimatePane';
import { ViewportPane } from './ViewportPane';
import { SidePanes } from './SidePanes';
import { PriceListInsertModal } from '../modals/PriceListInsertModal';
import { ConstantsModal } from '../modals/ConstantsModal';
import { OpeningsModal } from '../modals/OpeningsModal';
import { GroupingCodesModal } from '../modals/GroupingCodesModal';
import { JobUpdateModal } from '../modals/JobUpdateModal';
import { TaxAdjustmentsModal } from '../modals/TaxAdjustmentsModal';
import { InsertPlanModal } from '../modals/InsertPlanModal';
import { IfcImportModal } from '../modals/IfcImportModal';
import { PlanRevisionModal } from '../modals/PlanRevisionModal';
import { ReportPreviewModal, type ReportTabKind } from '../modals/ReportPreviewModal';
import { AiTakeoffModal, type AiModeTab } from '../modals/AiTakeoffModal';
import { OptionsVariationsModal } from '../modals/OptionsVariationsModal';
import { autoSelectPolygon, type AiZoneResult } from '../../services/engineClient';
import { defaultResultUnit, isPolygonResult } from '../../utils/measurement';

interface JobWorkspaceProps {
  job: JobRecord;
  priceLists: JobRecord[];
  options: CubitOptionsState;
  constants: ConstantEntry[];
  onUpdateConstants: (next: ConstantEntry[]) => void;
  groupingCodes: GroupingCodeDef[];
  onUpdateGroupingCodes: (next: GroupingCodeDef[]) => void;
  onCreateGroupedJob: (sourceJob: JobRecord) => void;
  ribbonCollapsed: boolean;
  onToggleRibbon: () => void;
  showKeytips: boolean;
  onUpdateJob: (jobId: string, patch: Partial<JobRecord>, recordHistory?: boolean) => void;
  onPinToQat: (id: string, label: string) => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onNotify: (msg: string) => void;
}

const SHAPE_PALETTE = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#0891b2', '#ea580c', '#b45309'];
const CUSTOM_LAYOUT_STORAGE_KEY = 'cobitx.customLayout.v1';

export const JobWorkspace: React.FC<JobWorkspaceProps> = ({
  job,
  priceLists,
  options,
  constants,
  onUpdateConstants,
  groupingCodes,
  onUpdateGroupingCodes,
  onCreateGroupedJob,
  ribbonCollapsed,
  onToggleRibbon,
  showKeytips,
  onUpdateJob,
  onPinToQat,
  onOpenSettings,
  onOpenHelp,
  onNotify,
}) => {
  const isPriceList = job.kind === 'PriceList';
  const isReadOnly = Boolean(job.isReadOnly);
  const freezeStates = job.freezeStates ?? ['None'];
  const isStatusLocked = LOCKED_JOB_STATUSES.has(job.status);
  const isJobFrozen =
    isReadOnly ||
    isStatusLocked ||
    freezeStates.includes('Job') ||
    freezeStates.includes('Estimate');
  const isQuantitiesFrozen = isJobFrozen || freezeStates.includes('Quantities');
  const isRatesFrozen = isJobFrozen || freezeStates.includes('Rates');
  const isNewItemsFrozen = isJobFrozen || freezeStates.includes('New Items');

  const freezeLockReason = (scope: string) =>
    isReadOnly
      ? 'Job is in Read-Only mode. Select Enable Editing to resume.'
      : isStatusLocked
      ? `Job status is "${job.status}" (locked against ${scope}).`
      : `${scope} frozen by Job Freeze States (${freezeStates.filter((f) => f !== 'None').join(', ')}).`;

  const [ribbonTab, setRibbonTab] = useState<RibbonTabKey>('Home');
  const [activeTool, setActiveTool] = useState<DrawingTool>('Select');
  const [orthoEnabled, setOrthoEnabled] = useState(false);
  const [phantomEnabled, setPhantomEnabled] = useState(false);
  const [viewMode, setViewMode] = useState<'2D' | '3D'>('2D');
  const [isolateSelected, setIsolateSelected] = useState(false);
  const [hidePickedRates, setHidePickedRates] = useState(false);

  const [optimisePdf, setOptimisePdf] = useState<OptimisePdfState>({
    flattenPdf: false,
    rasteriseText: false,
    singleColour: false,
  });
  const [takeoffDisplay, setTakeoffDisplay] = useState<TakeoffDisplayState>({
    legend: false,
    names: true,
    dimensions: false,
  });

  const [layoutPreset, setLayoutPreset] = useState<WorkspaceLayoutPreset>('Takeoff');
  const [estimateWidthPx, setEstimateWidthPx] = useState(isPriceList ? 920 : 480);
  const [paneVisibility, setPaneVisibility] = useState<PaneVisibility>({
    estimate: true,
    viewport: !isPriceList,
    plans: !isPriceList,
    shapes: !isPriceList,
    details: !isPriceList,
    takeoff: !isPriceList,
    navigation: !isPriceList,
    flags: !isPriceList,
    references: !isPriceList,
  });

  const [selectedRowId, setSelectedRowId] = useState<string | null>(
    job.rows.find((r) => r.rowType === 'Item')?.id ?? job.rows[0]?.id ?? null
  );
  const [deleteRows, setDeleteRows] = useState<string[]>([]);
  const [skipDeleteConfirmation, setSkipDeleteConfirmation] = useState(false);
  const [selectedCalcRowId, setSelectedCalcRowId] = useState<string | null>(null);
  const [lowerTab, setLowerTab] = useState<'Calc' | 'Rate'>(isPriceList ? 'Rate' : 'Calc');

  const [activePlanId, setActivePlanId] = useState<string>(job.plans[0]?.id ?? '');
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(job.shapes[0]?.id ?? null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 30, y: 20 });
  const [draftPoints, setDraftPoints] = useState<{ x: number; y: number }[]>([]);
  const activePlan = job.plans.find((plan) => plan.id === activePlanId);
  const canEditPlan = viewMode === '2D' && !!activePlan && activePlan.kind !== 'IFC' && !isQuantitiesFrozen;
  const canEditPdf = canEditPlan && activePlan.kind.endsWith('PDF');

  const [newShapeParams, setNewShapeParams] = useState({
    description: 'New Measurement Shape',
    heightMm: options.defaultWallHeightMm,
    startHeightMm: options.defaultWallHeightMm,
    endHeightMm: options.defaultWallHeightMm,
    pitchDeg: 0,
    depthMm: options.defaultVolumeDepthMm,
    trenchWidthMm: options.defaultWidthMm,
    centresSpacingMm: 450,
  });

  const [showPriceListModal, setShowPriceListModal] = useState(false);
  const [showConstantsModal, setShowConstantsModal] = useState(false);
  const [openingsModalKind, setOpeningsModalKind] = useState<'Door' | 'Window' | null>(null);
  const [showGroupingModal, setShowGroupingModal] = useState(false);
  const [showJobUpdateModal, setShowJobUpdateModal] = useState(false);
  const [showTaxModal, setShowTaxModal] = useState(false);
  const [showInsertPlanModal, setShowInsertPlanModal] = useState(false);
  const [showIfcModal, setShowIfcModal] = useState(false);
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [optionsVarModalTab, setOptionsVarModalTab] = useState<'Options' | 'Variations' | null>(null);
  const [clipboardRow, setClipboardRow] = useState<{ mode: 'copy' | 'cut'; row: EstimateRow } | null>(null);
  const [calibratingScale, setCalibratingScale] = useState(false);
  const [aligningRevision, setAligningRevision] = useState(false);
  const [reportTab, setReportTab] = useState<ReportTabKind | null>(null);
  const [aiModalTab, setAiModalTab] = useState<AiModeTab | null>(null);

  const workspaceBodyRef = useRef<HTMLDivElement>(null);
  const calcSheetRef = useRef<HTMLDivElement>(null);

  const selectedItem =
    job.rows.find((r) => r.id === selectedRowId) ??
    null;

  const selectEstimateRow = (id: string) => {
    if (id !== selectedRowId) setDraftPoints([]);
    setSelectedRowId(id);
  };

  const selectTool = (tool: DrawingTool) => {
    if (tool !== 'Select' && (!canEditPlan || (tool !== 'Ruler' && selectedItem?.rowType !== 'Item'))) {
      onNotify('Open a 2D drawing and select an estimate item to start takeoff.');
      return;
    }
    if (tool !== activeTool) {
      setDraftPoints([]);
      setCalibratingScale(false);
      setAligningRevision(false);
    }
    setActiveTool(tool);
  };

  const selectPlan = (id: string) => {
    if (id === activePlanId) return;
    setActivePlanId(id);
    setViewMode(job.plans.find((plan) => plan.id === id)?.kind === 'IFC' ? '3D' : '2D');
    setActiveTool('Select');
    setDraftPoints([]);
    setCalibratingScale(false);
    setAligningRevision(false);
    setSelectedShapeId(null);
    setZoom(1);
    setPan({ x: 30, y: 20 });
  };

  const changeViewMode = (mode: '2D' | '3D') => {
    if (mode === viewMode) return;
    setViewMode(mode);
    setActiveTool('Select');
    setDraftPoints([]);
    setCalibratingScale(false);
    setAligningRevision(false);
  };

  const summary = useMemo(() => computeJobSummary(job), [job]);

  const applyLayoutPreset = (preset: WorkspaceLayoutPreset) => {
    setLayoutPreset(preset);
    if (preset === 'Takeoff') {
      setEstimateWidthPx(460);
      setPaneVisibility({
        estimate: true,
        viewport: true,
        plans: true,
        shapes: true,
        details: true,
        takeoff: true,
        navigation: true,
        flags: true,
        references: true,
      });
    } else if (preset === 'Estimating') {
      setEstimateWidthPx(780);
      setPaneVisibility({
        estimate: true,
        viewport: true,
        plans: false,
        shapes: false,
        details: true,
        takeoff: false,
        navigation: false,
        flags: true,
        references: true,
      });
    } else if (preset === 'Dual screen') {
      setEstimateWidthPx(360);
      setPaneVisibility({
        estimate: true,
        viewport: true,
        plans: true,
        shapes: true,
        details: true,
        takeoff: true,
        navigation: true,
        flags: true,
        references: true,
      });
      if (window.cobitxDesktop?.openDualViewport) {
        window.cobitxDesktop.openDualViewport().then(() => {
          onNotify('Dual Screen Viewport window opened on secondary monitor.');
        });
      } else {
        onNotify('Dual screen preset applied (Viewport maximized for secondary monitor workflow).');
      }
    } else if (preset === 'Custom') {
      try {
        const saved = localStorage.getItem(CUSTOM_LAYOUT_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (typeof parsed.estimateWidthPx === 'number') setEstimateWidthPx(parsed.estimateWidthPx);
          if (parsed.paneVisibility) setPaneVisibility(parsed.paneVisibility);
          onNotify('Restored saved Custom layout.');
          return;
        }
      } catch {
        // Ignore storage error
      }
      localStorage.setItem(
        CUSTOM_LAYOUT_STORAGE_KEY,
        JSON.stringify({ estimateWidthPx, paneVisibility })
      );
      onNotify('Saved current panel widths & docked panes as Custom layout.');
    }
  };

  const handleTogglePane = (k: keyof PaneVisibility) => {
    setPaneVisibility((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      if (layoutPreset === 'Custom') {
        try {
          localStorage.setItem(
            CUSTOM_LAYOUT_STORAGE_KEY,
            JSON.stringify({ estimateWidthPx, paneVisibility: next })
          );
        } catch {
          // Ignore storage error
        }
      }
      return next;
    });
  };

  const updateRow = (rowId: string, patch: Partial<EstimateRow>) => {
    if (isJobFrozen) {
      onNotify(freezeLockReason('Editing'));
      return;
    }
    const touchesQty =
      patch.quantity !== undefined ||
      patch.factor !== undefined ||
      patch.conversion !== undefined ||
      patch.numberMultiplier !== undefined ||
      patch.wastagePct !== undefined ||
      patch.calcRows !== undefined;
    if (isQuantitiesFrozen && touchesQty) {
      onNotify(freezeLockReason('Quantities'));
      return;
    }
    const touchesRate =
      patch.rate !== undefined ||
      patch.rateRows !== undefined ||
      patch.markupPct !== undefined ||
      patch.pricingMode !== undefined ||
      patch.pickedRate !== undefined;
    if (isRatesFrozen && touchesRate) {
      onNotify(freezeLockReason('Rates'));
      return;
    }
    const nextRows = job.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r));
    onUpdateJob(job.id, { rows: nextRows });
  };

  const cloneRowForClipboard = (row: EstimateRow): EstimateRow => ({
    ...row,
    calcRows: row.calcRows.map((c) => ({ ...c })),
    rateRows: row.rateRows.map((r) => ({ ...r })),
    pickedRate: row.pickedRate ? { ...row.pickedRate } : undefined,
  });

  const handleCopyRow = () => {
    const target = job.rows.find((r) => r.id === selectedRowId) ?? selectedItem;
    if (!target) {
      onNotify('Select an Estimate row to copy.');
      return;
    }
    setClipboardRow({ mode: 'copy', row: cloneRowForClipboard(target) });
    onNotify(`Copied "${target.description}" to clipboard.`);
  };

  const handleCutRow = () => {
    if (isJobFrozen) {
      onNotify(freezeLockReason('Cutting rows'));
      return;
    }
    const target = job.rows.find((r) => r.id === selectedRowId) ?? selectedItem;
    if (!target) {
      onNotify('Select an Estimate row to cut.');
      return;
    }
    setClipboardRow({ mode: 'cut', row: cloneRowForClipboard(target) });
    const nextRows = job.rows.filter((r) => r.id !== target.id && r.parentId !== target.id);
    onUpdateJob(job.id, { rows: nextRows });
    setSelectedRowId(nextRows[0]?.id ?? null);
    onNotify(`Cut "${target.description}" to clipboard.`);
  };

  const removableRows = (ids: string[]) => {
    const byParent = new Map<string, EstimateRow[]>();
    for (const row of job.rows) {
      if (!row.parentId) continue;
      const children = byParent.get(row.parentId) ?? [];
      children.push(row);
      byParent.set(row.parentId, children);
    }
    const targets = new Set(ids);
    for (const id of targets) {
      for (const child of byParent.get(id) ?? []) targets.add(child.id);
    }
    return job.rows.filter((row) => targets.has(row.id));
  };

  const applyDeleteRows = (rows: EstimateRow[]) => {
    if (!rows.length) return;
    if (isJobFrozen || rows.some((row) => row.lockedBy ||
      (row.rowType === 'Item' && ((isQuantitiesFrozen && (row.quantity || row.calcRows.length)) ||
      (isRatesFrozen && (row.rate || row.rateRows.length)))))) {
      onNotify('Unlock the selected rows or job before deleting them.');
      return;
    }
    const ids = new Set(rows.map((row) => row.id));
    const nextRows = job.rows.filter((row) => !ids.has(row.id));
    onUpdateJob(job.id, {
      rows: nextRows,
      shapes: job.shapes.filter((shape) => !ids.has(shape.itemId)),
      externalRefs: job.externalRefs?.filter((ref) => !ids.has(ref.targetItemId)),
    });
    setSelectedRowId(nextRows[Math.min(job.rows.findIndex((row) => ids.has(row.id)), nextRows.length - 1)]?.id ?? null);
    setSelectedCalcRowId(null);
    setSelectedShapeId(null);
    setDraftPoints([]);
    onNotify(`Deleted ${rows.length} estimate ${rows.length === 1 ? 'row' : 'rows'}.`);
  };

  const requestDeleteRows = (ids: string[]) => {
    if (!ids.length || isJobFrozen) return;
    if (localStorage.getItem('cobitx.skipEstimateDeleteConfirmation') === 'true') {
      applyDeleteRows(removableRows(ids));
    } else {
      setSkipDeleteConfirmation(false);
      setDeleteRows(ids);
    }
  };

  const confirmDeleteRows = () => {
    applyDeleteRows(removableRows(deleteRows));
    if (skipDeleteConfirmation) localStorage.setItem('cobitx.skipEstimateDeleteConfirmation', 'true');
    setDeleteRows([]);
  };

  const handlePasteRow = () => {
    if (isNewItemsFrozen) {
      onNotify(freezeLockReason('Pasting rows'));
      return;
    }
    if (!clipboardRow) {
      onNotify('Clipboard is empty. Copy or Cut an Estimate row first.');
      return;
    }
    const src = clipboardRow.row;
    const ts = Date.now();
    const idx = job.rows.findIndex((r) => r.id === selectedRowId);
    const anchor = idx >= 0 ? job.rows[idx] : null;
    let parentId = src.parentId;
    if (anchor) {
      if (src.rowType === 'Trade') parentId = null;
      else if (anchor.rowType === 'Trade' || anchor.rowType === 'Heading') parentId = anchor.id;
      else parentId = anchor.parentId;
    }
    const cloned: EstimateRow = {
      ...cloneRowForClipboard(src),
      id: `row-paste-${ts}`,
      parentId,
      calcRows: src.calcRows.map((c, i) => ({
        ...c,
        id: `calc-paste-${ts}-${i}`,
        shapeId: undefined,
      })),
      rateRows: src.rateRows.map((rr, i) => ({ ...rr, id: `rr-paste-${ts}-${i}` })),
    };
    const nextRows = [...job.rows];
    if (idx >= 0) {
      nextRows.splice(idx + 1, 0, cloned);
    } else {
      nextRows.push(cloned);
    }
    onUpdateJob(job.id, { rows: nextRows });
    setSelectedRowId(cloned.id);
    if (clipboardRow.mode === 'cut') {
      setClipboardRow({ mode: 'copy', row: cloneRowForClipboard(cloned) });
    }
    onNotify(`Pasted "${cloned.description}".`);
  };

  const findTradeIdForRow = (rowId: string | null): string | null => {
    if (!rowId) return null;
    const byId = new Map(job.rows.map((r) => [r.id, r]));
    let cur = byId.get(rowId) ?? null;
    let guard = 0;
    while (cur && guard < 8) {
      if (cur.rowType === 'Trade') return cur.id;
      cur = cur.parentId ? byId.get(cur.parentId) ?? null : null;
      guard++;
    }
    return null;
  };

  const handleToggleLockTrade = () => {
    const tradeId = findTradeIdForRow(selectedRowId);
    if (!tradeId) {
      onNotify('Select a Trade or any row inside a Trade first (Ctrl+L).');
      return;
    }
    const tradeRow = job.rows.find((r) => r.id === tradeId);
    if (!tradeRow) return;
    const currentlyLocked = Boolean(tradeRow.lockedBy);
    const lockUser = currentlyLocked ? undefined : job.accountManager || 'Estimator';

    const byId = new Map(job.rows.map((r) => [r.id, r]));
    const belongsToTrade = (r: EstimateRow): boolean => {
      if (r.id === tradeId) return true;
      let p = r.parentId;
      let guard = 0;
      while (p && guard < 8) {
        if (p === tradeId) return true;
        p = byId.get(p)?.parentId ?? null;
        guard++;
      }
      return false;
    };

    const nextRows = job.rows.map((r) => (belongsToTrade(r) ? { ...r, lockedBy: lockUser } : r));
    onUpdateJob(job.id, { rows: nextRows });
    onNotify(
      lockUser
        ? `Locked Trade "${tradeRow.description}" for editing by ${lockUser}.`
        : `Unlocked Trade "${tradeRow.description}".`
    );
  };

  const handleToggleReadOnly = () => {
    const nextRo = !isReadOnly;
    if (nextRo && (ribbonTab === 'Plans' || ribbonTab === 'Configuration')) {
      setRibbonTab('Home');
    }
    setActiveTool('Select');
    setDraftPoints([]);
    setCalibratingScale(false);
    setAligningRevision(false);
    onUpdateJob(job.id, { isReadOnly: nextRo });
    onNotify(nextRo ? 'Switched to Read-Only Mode (plans & editing locked).' : 'Exited Read-Only Mode.');
  };

  const handleToggleOptionPackage = (optId: string) => {
    if (
      isJobFrozen ||
      freezeStates.includes('Options') ||
      freezeStates.includes('Option Values') ||
      freezeStates.includes('Option Configurations')
    ) {
      onNotify(freezeLockReason('Options'));
      return;
    }
    const next = (job.optionsPackages ?? []).map((op) =>
      op.id === optId ? { ...op, enabled: !op.enabled } : op
    );
    onUpdateJob(job.id, { optionsPackages: next });
    const changed = next.find((o) => o.id === optId);
    if (changed) {
      onNotify(`Option Package "${changed.name}" ${changed.enabled ? 'ENABLED' : 'DISABLED'}.`);
    }
  };

  const handleCycleVariationStatus = (varId: string) => {
    if (isJobFrozen) {
      onNotify(freezeLockReason('Variations'));
      return;
    }
    const order: VariationRecord['status'][] = ['Pending', 'Approved', 'Rejected'];
    const next = (job.variations ?? []).map((v) => {
      if (v.id !== varId) return v;
      const idx = order.indexOf(v.status);
      return { ...v, status: order[(idx + 1) % order.length] };
    });
    onUpdateJob(job.id, { variations: next });
    const changed = next.find((v) => v.id === varId);
    if (changed) {
      onNotify(`Variation "${changed.code}" marked ${changed.status}.`);
    }
  };

  const handleTogglePauseRef = (refId: string) => {
    const next = (job.externalRefs ?? []).map((ref) =>
      ref.id === refId ? { ...ref, paused: !ref.paused } : ref
    );
    onUpdateJob(job.id, { externalRefs: next });
  };

  const handleRecalculateRefs = () => {
    if (isJobFrozen) {
      onNotify(freezeLockReason('References'));
      return;
    }
    const refs = job.externalRefs ?? [];
    let updatedCount = 0;
    const nextRows = job.rows.map((row) => {
      const match = refs.find((rf) => !rf.paused && rf.targetItemId === row.id);
      if (!match) return row;
      updatedCount++;
      const fieldKey =
        match.targetField === 'Rate'
          ? 'rate'
          : match.targetField === 'Quantity'
          ? 'quantity'
          : 'markupPct';
      return {
        ...row,
        [fieldKey]: match.syncedValue,
      };
    });
    onUpdateJob(job.id, { rows: nextRows });
    onNotify(`Applied ${updatedCount} saved reference values.`);
  };

  const insertRow = (kind: 'Trade' | 'Heading' | 'Item', atEnd = false) => {
    if (isNewItemsFrozen) {
      onNotify(freezeLockReason('Inserting new items'));
      return;
    }
    const idx = job.rows.findIndex((r) => r.id === selectedRowId);
    const current = idx >= 0 ? job.rows[idx] : null;
    let parentId: string | null = null;
    if (kind === 'Heading') {
      if (current?.rowType === 'Trade') parentId = current.id;
      else parentId = current?.parentId ?? job.rows.find((r) => r.rowType === 'Trade')?.id ?? null;
    } else if (kind === 'Item') {
      if (current?.rowType === 'Trade' || current?.rowType === 'Heading') parentId = current.id;
      else parentId = current?.parentId ?? job.rows[0]?.id ?? null;
    }

    const newRow: EstimateRow = {
      id: `row-${Date.now()}`,
      parentId,
      rowType: kind,
      code: kind === 'Trade' ? '05' : kind === 'Heading' ? 'H1' : 'NEW',
      description:
        kind === 'Trade'
          ? 'NEW TRADE SECTION'
          : kind === 'Heading'
          ? 'New Heading'
          : 'New Estimate Item',
      resultType: kind === 'Item' ? 'Area' : undefined,
      quantity: 0,
      unit: kind === 'Item' ? 'm²' : '',
      conversion: 1,
      numberMultiplier: 1,
      factor: 1,
      wastagePct: 0,
      rate: 0,
      markupPct: 0,
      pricingMode: 'INCL',
      groupingCode: '',
      calcRows: [],
      rateRows: [],
    };

    const nextRows = [...job.rows];
    if (atEnd || idx < 0) {
      nextRows.push(newRow);
    } else {
      nextRows.splice(idx, 0, newRow);
    }
    onUpdateJob(job.id, { rows: nextRows });
    setSelectedRowId(newRow.id);
  };

  const handleIndent = () => {
    if (!selectedRowId || isJobFrozen) {
      if (isJobFrozen) onNotify(freezeLockReason('Indenting'));
      return;
    }
    const idx = job.rows.findIndex((r) => r.id === selectedRowId);
    if (idx <= 0) return;
    const prev = job.rows[idx - 1];
    if (prev.rowType === 'Trade' || prev.rowType === 'Heading') {
      updateRow(selectedRowId, { parentId: prev.id });
    }
  };

  const handleUnindent = () => {
    if (!selectedRowId || isJobFrozen) {
      if (isJobFrozen) onNotify(freezeLockReason('Unindenting'));
      return;
    }
    const cur = job.rows.find((r) => r.id === selectedRowId);
    if (!cur?.parentId) return;
    const parent = job.rows.find((r) => r.id === cur.parentId);
    updateRow(selectedRowId, { parentId: parent?.parentId ?? null });
  };

  const computeQuantityForShape = (
    shape: TakeoffShape,
    rt: EstimateRow['resultType'],
    scaleRatio: number
  ): { quantity: number; lengthM: number } => {
    const resultType = rt ?? 'Area';
    const m = computeShapeMetrics(shape, scaleRatio);
    let computedQty = m.areaM2;
    if (
      resultType === 'Count' ||
      resultType === 'Door Counts' ||
      resultType === 'Window Counts'
    ) {
      computedQty = shape.points.length;
    } else if (resultType.includes('Vertical')) {
      computedQty = m.verticalAreaM2;
    } else if (resultType === 'Volume') {
      computedQty = m.areaM2 * ((shape.depthMm ?? 150) / 1000);
    } else if (resultType === 'Volume by Length') {
      computedQty =
        m.lengthM *
        ((shape.trenchWidthMm ?? 450) / 1000) *
        ((shape.depthMm ?? 150) / 1000);
    } else if (resultType === 'Length by Centres') {
      const spacingM = Math.max(0.05, (shape.centresSpacingMm ?? 450) / 1000);
      computedQty = m.lengthM > 0 ? Math.ceil(m.lengthM / spacingM) + 1 : 0;
    } else if (resultType.includes('Length')) {
      computedQty = m.lengthM;
    }
    return { quantity: Number(computedQty.toFixed(2)), lengthM: Number(m.lengthM.toFixed(2)) };
  };

  const createTakeoffShapeForPoints = (
    points: { x: number; y: number }[],
    closed: boolean,
    labelOverride?: string
  ) => {
    if (isQuantitiesFrozen) {
      onNotify(freezeLockReason('Takeoff shapes'));
      return;
    }
    if (points.length === 0 || !activePlanId) return;
    const targetItem = selectedItem ?? job.rows.find((r) => r.rowType === 'Item');
    if (targetItem?.rowType !== 'Item' || targetItem.lockedBy) return;
    const rt = targetItem.resultType ?? 'Area';
    const plan = job.plans.find((p) => p.id === activePlanId) ?? job.plans[0];
    const scaleRatio = plan?.scaleRatio ?? 28;
    const shouldClose =
      !rt.includes('Count') && (closed || isPolygonResult(rt));

    const shapeId = `shp-${Date.now()}`;
    const newShape: TakeoffShape = {
      id: shapeId,
      name: labelOverride ?? `${newShapeParams.description} (${job.shapes.length + 1})`,
      planId: activePlanId,
      itemId: targetItem.id,
      resultType: rt,
      color: SHAPE_PALETTE[job.shapes.length % SHAPE_PALETTE.length],
      points,
      closed: shouldClose,
      heightMm: newShapeParams.heightMm,
      startHeightMm: newShapeParams.startHeightMm,
      endHeightMm: newShapeParams.endHeightMm,
      pitchDeg: newShapeParams.pitchDeg,
      depthMm: newShapeParams.depthMm,
      trenchWidthMm: newShapeParams.trenchWidthMm,
      centresSpacingMm: newShapeParams.centresSpacingMm,
    };

    const { quantity, lengthM } = computeQuantityForShape(newShape, rt, scaleRatio);
    const calcRow = {
      id: `calc-${Date.now()}`,
      description: newShape.name,
      shapeId,
      planId: activePlanId,
      resultType: rt,
      length: lengthM,
      height: rt.includes('Vertical') ? newShape.heightMm : undefined,
      depth: rt.includes('Volume') ? newShape.depthMm : undefined,
      width: rt === 'Volume by Length' ? newShape.trenchWidthMm : undefined,
      pitchDeg: rt === 'Area' ? newShape.pitchDeg : undefined,
      factor: 1,
      quantity,
      rounding: 'None' as const,
    };

    const nextRows = job.rows.map((r) => {
      if (r.id !== targetItem.id) return r;
      const nextCalcs = [...r.calcRows, calcRow];
      const nextQty = nextCalcs.reduce((acc, c) => acc + c.quantity * c.factor, 0);
      return {
        ...r,
        calcRows: nextCalcs,
        quantity: Number(nextQty.toFixed(2)),
      };
    });

    onUpdateJob(job.id, {
      shapes: [...job.shapes, newShape],
      rows: nextRows,
    });
    setSelectedShapeId(shapeId);
    onNotify(`Added "${newShape.name}" (${calcRow.quantity}) to ${targetItem.description}.`);
  };

  const finishDraftShape = (closed = false, points = draftPoints) => {
    if (isQuantitiesFrozen) {
      setDraftPoints([]);
      onNotify(freezeLockReason('Takeoff shapes'));
      return;
    }
    if (!canEditPlan || activeTool === 'Select' || selectedItem?.rowType !== 'Item' || !points.length) return;
    const result = selectedItem.resultType ?? 'Area';
    const closes = closed || isPolygonResult(result);
    const minimum = result.includes('Count') ? 1 : closes ? 3 : 2;
    if (new Set(points.map(({ x, y }) => `${x},${y}`)).size < minimum) {
      onNotify(`Place at least ${minimum} distinct points to finish this measurement.`);
      return;
    }
    createTakeoffShapeForPoints(points, closes);
    setDraftPoints([]);
  };

  const handleInsertPlans = (plans: PlanDocument[], startCalibration: boolean) => {
    if (isJobFrozen) {
      onNotify(freezeLockReason('Plans'));
      return;
    }
    if (!plans.length) return;
    onUpdateJob(job.id, { plans: [...job.plans, ...plans] });
    setActivePlanId(plans[0].id);
    setViewMode('2D');
    setActiveTool('Select');
    setAligningRevision(false);
    setDraftPoints([]);
    setSelectedShapeId(null);
    setZoom(1);
    setPan({ x: 30, y: 20 });
    const calibrate = startCalibration && !isQuantitiesFrozen;
    setCalibratingScale(calibrate);
    onNotify(`Imported ${plans.length} ${plans.length === 1 ? 'drawing' : 'drawings'}.${calibrate ? ' Click two points to calibrate the first drawing.' : ''}`);
  };

  const handleCompleteScaleCalibration = (pixelDistance: number, realMeters: number) => {
    if (isQuantitiesFrozen) {
      setCalibratingScale(false);
      onNotify(freezeLockReason('Scale calibration'));
      return;
    }
    if (!activePlanId || pixelDistance <= 1 || realMeters <= 0) return;
    const newScaleRatio = pixelDistance / realMeters;
    const approxRatio = Math.max(1, Math.round((3779.5 / newScaleRatio) * 1)); // informative 1:X label at 96dpi
    const nextPlans = job.plans.map((p) =>
      p.id === activePlanId
        ? {
            ...p,
            scaleRatio: newScaleRatio,
            scaleLabel: `Calibrated (~1:${approxRatio}, ${newScaleRatio.toFixed(1)} px/m)`,
          }
        : p
    );

    const shapeById = new Map(job.shapes.map((s) => [s.id, s]));
    const nextRows = job.rows.map((r) => {
      if (r.rowType !== 'Item' || r.calcRows.length === 0) return r;
      let touched = false;
      const nextCalcs = r.calcRows.map((c) => {
        if (c.planId !== activePlanId || !c.shapeId) return c;
        const shp = shapeById.get(c.shapeId);
        if (!shp) return c;
        touched = true;
        const { quantity, lengthM } = computeQuantityForShape(shp, c.resultType, newScaleRatio);
        return { ...c, length: lengthM, quantity };
      });
      if (!touched) return r;
      const totalQty = nextCalcs.reduce((acc, c) => acc + c.quantity * c.factor, 0);
      return { ...r, calcRows: nextCalcs, quantity: Number(totalQty.toFixed(2)) };
    });

    onUpdateJob(job.id, { plans: nextPlans, rows: nextRows });
    setCalibratingScale(false);
    onNotify(
      `Calibrated active plan scale to ${newScaleRatio.toFixed(2)} px/m (${realMeters} m over ${pixelDistance.toFixed(1)} px) & updated quantities.`
    );
  };

  const handleRotateActivePlan = () => {
    if (!activePlanId || isReadOnly) return;
    let nextDeg = 0;
    const nextPlans = job.plans.map((p) => {
      if (p.id !== activePlanId) return p;
      nextDeg = ((p.rotationDeg ?? 0) + 90) % 360;
      return { ...p, rotationDeg: nextDeg };
    });
    onUpdateJob(job.id, { plans: nextPlans });
    onNotify(`Rotated active plan to ${nextDeg}°.`);
  };

  const handleSaveSnapshot = () => {
    if (!activePlanId) return;
    const activePlan = job.plans.find((p) => p.id === activePlanId);
    if (!activePlan) return;
    const snap = {
      id: `snap-${Date.now()}`,
      name: `Snapshot ${activePlan.snapshots.length + 1} (${Math.round(zoom * 100)}%)`,
      zoom,
      panX: pan.x,
      panY: pan.y,
    };
    const nextPlans = job.plans.map((p) =>
      p.id === activePlanId ? { ...p, snapshots: [...p.snapshots, snap] } : p
    );
    onUpdateJob(job.id, { plans: nextPlans });
    onNotify(`Saved snapshot "${snap.name}" to ${activePlan.name}.`);
  };

  const handleAutoSelectAtPoint = async (
    pt: { x: number; y: number },
    imageDataUrl?: string
  ) => {
    if (isQuantitiesFrozen) {
      onNotify(freezeLockReason('Auto Select'));
      return;
    }
    const points = await autoSelectPolygon(imageDataUrl, pt.x, pt.y);
    if (points.length >= 3) {
      createTakeoffShapeForPoints(points, true, `Auto Room (${job.shapes.length + 1})`);
      return;
    }
    onNotify('Auto Select did not detect a closed room boundary around that point.');
  };

  const handleSaveRevisionOverlay = (
    planId: string,
    overlay: PlanDocument['revisionOverlay'],
    newRevLabel?: string
  ) => {
    const nextPlans = job.plans.map((p) =>
      p.id === planId
        ? {
            ...p,
            revisionOverlay: overlay,
            revision: newRevLabel ?? p.revision,
          }
        : p
    );
    onUpdateJob(job.id, { plans: nextPlans });
    if (overlay) {
      onNotify(`Attached revision comparison overlay "${overlay.label}" to plan.`);
    }
  };

  const handleCompleteRevisionAlign = (dx: number, dy: number) => {
    if (!activePlanId) return;
    const nextPlans = job.plans.map((p) => {
      if (p.id !== activePlanId) return p;
      const curOverlay = p.revisionOverlay ?? {
        label: 'Rev B Aligned',
        originalFileName: p.originalFileName,
        imageDataUrl: p.imageDataUrl,
        vectorPaths: p.vectorPaths,
        offsetX: 0,
        offsetY: 0,
        scaleFactor: 1,
        rotationDeg: 0,
        opacity: 0.55,
        visible: true,
      };
      return {
        ...p,
        revisionOverlay: {
          ...curOverlay,
          offsetX: Math.round(curOverlay.offsetX + dx),
          offsetY: Math.round(curOverlay.offsetY + dy),
          visible: true,
        },
      };
    });
    onUpdateJob(job.id, { plans: nextPlans });
    setAligningRevision(false);
    onNotify(`Aligned revision overlay by ΔX=${Math.round(dx)}px, ΔY=${Math.round(dy)}px.`);
  };

  const handleApplyAiAreaZones = (zones: AiZoneResult[]) => {
    if (isQuantitiesFrozen) {
      onNotify(freezeLockReason('AI Auto Area'));
      return;
    }
    if (!activePlanId || zones.length === 0) return;
    const targetItem = selectedItem ?? job.rows.find((r) => r.rowType === 'Item');
    if (!targetItem) return;
    const plan = job.plans.find((p) => p.id === activePlanId) ?? job.plans[0];
    const scaleRatio = plan?.scaleRatio ?? 28;
    const rt = targetItem.resultType ?? 'Area';
    const baseTs = Date.now();

    const addedShapes: TakeoffShape[] = [];
    const addedCalcs = zones.map((z, idx) => {
      const shapeId = `shp-ai-${baseTs}-${idx}`;
      const newShape: TakeoffShape = {
        id: shapeId,
        name: z.label,
        planId: activePlanId,
        itemId: targetItem.id,
        resultType: rt,
        color: SHAPE_PALETTE[(job.shapes.length + idx) % SHAPE_PALETTE.length],
        points: z.points,
        closed: true,
        heightMm: newShapeParams.heightMm,
        depthMm: newShapeParams.depthMm,
        pitchDeg: newShapeParams.pitchDeg,
      };
      addedShapes.push(newShape);
      const { quantity, lengthM } = computeQuantityForShape(newShape, rt, scaleRatio);
      return {
        id: `calc-ai-${baseTs}-${idx}`,
        description: z.label,
        shapeId,
        planId: activePlanId,
        resultType: rt,
        length: lengthM,
        depth: rt.includes('Volume') ? newShapeParams.depthMm : undefined,
        pitchDeg: rt === 'Area' ? newShapeParams.pitchDeg : undefined,
        factor: 1,
        quantity,
        rounding: 'None' as const,
      };
    });

    const nextRows = job.rows.map((r) => {
      if (r.id !== targetItem.id) return r;
      const nextCalcs = [...r.calcRows, ...addedCalcs];
      const nextQty = nextCalcs.reduce((acc, c) => acc + c.quantity * c.factor, 0);
      return {
        ...r,
        calcRows: nextCalcs,
        quantity: Number(nextQty.toFixed(2)),
      };
    });

    onUpdateJob(job.id, {
      shapes: [...job.shapes, ...addedShapes],
      rows: nextRows,
    });
    if (addedShapes.length > 0) {
      setSelectedShapeId(addedShapes[0].id);
    }
    onNotify(`AI Auto Area created ${addedShapes.length} polygon shape(s) on "${targetItem.description}".`);
  };

  const handleApplyAiCountMarkers = (label: string, points: { x: number; y: number }[]) => {
    if (isQuantitiesFrozen) {
      onNotify(freezeLockReason('AI Count Markers'));
      return;
    }
    if (!activePlanId || points.length === 0) return;
    const targetItem = selectedItem ?? job.rows.find((r) => r.rowType === 'Item');
    if (!targetItem) return;
    const baseTs = Date.now();
    const shapeId = `shp-aicnt-${baseTs}`;
    const countRt: NonNullable<EstimateRow['resultType']> =
      targetItem.resultType === 'Door Counts' || targetItem.resultType === 'Window Counts'
        ? targetItem.resultType
        : 'Count';

    const newShape: TakeoffShape = {
      id: shapeId,
      name: label,
      planId: activePlanId,
      itemId: targetItem.id,
      resultType: countRt,
      color: SHAPE_PALETTE[job.shapes.length % SHAPE_PALETTE.length],
      points,
      closed: false,
    };

    const calcRow = {
      id: `calc-aicnt-${baseTs}`,
      description: label,
      shapeId,
      planId: activePlanId,
      resultType: countRt,
      length: 0,
      factor: 1,
      quantity: points.length,
      rounding: 'None' as const,
    };

    const nextRows = job.rows.map((r) => {
      if (r.id !== targetItem.id) return r;
      const nextCalcs = [...r.calcRows, calcRow];
      const nextQty = nextCalcs.reduce((acc, c) => acc + c.quantity * c.factor, 0);
      return {
        ...r,
        calcRows: nextCalcs,
        quantity: Number(nextQty.toFixed(2)),
      };
    });

    onUpdateJob(job.id, {
      shapes: [...job.shapes, newShape],
      rows: nextRows,
    });
    setSelectedShapeId(shapeId);
    onNotify(`AI added ${points.length} "${label}" count markers to "${targetItem.description}".`);
  };

  const handleApplyAiAutoScale = (
    planId: string,
    name: string,
    scaleLabel: string,
    scaleRatio: number
  ) => {
    if (isQuantitiesFrozen) {
      onNotify(freezeLockReason('AI Auto Scale'));
      return;
    }
    const nextPlans = job.plans.map((p) =>
      p.id === planId ? { ...p, name, scaleLabel, scaleRatio } : p
    );
    const shapeById = new Map(job.shapes.map((s) => [s.id, s]));
    const nextRows = job.rows.map((r) => {
      if (r.rowType !== 'Item' || r.calcRows.length === 0) return r;
      let touched = false;
      const nextCalcs = r.calcRows.map((c) => {
        if (c.planId !== planId || !c.shapeId) return c;
        const shp = shapeById.get(c.shapeId);
        if (!shp) return c;
        touched = true;
        const { quantity, lengthM } = computeQuantityForShape(shp, c.resultType, scaleRatio);
        return { ...c, length: lengthM, quantity };
      });
      if (!touched) return r;
      const totalQty = nextCalcs.reduce((acc, c) => acc + c.quantity * c.factor, 0);
      return { ...r, calcRows: nextCalcs, quantity: Number(totalQty.toFixed(2)) };
    });

    onUpdateJob(job.id, { plans: nextPlans, rows: nextRows });
    onNotify(`Applied AI Auto Scale (${scaleLabel}) & renamed plan to "${name}".`);
  };

  // Cubit Keyboard Shortcuts inside Job Workspace
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('.modal-backdrop')) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Escape' && (draftPoints.length || calibratingScale || aligningRevision)) {
        e.preventDefault();
        setDraftPoints([]);
        setCalibratingScale(false);
        setAligningRevision(false);
      } else if ((e.key === 'Enter' || e.key.toLowerCase() === 'j') && draftPoints.length && activeTool !== 'Select' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        finishDraftShape(e.key.toLowerCase() === 'j');
      } else if (e.ctrlKey && e.key === '1') { e.preventDefault(); selectTool('Select'); }
      else if (e.ctrlKey && e.key === '2') { e.preventDefault(); selectTool('Polyline'); }
      else if (e.ctrlKey && e.key === '3') { e.preventDefault(); selectTool('Auto Select'); }
      else if (e.ctrlKey && e.key === '4') { e.preventDefault(); selectTool('Rectangle'); }
      else if (e.ctrlKey && e.key === '5') { e.preventDefault(); selectTool('Line'); }
      else if (e.ctrlKey && e.key === '6') { e.preventDefault(); selectTool('Count'); }
      else if (e.ctrlKey && e.key === '7') { e.preventDefault(); selectTool('Ruler'); }
      else if (e.key === 'F7') { e.preventDefault(); setPhantomEnabled((v) => !v); }
      else if (e.key === 'F8') { e.preventDefault(); setOrthoEnabled((v) => !v); }
      else if (e.key === 'F9') {
        e.preventDefault();
        setLowerTab(isPriceList ? 'Rate' : 'Calc');
        requestAnimationFrame(() => calcSheetRef.current?.focus());
      } else if (e.shiftKey && e.key === 'F4') {
        e.preventDefault();
        if (selectedItem && selectedItem.rowType === 'Item') {
          const itemIdx = job.rows.findIndex((r) => r.id === selectedItem.id);
          const prevItem = [...job.rows.slice(0, itemIdx)]
            .reverse()
            .find((r) => r.rowType === 'Item');
          if (prevItem) {
            updateRow(selectedItem.id, {
              rate: prevItem.rate,
              rateRows: prevItem.rateRows.map((rr, i) => ({ ...rr, id: `rr-${Date.now()}-${i}` })),
              rel: prevItem.refCode ? `@${prevItem.refCode}` : prevItem.rel,
              markupPct: prevItem.markupPct,
              groupingCode: selectedItem.groupingCode || prevItem.groupingCode,
            });
            onNotify(
              `Copied Down Relative pricing & reference from "${prevItem.description}" -> "${selectedItem.description}".`
            );
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        handleCutRow();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const selText = window.getSelection()?.toString() ?? '';
        if (!selText) {
          e.preventDefault();
          handleCopyRow();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePasteRow();
      } else if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        handleToggleLockTrade();
      } else if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        insertRow('Trade');
      } else if (e.ctrlKey && e.key === 'h') {
        e.preventDefault();
        insertRow('Heading');
      } else if (e.ctrlKey && e.key === '<') {
        e.preventDefault();
        handleIndent();
      } else if (e.ctrlKey && e.key === '>') {
        e.preventDefault();
        handleUnindent();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        insertRow('Item', e.shiftKey);
      } else if (e.key === 'i' || e.key === 'I') {
        if (!e.ctrlKey && selectedItem?.rowType === 'Item') {
          updateRow(selectedItem.id, { pricingMode: 'INCL' });
        }
      } else if (e.key === 'e' || e.key === 'E') {
        if (!e.ctrlKey && selectedItem?.rowType === 'Item') {
          updateRow(selectedItem.id, { pricingMode: 'EXCL' });
        }
      } else if (e.ctrlKey && (e.key === 'm' || e.key === 'M')) {
        if (selectedItem) {
          e.preventDefault();
          const nextFlagged = !selectedItem.flagged;
          updateRow(selectedItem.id, {
            flagged: nextFlagged,
            flagStatus: nextFlagged ? selectedItem.flagStatus ?? 'Attention' : 'Resolved',
          });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const startEstWidthDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const origW = estimateWidthPx;
    const onMove = (ev: MouseEvent) => {
      setEstimateWidthPx(Math.max(280, Math.min(960, origW + (ev.clientX - startX))));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <JobRibbon
        activeTab={ribbonTab}
        onChangeTab={setRibbonTab}
        ribbonCollapsed={ribbonCollapsed}
        onToggleRibbon={onToggleRibbon}
        showKeytips={showKeytips}
        activeTool={activeTool}
        onSelectTool={selectTool}
        orthoEnabled={orthoEnabled}
        onToggleOrtho={() => setOrthoEnabled((v) => !v)}
        phantomEnabled={phantomEnabled}
        onTogglePhantom={() => setPhantomEnabled((v) => !v)}
        viewMode={viewMode}
        onSetViewMode={changeViewMode}
        isolateSelected={isolateSelected}
        onToggleIsolate={() => setIsolateSelected((v) => !v)}
        hidePickedRates={hidePickedRates}
        onToggleHidePicked={() => setHidePickedRates((v) => !v)}
        layoutPreset={layoutPreset}
        onApplyLayout={applyLayoutPreset}
        paneVisibility={paneVisibility}
        onTogglePane={handleTogglePane}
        optimisePdf={optimisePdf}
        onChangeOptimisePdf={setOptimisePdf}
        takeoffDisplay={takeoffDisplay}
        onChangeTakeoffDisplay={setTakeoffDisplay}
        isReadOnly={isJobFrozen}
        canResumeEditing={isReadOnly}
        canEditPlan={canEditPlan}
        canEditPdf={canEditPdf}
        hasBimPlan={activePlan?.kind === 'IFC'}
        canShow3D={activePlan?.kind === 'IFC' || job.shapes.some((shape) => shape.planId === activePlanId && !shape.hidden)}
        hasDraft={draftPoints.length > 0}
        onToggleReadOnly={handleToggleReadOnly}
        onToggleLockTrade={handleToggleLockTrade}
        onOpenConstants={() => setShowConstantsModal(true)}
        onOpenOpenings={(k) => setOpeningsModalKind(k)}
        onOpenGroupingCodes={() => setShowGroupingModal(true)}
        onOpenTaxAdjustments={() => setShowTaxModal(true)}
        onOpenJobUpdate={() => setShowJobUpdateModal(true)}
        onOpenSettings={onOpenSettings}
        onOpenHelp={onOpenHelp}
        onInsertFromPriceList={() => setShowPriceListModal(true)}
        onCloseShape={() => finishDraftShape(true)}
        onCut={handleCutRow}
        onCopy={handleCopyRow}
        onPaste={handlePasteRow}
        onOpenOptionsVariations={(tab) => setOptionsVarModalTab(tab)}
        onInsertTrade={() => insertRow('Trade')}
        onInsertHeading={() => insertRow('Heading')}
        onInsertItem={() => insertRow('Item')}
        onIndent={handleIndent}
        onUnindent={handleUnindent}
        onOpenInsertPlan={() => setShowInsertPlanModal(true)}
        onOpenImportIfc={() => setShowIfcModal(true)}
        onStartScaleCalibration={() => {
          setActiveTool('Select');
          setDraftPoints([]);
          setCalibratingScale(true);
          onNotify('2-Point Scale Calibration active: click Point A then Point B in Viewport.');
        }}
        onRotateActivePlan={handleRotateActivePlan}
        onSaveSnapshot={handleSaveSnapshot}
        onOpenRevisionModal={() => setShowRevisionModal(true)}
        onStartRevisionAlign={() => {
          setActiveTool('Select');
          setDraftPoints([]);
          setAligningRevision(true);
          onNotify('2-Point Align active: click Base Plan Anchor then Matching Revision Anchor.');
        }}
        onOpenReport={(tab) => setReportTab(tab)}
        onOpenAiTool={(tab) => setAiModalTab(tab)}
        onPinToQat={onPinToQat}
        isPriceList={isPriceList}
      />

      {/* Main Dockable Single-View Workspace */}
      <div
        ref={workspaceBodyRef}
        className="workspace-body"
        style={{ padding: 4, gap: 0 }}
      >
        {/* LEFT: ESTIMATE PANE */}
        {paneVisibility.estimate && (
          <div
            className="pane-frame"
            style={{
              width: paneVisibility.viewport ? estimateWidthPx : '100%',
              flexShrink: 0,
            }}
          >
            <div className="pane-titlebar">
              <span>{isPriceList ? 'Price List' : 'Estimate'}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {job.name} {isReadOnly ? '· READ-ONLY' : isStatusLocked ? `· ${job.status.toUpperCase()}` : ''}
              </span>
            </div>
            <EstimatePane
              rows={job.rows}
              selectedRowId={selectedRowId}
              selectedCalcRowId={selectedCalcRowId}
              lowerTab={lowerTab}
              onChangeLowerTab={setLowerTab}
              onSelectRow={selectEstimateRow}
              onSelectCalcRow={(cid) => {
                setSelectedCalcRowId(cid);
                const found = selectedItem?.calcRows.find((c) => c.id === cid);
                if (found?.shapeId) setSelectedShapeId(found.shapeId);
              }}
              onUpdateRow={updateRow}
              onChangeResultType={(row, resultType) => {
                if (row.calcRows.length) {
                  onNotify('Change the result type on an item before adding measurements.');
                  return;
                }
                setDraftPoints([]);
                updateRow(row.id, { resultType, unit: defaultResultUnit(resultType, options.defaultCountUnit) });
              }}
              onDeleteRows={requestDeleteRows}
              onToggleCollapse={(id) => {
                const row = job.rows.find((r) => r.id === id);
                if (row) {
                  onUpdateJob(
                    job.id,
                    {
                      rows: job.rows.map((r) =>
                        r.id === id ? { ...r, collapsed: !row.collapsed } : r
                      ),
                    },
                    false
                  );
                }
              }}
              onExpandAll={(expand) => {
                onUpdateJob(
                  job.id,
                  {
                    rows: job.rows.map((r) =>
                      r.rowType !== 'Item' ? { ...r, collapsed: !expand } : r
                    ),
                  },
                  false
                );
              }}
              onInsertTrade={() => insertRow('Trade')}
              onInsertHeading={() => insertRow('Heading')}
              onInsertItem={() => insertRow('Item')}
              onAddItemEnd={() => insertRow('Item', true)}
              onIndentRow={handleIndent}
              onUnindentRow={handleUnindent}
              onViewShapeInViewport={(shapeId, planId) => {
                if (planId) setActivePlanId(planId);
                setSelectedShapeId(shapeId);
                setZoom(1.35);
                onNotify('Centered Viewport on selected shape.');
              }}
              hidePickedRates={hidePickedRates}
              isPriceList={isPriceList}
              isReadOnly={isJobFrozen}
              optionsPackages={job.optionsPackages ?? []}
              variations={job.variations ?? []}
              onToggleOption={handleToggleOptionPackage}
              onCycleVariationStatus={handleCycleVariationStatus}
              onNotify={onNotify}
              calcSheetRef={calcSheetRef}
            />
          </div>
        )}

        {paneVisibility.estimate && paneVisibility.viewport && !isPriceList && (
          <div className="resizer-v" onMouseDown={startEstWidthDrag} />
        )}

        {/* CENTER: VIEWPORT PANE */}
        {paneVisibility.viewport && !isPriceList && (
          <div className="pane-frame" style={{ flex: 1 }}>
            <div className="pane-titlebar">
              <span>
                Viewport — {job.plans.find((p) => p.id === activePlanId)?.name ?? 'No Plan'}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {viewMode} Mode · Zoom {Math.round(zoom * 100)}%
              </span>
            </div>
            <ViewportPane
              key={activePlanId}
              plans={job.plans}
              activePlanId={activePlanId}
              onSelectPlan={selectPlan}
              shapes={job.shapes}
              selectedShapeId={selectedShapeId}
              onSelectShape={(sid) => {
                setSelectedShapeId(sid);
                const shp = job.shapes.find((s) => s.id === sid);
                if (shp) setSelectedRowId(shp.itemId);
              }}
              activeTool={canEditPlan && (selectedItem?.rowType === 'Item' || activeTool === 'Ruler') ? activeTool : 'Select'}
              viewMode={viewMode}
              onSetViewMode={changeViewMode}
              isolateSelected={isolateSelected}
              snappingEnabled={options.snappingEnabled}
              snapColor={options.snapColor}
              orthoEnabled={orthoEnabled}
              phantomEnabled={phantomEnabled}
              optimisePdf={optimisePdf}
              takeoffDisplay={takeoffDisplay}
              zoom={zoom}
              pan={pan}
              onChangeZoom={setZoom}
              onChangePan={setPan}
              draftPoints={draftPoints}
              onAddDraftPoint={(pt) => {
                if (!isQuantitiesFrozen) setDraftPoints((p) => [...p, pt]);
                else onNotify(freezeLockReason('Takeoff shapes'));
              }}
              onFinishDraftShape={finishDraftShape}
              calibratingScale={calibratingScale}
              onCompleteScaleCalibration={handleCompleteScaleCalibration}
              onCancelScaleCalibration={() => setCalibratingScale(false)}
              aligningRevision={aligningRevision}
              onCompleteRevisionAlign={handleCompleteRevisionAlign}
              onCancelRevisionAlign={() => setAligningRevision(false)}
              onOpenInsertPlan={() => setShowInsertPlanModal(true)}
              onAutoSelectAtPoint={handleAutoSelectAtPoint}
              activeResultType={selectedItem?.resultType ?? 'Area'}
              measurementUnit={options.defaultMeasurementUnit}
              imperialDisplayMode={options.imperialDisplayMode}
              onNotify={onNotify}
            />
          </div>
        )}

        {!isPriceList &&
          (paneVisibility.plans ||
            paneVisibility.shapes ||
            paneVisibility.details ||
            paneVisibility.takeoff ||
            paneVisibility.navigation ||
            paneVisibility.flags ||
            paneVisibility.references) && <div className="resizer-v" />}

        {/* RIGHT: PLANS / SHAPES / DETAILS / TAKEOFF / NAVIGATION / FLAGS / REFERENCING */}
        {!isPriceList && (
          <SidePanes
            paneVisibility={paneVisibility}
            plans={job.plans}
            activePlanId={activePlanId}
            onSelectPlan={selectPlan}
            onTogglePlanVisibility={(pid) =>
              onUpdateJob(
                job.id,
                {
                  plans: job.plans.map((p) =>
                    p.id === pid ? { ...p, visible: !p.visible } : p
                  ),
                },
                false
              )
            }
            onToggleLayerVisibility={(pid, lid) =>
              onUpdateJob(
                job.id,
                {
                  plans: job.plans.map((p) =>
                    p.id === pid
                      ? {
                          ...p,
                          layers: p.layers.map((l) =>
                            l.id === lid ? { ...l, visible: !l.visible } : l
                          ),
                        }
                      : p
                  ),
                },
                false
              )
            }
            onApplySnapshot={(z, px, py) => {
              setZoom(z);
              setPan({ x: px, y: py });
            }}
            shapes={job.shapes}
            selectedShapeId={selectedShapeId}
            onSelectShape={setSelectedShapeId}
            onUpdateShape={(sid, patch) => {
              if (isQuantitiesFrozen) {
                onNotify(freezeLockReason('Shape dimensions'));
                return;
              }
              const target = job.shapes.find((s) => s.id === sid);
              if (!target) return;
              const updatedShape = { ...target, ...patch };
              const plan = job.plans.find((p) => p.id === updatedShape.planId);
              const scale = plan?.scaleRatio ?? 28;
              const nextShapes = job.shapes.map((s) => (s.id === sid ? updatedShape : s));
              const nextRows = job.rows.map((r) => {
                if (r.id !== updatedShape.itemId) return r;
                const nextCalcs = r.calcRows.map((c) => {
                  if (c.shapeId !== sid) return c;
                  const { quantity, lengthM } = computeQuantityForShape(
                    updatedShape,
                    c.resultType,
                    scale
                  );
                  return {
                    ...c,
                    length: lengthM,
                    height: c.resultType.includes('Vertical') ? updatedShape.heightMm : c.height,
                    depth: c.resultType.includes('Volume') ? updatedShape.depthMm : c.depth,
                    width: c.resultType === 'Volume by Length' ? updatedShape.trenchWidthMm : c.width,
                    pitchDeg: c.resultType === 'Area' ? updatedShape.pitchDeg : c.pitchDeg,
                    quantity,
                  };
                });
                const totalQty = nextCalcs.reduce((acc, c) => acc + c.quantity * c.factor, 0);
                return { ...r, calcRows: nextCalcs, quantity: Number(totalQty.toFixed(2)) };
              });
              onUpdateJob(job.id, { shapes: nextShapes, rows: nextRows });
            }}
            activeTool={activeTool}
            newShapeParams={newShapeParams}
            onChangeNewShapeParams={setNewShapeParams}
            activeResultType={selectedItem?.resultType ?? 'Area'}
            zoom={zoom}
            pan={pan}
            onChangePan={setPan}
            rows={job.rows}
            onSelectEstimateRow={(rid) => setSelectedRowId(rid)}
            onUpdateEstimateRow={updateRow}
            externalRefs={job.externalRefs ?? []}
            onTogglePauseRef={handleTogglePauseRef}
            onRecalculateRefs={handleRecalculateRefs}
            measurementUnit={options.defaultMeasurementUnit}
            imperialDisplayMode={options.imperialDisplayMode}
          />
        )}
      </div>

      {/* Status Bar */}
      <div className="status-bar">
        <div className="status-bar-left">
          <span>
            Status: <strong>{isReadOnly ? 'Read-Only' : job.status}</strong>
          </span>
          {!job.freezeStates.includes('None') && (
            <span style={{ color: 'var(--accent-red)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Lock size={11} /> Frozen: {job.freezeStates.join(', ')}
            </span>
          )}
          <span>Active Tool: {isQuantitiesFrozen ? 'View' : activeTool}</span>
          <span>
            Ortho (F8): {orthoEnabled ? 'ON' : 'OFF'} · Phantom (F7): {phantomEnabled ? 'ON' : 'OFF'}
          </span>
          {summary.costPerM2 !== null && (
            <span>Cost/m²: {formatCurrency(summary.costPerM2)}/m²</span>
          )}
        </div>

        <div className="status-bar-right">
          {!isPriceList && (
            <>
              <span>
                Excl Tax: <span className="status-total-pill">{formatCurrency(summary.subtotal)}</span>
              </span>
              <span>
                Markup ({job.markupPct}%):{' '}
                <span className="status-total-pill">{formatCurrency(summary.markupAmount)}</span>
              </span>
              <span>
                GST ({job.salesTaxPct}%):{' '}
                <span className="status-total-pill">{formatCurrency(summary.taxAmount)}</span>
              </span>
              <span className="status-grand-total">
                Total: {formatCurrency(summary.grandTotal)}
              </span>
            </>
          )}
        </div>
      </div>

      {showPriceListModal && (
        <PriceListInsertModal
          priceLists={priceLists}
          onInsertRows={(picked, action) => {
            if (action === 'Insert') {
              if (isNewItemsFrozen) {
                onNotify(freezeLockReason('Inserting rows'));
                return;
              }
              const clones = picked.map((r, i) => ({
                ...r,
                id: `ins-${Date.now()}-${i}`,
                parentId: r.rowType === 'Trade' ? null : selectedItem?.parentId ?? null,
              }));
              onUpdateJob(job.id, { rows: [...job.rows, ...clones] });
              onNotify(`Inserted ${clones.length} row(s) from Price List.`);
            } else if (action === 'Replace' && selectedItem && picked[0]) {
              if (isRatesFrozen) {
                onNotify(freezeLockReason('Rates'));
                return;
              }
              updateRow(selectedItem.id, { rate: picked[0].rate });
              onNotify(`Replaced rate on "${selectedItem.description}".`);
            } else if (action === 'Add Rate' && selectedItem) {
              if (isRatesFrozen) {
                onNotify(freezeLockReason('Rates'));
                return;
              }
              const added = picked
                .filter((p) => p.rowType === 'Item')
                .map((p, i) => ({
                  id: `rr-${Date.now()}-${i}`,
                  code: p.code,
                  description: p.description,
                  unit: p.unit,
                  quantity: 1,
                  rate: p.rate,
                  kind: 'Material' as const,
                  total: p.rate,
                }));
              updateRow(selectedItem.id, {
                rateRows: [...selectedItem.rateRows, ...added],
              });
              setLowerTab('Rate');
              onNotify(`Added ${added.length} component(s) to Rate Sheet.`);
            }
          }}
          onClose={() => setShowPriceListModal(false)}
        />
      )}

      {showConstantsModal && (
        <ConstantsModal
          constants={constants}
          onSave={(next) => {
            onUpdateConstants(next);
            onNotify(`Saved ${next.length} Constant(s).`);
          }}
          onClose={() => setShowConstantsModal(false)}
          onNotify={onNotify}
        />
      )}

      {openingsModalKind && (
        <OpeningsModal
          initialKind={openingsModalKind}
          selectedShape={job.shapes.find((s) => s.id === selectedShapeId) ?? null}
          scaleRatio={job.plans.find((p) => p.id === activePlanId)?.scaleRatio ?? 28}
          onApplyOpenings={(shapeId: string, openings: ShapeOpening[]) => {
            if (isQuantitiesFrozen) {
              onNotify(freezeLockReason('Openings'));
              return;
            }
            const targetShape = job.shapes.find((s) => s.id === shapeId);
            if (!targetShape) return;
            const plan = job.plans.find((p) => p.id === targetShape.planId);
            const scale = plan?.scaleRatio ?? 28;
            const nextShape = { ...targetShape, openings };
            const metrics = computeShapeMetrics(nextShape, scale);

            const nextShapes = job.shapes.map((s) => (s.id === shapeId ? nextShape : s));
            const nextRows = job.rows.map((r) => {
              if (r.id !== targetShape.itemId) return r;
              const nextCalcs = r.calcRows.map((c) => {
                if (c.shapeId !== shapeId) return c;
                const netQty = c.resultType.includes('Vertical')
                  ? metrics.verticalAreaM2
                  : c.resultType.includes('Length')
                  ? metrics.lengthM
                  : c.quantity;
                return { ...c, quantity: Number(netQty.toFixed(2)) };
              });
              const totalQty = nextCalcs.reduce((acc, c) => acc + c.quantity * c.factor, 0);
              return { ...r, calcRows: nextCalcs, quantity: Number(totalQty.toFixed(2)) };
            });

            onUpdateJob(job.id, { shapes: nextShapes, rows: nextRows });
          }}
          onClose={() => setOpeningsModalKind(null)}
          onNotify={onNotify}
        />
      )}

      {showGroupingModal && (
        <GroupingCodesModal
          groupingCodes={groupingCodes}
          rows={job.rows}
          selectedRow={selectedItem}
          onSaveCodes={(next) => {
            onUpdateGroupingCodes(next);
            onNotify(`Saved ${next.length} Grouping Code(s).`);
          }}
          onAssignRowCode={(rowId, code) => updateRow(rowId, { groupingCode: code })}
          onGenerateGroupedJob={() => onCreateGroupedJob(job)}
          onClose={() => setShowGroupingModal(false)}
        />
      )}

      {showJobUpdateModal && (
        <JobUpdateModal
          job={job}
          priceLists={priceLists}
          onApplyUpdates={(sourcePriceListId, selectedRowIds) => {
            if (isRatesFrozen) {
              onNotify(freezeLockReason('Rate updates'));
              return;
            }
            const src = priceLists.find((p) => p.id === sourcePriceListId);
            if (!src) return;
            const byCode = new Map(
              src.rows
                .filter((r) => r.rowType === 'Item' && r.code)
                .map((r) => [r.code.trim().toUpperCase(), r])
            );
            const selSet = new Set(selectedRowIds);
            const nextRows = job.rows.map((r) => {
              if (!selSet.has(r.id)) return r;
              const libRow = byCode.get(r.code.trim().toUpperCase());
              if (!libRow) return r;
              return {
                ...r,
                rate: computeRowRate(libRow),
                rateRows: libRow.rateRows.map((rr, i) => ({ ...rr, id: `rr-upd-${Date.now()}-${i}` })),
              };
            });
            onUpdateJob(job.id, { rows: nextRows });
            onNotify(`Propagated ${selectedRowIds.length} rate update(s) from "${src.name}".`);
          }}
          onClose={() => setShowJobUpdateModal(false)}
        />
      )}

      {showTaxModal && (
        <TaxAdjustmentsModal
          job={job}
          onSave={(patch) => {
            if (isJobFrozen) {
              onNotify(freezeLockReason('Job adjustments'));
              return;
            }
            onUpdateJob(job.id, patch);
            onNotify('Updated Job Markup, Sales Tax (GST), Adjustments & GFA.');
          }}
          onClose={() => setShowTaxModal(false)}
        />
      )}

      {deleteRows.length > 0 && (
        <div className="modal-backdrop" onClick={() => setDeleteRows([])}>
          <div className="modal-window" role="alertdialog" aria-modal="true" aria-labelledby="estimate-delete-title"
            style={{ width: 420 }} onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setDeleteRows([]);
              if (event.key === 'Enter' && (event.target as HTMLElement).tagName !== 'BUTTON') {
                event.preventDefault();
                confirmDeleteRows();
              }
            }}>
            <div className="modal-header" id="estimate-delete-title">Delete estimate rows?</div>
            <div className="modal-body">
              <p>This will delete {removableRows(deleteRows).length} estimate rows, including any headings, items and takeoff linked to them.</p>
              <label className="form-checkbox-row">
                <input type="checkbox" checked={skipDeleteConfirmation} onChange={(event) => setSkipDeleteConfirmation(event.target.checked)} />
                Don’t show again
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDeleteRows([])}>Cancel</button>
              <button className="btn-primary" autoFocus onClick={confirmDeleteRows}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {showInsertPlanModal && (
        <InsertPlanModal
          promptScalingOnInsert={options.promptScalingOnInsert}
          onInsertPlans={handleInsertPlans}
          onClose={() => setShowInsertPlanModal(false)}
        />
      )}

      {showIfcModal && (
        <IfcImportModal
          existingShapesCount={job.shapes.length}
          onImportIfc={({ plan, newRows, newShapes }) => {
            if (isNewItemsFrozen || isQuantitiesFrozen) {
              onNotify(freezeLockReason('IFC import'));
              return;
            }
            onUpdateJob(job.id, {
              plans: [...job.plans, plan],
              rows: [...job.rows, ...newRows],
              shapes: [...job.shapes, ...newShapes],
            });
            setActivePlanId(plan.id);
            setViewMode('3D');
          }}
          onClose={() => setShowIfcModal(false)}
          onNotify={onNotify}
        />
      )}

      {showRevisionModal && (
        <PlanRevisionModal
          activePlan={job.plans.find((p) => p.id === activePlanId) ?? null}
          onSaveOverlay={handleSaveRevisionOverlay}
          onStartViewportAlign={() => {
            setViewMode('2D');
            setAligningRevision(true);
            onNotify('2-Point Align active: click Base Plan Anchor then Matching Revision Anchor.');
          }}
          onClose={() => setShowRevisionModal(false)}
          onNotify={onNotify}
        />
      )}

      {reportTab && (
        <ReportPreviewModal
          job={job}
          initialTab={reportTab}
          onUpdateRow={updateRow}
          onClose={() => setReportTab(null)}
          onNotify={onNotify}
        />
      )}

      {optionsVarModalTab && (
        <OptionsVariationsModal
          job={job}
          initialTab={optionsVarModalTab}
          selectedRow={selectedItem}
          onUpdateJob={(patch) => onUpdateJob(job.id, patch)}
          onUpdateRow={updateRow}
          onClose={() => setOptionsVarModalTab(null)}
          onNotify={onNotify}
        />
      )}

      {aiModalTab && (
        <AiTakeoffModal
          initialTab={aiModalTab}
          job={job}
          activePlan={job.plans.find((p) => p.id === activePlanId) ?? null}
          selectedItem={selectedItem}
          onApplyAreaZones={handleApplyAiAreaZones}
          onApplyCountMarkers={handleApplyAiCountMarkers}
          onApplyAutoScale={handleApplyAiAutoScale}
          onClose={() => setAiModalTab(null)}
          onNotify={onNotify}
        />
      )}
    </div>
  );
};
