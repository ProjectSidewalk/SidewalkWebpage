/**
 * Tests for the AccessScore text helpers (frontend/js/access-score/AccessScoreText.js): `effectText`, the one
 * sentence for what a cluster does to the score, which the dot's tooltip, the cluster sheet, the panel's tiles and
 * pins and the crossing card all share (#5748). A block cluster's number is its street's, a corner cluster's its
 * crossing's, and a pooled type's clusters each carry "part of" the street's one term.
 */

import {stubI18next} from './support/accessScoreDockHarness.js';
import {loadModules} from './loader.js';

describe('AccessScoreText effectText', () => {
  let effectText;

  beforeAll(async () => {
    stubI18next();
    ({effectText} = await loadModules('frontend/js/access-score/AccessScoreText.js'));
  });

  test('says the street, the crossing or the pooled share, with the signed figure', () => {
    expect(effectText({label_type: 'CurbRamp', intersection_id: null}, {term: 0.75, pooled: false}))
      .toBe('cluster-effect type=curb-ramp value=+0.75');
    expect(effectText({label_type: 'CurbRamp', intersection_id: 7}, {term: -1, pooled: false}))
      .toBe('crossing-effect type=curb-ramp value=−1.00');
    expect(effectText({label_type: 'NoSidewalk'}, {term: -3, pooled: true, count: 5}))
      .toBe('cluster-effect type=no-sidewalk value=panel-effect-pooled value=−3.00');
    expect(effectText({label_type: 'Signal', intersection_id: null}, {term: 0, pooled: false}))
      .toBe('cluster-effect type=signal value=+0.00');
  });
});
