import assert from 'node:assert/strict';
import test from 'node:test';
import { getRouteRateLimitOptions } from '../dist/services/rateLimitOverrides.js';

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('getRouteRateLimitOptions: reads route-specific overrides', () => {
  withEnv(
    {
      RATE_LIMIT_SAMPLE_MAX: '45',
      RATE_LIMIT_SAMPLE_WINDOW: '2 minutes',
    },
    () => {
      const options = getRouteRateLimitOptions('RATE_LIMIT_SAMPLE', {
        max: 10,
        timeWindow: '1 minute',
      });
      assert.equal(options.max, 45);
      assert.equal(options.timeWindow, '2 minutes');
    },
  );
});

test('getRouteRateLimitOptions: invalid values fallback to defaults', () => {
  withEnv(
    {
      RATE_LIMIT_SAMPLE_MAX: '0',
      RATE_LIMIT_SAMPLE_WINDOW: '   ',
    },
    () => {
      const options = getRouteRateLimitOptions('RATE_LIMIT_SAMPLE', {
        max: 10,
        timeWindow: '1 minute',
      });
      assert.equal(options.max, 10);
      assert.equal(options.timeWindow, '1 minute');
    },
  );
});
