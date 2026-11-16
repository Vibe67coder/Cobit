import type {
  CalcRow,
  EstimateRow,
  ImperialDisplayMode,
  JobRecord,
  JobStatus,
  RateRow,
  TakeoffShape,
} from '../types/cubit';

export const LOCKED_JOB_STATUSES: ReadonlySet<JobStatus> = new Set([
  'Submitted',
  'Won',
  'Completed',
  'Cancelled',
]);

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function formatDimension(
  meters: number,
  unitSystem: 'Metric' | 'Imperial' = 'Metric',
  imperialMode: ImperialDisplayMode = 'Decimal'
): string {
  const safe = Number.isFinite(meters) ? meters : 0;
  if (unitSystem === 'Metric') {
    return `${safe.toFixed(2)} m`;
  }
  if (imperialMode === 'Decimal') {
    return `${(safe / 0.3048).toFixed(2)} ft`;
  }
  const sign = safe < 0 ? '-' : '';
  const absMeters = Math.abs(safe);
  if (imperialMode === 'FIS') {
    const totalSixths = Math.round((absMeters / 0.0254) * 6);
    const feet = Math.floor(totalSixths / 72);
    const rem = totalSixths % 72;
    const inches = Math.floor(rem / 6);
    const sixths = rem % 6;
    return sixths > 0 ? `${sign}${feet}' ${inches}" ${sixths}` : `${sign}${feet}' ${inches}"`;
  }
  // FIF: Feet-Inch-Fractions (nearest 1/16")
  const totalSixteenths = Math.round((absMeters / 0.0254) * 16);
  const feet = Math.floor(totalSixteenths / 192);
  const rem = totalSixteenths % 192;
  const inches = Math.floor(rem / 16);
  const sixteenths = rem % 16;
  if (sixteenths === 0) {
    return `${sign}${feet}'-${inches}"`;
  }
  const d = gcd(sixteenths, 16);
  return `${sign}${feet}'-${inches} ${sixteenths / d}/${16 / d}"`;
}

export function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

