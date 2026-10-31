/**
 * Tests for the shared map padding target (frontend/js/ps-map/mapPadding.js, #5748): the overlays that each own
 * one edge build on where the others are going, not on a half-way value read mid-ease, and a camera move already
 * in flight is left to finish rather than cancelled by a padding ease.
 */

import { paddingTarget, setPaddingEdges } from '../../frontend/js/ps-map/mapPadding.js';

/** A map whose reported padding lags its target, as Mapbox's does mid-ease. */
function fakeMap({ moving = false } = {}) {
  return {
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    getPadding() { return this.padding; },
    setPadding: vi.fn(),
    easeTo: vi.fn(),
    once: vi.fn(),
    isMoving: () => moving,
  };
}

describe('mapPadding', () => {
  test('the target starts as the map\'s own padding, and each edge set merges into it', () => {
    const map = fakeMap();
    map.padding = { top: 0, right: 0, bottom: 0, left: 350 };
    expect(paddingTarget(map)).toEqual({ top: 0, right: 0, bottom: 0, left: 350 });
    expect(setPaddingEdges(map, { right: 500 })).toEqual({ top: 0, right: 500, bottom: 0, left: 350 });
    expect(map.easeTo).toHaveBeenCalledWith({ padding: { top: 0, right: 500, bottom: 0, left: 350 }, duration: 300 });
    // A copy: editing what was handed out changes nothing.
    paddingTarget(map).right = 1;
    expect(paddingTarget(map).right).toBe(500);
  });

  test('a second owner mid-ease builds on the first\'s target, not on the half-way padding the map reports', () => {
    const map = fakeMap();
    setPaddingEdges(map, { right: 500 });
    map.padding = { top: 0, right: 199.8, bottom: 0, left: 0 };
    setPaddingEdges(map, { bottom: 77 });
    expect(map.easeTo).toHaveBeenLastCalledWith({ padding: { top: 0, right: 500, bottom: 77, left: 0 }, duration: 300 });
  });

  test('animate false jumps; a center rides along an ease', () => {
    const map = fakeMap();
    setPaddingEdges(map, { left: 350 }, { animate: false });
    expect(map.setPadding).toHaveBeenCalledWith({ top: 0, right: 0, bottom: 0, left: 350 });
    expect(map.easeTo).not.toHaveBeenCalled();
    setPaddingEdges(map, { right: 400 }, { duration: 100, camera: { center: { lng: 1, lat: 2 } } });
    expect(map.easeTo).toHaveBeenCalledWith({
      padding: { top: 0, right: 400, bottom: 0, left: 350 }, duration: 100, center: { lng: 1, lat: 2 },
    });
  });

  test('a camera move in flight is not cut short: the padding waits for moveend, coalesced, center dropped', () => {
    const map = fakeMap({ moving: true });
    setPaddingEdges(map, { right: 400 }, { camera: { center: { lng: 1, lat: 2 } } });
    setPaddingEdges(map, { bottom: 77 });
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(map.setPadding).not.toHaveBeenCalled();
    expect(map.once).toHaveBeenCalledTimes(1);
    expect(map.once.mock.calls[0][0]).toBe('moveend');
    map.once.mock.calls[0][1]();
    expect(map.easeTo).toHaveBeenCalledWith({ padding: { top: 0, right: 400, bottom: 77, left: 0 }, duration: 300 });
    // The next change, with the move over, eases at once.
    map.isMoving = () => false;
    setPaddingEdges(map, { top: 1 });
    expect(map.easeTo).toHaveBeenCalledTimes(2);
  });

  test('a fly that carried the target lands on it, and the deferred ease is then skipped', () => {
    const map = fakeMap({ moving: true });
    setPaddingEdges(map, { right: 400 });
    map.padding = { top: 0, right: 400, bottom: 0, left: 0 };
    map.once.mock.calls[0][1]();
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  test('a map without isMoving (a test stand-in) eases as asked', () => {
    const map = fakeMap();
    delete map.isMoving;
    setPaddingEdges(map, { top: 10 });
    expect(map.easeTo).toHaveBeenCalledTimes(1);
  });
});
