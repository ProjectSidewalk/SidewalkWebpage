/**
 * The Task geometry the compass, the nav arrows and the minimap read (#5840): how far along its street the labeler
 * has got, which way the street goes from here, the midpoint a geocoder is asked about, and the lines the street
 * being walked is drawn as. Plus the small reads around them: a mission's start on the street, a route street's
 * minimap key, and the defaults the distance helpers fall back to.
 *
 * Real turf: every answer here is a distance or a bearing on real street geometry.
 */

import * as turf from '@turf/turf';
import { loadModules } from './loader.js';

const START = [-77.02, 38.9];
const COVERAGE = { pano_window_m: 10, max_hop_m: 50, max_uncovered_m: 50, min_covered_frac: 0.5 };

/** A straight street `lengthM` long heading due east from `start`, as [lng, lat] pairs. */
function straightStreet(start, lengthM) {
  return [start, turf.destination(turf.point(start), lengthM / 1000, 90).geometry.coordinates];
}

/** The lat/lng `alongM` from the street's start, offset `asideM` to its left (north, on an eastward street). */
function standingAt(street, alongM, asideM = 0) {
  const bearing = turf.bearing(turf.point(street[0]), turf.point(street[1]));
  const along = turf.destination(turf.point(street[0]), alongM / 1000, bearing);
  const aside = turf.destination(along, asideM / 1000, bearing - 90).geometry.coordinates;
  return { lat: aside[1], lng: aside[0] };
}

/** A /tasks feature for a street. Coordinates are copied because Task.reverseCoordinates reverses in place. */
function feature(coordinates, properties = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coordinates.map((coord) => [...coord]) },
    properties: {
      street_edge_id: 1,
      task_start: '2026-10-09T12:00:00Z',
      current_lng: coordinates[0][0],
      current_lat: coordinates[0][1],
      ...properties,
    },
  };
}

