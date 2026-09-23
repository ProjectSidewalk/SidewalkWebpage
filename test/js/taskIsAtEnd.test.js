/**
 * When a position counts as the end of a street (#5350, #4640).
 *
 * Every street-advance decision in Explore — finishing a task after a move, crediting a street whose imagery ran out
 * near its end — goes through `Task.isAtEnd`, so the two failure modes it has to hold apart are both about street
 * length. A fixed metre threshold on a short street is most of that street, and a route's last street ended before
 * the labeler reached its final pano (#4640); the fix, a threshold capped at a fraction of the street's length, then
 * made streets shorter than the pano spacing unfinishable from any pano that exists, and Explore cycled the panos
 * around the endpoint forever (#5350). The cases here are the measured session behind #5350 — the real 8.6 m
 * Richmond stub and the panos the labeler was bounced between — plus the #4640 shape, so a change to either rule
 * has to answer for the other.
 *
 * Real vendored turf and the real `util.math.haversine`: the question is about projection onto real geometry, and a
 * stub that got the geometry slightly wrong would pass for the wrong reason.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const readSrc = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

const TASK_SRC = readSrc('public/js/explore/src/task/Task.js');
const UTIL_MATH_SRC = readSrc('public/js/common/utilitiesMath.js');
// Loaded once, up front: the fixtures below are built while the suite is collected, before any beforeEach runs.
const turf = require(path.join(REPO_ROOT, 'public/vendor/turf/turf-7.4.0.min.js'));

// The thresholds NavigationService passes: the post-move end-of-street check and the imagery-ran-out credit.
const END_OF_STREET_M = 25;
const NEAR_END_NO_IMAGERY_M = 50;

/** A task over a street given as [lng, lat] coordinates, with the properties `Task.initialize` reads. */
function makeTask(coordinates, streetEdgeId = 1) {
    return new window.Task({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: { street_edge_id: streetEdgeId, task_start: '2026-09-15T18:44:14Z' },
    }, false);
}

/** A straight street `lengthM` long heading due east from `start`. */
function straightStreet(start, lengthM) {
    const end = turf.destination(turf.point(start), lengthM / 1000, 90).geometry.coordinates;
    return [start, end];
}

/**
 * A point along (or past) a straight street: `alongM` from its start in its direction, then `offsetM` to the left.
 * @returns {{lat: number, lng: number}}
 */
function positionOn(street, alongM, offsetM = 0) {
    const bearing = turf.bearing(turf.point(street[0]), turf.point(street.at(-1)));
    const onLine = turf.destination(turf.point(street[0]), alongM / 1000, bearing);
    const point = offsetM === 0 ? onLine : turf.destination(onLine, offsetM / 1000, bearing - 90);
    return { lat: point.geometry.coordinates[1], lng: point.geometry.coordinates[0] };
}

