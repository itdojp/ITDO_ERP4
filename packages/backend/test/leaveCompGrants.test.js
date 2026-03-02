import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LeaveCompBalanceShortageError,
  computeCompLeaveBalance,
  consumeCompLeaveForRequest,
} from '../dist/services/leaveCompGrants.js';

test('computeCompLeaveBalance: subtracts pending reservations and requested minutes', async () => {
  const client = {
    leaveCompGrant: {
      updateMany: async () => ({ count: 0 }),
      findMany: async () => [
        { grantedMinutes: 120, remainingMinutes: 120 },
        { grantedMinutes: 60, remainingMinutes: 60 },
      ],
    },
    leaveRequest: {
      findMany: async () => [
        {
          id: 'pending-1',
          startDate: new Date('2026-03-11T00:00:00.000Z'),
          endDate: new Date('2026-03-11T00:00:00.000Z'),
          minutes: 30,
        },
        {
          id: 'pending-before',
          startDate: new Date('2026-03-01T00:00:00.000Z'),
          endDate: new Date('2026-03-01T00:00:00.000Z'),
          minutes: 20,
        },
      ],
    },
  };

  const balance = await computeCompLeaveBalance({
    userId: 'user-1',
    leaveType: 'compensatory',
    additionalRequestedMinutes: 90,
    asOfDate: new Date('2026-03-10T00:00:00.000Z'),
    client,
  });

  assert.equal(balance.totalGrantedMinutes, 180);
  assert.equal(balance.remainingMinutes, 180);
  assert.equal(balance.reservedPendingMinutes, 30);
  assert.equal(balance.requestedMinutes, 90);
  assert.equal(balance.projectedRemainingMinutes, 60);
  assert.equal(balance.shortage, false);
});

test('consumeCompLeaveForRequest: allocates grants by earliest expiration', async () => {
  const grants = [
    {
      id: 'g1',
      remainingMinutes: 60,
      status: 'active',
      expiresAt: new Date('2026-03-15T00:00:00.000Z'),
      sourceDate: new Date('2026-03-01T00:00:00.000Z'),
      createdAt: new Date('2026-03-01T01:00:00.000Z'),
    },
    {
      id: 'g2',
      remainingMinutes: 90,
      status: 'active',
      expiresAt: new Date('2026-03-20T00:00:00.000Z'),
      sourceDate: new Date('2026-03-02T00:00:00.000Z'),
      createdAt: new Date('2026-03-02T01:00:00.000Z'),
    },
  ];
  const consumptions = [];

  const client = {
    leaveCompGrant: {
      updateMany: async () => ({ count: 0 }),
      findMany: async () => grants,
      findUnique: async ({ where }) => {
        const row = grants.find((grant) => grant.id === where.id);
        return row
          ? { remainingMinutes: row.remainingMinutes, status: row.status }
          : null;
      },
      update: async ({ where, data }) => {
        const row = grants.find((grant) => grant.id === where.id);
        if (!row) throw new Error('grant not found');
        row.remainingMinutes = data.remainingMinutes;
        row.status = data.status;
        row.consumedAt = data.consumedAt;
        return row;
      },
    },
    leaveCompConsumption: {
      findMany: async () => [],
      create: async ({ data }) => {
        consumptions.push(data);
        return data;
      },
    },
    leaveRequest: {
      findMany: async () => [],
    },
  };

  const result = await consumeCompLeaveForRequest({
    leaveRequestId: 'leave-1',
    userId: 'user-1',
    leaveType: 'compensatory',
    requestedMinutes: 100,
    leaveStartDate: new Date('2026-03-10T00:00:00.000Z'),
    actorId: 'approver-1',
    client,
  });

  assert.equal(result.consumedMinutes, 100);
  assert.deepEqual(result.items, [
    { grantId: 'g1', consumedMinutes: 60 },
    { grantId: 'g2', consumedMinutes: 40 },
  ]);
  assert.equal(grants[0].remainingMinutes, 0);
  assert.equal(grants[0].status, 'consumed');
  assert.equal(grants[1].remainingMinutes, 50);
  assert.equal(grants[1].status, 'active');
  assert.equal(consumptions.length, 2);
});

test('consumeCompLeaveForRequest: throws shortage error when grants are insufficient', async () => {
  const client = {
    leaveCompGrant: {
      updateMany: async () => ({ count: 0 }),
      findMany: async () => [
        {
          id: 'g1',
          remainingMinutes: 30,
          status: 'active',
          expiresAt: new Date('2026-03-15T00:00:00.000Z'),
          sourceDate: new Date('2026-03-01T00:00:00.000Z'),
          createdAt: new Date('2026-03-01T01:00:00.000Z'),
          grantedMinutes: 30,
        },
      ],
      findUnique: async ({ where }) =>
        where.id === 'g1' ? { remainingMinutes: 30, status: 'active' } : null,
      update: async () => {
        throw new Error('should not update on shortage');
      },
    },
    leaveCompConsumption: {
      findMany: async () => [],
      create: async () => {
        throw new Error('should not create on shortage');
      },
    },
    leaveRequest: {
      findMany: async () => [],
    },
  };

  await assert.rejects(
    () =>
      consumeCompLeaveForRequest({
        leaveRequestId: 'leave-shortage',
        userId: 'user-1',
        leaveType: 'compensatory',
        requestedMinutes: 90,
        leaveStartDate: new Date('2026-03-10T00:00:00.000Z'),
        actorId: 'approver-1',
        client,
      }),
    (error) => {
      assert.equal(error instanceof LeaveCompBalanceShortageError, true);
      assert.equal(error.details.leaveType, 'compensatory');
      assert.equal(error.details.shortageMinutes > 0, true);
      return true;
    },
  );
});
