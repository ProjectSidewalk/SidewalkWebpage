/**
 * Tests for PanoImageAdjustments (frontend/js/common/PanoImageAdjustments.js), the display-only shadows / brightness /
 * contrast model behind the Image pill on Explore (#3136) and Validate (#5501).
 *
 * What is worth pinning: the filter string's composition (the gamma curve runs first, default terms are omitted, an
 * all-default state removes the inline filter entirely so the untouched pano never references the SVG), the gamma
 * mapping's endpoints, the SVG curve's sRGB interpolation flag (linearRGB would quietly lift far less), persistence
 * with field-by-field validation of whatever is in storage, and that a blocked storage degrades to "not remembered"
 * rather than throwing. The class is a top-level `class`, so the source is eval'd into the jsdom global scope with an
 * explicit `window.X = X` epilogue rather than require()-d, as with ShareWidget.
 */

const { loadModules } = require('./loadGlobalScript');


/** Loads the class fresh into the global scope. */
function loadClass() {
    Object.assign(window, loadModules('frontend/js/common/PanoImageAdjustments.js'));
    return window.PanoImageAdjustments;
}

/** A Storage stand-in backed by a plain object, so tests can plant arbitrary values and read back writes. */
function memoryStorage(seed = {}) {
    const data = { ...seed };
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        removeItem: (k) => { delete data[k]; },
        data,
    };
}

let PanoImageAdjustments;
let target;

beforeEach(() => {
    document.body.innerHTML = '<div id="pano"></div>';
    target = document.getElementById('pano');
    PanoImageAdjustments = loadClass();
});

describe('defaults', () => {
    test('starts at every control\'s default with no filter on the target', () => {
        const model = new PanoImageAdjustments(target, memoryStorage());
        expect(model.values()).toEqual({ shadows: 0, brightness: 100, contrast: 100 });
        expect(model.isDefault()).toBe(true);
        expect(target.style.filter).toBe('');
        expect(target.getAttribute('style')).toBeNull();
    });

    test('creates no SVG until Shadows is used', () => {
        const model = new PanoImageAdjustments(target, memoryStorage());
        model.set('brightness', 120);
        expect(document.getElementById(PanoImageAdjustments.FILTER_ID)).toBeNull();
        model.set('shadows', 10);
        expect(document.getElementById(PanoImageAdjustments.FILTER_ID)).not.toBeNull();
    });
});

describe('filter composition', () => {
    test('omits terms at their default and puts the curve first', () => {
        const f = PanoImageAdjustments.filterString;
        expect(f({ shadows: 0, brightness: 100, contrast: 100 })).toBe('');
        expect(f({ shadows: 0, brightness: 120, contrast: 100 })).toBe('brightness(1.2)');
        expect(f({ shadows: 0, brightness: 100, contrast: 80 })).toBe('contrast(0.8)');
        expect(f({ shadows: 50, brightness: 150, contrast: 110 }))
            .toBe('url(#ps-pano-tone-curve) brightness(1.5) contrast(1.1)');
    });

    test('writes the filter onto the target and removes it again at defaults', () => {
        const model = new PanoImageAdjustments(target, memoryStorage());
        model.set('contrast', 130);
        expect(target.style.filter).toBe('contrast(1.3)');
        model.set('contrast', 100);
        expect(target.style.filter).toBe('');
        expect(target.getAttribute('style')).toBe('');
    });
});