describe('Task.isAtEnd', () => {
    beforeEach(() => {
        window.turf = turf;
        window.svl = { CLOSE_TO_ROUTE_THRESHOLD: 0.05 };
        window.eval(UTIL_MATH_SRC);
        window.eval(`${TASK_SRC}; window.Task = Task;`);
    });

    describe('on the 8.6 m Richmond stub the labeler was bounced around (#5350)', () => {
        // richmond:9242 as the client received it, and where each move of the measured session landed. Every pano
        // is 10–18 m from the endpoint, so the capped threshold (0.4 × 8.6 = 3.45 m) alone can never be met.
        const STUB = [[-77.44193956, 37.54563697], [-77.4419307, 37.5456463], [-77.4418807, 37.545699]];
        const START_PANO = { lat: 37.545636, lng: -77.441974 }; // 632328559817823: 10.8 m from the endpoint.
        // 923613006534057: 14.7 m from the endpoint, projecting onto it.
        const PAST_THE_END = { lat: 37.545798, lng: -77.441992 };
        // Where the sweep took the labeler next: each a fresh pano near the start or off to the side.
        const BOUNCED_TO = [
            { lat: 37.545605, lng: -77.441933 }, // 1811945129546329
            { lat: 37.54567, lng: -77.44204 }, // 586029333899979
            { lat: 37.545614, lng: -77.441957 }, // 481526768215200
            { lat: 37.545689, lng: -77.442083 }, // 461093956975726
            { lat: 37.545538, lng: -77.441833 }, // 903489434538071
        ];

        it('is not the end at the pano the labeler started from', () => {
            expect(makeTask(STUB).isAtEnd(START_PANO, END_OF_STREET_M)).toBe(false);
        });

        it('is the end at the first pano past the endpoint, even though it is well outside the capped distance', () => {
            // The move that actually walked the street. Reading it as not-at-end is what left the labeler with nowhere
            // to go but the next-best pano in the search circle, whichever direction that lay.
            expect(makeTask(STUB).isAtEnd(PAST_THE_END, END_OF_STREET_M)).toBe(true);
        });

        it.each(BOUNCED_TO.map((pano, i) => [i + 2, pano]))(
            'is not the end at hop %i, which landed back near the start', (_hop, pano) => {
                expect(makeTask(STUB).isAtEnd(pano, END_OF_STREET_M)).toBe(false);
            },
        );

        it('counts a pano beside the endpoint on the other carriageway of a divided road', () => {
            // The stub exists because a divided road split the street; imagery on the far carriageway sits well off
            // the line but projects onto the endpoint.
            expect(makeTask(STUB).isAtEnd(positionOn(STUB, 7, 15), END_OF_STREET_M)).toBe(true);
        });

        it('does not count a pano 30 m beside the endpoint, even at the imagery-ran-out threshold', () => {
            // Within 50 m of the endpoint and projecting onto its last stretch, but too far off the line to have
            // counted as on this street at all — #hasAdvanced would not have moved the furthest point there either.
            expect(makeTask(STUB).isAtEnd(positionOn(STUB, 7, 30), NEAR_END_NO_IMAGERY_M)).toBe(false);
        });
    });

    describe('on a 30 m final route street (#4640)', () => {
        const STREET = straightStreet([-122.335, 47.61], 30);

        it('is not the end 8 m in, though that is within the uncapped 25 m of the endpoint', () => {
            // The #4640 shape: 22 m from the endpoint is most of this street, and the pano before the last one. Only
            // the projection clause rejects it — 8 m along is nowhere near the last 12 m.
            expect(makeTask(STREET).isAtEnd(positionOn(STREET, 8), END_OF_STREET_M)).toBe(false);
        });

        it('is not the end 20 m beside the 12 m mark, though that too is within 25 m of the endpoint', () => {
            expect(makeTask(STREET).isAtEnd(positionOn(STREET, 12, 20), END_OF_STREET_M)).toBe(false);
        });

        it('is the end 20 m in, within the capped distance', () => {
            expect(makeTask(STREET).isAtEnd(positionOn(STREET, 20), END_OF_STREET_M)).toBe(true);
        });

        it('is the end 10 m past the endpoint, inside the capped distance', () => {
            expect(makeTask(STREET).isAtEnd(positionOn(STREET, 40), END_OF_STREET_M)).toBe(true);
        });

        it('is the end 20 m past the endpoint, outside the capped distance but projecting onto it', () => {
            expect(makeTask(STREET).isAtEnd(positionOn(STREET, 50), END_OF_STREET_M)).toBe(true);
        });

        it('is not the end 40 m past it: that is the next street, not this one', () => {
            // Past the endpoint a position always projects onto it, so without the uncapped bound every pano down
            // the next street would count as the end of this one.
            expect(makeTask(STREET).isAtEnd(positionOn(STREET, 70), END_OF_STREET_M)).toBe(false);
        });

        it('at the imagery-ran-out threshold, is the end 20 m past the endpoint but not 30 m past it', () => {
            // 50 m reaches well down the next street; the on-street bound, not the threshold, is what stops it.
            expect(makeTask(STREET).isAtEnd(positionOn(STREET, 50), NEAR_END_NO_IMAGERY_M)).toBe(true);
            expect(makeTask(STREET).isAtEnd(positionOn(STREET, 60), NEAR_END_NO_IMAGERY_M)).toBe(false);
        });
    });

    describe('on a 100 m street, where the cap sits above the post-move threshold', () => {
        const STREET = straightStreet([-122.335, 47.61], 100);

        it('is the end 20 m short of the endpoint', () => {
            expect(makeTask(STREET).isAtEnd(positionOn(STREET, 80), END_OF_STREET_M)).toBe(true);
        });

        it('is not the end 30 m short of it', () => {
            expect(makeTask(STREET).isAtEnd(positionOn(STREET, 70), END_OF_STREET_M)).toBe(false);
        });

        it('is the end 20 m past it', () => {
            expect(makeTask(STREET).isAtEnd(positionOn(STREET, 120), END_OF_STREET_M)).toBe(true);
        });

        it('caps the more generous imagery-ran-out threshold at 40 m of the street', () => {
            expect(makeTask(STREET).isAtEnd(positionOn(STREET, 65), NEAR_END_NO_IMAGERY_M)).toBe(true);
            expect(makeTask(STREET).isAtEnd(positionOn(STREET, 55), NEAR_END_NO_IMAGERY_M)).toBe(false);
        });

        it('is not the end 45 m past the endpoint even at the imagery-ran-out threshold: off the street', () => {
            expect(makeTask(STREET).isAtEnd(positionOn(STREET, 145), NEAR_END_NO_IMAGERY_M)).toBe(false);
        });
    });
});
