/**
 * Tests for the Imagery page's tier classifier (#4908).
 *
 * `tierFor` is the single place a street's audit counts become the label an admin reads off the map, the legend, both
 * tables, and the region roll-ups — so a boundary it gets wrong is wrong everywhere at once, consistently, which is
 * exactly the kind of error nothing else catches. The boundaries are pinned here rather than inferred from the
 * rendered page.
 *
 * Runs under jsdom (jest.config.js). StreetPriorityTiers is a bare top-level class in a concatenated bundle, so it is
 * eval'd into global scope rather than required.
 */

const fs = require('fs');
const path = require('path');

const MAP_PATH = path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard/StreetPriorityMap.js');

/** Load StreetPriorityMap.js and return its tier class. */
function loadTiers() {
  const src = fs.readFileSync(MAP_PATH, 'utf8');
  return (0, eval)(`${src}\nStreetPriorityTiers;`);
}

const StreetPriorityTiers = loadTiers();

/** A street row as /adminapi/streetPriority returns it, never audited unless overridden. */
const street = (overrides = {}) => ({ fresh_good_count: 0, outdated_good_count: 0, bad_count: 0, ...overrides });

describe('StreetPriorityTiers.tierFor', () => {
  test('classifies a street with no counted audit as never audited', () => {
    expect(StreetPriorityTiers.tierFor(street())).toBe('unaudited');
  });

  test('does not let low-quality audits alone lift a street out of the unaudited tier', () => {
    // Audits by excluded or flagged users carry a quarter weight in the priority formula but never make a street
    // "audited" — reading them as coverage is how a street nobody trustworthy has walked drops off the queue.
    expect(StreetPriorityTiers.tierFor(street({ bad_count: 9 }))).toBe('unaudited');
  });

  test('classifies a street whose only counted audits are on replaced imagery as needing a re-audit', () => {
    expect(StreetPriorityTiers.tierFor(street({ outdated_good_count: 1 }))).toBe('reaudit');
    expect(StreetPriorityTiers.tierFor(street({ outdated_good_count: 4, bad_count: 2 }))).toBe('reaudit');
  });

  test('steps from one current audit to two, which is where the queue stops caring', () => {
    expect(StreetPriorityTiers.tierFor(street({ fresh_good_count: 1 }))).toBe('audited_once');
    expect(StreetPriorityTiers.tierFor(street({ fresh_good_count: 2 }))).toBe('audited_multi');
    expect(StreetPriorityTiers.tierFor(street({ fresh_good_count: 17 }))).toBe('audited_multi');
  });

  test('lets a current audit outrank an outdated one on the same street', () => {
    // A street with both has been walked since its imagery changed, so it is not waiting on anything.
    expect(StreetPriorityTiers.tierFor(street({ fresh_good_count: 1, outdated_good_count: 3 }))).toBe('audited_once');
  });

  test('returns a tier key that every tier-keyed consumer knows', () => {
    const keys = StreetPriorityTiers.TIERS.map((tier) => tier.key);
    const cases = [street(), street({ bad_count: 1 }), street({ outdated_good_count: 1 }),
      street({ fresh_good_count: 1 }), street({ fresh_good_count: 5 })];
    // The page indexes per-region counters by this return value (`row[tier] += 1`), so a key outside TIERS would
    // silently produce NaN counts in the region table rather than an error.
    cases.forEach((row) => expect(keys).toContain(StreetPriorityTiers.tierFor(row)));
  });
});

describe('StreetPriorityTiers palette', () => {
  test('gives every tier a distinct color, so no two tiers read as one on the map', () => {
    const colors = StreetPriorityTiers.TIERS.map((tier) => tier.color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(colors).not.toContain(StreetPriorityTiers.FALLBACK);
    expect(colors).not.toContain(StreetPriorityTiers.SELECTED);
  });

  test('keeps an unrecognized tier visible rather than dropping it', () => {
    expect(StreetPriorityTiers.colorFor('no-such-tier')).toBe(StreetPriorityTiers.FALLBACK);
    expect(StreetPriorityTiers.labelFor('no-such-tier')).toBe('no-such-tier');
  });

  test('resolves each known tier to its own color and label', () => {
    StreetPriorityTiers.TIERS.forEach((tier) => {
      expect(StreetPriorityTiers.colorFor(tier.key)).toBe(tier.color);
      expect(StreetPriorityTiers.labelFor(tier.key)).toBe(tier.label);
    });
  });
});

describe('StreetPriorityTiers.mapboxExpression', () => {
  test('pairs every tier with its color and ends in the fallback', () => {
    const expr = StreetPriorityTiers.mapboxExpression();
    expect(expr.slice(0, 2)).toEqual(['match', ['get', 'priority_tier']]);
    const pairs = expr.slice(2, -1);
    expect(pairs).toHaveLength(StreetPriorityTiers.TIERS.length * 2);
    StreetPriorityTiers.TIERS.forEach((tier, i) => {
      expect(pairs[i * 2]).toBe(tier.key);
      expect(pairs[i * 2 + 1]).toBe(tier.color);
    });
    // A `match` expression without a trailing default throws at style-load time, taking the whole map with it.
    expect(expr[expr.length - 1]).toBe(StreetPriorityTiers.FALLBACK);
  });
});

describe('StreetPriorityTiers.publishCssVars', () => {
  test('publishes each tier color under a kebab-case custom property the stylesheet can read', () => {
    StreetPriorityTiers.publishCssVars();
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--priority-unaudited')).toBe(StreetPriorityTiers.colorFor('unaudited'));
    // The tier keys are snake_case because they come from the payload's counts; the custom properties are not.
    expect(root.style.getPropertyValue('--priority-audited-once')).toBe(StreetPriorityTiers.colorFor('audited_once'));
    expect(root.style.getPropertyValue('--priority-audited_once')).toBe('');
  });
});
