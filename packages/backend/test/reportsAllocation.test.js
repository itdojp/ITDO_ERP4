import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveProfitAllocationMethod,
  resolveProfitAllocationShare,
} from '../dist/services/reports.js';

test('resolveProfitAllocationMethod: labor_cost is preferred when labor cost exists', () => {
  assert.equal(resolveProfitAllocationMethod(1200, 300), 'labor_cost');
});

test('resolveProfitAllocationMethod: minutes is used when labor cost is zero', () => {
  assert.equal(resolveProfitAllocationMethod(0, 300), 'minutes');
});

test('resolveProfitAllocationMethod: none when no positive denominator exists', () => {
  assert.equal(resolveProfitAllocationMethod(0, 0), 'none');
  assert.equal(resolveProfitAllocationMethod(-1, -1), 'none');
});

test('resolveProfitAllocationShare: labor_cost uses labor ratio', () => {
  const share = resolveProfitAllocationShare({
    allocationMethod: 'labor_cost',
    userLaborCost: 250,
    totalLaborCost: 1000,
    userMinutes: 0,
    totalMinutes: 0,
  });
  assert.equal(share, 0.25);
});

test('resolveProfitAllocationShare: minutes uses minutes ratio', () => {
  const share = resolveProfitAllocationShare({
    allocationMethod: 'minutes',
    userLaborCost: 0,
    totalLaborCost: 0,
    userMinutes: 90,
    totalMinutes: 300,
  });
  assert.equal(share, 0.3);
});

test('resolveProfitAllocationShare: returns zero when denominator is invalid', () => {
  assert.equal(
    resolveProfitAllocationShare({
      allocationMethod: 'labor_cost',
      userLaborCost: 100,
      totalLaborCost: 0,
      userMinutes: 0,
      totalMinutes: 0,
    }),
    0,
  );
  assert.equal(
    resolveProfitAllocationShare({
      allocationMethod: 'minutes',
      userLaborCost: 0,
      totalLaborCost: 0,
      userMinutes: 50,
      totalMinutes: Number.NaN,
    }),
    0,
  );
  assert.equal(
    resolveProfitAllocationShare({
      allocationMethod: 'none',
      userLaborCost: 100,
      totalLaborCost: 1000,
      userMinutes: 50,
      totalMinutes: 500,
    }),
    0,
  );
});
