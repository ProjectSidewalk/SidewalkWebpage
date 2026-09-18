/**
 * Tests for RouteGraph (public/js/route-builder/src/RouteGraph.js, issue #4579) — the client-side street graph
 * behind RouteBuilder's start/end auto-routing.
 *
 * RouteGraph is a top-level `class` declaration written for the Grunt-concatenation world, so (like ShareWidget's
 * test) we eval the source in the jsdom global scope. The class is pure geometry/graph logic with no DOM or map
 * dependencies, so the tests exercise it directly on a small synthetic street grid.
 *
 * The grid (region 1), ~111 m per 0.001°:
 *
 *   (0,0.001) C ──d── (0.001,0.001) D
 *       │                  │
 *       a                  c        e: D -> E(0.002, 0.001), region 2
 *       │                  │
 *   (0,0)   A ──b── (0.001,0)  B
 *
 * Street "b" runs A->B, "a" runs A->C, "c" runs B->D, "d" runs C->D, "e" runs D->E (a different region, which
 * routing is free to cross into).
 */

const fs = require('fs');
const path = require('path');

const GRAPH_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/route-builder/src/RouteGraph.js'), 'utf8'
);

/** Loads a fresh RouteGraph class into the jsdom global scope. */
function loadRouteGraph() {
    window.eval(`${GRAPH_SRC}\nwindow.RouteGraph = RouteGraph;`);
    return window.RouteGraph;
}

/** Builds a GeoJSON LineString street feature. */
function street(id, coords, regionId = 1) {
    return {
        type: 'Feature',
        properties: { street_edge_id: id, region_id: regionId },
        geometry: { type: 'LineString', coordinates: coords }
    };
}

const A = [0, 0];
const B = [0.001, 0];
const C = [0, 0.001];
const D = [0.001, 0.001];
const E = [0.002, 0.001];

/** The standard test grid; street b takes a long detour so the A->B shortest path is not always direct. */
function gridStreets() {
    return [
        street(10, [A, B]), // b: bottom edge (direct A->B, ~111 m)
        street(11, [A, C]), // a: left edge
        street(12, [B, D]), // c: right edge
        street(13, [C, D]), // d: top edge
        street(14, [D, E], 2) // e: crosses into another region
    ];
}

