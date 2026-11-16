import React from 'react';
import {
  Scissors,
  Copy,
  ClipboardPaste,
  MousePointer2,
  PenTool,
  Wand2,
  Square,
  Minus,
  Hash,
  Ruler,
  CornerDownLeft,
  DoorOpen,
  AppWindow,
  Sparkles,
  ScanText,
  FilePlus,
  Box,
  Compass,
  RotateCw,
  GitBranch,
  Camera,
  LayoutTemplate,
  PanelLeft,
  Eye,
  EyeOff,
  FileBarChart2,
  Table2,
  Tags,
  Calculator,
  FileSpreadsheet,
  CloudUpload,
  ChevronUp,
  ChevronDown,
  BookOpen,
  Plus,
  Indent,
  Outdent,
  Lock,
  Plug,
  Settings,
  HelpCircle,
  SlidersHorizontal,
  GitFork,
  Flag,
  Link2,
  RefreshCw,
} from 'lucide-react';
import type { DrawingTool, WorkspaceLayoutPreset } from '../../types/cubit';

export type RibbonTabKey = 'Home' | 'Plans' | 'View' | 'Data' | 'Configuration' | 'Help';

export interface PaneVisibility {
  estimate: boolean;
  viewport: boolean;
  plans: boolean;
  shapes: boolean;
  details: boolean;
  takeoff: boolean;
  navigation: boolean;
  flags: boolean;
  references: boolean;
}

export interface OptimisePdfState {
  flattenPdf: boolean;
  rasteriseText: boolean;
  singleColour: boolean;
}

export interface TakeoffDisplayState {
  legend: boolean;
  names: boolean;
  dimensions: boolean;
}

interface JobRibbonProps {
  activeTab: RibbonTabKey;
  onChangeTab: (tab: RibbonTabKey) => void;
  ribbonCollapsed: boolean;
  onToggleRibbon: () => void;
  showKeytips: boolean;
  activeTool: DrawingTool;
  onSelectTool: (tool: DrawingTool) => void;
  orthoEnabled: boolean;
  onToggleOrtho: () => void;
  phantomEnabled: boolean;
  onTogglePhantom: () => void;
  viewMode: '2D' | '3D';
  onSetViewMode: (m: '2D' | '3D') => void;
  isolateSelected: boolean;
  onToggleIsolate: () => void;
  hidePickedRates: boolean;
  onToggleHidePicked: () => void;
  layoutPreset: WorkspaceLayoutPreset;
  onApplyLayout: (preset: WorkspaceLayoutPreset) => void;
  paneVisibility: PaneVisibility;
  onTogglePane: (pane: keyof PaneVisibility) => void;
  optimisePdf: OptimisePdfState;
  onChangeOptimisePdf: (next: OptimisePdfState) => void;
  takeoffDisplay: TakeoffDisplayState;
  onChangeTakeoffDisplay: (next: TakeoffDisplayState) => void;
  isReadOnly: boolean;
  onToggleReadOnly: () => void;
  onToggleLockTrade: () => void;
  onOpenConstants: () => void;
  onOpenOpenings: (kind: 'Door' | 'Window') => void;
  onOpenGroupingCodes: () => void;
  onOpenTaxAdjustments: () => void;
  onOpenJobUpdate: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onInsertFromPriceList: () => void;
  onCloseShape: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onOpenOptionsVariations: (tab: 'Options' | 'Variations') => void;
  onInsertTrade: () => void;
  onInsertHeading: () => void;
  onInsertItem: () => void;
  onIndent: () => void;
  onUnindent: () => void;
  onOpenInsertPlan: () => void;
  onOpenImportIfc: () => void;
  onStartScaleCalibration: () => void;
  onRotateActivePlan: () => void;
  onSaveSnapshot: () => void;
  onOpenRevisionModal: () => void;
  onStartRevisionAlign: () => void;
  onOpenReport: (tab: 'BOQ' | 'Trade' | 'Shapes' | 'LiveCosts' | 'Xero') => void;
  onOpenAiTool: (tab: 'AutoArea' | 'CountSymbols' | 'ScanText' | 'AutoScale' | 'Copilot') => void;
  onPinToQat: (id: string, label: string) => void;
  isPriceList?: boolean;
}