export function formatNumber(val: number, decimals = 2): string {
  return val.toLocaleString('en-AU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Evaluate composite Rate Sheet rows including Cubit's `%` (percentage markup/waste on prior row)
 * and `+` (batch divisor: divides component cost by quantity to yield unit rate).
 */
export function evaluateRateSheetRows(rateRows: RateRow[]): {
  computedRows: RateRow[];
  unitRate: number;
} {
  let runningTotal = 0;
  let prevTotal = 0;
  const computedRows = rateRows.map((rr) => {
    const conv = rr.conversion ?? 1;
    const fac = rr.factor ?? 1;
    const waste = 1 + (rr.wastagePct ?? 0) / 100;
    let total = 0;
    if (rr.fn === '%') {
      total = prevTotal * (rr.quantity / 100) * (rr.rate > 0 ? rr.rate : 1);
    } else if (rr.fn === '+') {
      const denom = rr.quantity !== 0 ? rr.quantity : 1;
      total = (rr.rate * conv * fac * waste) / denom;
    } else {
      total = rr.quantity * rr.rate * conv * fac * waste;
    }
    prevTotal = total;
    runningTotal += total;
    return { ...rr, total };
  });
  return { computedRows, unitRate: runningTotal };
}

export function computeRowRate(row: EstimateRow): number {
  if (row.rateRows && row.rateRows.length > 0) {
    return evaluateRateSheetRows(row.rateRows).unitRate;
  }
  return row.rate;
}

export function computeEffectiveQuantity(row: EstimateRow): number {
  const base = row.quantity || 0;
  const conv = row.conversion ?? 1;
  const num = row.numberMultiplier ?? 1;
  const fac = row.factor ?? 1;
  const waste = 1 + (row.wastagePct ?? 0) / 100;
  return base * conv * num * fac * waste;
}

export function computeItemCostTotal(row: EstimateRow): number {
  if (row.rowType !== 'Item') return 0;
  if (
    row.pricingMode === 'EXCL' ||
    row.excludeFromTotal ||
    row.resultType === 'Exclude from total' ||
    row.resultType === 'Note'
  ) {
    return 0;
  }
  const effectiveQty = computeEffectiveQuantity(row);
  const effectiveRate = computeRowRate(row);
  return effectiveQty * effectiveRate;
}

export function computeItemMarkupAmount(row: EstimateRow): number {
  const cost = computeItemCostTotal(row);
  return cost * ((row.markupPct || 0) / 100);
}

export function computeItemTotal(row: EstimateRow): number {
  return computeItemCostTotal(row) + computeItemMarkupAmount(row);
}

export function applyRounding(val: number, rounding?: CalcRow['rounding']): number {
  switch (rounding) {
    case 'Round':
      return Math.round(val);
    case 'Round Up':
      return Math.ceil(val);
    case 'Round Down':
      return Math.floor(val);
    case 'Near to 0.1':
      return Math.round(val * 10) / 10;
    case 'Roundup to 0.01':
      return Math.ceil(val * 100) / 100;
    default:
      return val;
  }
}

/**
 * Safe Cubit Formula Evaluator:
 * Supports `SUM(@Start, @End, Col)`, `TSUM(@Start, @End)`, `@RefCode.Col`, and arithmetic (`+ - * / ()`).
 */
export function evaluateCubitFormula(
  formula: string,
  rows: EstimateRow[],
  fallback = 0
): { value: number; error?: string } {
  const raw = formula.trim();
  if (!raw.startsWith('=')) {
    const num = Number(raw);
    return Number.isFinite(num) ? { value: num } : { value: fallback };
  }
  let expr = raw.slice(1).trim();

  const findIndexByRef = (refToken: string): number => {
    const clean = refToken.replace(/^@/, '').trim().toLowerCase();
    return rows.findIndex(
      (r) =>
        r.refCode?.toLowerCase() === clean ||
        r.code.toLowerCase() === clean ||
        r.id.toLowerCase() === clean
    );
  };

  const getFieldValue = (row: EstimateRow, colName: string): number => {
    const c = colName.trim().toLowerCase();
    if (c === 'qty' || c === 'quantity') return row.quantity;
    if (c === 'rate') return computeRowRate(row);
    if (c === 'factor') return row.factor;
    if (c === 'wastage') return row.wastagePct ?? 0;
    if (c === 'conversion') return row.conversion ?? 1;
    if (c === 'cost') return computeItemCostTotal(row);
    if (c === 'markup') return row.markupPct;
    return computeItemTotal(row);
  };

  // TSUM(@Start, @End)
  expr = expr.replace(/TSUM\(\s*(@?[A-Za-z0-9_-]+)\s*,\s*(@?[A-Za-z0-9_-]+)\s*\)/gi, (_, a, b) => {
    const i1 = findIndexByRef(a);
    const i2 = findIndexByRef(b);
    if (i1 < 0 || i2 < 0) return '0';
    const [lo, hi] = i1 <= i2 ? [i1, i2] : [i2, i1];
    let sum = 0;
    for (let i = lo; i <= hi; i++) {
      if (rows[i].rowType === 'Item') sum += computeItemTotal(rows[i]);
    }
    return String(sum);
  });

  // SUM(@Start, @End, Col)
  expr = expr.replace(
    /SUM\(\s*(@?[A-Za-z0-9_-]+)\s*,\s*(@?[A-Za-z0-9_-]+)\s*,\s*([A-Za-z]+)\s*\)/gi,
    (_, a, b, col) => {
      const i1 = findIndexByRef(a);
      const i2 = findIndexByRef(b);
      if (i1 < 0 || i2 < 0) return '0';
      const [lo, hi] = i1 <= i2 ? [i1, i2] : [i2, i1];
      let sum = 0;
      for (let i = lo; i <= hi; i++) {
        if (rows[i].rowType === 'Item') sum += getFieldValue(rows[i], col);
      }
      return String(sum);
    }
  );

  // @RefCode.Column
  expr = expr.replace(/@([A-Za-z0-9_-]+)\.([A-Za-z]+)/g, (_, ref, col) => {
    const idx = findIndexByRef(ref);
    if (idx < 0) return '0';
    return String(getFieldValue(rows[idx], col));
  });

  if (!/^[0-9+\-*/().\s]+$/.test(expr)) {
    return { value: fallback, error: 'Unsupported formula token' };
  }

  try {
    const fn = new Function(`"use strict"; return (${expr});`);
    const out = Number(fn());
    if (!Number.isFinite(out)) return { value: 0, error: 'Invalid result' };
    return { value: out };
  } catch {
    return { value: fallback, error: 'Syntax error' };
  }
}

export function computeTradeAndHeadingTotals(rows: EstimateRow[]): Record<string, number> {
  const totals: Record<string, number> = {};
  const childrenMap: Record<string, EstimateRow[]> = {};
  for (const r of rows) {
    const pid = r.parentId ?? '__root__';
    if (!childrenMap[pid]) childrenMap[pid] = [];
    childrenMap[pid].push(r);
  }

  function sumNode(row: EstimateRow): number {
    if (row.rowType === 'Item') {
      const t = computeItemTotal(row);
      totals[row.id] = t;
      return t;
    }
    const kids = childrenMap[row.id] ?? [];
    const s = kids.reduce((acc, k) => acc + sumNode(k), 0);
    totals[row.id] = s;
    return s;
  }

  for (const root of childrenMap['__root__'] ?? []) {
    sumNode(root);
  }
  return totals;
}

export function computeJobSummary(job: JobRecord): {
  subtotal: number;
  markupAmount: number;
  adjustmentAmount: number;
  taxAmount: number;
  grandTotal: number;
  costPerM2: number | null;
} {
  const activeOptionIds = new Set(
    (job.optionsPackages ?? []).filter((o) => !o.enabled).map((o) => o.id)
  );
  const rejectedVarIds = new Set(
    (job.variations ?? []).filter((v) => v.status === 'Rejected').map((v) => v.id)
  );

  const includedRows = job.rows.filter((r) => {
    if (r.optionId && activeOptionIds.has(r.optionId)) return false;
    if (r.variationId && rejectedVarIds.has(r.variationId)) return false;
    return true;
  });

  const subtotal = includedRows.reduce((acc, r) => acc + computeItemTotal(r), 0);
  const markupAmount = subtotal * (job.markupPct / 100);
  const adjustmentAmount =
    subtotal * ((job.adjustmentPct ?? 0) / 100) + (job.adjustmentFixed ?? 0);
  const taxableBase = includedRows.reduce((acc, r) => {
    if (r.excludeFromTax) return acc;
    return acc + computeItemTotal(r);
  }, 0);
  const preTaxRatio = subtotal > 0 ? (subtotal + markupAmount + adjustmentAmount) / subtotal : 1;
  const taxAmount = taxableBase * preTaxRatio * (job.salesTaxPct / 100);
  const grandTotal = subtotal + markupAmount + adjustmentAmount + taxAmount;
  const costPerM2 = job.gfaM2 && job.gfaM2 > 0 ? grandTotal / job.gfaM2 : null;
  return { subtotal, markupAmount, adjustmentAmount, taxAmount, grandTotal, costPerM2 };
}

export function computeShapeMetrics(
  shape: TakeoffShape,
  scaleRatio: number // pixels per meter
): { lengthM: number; areaM2: number; verticalAreaM2: number; openingDeductionM2: number } {
  const pts = shape.points;
  if (pts.length <= 1) {
    return { lengthM: 0, areaM2: 0, verticalAreaM2: 0, openingDeductionM2: 0 };
  }

  let pxLen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    pxLen += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  if (shape.closed && pts.length > 2) {
    pxLen += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  }
  const lengthM = pxLen / scaleRatio;

  let pxArea = 0;
  if (shape.closed && pts.length > 2) {
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      pxArea += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    pxArea = Math.abs(pxArea) / 2;
  }
  const flatAreaM2 = pxArea / (scaleRatio * scaleRatio);
  const pitchRad = ((shape.pitchDeg ?? 0) * Math.PI) / 180;
  const areaM2 = pitchRad > 0 ? flatAreaM2 / Math.cos(pitchRad) : flatAreaM2;

  const h1 = (shape.startHeightMm ?? shape.heightMm ?? 2700) / 1000;
  const h2 = (shape.endHeightMm ?? shape.heightMm ?? 2700) / 1000;
  const avgHeightM = (h1 + h2) / 2;
  const grossVert = lengthM * avgHeightM;
  const openingDeductionM2 = (shape.openings ?? []).reduce(
    (acc, op) => acc + (op.widthMm / 1000) * (op.heightMm / 1000),
    0
  );
  const verticalAreaM2 = Math.max(0, grossVert - openingDeductionM2);

  return { lengthM, areaM2, verticalAreaM2, openingDeductionM2 };
}

