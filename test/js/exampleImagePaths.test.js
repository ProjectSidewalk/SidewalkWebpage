/**
 * Tests for the example-imagery helpers in public/js/common/utilitiesSidewalk.js (#4723).
 *
 * These functions are the single definition of two things every consumer depends on: which URL an example image lives
 * at, and how an annotation mark is drawn. Both fail quietly — a wrong slug shows an empty tooltip, a malformed mark
 * shows nothing — so nothing in the running app would report a regression. tools/check-example-images.mjs loads this
 * same file and calls these same functions, so a break here also blinds the checker meant to catch it.
 *
 * Runs under jsdom (set in jest.config.js via testEnvironment).
 */

const { loadGlobalScript } = require('./loadGlobalScript');

const MODULE_PATH = 'public/js/common/utilitiesSidewalk.js';
const BASE = '/assets/images/examples';

beforeAll(() => {
  // getLabelDescriptions() reaches for i18next at call time; none of these functions do, but the file is loaded whole.
  global.i18next = { t: (key) => key };
  loadGlobalScript(MODULE_PATH);
});

beforeEach(() => {
  delete window.countryId;
});

describe('tagSlug', () => {
  // Tag strings aren't filename-safe as they stand: 14 contain "/", 6 contain ":", and one a comma.
  test.each([
    ['narrow', 'narrow'],
    ['trash/recycling can', 'trash-recycling-can'],
    ['debris / pooled water', 'debris-pooled-water'],
    ['cycle lane: debris / pooled water', 'cycle-lane-debris-pooled-water'],
    ['yellow box, accessibility features not visible', 'yellow-box-accessibility-features-not-visible'],
    ['APS', 'aps'],
  ])('%s -> %s', (tag, expected) => {
    expect(util.misc.tagSlug(tag)).toBe(expected);
  });

  test('collapses runs and trims, so no slug can start, end, or double up on a dash', () => {
    expect(util.misc.tagSlug('  a // b  ')).toBe('a-b');
  });
});

describe('getTagExampleImageUrls', () => {
  test('a country with no overrides gets one URL, so no request can 404 by design', () => {
    window.countryId = 'usa';
    expect(util.misc.getTagExampleImageUrls('SurfaceProblem', 'height difference'))
      .toEqual([`${BASE}/SurfaceProblem/tag-height-difference.png`]);
  });

  test('an override country gets its own photo first and the shared default second', () => {
    window.countryId = 'india';
    expect(util.misc.getTagExampleImageUrls('Obstacle', 'pole'))
      .toEqual([`${BASE}/india/Obstacle/tag-pole.png`, `${BASE}/Obstacle/tag-pole.png`]);
  });

  test('scopes by label type, since a tag name can belong to two types and mean different things', () => {
    const [surface] = util.misc.getTagExampleImageUrls('SurfaceProblem', 'height difference');
    const [obstacle] = util.misc.getTagExampleImageUrls('Obstacle', 'height difference');
    expect(surface).not.toBe(obstacle);
  });
});

describe('getSeverityExampleImageUrl / getValidateReasonExampleImageUrl', () => {
  test('severity', () => {
    expect(util.misc.getSeverityExampleImageUrl('CurbRamp', 2)).toBe(`${BASE}/CurbRamp/severity-2.png`);
  });

  test('a per-type reason', () => {
    expect(util.misc.getValidateReasonExampleImageUrl('disagree', 1, 'Signal')).toBe(`${BASE}/Signal/disagree-1.png`);
  });

  test('a reason shared by every label type resolves to _common', () => {
    expect(util.misc.getValidateReasonExampleImageUrl('unsure', 2, null)).toBe(`${BASE}/_common/unsure-2.png`);
  });
});

