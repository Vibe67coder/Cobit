export type JobStatus =
  | 'Open'
  | 'Draft Complete'
  | 'Submitted'
  | 'Won'
  | 'Lost'
  | 'Completed'
  | 'Cancelled';

export type FreezeStateFlag =
  | 'None'
  | 'Quantities'
  | 'Rates'
  | 'Options'
  | 'Option Values'
  | 'Option Configurations'
  | 'Estimate'
  | 'New Items'
  | 'Job';

export type ResultType =
  | 'Area'
  | 'Length'
  | 'Volume'
  | 'Volume by Length'
  | 'Vertical Area'
  | 'Vertical Area Less Openings'
  | 'Length Less Openings'
  | 'Length by Centres'
  | 'Count'
  | 'Door Counts'
  | 'Window Counts'
  | 'Note'
  | 'Exclude from total';

export type DrawingTool =
  | 'Select'
  | 'Polyline'
  | 'Auto Select'
  | 'Rectangle'
  | 'Line'
  | 'Count'
  | 'Ruler';

export type UiThemeMode = 'Light' | 'Dark' | 'DesignerBlack';

export type ImperialDisplayMode = 'Decimal' | 'FIS' | 'FIF';

export type FlagStatus = 'Incomplete' | 'Attention' | 'Review' | 'FollowUp' | 'Resolved';

export type WorkspaceLayoutPreset = 'Takeoff' | 'Estimating' | 'Dual screen' | 'Custom';

export interface SiteAddress {
  street: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
}

export interface ClientContact {
  id: string;
  companyId: string;
  name: string;
  mobile: string;
  phone: string;
  email: string;
  isPrimary: boolean;
  archived?: boolean;
}

export interface ClientCompany {
  id: string;
  name: string;
  code: string;
  street: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  archived?: boolean;
}

export interface CalcRow {
  id: string;
  description: string;
  shapeId?: string;
  planId?: string;
  resultType: ResultType;
  length?: number;
  width?: number;
  height?: number;
  depth?: number;
  pitchDeg?: number;
  conversion?: number;
  numberMultiplier?: number;
  factor: number;
  wastagePct?: number;
  deduction?: number;
  quantity: number;
  rounding?: 'None' | 'Round' | 'Round Up' | 'Round Down' | 'Near to 0.1' | 'Roundup to 0.01';
  formula?: string;
}

export interface RateRow {
  id: string;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  rate: number;
  conversion?: number;
  factor?: number;
  wastagePct?: number;
  fn?: '+' | '%';
  kind: 'Material' | 'Labour' | 'Subcontract';
  total: number;
}

export interface EstimateRow {
  id: string;
  parentId: string | null;
  rowType: 'Trade' | 'Heading' | 'Subheading' | 'Item';
  code: string;
  refCode?: string;
  description: string;
  resultType?: ResultType;
  quantity: number;
  unit: string;
  conversion?: number;
  numberMultiplier?: number;
  factor: number;
  wastagePct?: number;
  rate: number;
  markupPct: number;
  pricingMode: 'INCL' | 'EXCL';
  excludeFromTotal?: boolean;
  excludeFromTax?: boolean;
  groupingCode: string;
  rel?: string;
  formula?: string;
  lockedBy?: string | null;
  pickedRate?: {
    supplier: string;
    pickedDate: string;
    rate: number;
    quoteRef?: string;
  };
  flagged?: boolean;
  flagStatus?: FlagStatus;
  flagNote?: string;
  note?: string;
  optionId?: string;
  variationId?: string;
  collapsed?: boolean;
  calcRows: CalcRow[];
  rateRows: RateRow[];
}

