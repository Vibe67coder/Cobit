import type {
  ClientCompany,
  ClientContact,
  ConstantEntry,
  CubitOptionsState,
  FolderNode,
  GroupingCodeDef,
  IfcElementGeom,
  JobRecord,
  ProjectNode,
  ResultType,
} from '../types/cubit';

export interface WorkspacePersistedState {
  projects: ProjectNode[];
  folders: FolderNode[];
  jobs: JobRecord[];
  companies: ClientCompany[];
  contacts: ClientContact[];
  constants: ConstantEntry[];
  groupingCodes: GroupingCodeDef[];
  options: CubitOptionsState;
}

export interface EngineHealth {
  status: string;
  service: string;
  version: string;
  sqlitePath: string;
  duckdbPath: string;
  mcpReady: boolean;
}

export interface BoqAnalyticsResult {
  jobId: string;
  itemCount: number;
  totalCost: number;
  totalSell: number;
  itemMarkup: number;
  byGroupingCode: {
    code: string;
    itemCount: number;
    costTotal: number;
    sellTotal: number;
  }[];
}

export interface McpToolDef {
  name: string;
  description: string;
  argsSchema: Record<string, string>;
}

export interface McpManifest {
  serverName: string;
  protocolVersion: string;
  tools: McpToolDef[];
  resources: string[];
}

export interface OpeningPreset {
  id: string;
  kind: 'Door' | 'Window';
  name: string;
  widthMm: number;
  heightMm: number;
  offsetMm: number;
  deductArea: boolean;
}

let cachedBaseUrl: string | null = null;

async function getBaseUrl(): Promise<string> {
  if (cachedBaseUrl !== null) return cachedBaseUrl;
  if (typeof window !== 'undefined' && window.cobitxDesktop?.getEnv) {
    try {
      const env = await window.cobitxDesktop.getEnv();
      cachedBaseUrl = env.engineUrl;
      return cachedBaseUrl;
    } catch {
      // Fall through to relative path
    }
  }
  cachedBaseUrl = '';
  return cachedBaseUrl;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function checkEngineHealth(): Promise<EngineHealth | null> {
  try {
    return await req<EngineHealth>('/health');
  } catch {
    return null;
  }
}

export async function loadWorkspaceState(): Promise<WorkspacePersistedState | null> {
  try {
    const res = await req<{ initialized: boolean; state: WorkspacePersistedState | null }>(
      '/api/state'
    );
    return res.initialized ? res.state : null;
  } catch {
    return null;
  }
}

export async function saveWorkspaceState(state: WorkspacePersistedState): Promise<boolean> {
  try {
    await req('/api/state', {
      method: 'PUT',
      body: JSON.stringify(state),
    });
    return true;
  } catch {
    return false;
  }
}

export async function fetchOpeningsLibrary(): Promise<OpeningPreset[]> {
  try {
    const res = await req<{ openings: OpeningPreset[] }>('/api/openings-library');
    return res.openings;
  } catch {
    return [
      { id: 'op-d820', kind: 'Door', name: 'Single Timber Door 820x2040', widthMm: 820, heightMm: 2040, offsetMm: 0, deductArea: true },
      { id: 'op-d920', kind: 'Door', name: 'Accessible Entry Door 920x2040', widthMm: 920, heightMm: 2040, offsetMm: 0, deductArea: true },
      { id: 'op-w1200', kind: 'Window', name: 'Aluminium Sliding Window 1200x1200', widthMm: 1200, heightMm: 1200, offsetMm: 900, deductArea: true },
    ];
  }
}

export async function fetchBoqAnalytics(jobId: string): Promise<BoqAnalyticsResult | null> {
  try {
    return await req<BoqAnalyticsResult>(`/api/jobs/${encodeURIComponent(jobId)}/boq-analytics`);
  } catch {
    return null;
  }
}

export async function fetchMcpManifest(): Promise<McpManifest | null> {
  try {
    return await req<McpManifest>('/api/mcp/manifest');
  } catch {
    return null;
  }
}

export async function callMcpTool(
  tool: string,
  toolArgs?: Record<string, unknown>
): Promise<{ tool: string; result: unknown }> {
  return req('/api/mcp/call', {
    method: 'POST',
    body: JSON.stringify({ tool, arguments: toolArgs ?? {} }),
  });
}

export async function probeMcpConnection(
  transport: 'stdio' | 'http',
  endpointOrCommand: string
): Promise<{
  ok: boolean;
  status: 'Connected' | 'Ready' | 'Disconnected';
  latencyMs: number;
  toolsCount?: number;
  resourcesCount?: number;
  detail: string;
}> {
  return req('/api/mcp/test', {
    method: 'POST',
    body: JSON.stringify({ transport, endpointOrCommand }),
  });
}

export interface UploadedPlanResponse {
  name: string;
  originalFileName: string;
  pageNumber: number;
  totalPages: number;
  kind: 'Vector PDF' | 'Raster PDF' | 'DWG' | 'DXF' | 'IFC' | 'Image';
  scaleLabel: string;
  scaleRatio: number;
  imageDataUrl?: string;
  widthPx?: number;
  heightPx?: number;
  snapNodes?: { x: number; y: number }[];
  vectorPaths?: { d: string; stroke: string; layer: string }[];
  layers: { id: string; name: string; visible: boolean; color: string }[];
}

export interface PdfPagePreview {
  number: number;
  thumbnail: string;
}

async function postPlanFile<T>(endpoint: string, data: FormData): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/plans/${endpoint}`, { method: 'POST', body: data });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Drawing request failed (${res.status}).`);
  }
  return res.json() as Promise<T>;
}