describe('several mounts', () => {
    let second;

    beforeEach(() => {
        second = document.createElement('div');
        document.body.appendChild(second);
    });

    test('writes the filter onto every mount and removes it from every mount at defaults', () => {
        const model = new PanoImageAdjustments([target, second], memoryStorage());
        model.set('brightness', 120);
        expect(target.style.filter).toBe('brightness(1.2)');
        expect(second.style.filter).toBe('brightness(1.2)');
        model.reset();
        expect(target.style.filter).toBe('');
        expect(second.style.filter).toBe('');
    });

    test('leaves no style attribute on any mount when constructed at defaults', () => {
        new PanoImageAdjustments([target, second], memoryStorage());
        expect(target.getAttribute('style')).toBeNull();
        expect(second.getAttribute('style')).toBeNull();
    });

    test('applies restored values to every mount on construction', () => {
        const storage = memoryStorage({
            panoImageAdjustments: JSON.stringify({ v: 1, shadows: 0, brightness: 100, contrast: 120 }),
        });
        new PanoImageAdjustments([target, second], storage);
        expect(target.style.filter).toBe('contrast(1.2)');
        expect(second.style.filter).toBe('contrast(1.2)');
    });

    test('creates a single SVG filter shared by every mount', () => {
        const model = new PanoImageAdjustments([target, second], memoryStorage());
        model.set('shadows', 50);
        expect(document.querySelectorAll('#ps-pano-tone-curve')).toHaveLength(1);
        expect(document.querySelectorAll('svg.ps-svg-defs')).toHaveLength(1);
        expect(target.style.filter).toBe('url(#ps-pano-tone-curve)');
        expect(second.style.filter).toBe('url(#ps-pano-tone-curve)');
    });

    test('skips a mount that is missing from the page', () => {
        const model = new PanoImageAdjustments([target, null], memoryStorage());
        expect(() => model.set('contrast', 80)).not.toThrow();
        expect(target.style.filter).toBe('contrast(0.8)');
    });

    test('refuses to construct with no mount at all', () => {
        expect(() => new PanoImageAdjustments([null, undefined], memoryStorage())).toThrow(/no pano mount/);
    });
});

describe('the Shadows curve', () => {
    test('maps 0 to the identity exponent and 100 to the floor', () => {
        expect(PanoImageAdjustments.gammaExponent(0)).toBe(1);
        expect(PanoImageAdjustments.gammaExponent(100)).toBeCloseTo(0.4, 10);
        expect(PanoImageAdjustments.gammaExponent(50)).toBeCloseTo(0.7, 10);
    });

    test('clamps out-of-range strengths before mapping', () => {
        expect(PanoImageAdjustments.gammaExponent(-20)).toBe(1);
        expect(PanoImageAdjustments.gammaExponent(500)).toBeCloseTo(0.4, 10);
    });

    test('builds one sRGB feComponentTransfer with a gamma func per color channel and updates its exponent', () => {
        const model = new PanoImageAdjustments(target, memoryStorage());
        model.set('shadows', 50);
        const filter = document.getElementById('ps-pano-tone-curve');
        expect(filter.getAttribute('color-interpolation-filters')).toBe('sRGB');
        expect(filter.closest('svg').getAttribute('aria-hidden')).toBe('true');
        const funcs = filter.querySelectorAll('feComponentTransfer > *');
        expect(Array.from(funcs, (n) => n.tagName)).toEqual(['feFuncR', 'feFuncG', 'feFuncB']);
        for (const fn of funcs) {
            expect(fn.getAttribute('type')).toBe('gamma');
            expect(Number(fn.getAttribute('exponent'))).toBeCloseTo(0.7, 10);
        }
        expect(filter.querySelector('feFuncA')).toBeNull();

        model.set('shadows', 100);
        expect(Number(funcs[0].getAttribute('exponent'))).toBeCloseTo(0.4, 10);
        expect(target.style.filter).toBe('url(#ps-pano-tone-curve)');
    });

    test('reuses an SVG filter another instance already put in the document', () => {
        const a = new PanoImageAdjustments(target, memoryStorage());
        a.set('shadows', 20);
        const other = document.createElement('div');
        document.body.appendChild(other);
        const b = new PanoImageAdjustments(other, memoryStorage());
        b.set('shadows', 40);
        expect(document.querySelectorAll('#ps-pano-tone-curve')).toHaveLength(1);
    });
});

