/**
 * The rating helpers on util.misc (frontend/js/common/utilitiesSidewalk.js), built from the label-type table the
 * server stamps on every page: which scale a type is rated on, and the colours each rating level gets. Curb ramps are
 * rated for quality (1 is good, so green) and obstacles for severity (1 is a mild problem, so yellow); mixing the two
 * up tells a mapper a problem needs no attention. (#5840)
 */

import { loadModules } from './loader.js';

const { util } = await loadModules('frontend/js/common/utilitiesSidewalk.js', 'frontend/js/common/utilities.js');

describe('rating scales', () => {
  test('reads each type\'s scale off the stamped table', () => {
    expect(util.misc.getRatingScale('CurbRamp')).toBe('quality');
    expect(util.misc.getRatingScale('Obstacle')).toBe('severity');
    expect(util.misc.getRatingScale('Signal')).toBe('unrated');
    expect(util.misc.labelTypeHasSeverity('Obstacle')).toBe(true);
    expect(util.misc.labelTypeHasSeverity('NoSidewalk')).toBe(false);
  });

  // A label of a type this page's table doesn't know (an old tab after a type is added, say) offers no rating rather
  // than a scale nobody can name.
  test('treats a type the table doesn\'t know as unrated', () => {
    expect(util.misc.getRatingScale('Bollard')).toBe('unrated');
    expect(util.misc.labelTypeHasSeverity('Bollard')).toBe(false);
  });
});

describe('util.misc.getSeverityLevelColors', () => {
  test('colours a good curb ramp green, and a mild obstacle yellow', () => {
    expect(util.misc.getSeverityLevelColors(1, 'CurbRamp'))
      .toEqual({ face: 'var(--color-jade-400)', edge: 'var(--color-jade-700)', wash: 'var(--color-jade-200)' });
    expect(util.misc.getSeverityLevelColors(1, 'Obstacle')).toEqual({
      face: 'var(--color-banana-400)', edge: 'var(--color-banana-900)', wash: 'var(--color-banana-200)',
    });
  });

  // Old data carries 0 for "not applicable", which gets no colour of its own.
  test('has no colours for a level outside 1-3', () => {
    expect(util.misc.getSeverityLevelColors(0, 'Obstacle')).toBeNull();
  });
});