export async function previewPdfPages(file: File): Promise<PdfPagePreview[]> {
  const data = new FormData();
  data.append('file', file);
  return (await postPlanFile<{ pages: PdfPagePreview[] }>('pdf-preview', data)).pages;
}

export async function uploadPdfPages(file: File, pages: number[]): Promise<UploadedPlanResponse[]> {
  const data = new FormData();
  data.append('file', file);
  for (const page of pages) data.append('page_numbers', String(page));
  return (await postPlanFile<{ plans: UploadedPlanResponse[] }>('upload-pages', data)).plans;
}

export async function uploadPlanFile(
  file: File,
  pageNumber = 1
): Promise<UploadedPlanResponse> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('page_number', String(pageNumber));
  return postPlanFile<UploadedPlanResponse>('upload', fd);
}

export async function autoSelectPolygon(
  imageDataUrl: string | undefined,
  seedX: number,
  seedY: number
): Promise<{ x: number; y: number }[]> {
  try {
    const res = await req<{ points: { x: number; y: number }[] }>('/api/plans/auto-select', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl: imageDataUrl ?? null, seedX, seedY }),
    });
    return res.points ?? [];
  } catch {
    return [];
  }
}

export interface IfcClassSummary {
  ifcClass: string;
  count: number;
  totalAreaM2: number;
  totalLengthM: number;
  totalVolumeM3: number;
  defaultResultType: ResultType;
  defaultUnit: string;
}

export interface ImportedIfcResponse {
  name: string;
  originalFileName: string;
  kind: 'IFC';
  scaleLabel: string;
  scaleRatio: number;
  levels: string[];
  layers: { id: string; name: string; visible: boolean; color: string }[];
  ifcElements: IfcElementGeom[];
  vectorPaths: { d: string; stroke: string; layer: string }[];
  snapNodes: { x: number; y: number }[];
  classSummaries: IfcClassSummary[];
}

export async function importIfcFile(file: File): Promise<ImportedIfcResponse> {
  const base = await getBaseUrl();
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${base}/api/plans/import-ifc`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return (await res.json()) as ImportedIfcResponse;
}

export async function loadSampleIfc(): Promise<ImportedIfcResponse> {
  return req<ImportedIfcResponse>('/api/plans/sample-ifc', { method: 'POST' });
}

export async function downloadJobExport(
  job: JobRecord,
  format: 'excel' | 'pdf' | 'csv',
  reportKind: string
): Promise<Blob> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/export/${format}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job, reportKind }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.blob();
}

export interface AiZoneResult {
  label: string;
  points: { x: number; y: number }[];
  confidence: number;
}

export interface AiMarkerResult {
  x: number;
  y: number;
  label?: string;
  text?: string;
  confidence: number;
}

export async function runAiAutoArea(imageDataUrl?: string): Promise<AiZoneResult[]> {
  const res = await req<{ zones: AiZoneResult[] }>('/api/ai/auto-area', {
    method: 'POST',
    body: JSON.stringify({ imageDataUrl: imageDataUrl ?? null }),
  });
  return res.zones ?? [];
}

export async function runAiCountSymbols(
  symbolKind: string,
  imageDataUrl?: string,
  confidenceThreshold = 0.72,
  seedBox?: { x: number; y: number; w: number; h: number }
): Promise<AiMarkerResult[]> {
  const res = await req<{ markers: AiMarkerResult[] }>('/api/ai/count-symbols', {
    method: 'POST',
    body: JSON.stringify({
      symbolKind,
      imageDataUrl: imageDataUrl ?? null,
      seedBox: seedBox ?? null,
      confidenceThreshold,
    }),
  });
  return res.markers ?? [];
}

export async function runAiScanText(
  query: string,
  planName: string,
  imageDataUrl?: string
): Promise<AiMarkerResult[]> {
  const res = await req<{ matches: AiMarkerResult[] }>('/api/ai/scan-text', {
    method: 'POST',
    body: JSON.stringify({ query, planName, imageDataUrl: imageDataUrl ?? null }),
  });
  return res.matches ?? [];
}

export async function runAiAutoScale(
  currentName: string,
  originalFileName: string,
  imageDataUrl?: string
): Promise<{
  suggestedName: string;
  detectedScaleLabel: string;
  suggestedScaleRatio: number;
  confidence: number;
}> {
  return req('/api/ai/auto-scale', {
    method: 'POST',
    body: JSON.stringify({
      currentName,
      originalFileName,
      imageDataUrl: imageDataUrl ?? null,
    }),
  });
}

export async function importLegacyArchive(
  file: File,
  kindHint?: 'Job' | 'PriceList'
): Promise<JobRecord> {
  const base = await getBaseUrl();
  const fd = new FormData();
  fd.append('file', file);
  if (kindHint) fd.append('kind_hint', kindHint);
  const res = await fetch(`${base}/api/import/cbx`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const data = (await res.json()) as { job: JobRecord };
  return data.job;
}

export async function importEstimateSpreadsheet(file: File, kind: 'Job' | 'PriceList'): Promise<JobRecord> {
  const base = await getBaseUrl();
  const fd = new FormData();
  fd.append('file', file);
  const endpoint = kind === 'Job' ? 'costx-estimate' : 'pricelist-excel';
  const res = await fetch(`${base}/api/import/${endpoint}`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Spreadsheet import failed (${res.status}).`);
  }
  const data = (await res.json()) as { job: JobRecord };
  return data.job;
}

export async function exportLegacyArchive(job: JobRecord): Promise<Blob> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/export/cbx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job, reportKind: job.kind }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.blob();
}

