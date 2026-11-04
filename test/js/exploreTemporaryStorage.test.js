/**
 * Tests Explore's localStorage wrapper (frontend/js/explore/data/Storage.js) (#5840): the defaults it seeds for the
 * rest of the tool, and that what goes in comes back out as the same value.
 */

import { loadModules } from './loader.js';

describe('Explore TemporaryStorage', () => {
  let TemporaryStorage;

  beforeEach(async () => {
    window.localStorage.clear();
    ({ TemporaryStorage } = await loadModules('frontend/js/explore/data/Storage.js'));
  });

  it('seeds the keys the tool assumes are always there', () => {
    const storage = new TemporaryStorage(JSON);
    expect(storage.get('completedFirstMission')).toBeNull();
    expect(storage.get('muted')).toBe(false);
    expect(window.localStorage.getItem('muted')).toBe('false');
  });

  it('keeps what an earlier visit stored', () => {
    window.localStorage.setItem('completedFirstMission', 'true');
    window.localStorage.setItem('muted', 'true');
    const storage = new TemporaryStorage(JSON);
    expect(storage.get('completedFirstMission')).toBe(true);
    expect(storage.get('muted')).toBe(true);
  });

  it('round-trips structured values', () => {
    const storage = new TemporaryStorage(JSON);
    storage.set('lastPosition', { lat: 47.6, lng: -122.3 });
    expect(storage.get('lastPosition')).toEqual({ lat: 47.6, lng: -122.3 });
    expect(storage.get('never-set')).toBeNull();
  });
});