describe('exampleAnnotationKey', () => {
  test('drops the extension, so keys survive the switch from PNG to WebP', () => {
    expect(util.misc.exampleAnnotationKey(`${BASE}/Signal/tag-aps.webp`)).toBe('Signal/tag-aps');
  });

  test('an override folds onto its default\'s key: it replaces the photo, not what is depicted', () => {
    expect(util.misc.exampleAnnotationKey(`${BASE}/india/Obstacle/tag-pole.png`)).toBe('Obstacle/tag-pole');
  });
});

describe('renderExampleMarks', () => {
  let svg;

  beforeEach(() => {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  });

  test('sizes the viewBox to the image, so a mark on a 5:4 photo is not skewed by a 3:2 assumption', () => {
    util.misc.renderExampleMarks(svg, [], { aspectRatio: 1.25 });
    expect(svg.getAttribute('viewBox')).toBe('0 0 125 100');
    util.misc.renderExampleMarks(svg, [], { aspectRatio: 1.5 });
    expect(svg.getAttribute('viewBox')).toBe('0 0 150 100');
  });

  test('marks are decorative: the surrounding text already names what is depicted', () => {
    util.misc.renderExampleMarks(svg, [{ type: 'arrow', from: [0, 0], to: [1, 1] }], { aspectRatio: 1.5 });
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  test('an arrow is one closed polygon with a white fill inside a dark outline', () => {
    util.misc.renderExampleMarks(svg, [{ type: 'arrow', from: [0.2, 0.9], to: [0.6, 0.4] }], { aspectRatio: 1.5 });
    expect(svg.children).toHaveLength(1);
    expect(svg.children[0].tagName).toBe('polygon');
    expect(svg.children[0].getAttribute('fill')).toBe('#fff');
    expect(svg.children[0].getAttribute('stroke')).toBe('#1b1e21');
  });

  test('the arrow tip lands on the point that was clicked', () => {
    util.misc.renderExampleMarks(svg, [{ type: 'arrow', from: [0.2, 0.9], to: [0.6, 0.4] }], { aspectRatio: 1.5 });
    // Fourth vertex is the tip; the viewBox is 150x100, so [0.6, 0.4] maps to [90, 40].
    const [x, y] = svg.children[0].getAttribute('points').split(' ')[3].split(',').map(Number);
    expect(x).toBeCloseTo(90, 5);
    expect(y).toBeCloseTo(40, 5);
  });

  test('a marker draws the label type\'s canonical SVG icon, not a raster', () => {
    util.misc.renderExampleMarks(svg, [{ type: 'marker', at: [0.5, 0.5] }], { labelType: 'CurbRamp' });
    expect(svg.children[0].getAttribute('href')).toBe('/assets/images/icons/label_type_icons/CurbRamp_small.svg');
  });

  test('a marker can name its own label type, for an example that points at another type', () => {
    util.misc.renderExampleMarks(svg, [{ type: 'marker', at: [0.5, 0.5], labelType: 'Signal' }], {});
    expect(svg.children[0].getAttribute('href')).toContain('Signal_small.svg');
  });

  test('drops malformed marks instead of throwing, so one bad entry costs its own mark and no more', () => {
    const marks = [
      null,
      { type: 'blob', at: [0.5, 0.5] },
      { type: 'arrow', from: [0.1, 0.1] },
      { type: 'marker' },
      { type: 'arrow', from: [0.1, 0.1], to: [0.9, 0.9] },
    ];
    expect(() => util.misc.renderExampleMarks(svg, marks, { aspectRatio: 1.5 })).not.toThrow();
    expect(svg.children).toHaveLength(1);
  });

  test('replaces the previous marks rather than accumulating them across renders', () => {
    const mark = { type: 'arrow', from: [0.1, 0.1], to: [0.9, 0.9] };
    util.misc.renderExampleMarks(svg, [mark, mark], { aspectRatio: 1.5 });
    util.misc.renderExampleMarks(svg, [mark], { aspectRatio: 1.5 });
    expect(svg.children).toHaveLength(1);
  });
});
