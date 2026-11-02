/** Tests for frontend/js/report/stretchRollup.js, the JS twin of the server's roll-ups (see ReportRulesSpec). */

import { describe, expect, test } from 'vitest';
import { rankWays, regionScore, stretchScore } from '../../frontend/js/report/stretchRollup.js';

describe('stretchScore', () => {
  test('has no score with no edges', () => expect(stretchScore([])).toBeNull());

  test('weights by length', () => {
    expect(stretchScore([{ score: 0.2, length: 300 }, { score: 0.6, length: 100 }])).toBeCloseTo(0.3);
  });

  test('falls back to a plain mean where every edge is zero-length', () => {
    expect(stretchScore([{ score: 0.2, length: 0 }, { score: 0.6, length: 0 }])).toBeCloseTo(0.4);
  });

  test('treats a negative length as none, as the server does', () => {
    expect(stretchScore([{ score: 0.2, length: -5 }, { score: 0.6, length: 10 }])).toBeCloseTo(0.6);
  });
});

describe('regionScore', () => {
  test('weights by length', () => {
    expect(regionScore([{ score: 0.2, length: 300 }, { score: 0.6, length: 100 }])).toBeCloseTo(0.3);
  });

  test('has no score with no length', () => {
    expect(regionScore([])).toBeNull();
    expect(regionScore([{ score: 0.2, length: 0 }])).toBeNull();
  });
});

describe('rankWays', () => {
  test('puts the lowest first, keeps ties in place, and sends the unscored last', () => {
    expect(rankWays([
      { wayId: 1, score: null }, { wayId: 2, score: 0.5 }, { wayId: 3, score: 0.2 }, { wayId: 4, score: 0.5 },
    ])).toEqual([3, 2, 4, 1]);
  });
});