export const JobRibbon: React.FC<JobRibbonProps> = ({
  activeTab,
  onChangeTab,
  ribbonCollapsed,
  onToggleRibbon,
  showKeytips,
  activeTool,
  onSelectTool,
  orthoEnabled,
  onToggleOrtho,
  phantomEnabled,
  onTogglePhantom,
  viewMode,
  onSetViewMode,
  isolateSelected,
  onToggleIsolate,
  hidePickedRates,
  onToggleHidePicked,
  layoutPreset,
  onApplyLayout,
  paneVisibility,
  onTogglePane,
  optimisePdf,
  onChangeOptimisePdf,
  takeoffDisplay,
  onChangeTakeoffDisplay,
  isReadOnly,
  onToggleReadOnly,
  onToggleLockTrade,
  onOpenConstants,
  onOpenOpenings,
  onOpenGroupingCodes,
  onOpenTaxAdjustments,
  onOpenJobUpdate,
  onOpenSettings,
  onOpenHelp,
  onInsertFromPriceList,
  onCloseShape,
  onCut,
  onCopy,
  onPaste,
  onOpenOptionsVariations,
  onInsertTrade,
  onInsertHeading,
  onInsertItem,
  onIndent,
  onUnindent,
  onOpenInsertPlan,
  onOpenImportIfc,
  onStartScaleCalibration,
  onRotateActivePlan,
  onSaveSnapshot,
  onOpenRevisionModal,
  onStartRevisionAlign,
  onOpenReport,
  onOpenAiTool,
  onPinToQat,
  isPriceList,
}) => {
  // Buildsoft KB 14415314156431: Read-Only Mode swaps Home -> Read-Only and hides Plans & Configuration
  const tabs: RibbonTabKey[] = isReadOnly
    ? ['Home', 'View', 'Data', 'Help']
    : ['Home', 'Plans', 'View', 'Data', 'Configuration', 'Help'];

  const handleRightClickPin = (e: React.MouseEvent, id: string, label: string) => {
    e.preventDefault();
    onPinToQat(id, label);
  };

  return (
    <div className="ribbon-container">
      <div className="ribbon-tabs-row">
        <div className="ribbon-tabs-left">
          {tabs.map((t) => (
            <button
              key={t}
              className={`ribbon-tab-btn ${activeTab === t ? 'active' : ''}`}
              onClick={() => onChangeTab(t)}
            >
              {t === 'Home' && isReadOnly ? 'Read-Only' : t}
              {showKeytips && <span className="keytip-badge">{t[0]}</span>}
            </button>
          ))}
        </div>
        <div className="ribbon-tabs-right">
          <span style={{ fontSize: 10.5 }}>
            Right-click any button to pin to Quick Access Toolbar · Ctrl+F1 to collapse
          </span>
          <button
            className="ribbon-collapse-btn"
            onClick={onToggleRibbon}
            title="Hide or show ribbon (Ctrl+F1)"
          >
            {ribbonCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      {!ribbonCollapsed && (
        <div className="ribbon-body">
          {activeTab === 'Home' && (
            <>
              {/* Clipboard */}
              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <button
                    className="ribbon-btn-lg"
                    disabled={isReadOnly}
                    onClick={onCut}
                    onContextMenu={(e) => handleRightClickPin(e, 'cut', 'Cut')}
                  >
                    <Scissors size={17} />
                    <span>Cut</span>
                  </button>
                  <div className="ribbon-btn-stack">
                    <button className="ribbon-btn-sm" onClick={onCopy}>
                      <Copy size={12} /> Copy
                    </button>
                    <button
                      className="ribbon-btn-sm"
                      disabled={isReadOnly}
                      onClick={onPaste}
                    >
                      <ClipboardPaste size={12} /> Paste
                    </button>
                  </div>
                </div>
                <div className="ribbon-group-label">Clipboard</div>
              </div>

              {/* Estimate / Insert */}
              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <button
                    className="ribbon-btn-lg"
                    disabled={isReadOnly}
                    onClick={onInsertFromPriceList}
                    onContextMenu={(e) => handleRightClickPin(e, 'pricelist', 'Price List')}
                  >
                    <BookOpen size={17} color="var(--brand-blue)" />
                    <span>Price List</span>
                  </button>
                  <div className="ribbon-btn-stack">
                    <button className="ribbon-btn-sm" disabled={isReadOnly} onClick={onInsertTrade}>
                      <Plus size={12} color="var(--brand-blue)" /> Trade (Ctrl+T)
                    </button>
                    <button className="ribbon-btn-sm" disabled={isReadOnly} onClick={onInsertHeading}>
                      <Plus size={12} color="#d97706" /> Heading (Ctrl+H)
                    </button>
                  </div>
                  <div className="ribbon-btn-stack">
                    <button className="ribbon-btn-sm" disabled={isReadOnly} onClick={onInsertItem}>
                      <Plus size={12} color="#16a34a" /> Item (Ctrl+I)
                    </button>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button className="ribbon-btn-sm" disabled={isReadOnly} onClick={onIndent} title="Indent (Ctrl+<)">
                        <Indent size={12} />
                      </button>
                      <button className="ribbon-btn-sm" disabled={isReadOnly} onClick={onUnindent} title="Unindent (Ctrl+>)">
                        <Outdent size={12} />
                      </button>
                      <button className="ribbon-btn-sm" onClick={onToggleLockTrade} title="Lock/Unlock Trade (Ctrl+L)">
                        <Lock size={12} color="#b45309" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="ribbon-group-label">Estimate</div>
              </div>

              {/* Shapes / Drawing Tools */}
              {!isPriceList && !isReadOnly && (
                <div className="ribbon-group">
                  <div className="ribbon-group-controls">
                    <button
                      className={`ribbon-btn-lg ${activeTool === 'Select' ? 'active' : ''}`}
                      onClick={() => onSelectTool('Select')}
                      title="Select Tool (Ctrl+1)"
                      onContextMenu={(e) => handleRightClickPin(e, 'select', 'Select')}
                    >
                      <MousePointer2 size={17} />
                      <span>Select</span>
                    </button>
                    <button
                      className={`ribbon-btn-lg ${activeTool === 'Polyline' ? 'active' : ''}`}
                      onClick={() => onSelectTool('Polyline')}
                      title="Polyline Tool (Ctrl+2)"
                      onContextMenu={(e) => handleRightClickPin(e, 'polyline', 'Polyline')}
                    >
                      <PenTool size={17} color="#0284c7" />
                      <span>Polyline</span>
                    </button>
                    <button
                      className={`ribbon-btn-lg ${activeTool === 'Auto Select' ? 'active' : ''}`}
                      onClick={() => onSelectTool('Auto Select')}
                      title="Auto Select Tool (Ctrl+3)"
                    >
                      <Wand2 size={17} color="#7c3aed" />
                      <span>Auto Select</span>
                    </button>
                    <div className="ribbon-btn-stack">
                      <button
                        className={`ribbon-btn-sm ${activeTool === 'Rectangle' ? 'active' : ''}`}
                        onClick={() => onSelectTool('Rectangle')}
                        title="Rectangle (Ctrl+4)"
                      >
                        <Square size={12} color="#16a34a" /> Rectangle
                      </button>
                      <button
                        className={`ribbon-btn-sm ${activeTool === 'Line' ? 'active' : ''}`}
                        onClick={() => onSelectTool('Line')}
                        title="Line (Ctrl+5)"
                      >
                        <Minus size={12} color="#0284c7" /> Line
                      </button>
                    </div>
                    <div className="ribbon-btn-stack">
                      <button
                        className={`ribbon-btn-sm ${activeTool === 'Count' ? 'active' : ''}`}
                        onClick={() => onSelectTool('Count')}
                        title="Count (Ctrl+6)"
                      >
                        <Hash size={12} color="#ea580c" /> Count
                      </button>
                      <button
                        className={`ribbon-btn-sm ${activeTool === 'Ruler' ? 'active' : ''}`}
                        onClick={() => onSelectTool('Ruler')}
                        title="Ruler (Ctrl+7)"
                      >
                        <Ruler size={12} color="#64748b" /> Ruler
                      </button>
                    </div>
                    <div className="ribbon-btn-stack">
                      <button className="ribbon-btn-sm" onClick={onCloseShape} title="Close Shape (J)">
                        <CornerDownLeft size={12} /> Close (J)
                      </button>
                      <div style={{ display: 'flex', gap: 2 }}>
                        <button
                          className={`ribbon-btn-sm ${orthoEnabled ? 'active' : ''}`}
                          onClick={onToggleOrtho}
                          title="Ortho Angle (F8)"
                        >
                          Ortho
                        </button>
                        <button
                          className={`ribbon-btn-sm ${phantomEnabled ? 'active' : ''}`}
                          onClick={onTogglePhantom}
                          title="Phantom Line (F7)"
                        >
                          Phantom
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="ribbon-group-label">Shapes</div>
                </div>
              )}

              {/* Openings */}
              {!isPriceList && !isReadOnly && (
                <div className="ribbon-group">
                  <div className="ribbon-group-controls">
                    <button
                      className="ribbon-btn-lg"
                      onClick={() => onOpenOpenings('Door')}
                    >
                      <DoorOpen size={17} color="#b45309" />
                      <span>Door</span>
                    </button>
                    <button
                      className="ribbon-btn-lg"
                      onClick={() => onOpenOpenings('Window')}
                    >
                      <AppWindow size={17} color="#0284c7" />
                      <span>Window</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Openings</div>
                </div>
              )}

              {/* AI Tools (v14–v15) */}
              {!isPriceList && !isReadOnly && (
                <div className="ribbon-group">
                  <div className="ribbon-group-controls">
                    <button
                      className="ribbon-btn-lg"
                      onClick={() => onOpenAiTool('AutoArea')}
                    >
                      <Sparkles size={17} color="#7c3aed" />
                      <span>Auto Area</span>
                    </button>
                    <button
                      className="ribbon-btn-lg"
                      onClick={() => onOpenAiTool('CountSymbols')}
                    >
                      <Sparkles size={17} color="#0d9488" />
                      <span>Count Symbols</span>
                    </button>
                    <button
                      className="ribbon-btn-lg"
                      onClick={() => onOpenAiTool('ScanText')}
                    >
                      <ScanText size={17} color="var(--brand-blue)" />
                      <span>Scan Text</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">AI Estimating</div>
                </div>
              )}
            </>
          )}

          {activeTab === 'Plans' && (
            <>
              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <button
                    className="ribbon-btn-lg"
                    onClick={onOpenInsertPlan}
                  >
                    <FilePlus size={17} color="var(--brand-blue)" />
                    <span>Insert Plan</span>
                  </button>
                  <button
                    className="ribbon-btn-lg"
                    onClick={onOpenImportIfc}
                  >
                    <Box size={17} color="#0d9488" />
                    <span>Import IFC</span>
                  </button>
                </div>
                <div className="ribbon-group-label">Insert</div>
              </div>

              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <button
                    className="ribbon-btn-lg"
                    onClick={onStartScaleCalibration}
                  >
                    <Compass size={17} color="var(--brand-blue)" />
                    <span>Scale Plan</span>
                  </button>
                  <button
                    className="ribbon-btn-lg"
                    onClick={() => onOpenAiTool('AutoScale')}
                  >
                    <Sparkles size={17} color="#7c3aed" />
                    <span>AI Auto Scale</span>
                  </button>
                  <button
                    className="ribbon-btn-lg"
                    onClick={onRotateActivePlan}
                  >
                    <RotateCw size={17} />
                    <span>Rotate</span>
                  </button>
                </div>
                <div className="ribbon-group-label">Calibration</div>
              </div>

              {/* Optimise PDF Group (Exact KB Parity) */}
              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <div className="ribbon-btn-stack" style={{ padding: '2px 6px' }}>
                    <label className="form-checkbox-row" style={{ fontSize: 11 }}>
                      <input
                        type="checkbox"
                        checked={optimisePdf.flattenPdf}
                        onChange={(e) =>
                          onChangeOptimisePdf({ ...optimisePdf, flattenPdf: e.target.checked })
                        }
                      />
                      Flatten PDF
                    </label>
                    <label className="form-checkbox-row" style={{ fontSize: 11 }}>
                      <input
                        type="checkbox"
                        checked={optimisePdf.rasteriseText}
                        onChange={(e) =>
                          onChangeOptimisePdf({ ...optimisePdf, rasteriseText: e.target.checked })
                        }
                      />
                      Rasterise Text
                    </label>
                  </div>
                  <div className="ribbon-btn-stack" style={{ padding: '2px 6px' }}>
                    <label className="form-checkbox-row" style={{ fontSize: 11 }}>
                      <input
                        type="checkbox"
                        checked={optimisePdf.singleColour}
                        onChange={(e) =>
                          onChangeOptimisePdf({ ...optimisePdf, singleColour: e.target.checked })
                        }
                      />
                      Single Colour
                    </label>
                  </div>
                </div>
                <div className="ribbon-group-label">Optimise</div>
              </div>

              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <button
                    className="ribbon-btn-lg"
                    onClick={onOpenRevisionModal}
                  >
                    <GitBranch size={17} color="#d97706" />
                    <span>Add Revision</span>
                  </button>
                  <button
                    className="ribbon-btn-lg"
                    onClick={onStartRevisionAlign}
                  >
                    <Ruler size={17} />
                    <span>Align</span>
                  </button>
                </div>
                <div className="ribbon-group-label">Plan Change</div>
              </div>

              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <button
                    className="ribbon-btn-lg"
                    onClick={onSaveSnapshot}
                  >
                    <Camera size={17} color="var(--brand-blue)" />
                    <span>Save Snapshot</span>
                  </button>
                  <button
                    className="ribbon-btn-lg"
                    onClick={onOpenImportIfc}
                  >
                    <Tags size={17} color="#0d9488" />
                    <span>Result Mapping</span>
                  </button>
                </div>
                <div className="ribbon-group-label">Snapshots &amp; BIM</div>
              </div>
            </>
          )}

          {activeTab === 'View' && (
            <>
              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  {(['Takeoff', 'Estimating', 'Dual screen', 'Custom'] as WorkspaceLayoutPreset[]).map(
                    (preset) => (
                      <button
                        key={preset}
                        className={`ribbon-btn-lg ${layoutPreset === preset ? 'active' : ''}`}
                        onClick={() => onApplyLayout(preset)}
                      >
                        <LayoutTemplate size={17} color="var(--brand-blue)" />
                        <span>{preset}</span>
                      </button>
                    )
                  )}
                </div>
                <div className="ribbon-group-label">Layout</div>
              </div>

              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <div className="ribbon-btn-stack">
                    <button
                      className={`ribbon-btn-sm ${paneVisibility.estimate ? 'active' : ''}`}
                      onClick={() => onTogglePane('estimate')}
                    >
                      <PanelLeft size={12} /> Estimate
                    </button>
                    <button
                      className={`ribbon-btn-sm ${paneVisibility.viewport ? 'active' : ''}`}
                      onClick={() => onTogglePane('viewport')}
                    >
                      <PanelLeft size={12} /> Viewport
                    </button>
                  </div>
                  <div className="ribbon-btn-stack">
                    <button
                      className={`ribbon-btn-sm ${paneVisibility.plans ? 'active' : ''}`}
                      onClick={() => onTogglePane('plans')}
                    >
                      Plans
                    </button>
                    <button
                      className={`ribbon-btn-sm ${paneVisibility.shapes ? 'active' : ''}`}
                      onClick={() => onTogglePane('shapes')}
                    >
                      Shapes
                    </button>
                  </div>
                  <div className="ribbon-btn-stack">
                    <button
                      className={`ribbon-btn-sm ${paneVisibility.details ? 'active' : ''}`}
                      onClick={() => onTogglePane('details')}
                    >
                      Details
                    </button>
                    <button
                      className={`ribbon-btn-sm ${paneVisibility.takeoff ? 'active' : ''}`}
                      onClick={() => onTogglePane('takeoff')}
                    >
                      Takeoff
                    </button>
                  </div>
                  <div className="ribbon-btn-stack">
                    <button
                      className={`ribbon-btn-sm ${paneVisibility.navigation ? 'active' : ''}`}
                      onClick={() => onTogglePane('navigation')}
                    >
                      Navigation
                    </button>
                    <button
                      className={`ribbon-btn-sm ${paneVisibility.flags ? 'active' : ''}`}
                      onClick={() => onTogglePane('flags')}
                    >
                      <Flag size={11} /> Flags
                    </button>
                  </div>
                  <div className="ribbon-btn-stack">
                    <button
                      className={`ribbon-btn-sm ${paneVisibility.references ? 'active' : ''}`}
                      onClick={() => onTogglePane('references')}
                    >
                      <Link2 size={11} /> Referencing
                    </button>
                  </div>
                </div>
                <div className="ribbon-group-label">Panes</div>
              </div>

              {/* View -> Takeoff Overlay Checkboxes (Exact KB Parity) */}
              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <div className="ribbon-btn-stack" style={{ padding: '2px 6px' }}>
                    <label className="form-checkbox-row" style={{ fontSize: 11 }}>
                      <input
                        type="checkbox"
                        checked={takeoffDisplay.legend}
                        onChange={(e) =>
                          onChangeTakeoffDisplay({ ...takeoffDisplay, legend: e.target.checked })
                        }
                      />
                      Legend
                    </label>
                    <label className="form-checkbox-row" style={{ fontSize: 11 }}>
                      <input
                        type="checkbox"
                        checked={takeoffDisplay.names}
                        onChange={(e) =>
                          onChangeTakeoffDisplay({ ...takeoffDisplay, names: e.target.checked })
                        }
                      />
                      Names
                    </label>
                  </div>
                  <div className="ribbon-btn-stack" style={{ padding: '2px 6px' }}>
                    <label className="form-checkbox-row" style={{ fontSize: 11 }}>
                      <input
                        type="checkbox"
                        checked={takeoffDisplay.dimensions}
                        onChange={(e) =>
                          onChangeTakeoffDisplay({
                            ...takeoffDisplay,
                            dimensions: e.target.checked,
                          })
                        }
                      />
                      Dimensions
                    </label>
                  </div>
                </div>
                <div className="ribbon-group-label">Takeoff</div>
              </div>

              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <button
                    className={`ribbon-btn-lg ${viewMode === '2D' ? 'active' : ''}`}
                    onClick={() => onSetViewMode('2D')}
                  >
                    <Square size={17} />
                    <span>2D View</span>
                  </button>
                  <button
                    className={`ribbon-btn-lg ${viewMode === '3D' ? 'active' : ''}`}
                    onClick={() => onSetViewMode('3D')}
                  >
                    <Box size={17} color="#0d9488" />
                    <span>3D View</span>
                  </button>
                  <button
                    className={`ribbon-btn-lg ${isolateSelected ? 'active' : ''}`}
                    onClick={onToggleIsolate}
                  >
                    {isolateSelected ? <EyeOff size={17} /> : <Eye size={17} />}
                    <span>Isolate Shapes</span>
                  </button>
                  <button
                    className={`ribbon-btn-lg ${hidePickedRates ? 'active' : ''}`}
                    onClick={onToggleHidePicked}
                  >
                    <EyeOff size={17} color="#0d9488" />
                    <span>Hide Picked</span>
                  </button>
                </div>
                <div className="ribbon-group-label">Viewport</div>
              </div>
            </>
          )}

          {activeTab === 'Data' && (
            <>
              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <button
                    className="ribbon-btn-lg"
                    onClick={() => onOpenReport('BOQ')}
                  >
                    <FileBarChart2 size={17} color="var(--brand-blue)" />
                    <span>BOQ Report</span>
                  </button>
                  <button
                    className="ribbon-btn-lg"
                    onClick={() => onOpenReport('Trade')}
                  >
                    <Table2 size={17} color="#0d9488" />
                    <span>Trade Report</span>
                  </button>
                  <button
                    className="ribbon-btn-lg"
                    onClick={() => onOpenReport('Shapes')}
                  >
                    <Camera size={17} color="#d97706" />
                    <span>Shapes Report</span>
                  </button>
                </div>
                <div className="ribbon-group-label">Reports</div>
              </div>

              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <button className="ribbon-btn-lg" onClick={onInsertFromPriceList}>
                    <BookOpen size={17} color="var(--brand-blue)" />
                    <span>Assign Lists</span>
                  </button>
                  <button className="ribbon-btn-lg" onClick={onOpenJobUpdate}>
                    <RefreshCw size={17} color="#0284c7" />
                    <span>Update Job</span>
                  </button>
                  <button className="ribbon-btn-lg" onClick={onOpenGroupingCodes}>
                    <Tags size={17} color="#7c3aed" />
                    <span>Codes</span>
                  </button>
                  <button className="ribbon-btn-lg" onClick={onOpenTaxAdjustments}>
                    <Calculator size={17} color="#16a34a" />
                    <span>Tax &amp; Markup</span>
                  </button>
                </div>
                <div className="ribbon-group-label">References &amp; Pricing</div>
              </div>

              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <button
                    className="ribbon-btn-lg"
                    onClick={() => onOpenReport('BOQ')}
                  >
                    <FileSpreadsheet size={17} color="#15803d" />
                    <span>Export Excel</span>
                  </button>
                  <button
                    className="ribbon-btn-lg"
                    onClick={() => onOpenReport('LiveCosts')}
                  >
                    <CloudUpload size={17} color="var(--brand-blue)" />
                    <span>LiveCosts CSV</span>
                  </button>
                  <button
                    className="ribbon-btn-lg"
                    onClick={() => onOpenReport('Xero')}
                  >
                    <CloudUpload size={17} color="#0d9488" />
                    <span>Select / Xero</span>
                  </button>
                </div>
                <div className="ribbon-group-label">Integrations</div>
              </div>
            </>
          )}

          {activeTab === 'Configuration' && (
            <>
              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <button className="ribbon-btn-lg" onClick={onOpenGroupingCodes}>
                    <Tags size={17} color="#7c3aed" />
                    <span>Codes</span>
                  </button>
                  <button className="ribbon-btn-lg" onClick={onOpenConstants}>
                    <Calculator size={17} color="var(--brand-blue)" />
                    <span>Constants</span>
                  </button>
                  <button
                    className="ribbon-btn-lg"
                    onClick={() => onOpenOptionsVariations('Options')}
                  >
                    <SlidersHorizontal size={17} color="#0d9488" />
                    <span>Options</span>
                  </button>
                  <button
                    className="ribbon-btn-lg"
                    onClick={() => onOpenOptionsVariations('Variations')}
                  >
                    <GitFork size={17} color="#d97706" />
                    <span>Variations</span>
                  </button>
                </div>
                <div className="ribbon-group-label">Manage</div>
              </div>

              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <button className="ribbon-btn-lg" onClick={onToggleLockTrade}>
                    <Lock size={17} color="#b45309" />
                    <span>Lock Trade</span>
                  </button>
                  <button
                    className={`ribbon-btn-lg ${isReadOnly ? 'active' : ''}`}
                    onClick={onToggleReadOnly}
                  >
                    <Eye size={17} />
                    <span>Read-Only</span>
                  </button>
                </div>
                <div className="ribbon-group-label">Collaboration</div>
              </div>

              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <button className="ribbon-btn-lg" onClick={onOpenSettings}>
                    <Plug size={17} color="#0d9488" />
                    <span>MCP Connections</span>
                  </button>
                  <button className="ribbon-btn-lg" onClick={onOpenSettings}>
                    <Settings size={17} color="var(--brand-blue)" />
                    <span>Settings</span>
                  </button>
                </div>
                <div className="ribbon-group-label">MCP &amp; System</div>
              </div>
            </>
          )}

          {activeTab === 'Help' && (
            <>
              <div className="ribbon-group">
                <div className="ribbon-group-controls">
                  <button className="ribbon-btn-lg" onClick={onOpenHelp}>
                    <HelpCircle size={17} color="var(--brand-blue)" />
                    <span>Shortcuts (F1)</span>
                  </button>
                  <button className="ribbon-btn-lg" onClick={onOpenSettings}>
                    <Settings size={17} />
                    <span>Settings</span>
                  </button>
                  <button className="ribbon-btn-lg" onClick={onOpenSettings}>
                    <Plug size={17} color="#0d9488" />
                    <span>MCP API</span>
                  </button>
                </div>
                <div className="ribbon-group-label">Support &amp; CobitX Docs</div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