describe('RouteGraph', () => {
    let RouteGraph;

    beforeEach(() => {
        RouteGraph = loadRouteGraph();
    });

    describe('distance math', () => {
        it('measures ~111 m for 0.001 degrees of latitude', () => {
            const d = RouteGraph.distanceM([0, 0], [0, 0.001]);
            expect(d).toBeGreaterThan(105);
            expect(d).toBeLessThan(118);
        });

        it('sums segment lengths for a line', () => {
            const len = RouteGraph.lineLengthM([A, B, D]); // bottom then right edge
            expect(len).toBeGreaterThan(210);
            expect(len).toBeLessThan(236);
        });
    });

    describe('route()', () => {
        it('finds the direct one-street path', () => {
            const graph = new RouteGraph(gridStreets());
            const result = graph.route({ lng: A[0], lat: A[1] }, { lng: B[0], lat: B[1] });
            expect(result.error).toBeUndefined();
            expect(result.streets.map((s) => s.streetId)).toEqual([10]);
            expect(result.streets[0].flip).toBe(false); // b runs A->B, traversed A->B.
        });

        it('finds a multi-street shortest path and flags streets traversed against their coordinates', () => {
            // No direct bottom edge: A->B must go A -up-> C -across-> D -down-> B, entering c (B->D) at D.
            const streets = [street(11, [A, C]), street(13, [C, D]), street(12, [B, D])];
            const graph = new RouteGraph(streets);
            const result = graph.route({ lng: A[0], lat: A[1] }, { lng: B[0], lat: B[1] });
            expect(result.streets.map((s) => s.streetId)).toEqual([11, 13, 12]);
            expect(result.streets[0].flip).toBe(false); // a runs A->C, walked A->C.
            expect(result.streets[1].flip).toBe(false); // d runs C->D, walked C->D.
            expect(result.streets[2].flip).toBe(true); // c runs B->D but is walked D->B.
        });

        it('prefers the shorter of two alternatives', () => {
            // A->D: either a+d (left+top) or b+c (bottom+right) — same length; shrink a to force left+top.
            const shortC = [0, 0.0005];
            const streets = [
                street(11, [A, shortC]),
                street(13, [shortC, D]),
                street(10, [A, B]),
                street(12, [B, D])
            ];
            const graph = new RouteGraph(streets);
            const result = graph.route({ lng: A[0], lat: A[1] }, { lng: D[0], lat: D[1] });
            expect(result.streets.map((s) => s.streetId)).toEqual([11, 13]);
        });

        it('merges endpoints within the 10 m tolerance into one intersection', () => {
            // d' ends ~5 m away from D; the path A->a->d' must still connect through to c at D.
            const nearD = [0.001, 0.001 + 0.00004];
            const streets = [street(11, [A, C]), street(13, [C, nearD]), street(12, [B, D])];
            const graph = new RouteGraph(streets);
            const result = graph.route({ lng: A[0], lat: A[1] }, { lng: B[0], lat: B[1] });
            expect(result.error).toBeUndefined();
            expect(result.streets.map((s) => s.streetId)).toEqual([11, 13, 12]);
        });

        it('respects live geometry reversals when computing flip', () => {
            const b = street(10, [A, B]);
            const graph = new RouteGraph([b]);
            // The builder reverses geometry in place when a street's direction is flipped.
            b.geometry.coordinates.reverse();
            const result = graph.route({ lng: A[0], lat: A[1] }, { lng: B[0], lat: B[1] });
            // b now runs B->A, but we walk A->B, so it must be flipped.
            expect(result.streets).toEqual([{ streetId: 10, flip: true }]);
        });

        it('flips by which end is nearer, not by an absolute tolerance', () => {
            // A long crescent whose two ends come back within ~13 m of each other: both ends sit inside any
            // fixed tolerance of the entry point, so only "which is nearer" can tell the direction.
            const hookStart = [0.001, 0];
            const hookEnd = [0.00112, 0]; // ~13 m from hookStart.
            const crescent = street(30, [hookStart, [0.0015, 0.0008], [0.0008, 0.0008], hookEnd]);
            const feeder = street(31, [A, hookEnd]); // Arrives at the crescent's LAST coordinate.
            const graph = new RouteGraph([crescent, feeder]);

            const result = graph.route({ lng: A[0], lat: A[1] }, { lng: hookStart[0], lat: hookStart[1] });
            expect(result.error).toBeUndefined();
            // Entered at the crescent's last coordinate, so walking it means reversing its coordinate order.
            expect(result.streets).toContainEqual({ streetId: 30, flip: true });
        });

        it('routes across a region boundary', () => {
            const graph = new RouteGraph(gridStreets());
            const result = graph.route({ lng: A[0], lat: A[1] }, { lng: E[0], lat: E[1] });
            expect(result.error).toBeUndefined();
            // Street e is the only way to E, and it belongs to a different region than the rest of the grid.
            expect(result.streets[result.streets.length - 1]).toEqual({ streetId: 14, flip: false });
            expect(result.streets).toHaveLength(3);
        });

        it('stays shortest across a network large enough to reorder the open set many times', () => {
            // A 12 x 12 lattice of ~111 m blocks: the diagonal trip is 22 blocks however it is walked, so any
            // returned path longer than that means the priority queue handed back a non-minimal node.
            const n = 12;
            const streets = [];
            let id = 1000;
            for (let x = 0; x < n; x++) {
                for (let y = 0; y < n; y++) {
                    const here = [x * 0.001, y * 0.001];
                    if (x + 1 < n) streets.push(street(id++, [here, [(x + 1) * 0.001, y * 0.001]], x % 3));
                    if (y + 1 < n) streets.push(street(id++, [here, [x * 0.001, (y + 1) * 0.001]], y % 3));
                }
            }
            const graph = new RouteGraph(streets);
            const corner = (n - 1) * 0.001;
            const result = graph.route({ lng: 0, lat: 0 }, { lng: corner, lat: corner });
            expect(result.error).toBeUndefined();
            expect(result.streets).toHaveLength(2 * (n - 1));
        });

        it('returns no-path when the network is disconnected', () => {
            const far = [0.01, 0.01];
            const farther = [0.011, 0.01];
            const streets = [street(10, [A, B]), street(20, [far, farther])];
            const graph = new RouteGraph(streets);
            const result = graph.route({ lng: A[0], lat: A[1] }, { lng: far[0], lat: far[1] });
            expect(result.error).toBe('no-path');
        });

        it('returns no-path when start and end snap to the same intersection', () => {
            const graph = new RouteGraph(gridStreets());
            const result = graph.route({ lng: A[0], lat: A[1] }, { lng: A[0] + 0.00001, lat: A[1] });
            expect(result.error).toBe('no-path');
        });
    });

    describe('snapToStreet()', () => {
        it('snaps to the nearest street and its nearer endpoint', () => {
            const graph = new RouteGraph(gridStreets());
            // A point just below the bottom edge, nearer its B end.
            const snapped = graph.snapToStreet({ lng: 0.0009, lat: -0.0001 });
            expect(snapped.streetId).toBe(10);
            expect(snapped.distanceM).toBeLessThan(30);
        });
    });
});
