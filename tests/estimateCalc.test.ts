import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRounding,
  computeJobSummary,
  computeShapeMetrics,
  evaluateCubitFormula,
  evaluateRateSheetRows,
  formatDimension,
} from '../src/utils/estimateCalc.ts';
import type { EstimateRow, JobRecord, TakeoffShape } from '../src/types/cubit.ts';

function makeItem(partial: Partial<EstimateRow>): EstimateRow {
  return {
    id: partial.id ?? 'i1',
    parentId: partial.parentId ?? null,
    rowType: partial.rowType ?? 'Item',
    code: partial.code ?? 'C1',
    refCode: partial.refCode,
    description: partial.description ?? 'Item',
    resultType: partial.resultType ?? 'Area',
    quantity: partial.quantity ?? 10,
    unit: partial.unit ?? 'm2',
    conversion: partial.conversion ?? 1,
    numberMultiplier: partial.numberMultiplier ?? 1,
    factor: partial.factor ?? 1,
    wastagePct: partial.wastagePct ?? 0,
    rate: partial.rate ?? 100,
    markupPct: partial.markupPct ?? 0,
    pricingMode: partial.pricingMode ?? 'INCL',
    groupingCode: partial.groupingCode ?? '',
    calcRows: partial.calcRows ?? [],
    rateRows: partial.rateRows ?? [],
    optionId: partial.optionId,
    variationId: partial.variationId,
    excludeFromTax: partial.excludeFromTax,
    excludeFromTotal: partial.excludeFromTotal,
  };
}

test('evaluateRateSheetRows supports Cubit % and + batch divisor functions', () => {
  const { computedRows, unitRate } = evaluateRateSheetRows([
    { id: 'r1', description: 'Concrete Supply', unit: 'm3', quantity: 1, rate: 300, kind: 'Material' },
    { id: 'r2', description: 'Pump Surcharge', unit: '%', quantity: 10, rate: 1, fn: '%', kind: 'Plant' },
    { id: 'r3', description: 'Crew Batch Shift', unit: 'm3', quantity: 20, rate: 1000, fn: '+', kind: 'Labour' },
  ]);
  assert.equal(computedRows[0].total, 300);
  assert.equal(computedRows[1].total, 30); // 10% of 300
  assert.equal(computedRows[2].total, 50); // 1000 / 20
  assert.equal(unitRate, 380);
});

test('evaluateCubitFormula resolves SUM, TSUM, and @RefCode.Col expressions', () => {
  const rows: EstimateRow[] = [
    makeItem({ id: 'a', code: 'A1', refCode: 'SLAB', quantity: 100, rate: 50, markupPct: 10 }), // total = 5500
    makeItem({ id: 'b', code: 'B1', refCode: 'WALL', quantity: 40, rate: 75, markupPct: 0 }), // total = 3000
    makeItem({ id: 'c', code: 'C1', refCode: 'ROOF', quantity: 50, rate: 60, pricingMode: 'EXCL' }), // total = 0
  ];

  const tsum = evaluateCubitFormula('=TSUM(@SLAB, @WALL)', rows);
  assert.equal(tsum.error, undefined);
  assert.equal(tsum.value, 8500);

  const sumQty = evaluateCubitFormula('=SUM(@SLAB, @ROOF, Quantity)', rows);
  assert.equal(sumQty.value, 190);

  const refExpr = evaluateCubitFormula('=@SLAB.Rate * 2 + @WALL.Quantity', rows);
  assert.equal(refExpr.value, 140);
});