describe('set / reset', () => {
    test('clamps to the control\'s range and reports what was stored', () => {
        const model = new PanoImageAdjustments(target, memoryStorage());
        expect(model.set('brightness', 999)).toBe(200);
        expect(model.set('brightness', -5)).toBe(50);
        expect(model.set('shadows', 33)).toBe(33);
        expect(model.get('shadows')).toBe(33);
    });

    test('snaps to the control\'s step', () => {
        const model = new PanoImageAdjustments(target, memoryStorage());
        expect(model.set('brightness', 103)).toBe(105);
        expect(model.set('contrast', 62)).toBe(60);
        expect(model.set('shadows', 33.4)).toBe(33);
    });

    test('falls back to the default for a non-numeric value', () => {
        const model = new PanoImageAdjustments(target, memoryStorage());
        model.set('contrast', 140);
        expect(model.set('contrast', 'abc')).toBe(100);
    });

    test('rejects an unknown control rather than storing it', () => {
        const model = new PanoImageAdjustments(target, memoryStorage());
        expect(() => model.set('saturation', 50)).toThrow(/unknown control/);
    });

    test('reset returns everything to default and clears the filter', () => {
        const model = new PanoImageAdjustments(target, memoryStorage());
        model.set('shadows', 60);
        model.set('brightness', 150);
        model.reset();
        expect(model.isDefault()).toBe(true);
        expect(target.style.filter).toBe('');
    });

    test('notifies listeners once per effective change, with a copy of the values', () => {
        const model = new PanoImageAdjustments(target, memoryStorage());
        const seen = [];
        model.onChange((v) => seen.push(v));
        model.set('shadows', 10);
        model.set('shadows', 10); // no-op
        model.reset();
        model.reset(); // already default: no-op
        expect(seen).toEqual([
            { shadows: 10, brightness: 100, contrast: 100 },
            { shadows: 0, brightness: 100, contrast: 100 },
        ]);
        seen[0].shadows = 99;
        expect(model.get('shadows')).toBe(0);
    });
});

describe('persistence', () => {
    test('writes a versioned record on every change', () => {
        const storage = memoryStorage();
        const model = new PanoImageAdjustments(target, storage);
        model.set('shadows', 25);
        expect(JSON.parse(storage.data.panoImageAdjustments))
            .toEqual({ v: 1, shadows: 25, brightness: 100, contrast: 100 });
    });

    test('restores stored values and applies them on construction', () => {
        const storage = memoryStorage({
            panoImageAdjustments: JSON.stringify({ v: 1, shadows: 40, brightness: 120, contrast: 90 }),
        });
        const model = new PanoImageAdjustments(target, storage);
        expect(model.values()).toEqual({ shadows: 40, brightness: 120, contrast: 90 });
        expect(target.style.filter).toBe('url(#ps-pano-tone-curve) brightness(1.2) contrast(0.9)');
    });

    test('takes only the stored fields that are finite numbers within range', () => {
        const storage = memoryStorage({
            panoImageAdjustments: JSON.stringify({ v: 1, shadows: 500, brightness: 'bright', contrast: 120, extra: 1 }),
        });
        const model = new PanoImageAdjustments(target, storage);
        expect(model.values()).toEqual({ shadows: 0, brightness: 100, contrast: 120 });
    });

    test('ignores a record from another format version rather than half-reading it', () => {
        const storage = memoryStorage({
            panoImageAdjustments: JSON.stringify({ v: 2, shadows: 40, brightness: 120, contrast: 120 }),
        });
        expect(new PanoImageAdjustments(target, storage).isDefault()).toBe(true);
        const unversioned = memoryStorage({ panoImageAdjustments: JSON.stringify({ shadows: 40 }) });
        expect(new PanoImageAdjustments(target, unversioned).isDefault()).toBe(true);
    });

    test('snaps a stored value that is off the slider step, so the slider and the pano agree', () => {
        const storage = memoryStorage({
            panoImageAdjustments: JSON.stringify({ v: 1, shadows: 0, brightness: 103, contrast: 100 }),
        });
        const model = new PanoImageAdjustments(target, storage);
        expect(model.get('brightness')).toBe(105);
        expect(target.style.filter).toBe('brightness(1.05)');
    });

    test.each([
        ['garbage', '{not json'],
        ['a bare number', '42'],
        ['null', 'null'],
        ['an array', '[1,2,3]'],
    ])('ignores %s in storage', (_label, raw) => {
        const model = new PanoImageAdjustments(target, memoryStorage({ panoImageAdjustments: raw }));
        expect(model.isDefault()).toBe(true);
    });

    test('keeps working when storage throws', () => {
        const broken = {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
        };
        const model = new PanoImageAdjustments(target, broken);
        expect(model.isDefault()).toBe(true);
        expect(() => model.set('brightness', 130)).not.toThrow();
        expect(target.style.filter).toBe('brightness(1.3)');
    });

    test('runs without any storage', () => {
        const model = new PanoImageAdjustments(target, null);
        model.set('shadows', 5);
        expect(model.currentFilter()).toBe('url(#ps-pano-tone-curve)');
    });
});
