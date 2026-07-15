/**
 * Tests for public/js/ps-map/nearbyLabelNavigator.js (`createNearbyLabelNavigator`).
 *
 * The navigator backs the LabelMap popup's prev/next arrows (#4572): "next" greedily walks to the nearest label
 * not yet visited this page-load, "prev" retraces the visited trail. These tests pin that contract:
 * nearest-first ordering, no revisits (touring outward instead of ping-ponging between two closest points),
 * trail-based prev with hasPrev gating, cross-type flattening, and the deep-link coordinate lookup.
 */

const fs = require('fs');
const path = require('path');

const NAV_PATH = path.resolve(__dirname, '..', '..', 'public/js/ps-map/nearbyLabelNavigator.js');

/** Loads the global script fresh and returns the factory. */
function loadFactory() {
    const src = fs.readFileSync(NAV_PATH, 'utf8');
    (0, eval)(src); // Declares createNearbyLabelNavigator on the global scope.
    return global.createNearbyLabelNavigator;
}

/** Builds a map-data stub in the shape addLabelsToMap produces: features bucketed by label type. */
function mapDataWith(featuresByType) {
    const sortedLabels = {};
    for (const [type, labels] of Object.entries(featuresByType)) {
        sortedLabels[type] = labels.map(([id, lng, lat]) => ({
            properties: { label_id: id },
            geometry: { coordinates: [lng, lat] },
        }));
    }
    return { sortedLabels };
}

describe('createNearbyLabelNavigator', () => {
    // Five labels along a street: 1..4 clustered 111m apart, 5 further down the block.
    const LINE = { CurbRamp: [[1, 0, 0], [2, 0.001, 0], [3, 0.002, 0], [4, 0.003, 0], [5, 0.01, 0]] };

    test('next() tours nearest-first without revisiting, and returns null when exhausted', () => {
        const nav = loadFactory()(mapDataWith(LINE));
        expect(nav.next(1)).toBe(2);
        expect(nav.next(2)).toBe(3);
        // 2 is nearer to 3 than 4 is, but it's visited — the walk continues outward instead of bouncing back.
        expect(nav.next(3)).toBe(4);
        expect(nav.next(4)).toBe(5);
        expect(nav.next(5)).toBeNull();
    });

    test('prev() retraces the trail and hasPrev() gates the button', () => {
        const nav = loadFactory()(mapDataWith(LINE));
        expect(nav.hasPrev(1)).toBe(false);
        nav.next(1); // -> 2
        nav.next(2); // -> 3
        expect(nav.hasPrev(3)).toBe(true);
        expect(nav.prev(3)).toBe(2);
        expect(nav.prev(2)).toBe(1);
        expect(nav.prev(1)).toBeNull();
    });

    test('next() after prev() returns to the abandoned label (back/forward semantics)', () => {
        const nav = loadFactory()(mapDataWith(LINE));
        nav.next(1); // -> 2
        nav.next(2); // -> 3
        nav.prev(3); // back to 2
        // A label only counts as visited once the user navigates *from* it, so forward re-reaches 3, then 4.
        expect(nav.next(2)).toBe(3);
        expect(nav.next(3)).toBe(4);
    });

    test('flattens labels across types and looks up coordinates for deep links', () => {
        const nav = loadFactory()(mapDataWith({
            CurbRamp: [[1, 0, 0]],
            Obstacle: [[2, 0.0005, 0]],
        }));
        expect(nav.next(1)).toBe(2);
        expect(nav.getCoords(2)).toEqual([0.0005, 0]);
        expect(nav.getCoords(999)).toBeNull();
    });

    test('next() from an unknown label is a harmless no-op', () => {
        const nav = loadFactory()(mapDataWith(LINE));
        expect(nav.next(999)).toBeNull();
    });
});