test('computeShapeMetrics computes pitched area & vertical area less openings', () => {
  // 100px = 4m at scaleRatio = 25 px/m -> 4m x 3m rectangle = 12 m2, perimeter = 14m
  const shape: TakeoffShape = {
    id: 's1',
    name: 'Wall Perimeter',
    planId: 'p1',
    itemId: 'i1',
    resultType: 'Vertical Area Less Openings',
    color: '#2563eb',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 75 },
      { x: 0, y: 75 },
    ],
    closed: true,
    heightMm: 3000,
    openings: [
      { id: 'op1', kind: 'Door', name: 'D01', widthMm: 1000, heightMm: 2000, offsetMm: 0 }, // 2 m2
      { id: 'op2', kind: 'Window', name: 'W01', widthMm: 2000, heightMm: 1000, offsetMm: 900 }, // 2 m2
    ],
  };

  const metrics = computeShapeMetrics(shape, 25);
  assert.equal(metrics.lengthM, 14);
  assert.equal(metrics.areaM2, 12);
  assert.equal(metrics.openingDeductionM2, 4);
  assert.equal(metrics.verticalAreaM2, 14 * 3 - 4); // 38 m2
});

test('computeJobSummary honors Options, Variations, Markup, GST, and GFA cost/m2', () => {
  const job: JobRecord = {
    id: 'j1',
    kind: 'Job',
    projectId: null,
    folderId: null,
    name: 'Test Job',
    description: '',
    builder: '',
    startDate: '2026-01-01',
    lastUpdated: '2026-01-01',
    useAsTemplate: false,
    status: 'Open',
    freezeStates: ['None'],
    siteAddress: { street: '', suburb: '', state: 'NSW', postcode: '', country: 'Australia' },
    companyId: null,
    contactId: null,
    accountManager: 'Estimator',
    markupPct: 10,
    salesTaxPct: 10,
    gfaM2: 100,
    optionsPackages: [
      { id: 'opt-1', name: 'Solar Array', enabled: false },
      { id: 'opt-2', name: 'Acoustic Upgrade', enabled: true },
    ],
    variations: [
      { id: 'var-1', code: 'VAR-01', title: 'Rejected Change', status: 'Rejected' },
      { id: 'var-2', code: 'VAR-02', title: 'Approved Change', status: 'Approved' },
    ],
    plans: [],
    shapes: [],
    rows: [
      makeItem({ id: 'base', quantity: 10, rate: 100 }), // 1000
      makeItem({ id: 'opt-off', quantity: 10, rate: 50, optionId: 'opt-1' }), // excluded (0)
      makeItem({ id: 'opt-on', quantity: 5, rate: 100, optionId: 'opt-2' }), // 500
      makeItem({ id: 'var-rej', quantity: 10, rate: 99, variationId: 'var-1' }), // excluded (0)
      makeItem({ id: 'var-app', quantity: 5, rate: 100, variationId: 'var-2' }), // 500
    ],
  };

  const sum = computeJobSummary(job);
  assert.equal(sum.subtotal, 2000);
  assert.equal(sum.markupAmount, 200);
  assert.equal(Math.round(sum.taxAmount), 220);
  assert.equal(Math.round(sum.grandTotal), 2420);
  assert.equal(Math.round((sum.costPerM2 ?? 0) * 100) / 100, 24.2);

  assert.equal(applyRounding(12.341, 'Roundup to 0.01'), 12.35);
  assert.equal(applyRounding(12.341, 'Round Up'), 13);
});

test('formatDimension supports Metric and Imperial Decimal / FIS / FIF display modes', () => {
  assert.equal(formatDimension(12.5, 'Metric', 'Decimal'), '12.50 m');
  assert.equal(formatDimension(12.5, 'Imperial', 'Decimal'), '41.01 ft');
  assert.equal(formatDimension(12.5, 'Imperial', 'FIS'), '41\' 0" 1');
  assert.equal(formatDimension(12.5, 'Imperial', 'FIF'), '41\'-0 1/8"');
  assert.equal(formatDimension(3.048, 'Imperial', 'FIS'), '10\' 0"');
  assert.equal(formatDimension(3.048, 'Imperial', 'FIF'), '10\'-0"');
  assert.equal(formatDimension(-1.524, 'Imperial', 'FIF'), '-5\'-0"');
});