export interface OptionPackage {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface VariationRecord {
  id: string;
  code: string;
  name: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  containerGroup?: string;
}

export interface ExternalReference {
  id: string;
  sourceName: string;
  sourceKind: 'PriceList' | 'Job' | 'MCP';
  refKey: string;
  targetItemId: string;
  targetDescription: string;
  targetField: 'Rate' | 'Quantity' | 'Markup';
  syncedValue: number;
  paused?: boolean;
  lastSynced: string;
}

export interface ConstantEntry {
  id: string;
  group: string;
  name: string;
  symbol: string;
  value: number;
  unit: string;
  notes?: string;
}

export interface GroupingCodeDef {
  id: string;
  kind: 'Quantity' | 'Rate';
  code: string;
  description: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  endpointOrCommand: string;
  category: 'CostLibrary' | 'SupplierPricing' | 'Accounting' | 'BIM_CDE' | 'Custom';
  enabled: boolean;
  status: 'Connected' | 'Ready' | 'Disconnected';
  toolsCount: number;
  resourcesCount: number;
}

export interface PlanLayer {
  id: string;
  name: string;
  visible: boolean;
  color: string;
}

export interface PlanSnapshot {
  id: string;
  name: string;
  zoom: number;
  panX: number;
  panY: number;
  isDefault?: boolean;
}

export interface IfcElementGeom {
  id: string;
  globalId: string;
  ifcClass: string;
  name: string;
  level: string;
  xM: number;
  yM: number;
  zM: number;
  widthM: number;
  depthM: number;
  heightM: number;
  rotationRad?: number;
  vertices?: number[];
  indices?: number[];
  footprint?: { x: number; y: number }[];
  areaM2: number;
  lengthM: number;
  volumeM3: number;
  color: string;
  properties?: Record<string, string | number>;
}

export interface IfcResultMappingRule {
  ifcClass: string;
  resultType: ResultType;
  unit: string;
  include: boolean;
}

export interface RevisionOverlay {
  label: string;
  originalFileName: string;
  imageDataUrl?: string;
  vectorPaths?: { d: string; stroke: string; layer: string }[];
  offsetX: number;
  offsetY: number;
  scaleFactor: number;
  rotationDeg: number;
  opacity: number;
  visible: boolean;
}

export interface PlanDocument {
  id: string;
  name: string;
  originalFileName: string;
  pageNumber: number;
  kind: 'Vector PDF' | 'Raster PDF' | 'DWG' | 'DXF' | 'IFC' | 'Image';
  scaleLabel: string;
  scaleRatio: number; // px per meter
  visible: boolean;
  revision: string;
  rotationDeg?: number;
  imageDataUrl?: string;
  widthPx?: number;
  heightPx?: number;
  snapNodes?: { x: number; y: number }[];
  vectorPaths?: { d: string; stroke: string; layer: string }[];
  ifcElements?: IfcElementGeom[];
  revisionOverlay?: RevisionOverlay;
  layers: PlanLayer[];
  snapshots: PlanSnapshot[];
}

export interface ShapeOpening {
  id: string;
  kind: 'Door' | 'Window';
  name: string;
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  offsetMm: number;
  positionRatio: number; // along parent edge
}

export interface TakeoffShape {
  id: string;
  name: string;
  planId: string;
  itemId: string;
  resultType: ResultType;
  color: string;
  points: { x: number; y: number }[];
  closed: boolean;
  heightMm?: number;
  startHeightMm?: number;
  endHeightMm?: number;
  pitchDeg?: number;
  depthMm?: number;
  trenchWidthMm?: number;
  centresSpacingMm?: number;
  factor?: number;
  openings?: ShapeOpening[];
  hidden?: boolean;
  ifcLevel?: string;
  ifcElementId?: string;
}

export interface JobRecord {
  id: string;
  kind: 'Job' | 'PriceList';
  jobMode?: 'Simple' | 'MaterialLabour';
  isReadOnly?: boolean;
  gfaM2?: number;
  adjustmentPct?: number;
  adjustmentFixed?: number;
  projectId: string | null;
  folderId: string | null;
  name: string;
  description: string;
  builder: string;
  startDate: string;
  lastUpdated: string;
  eswProject?: string;
  eswJob?: string;
  useAsTemplate: boolean;
  status: JobStatus;
  freezeStates: FreezeStateFlag[];
  siteAddress: SiteAddress;
  companyId: string | null;
  contactId: string | null;
  accountManager: string;
  markupPct: number;
  salesTaxPct: number;
  rows: EstimateRow[];
  plans: PlanDocument[];
  shapes: TakeoffShape[];
  optionsPackages?: OptionPackage[];
  variations?: VariationRecord[];
  externalRefs?: ExternalReference[];
}

export interface FolderNode {
  id: string;
  projectId: string;
  name: string;
}

export interface ProjectNode {
  id: string;
  name: string;
  description: string;
  builder: string;
  startDate: string;
  useAsTemplate: boolean;
  status: JobStatus;
  freezeStates: FreezeStateFlag[];
  siteAddress: SiteAddress;
  companyId: string | null;
  contactId: string | null;
}

export interface CubitOptionsState {
  uiTheme: UiThemeMode;
  country: string;
  language: string;
  imperialDisplayMode: ImperialDisplayMode;
  companyCodeLabel: string;
  promptScalingOnInsert: boolean;
  importPdfDefault: 'Vector' | 'Raster';
  panesMovable: boolean;
  panesCollapsible: boolean;
  defaultMarkupPct: number;
  defaultTaxPct: number;
  snappingEnabled: boolean;
  snapColor: string;
  defaultMeasurementUnit: 'Metric' | 'Imperial';
  defaultWallHeightMm: number;
  defaultVolumeDepthMm: number;
  defaultWidthMm: number;
  defaultCountUnit: string;
  reportOutputFolder: string;
  aiAutoScale: boolean;
  aiPlanRename: boolean;
  showAiAnalysisMessage: boolean;
  mcpServerEnabled: boolean;
  mcpServerPort: number;
  mcpServerTransport: 'stdio' | 'http';
  mcpConnections: McpServerConfig[];
}