describe('Task geometry', () => {
  const street = straightStreet(START, 200);
  let Task;

  const makeTask = (geojson, resumeAt) => new Task(geojson, COVERAGE, false, resumeAt);

  beforeEach(async () => {
    ({ Task } = await loadModules('frontend/js/explore/task/Task.js'));
  });

  describe('the furthest point reached', () => {
    it('advances with a pano further along the street, but never back', () => {
      const task = makeTask(feature(street));

      task.updateTheFurthestPointReached(standingAt(street, 60));
      expect(task.getAuditedDistance({ units: 'meters' })).toBeCloseTo(60, 0);

      task.updateTheFurthestPointReached(standingAt(street, 30));
      expect(task.getAuditedDistance({ units: 'meters' })).toBeCloseTo(60, 0);
      expect(task.getAuditedDistance()).toBeCloseTo(0.06, 3);
    });

    it('counts a pano as a step on only when it sits a couple of metres past that point (#5918)', () => {
      const task = makeTask(feature(street));
      task.updateTheFurthestPointReached(standingAt(street, 60));

      expect(task.advancesWalk(standingAt(street, 64))).toBe(true);
      // Beside the street, barely further along: imagery that has turned off it.
      expect(task.advancesWalk(standingAt(street, 61, 15))).toBe(false);
      expect(task.advancesWalk(standingAt(street, 50))).toBe(false);
      // Well along, but too far off the street to ever move the furthest point.
      expect(task.advancesWalk(standingAt(street, 80, 30))).toBe(false);
    });

    it('ignores a pano off the street, however far along it projects', () => {
      const task = makeTask(feature(street));

      // Within the compass's 50 m "near the route" band but past the 25 m on-street bound.
      task.updateTheFurthestPointReached(standingAt(street, 120, 40));
      expect(task.getAuditedDistance({ units: 'meters' })).toBeCloseTo(0, 0);

      task.updateTheFurthestPointReached(standingAt(street, 120, 200));
      expect(task.getAuditedDistance({ units: 'meters' })).toBeCloseTo(0, 0);
    });

    it('is where a walk enters a part-walked street, and its start otherwise', () => {
      const stopped = standingAt(street, 70);
      const resumed = makeTask(feature(street, { audit_task_id: 9, completed: false }), stopped);
      const fresh = makeTask(feature(street));

      expect(resumed.getEntryCoordinate()).toEqual(stopped);
      expect(fresh.getEntryCoordinate()).toEqual({ lat: street[0][1], lng: street[0][0] });
    });
  });

  describe('the way forward', () => {
    it('points along the street from where the labeler stands, and back toward it from off the street', () => {
      const task = makeTask(feature(street));
      task.updateTheFurthestPointReached(standingAt(street, 50));

      // 15 m further along an eastward street: due east.
      expect(task.headingAlongRoute(standingAt(street, 50))).toBeCloseTo(90, 0);
      // 15 m north of there the goal is true south-east, only if longitude degrees count as shorter than latitude's.
      expect(task.headingAlongRoute(standingAt(street, 50, 15))).toBeCloseTo(135, 0);
    });

    it('aims at the street\'s end once less than 15 m of it remains', () => {
      const task = makeTask(feature(street));
      task.updateTheFurthestPointReached(standingAt(street, 195));

      expect(task.headingAlongRoute(standingAt(street, 195))).toBeCloseTo(90, 0);
      expect(turf.length(task.unwalkedRemainder(), { units: 'meters' })).toBeCloseTo(5, 0);
    });

    it('counts a position within 50 m of the line as near the route', () => {
      const task = makeTask(feature(street));

      expect(task.isNearRoute(standingAt(street, 100, 40))).toBe(true);
      expect(task.isNearRoute(standingAt(street, 100, 60))).toBe(false);
    });
  });

  describe('the street either way from where the labeler stands (#5968)', () => {
    const meters = { units: 'meters' };
    const metersBetween = (a, b) => turf.distance(turf.point(a), turf.point(b), meters);
    const lngLat = ({ lat, lng }) => [lng, lat];

    it.each([
      ['a two-point street', straightStreet(START, 100)],
      ['a street with a vertex either side', [0, 30, 80, 100].map((m) => straightStreet(START, m || 0.001)[m ? 1 : 0])],
    ])('on %s, each stretch starts where they stand and runs to its own end', (_name, street) => {
      const task = new Task(feature(street), COVERAGE, false);
      const at = standingAt(street, 60, 3);
      const onStreet = lngLat(standingAt(street, 60));

      const toEnd = task.streetFrom(at, true);
      expect(metersBetween(toEnd.geometry.coordinates[0], onStreet)).toBeLessThan(0.5);
      expect(turf.length(toEnd, meters)).toBeCloseTo(40, 0);
      expect(task.headingAlongStreet(at, true)).toBeCloseTo(90, 0);

      const toStart = task.streetFrom(at, false);
      expect(metersBetween(toStart.geometry.coordinates[0], onStreet)).toBeLessThan(0.5);
      expect(metersBetween(toStart.geometry.coordinates.at(-1), street[0])).toBeLessThan(0.5);
      expect(turf.length(toStart, meters)).toBeCloseTo(60, 0);
      expect(task.headingAlongStreet(at, false)).toBeCloseTo(270, 0);
    });

    it('close to the start, the arrow back still points at the start, not across the street', () => {
      const street = straightStreet(START, 100);
      const task = new Task(feature(street), COVERAGE, false);
      expect(task.headingAlongStreet(standingAt(street, 5), false)).toBeCloseTo(270, 0);
    });

    it('from well off to one side the two arrows still point opposite ways, along the street', () => {
      const street = straightStreet(START, 100);
      const task = new Task(feature(street), COVERAGE, false);
      const at = standingAt(street, 60, 40);
      expect(task.headingAlongStreet(at, true)).toBeCloseTo(90, 0);
      expect(task.headingAlongStreet(at, false)).toBeCloseTo(270, 0);
    });

    it('on a loop, whose ends are one point, each stretch still starts where they stand', () => {
      const corner = (east, north) => turf.destination(
        turf.destination(turf.point(START), east / 1000, 90), north / 1000, 0,
      ).geometry.coordinates;
      const loop = [START, corner(50, 0), corner(50, 50), corner(0, 50), START];
      const task = new Task(feature(loop), COVERAGE, false);
      const at = { lng: corner(50, 25)[0], lat: corner(50, 25)[1] }; // Halfway up the east side.

      expect(task.headingAlongStreet(at, true)).toBeCloseTo(0, 0);
      expect(turf.length(task.streetFrom(at, true), meters)).toBeCloseTo(125, 0);
      expect(task.headingAlongStreet(at, false)).toBeCloseTo(180, 0);
      expect(turf.length(task.streetFrom(at, false), meters)).toBeCloseTo(75, 0);
    });

    it.each([
      ['at the end', 100], ['a metre short of the end', 99], ['past the end', 110],
    ])('offers no way toward the end %s, where no pano could count as a step', (_name, alongM) => {
      const street = straightStreet(START, 100);
      const task = new Task(feature(street), COVERAGE, false);
      const at = standingAt(street, alongM);
      expect(task.headingAlongStreet(at, true)).toBeNull();
      expect(task.headingAlongStreet(at, false)).toBeCloseTo(270, 0);
      expect(turf.length(task.streetFrom(standingAt(street, 110), true))).toBe(0);
    });

    it('counts a pano as a step only from two metres down the stretch; behind or beside is none', () => {
      const street = straightStreet(START, 100);
      const task = new Task(feature(street), COVERAGE, false);
      const toStart = task.streetFrom(standingAt(street, 60), false);
      expect(Task.isStepDown(toStart, standingAt(street, 50))).toBe(true);
      expect(Task.isStepDown(toStart, standingAt(street, 59))).toBe(false);
      expect(Task.isStepDown(toStart, standingAt(street, 70))).toBe(false);
      expect(Task.isStepDown(toStart, standingAt(street, 60, 8))).toBe(false);
    });
  });

  describe('the minimap lines of the street being walked', () => {
    const CURRENT = { exploreAddressMode: false, current: true, route: false };

    it('split at the furthest point into the audited and the remaining halves', () => {
      const task = makeTask(feature(street));
      task.updateTheFurthestPointReached(standingAt(street, 80));

      const lines = task.minimapLines(CURRENT);

      expect(lines.map((line) => line.kind)).toEqual(['audited', 'remaining']);
      expect(turf.length(turf.lineString(lines[0].coordinates), { units: 'meters' })).toBeCloseTo(80, 0);
      expect(turf.length(turf.lineString(lines[1].coordinates), { units: 'meters' })).toBeCloseTo(120, 0);
    });

    it('are keyed by the route street on a route, so an out-and-back street draws twice', () => {
      expect(makeTask(feature(street, { route_street_id: 44 })).minimapKey()).toBe('route-street-44');
      expect(makeTask(feature(street)).minimapKey()).toBe('street-1');
    });
  });

  it('reads the mission\'s start on the street back from the payload', () => {
    const start = { lat: 38.9001, lng: -77.0199 };
    const task = makeTask(feature(street, { current_mission_id: 3, current_mission_start: start }));

    expect(task.getMissionStart(3)).toEqual(start);
    expect(task.getMissionStart(4)).toBeUndefined();
    task.setMissionStart(4, { lat: 1, lng: 2 });
    expect(task.getMissionStart(4)).toEqual({ lat: 1, lng: 2 });
  });

  it('answers a geocoder with the street\'s midpoint, away from its intersections', () => {
    const task = makeTask(feature(street));

    const midpoint = task.getMidpoint();

    expect(turf.distance(turf.point([midpoint.lng, midpoint.lat]), turf.point(street[0]), { units: 'meters' }))
      .toBeCloseTo(100, 0);
  });

  it('measures in kilometers unless told otherwise', () => {
    const task = makeTask(feature(street));
    const next = makeTask(feature(straightStreet(street[1], 100), { street_edge_id: 2 }));

    expect(task.lineDistance()).toBeCloseTo(0.2, 3);
    expect(task.getDistanceFromStart(standingAt(street, 150))).toBeCloseTo(0.15, 3);
    expect(task.isConnectedTo(next, 0.025)).toBe(true);
    expect(task.getGeoJSON()).toBe(task.getGeoJSON());
    expect(task.getProperty('noSuchProperty')).toBeNull();
  });

  it('never calls a degenerate street finished short of its endpoint', () => {
    const point = makeTask(feature([START, START]));

    expect(point.isAtEnd({ lat: START[1], lng: START[0] }, 10)).toBe(true);
    expect(point.isAtEnd(standingAt(street, 15), 10)).toBe(false);
  });

  it('merges two ranges that start together by their ends', () => {
    expect(Task.mergeRanges([[10, 40], [10, 20]], 200)).toEqual([[10, 40]]);
  });
});
