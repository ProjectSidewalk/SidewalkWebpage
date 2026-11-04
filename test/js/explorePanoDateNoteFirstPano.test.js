/**
 * How PanoDateNote hears about panos (#5840): the one already on screen when it is built, and each one landed on
 * after, including a pano whose metadata carries no capture date at all.
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker } from './fakes.js';

mockModule('i18next', () => ({
  default: { language: 'en', t: (key, opts) => (opts?.date ? `${key}|${opts.date}` : key) },
}));

describe('PanoDateNote following the pano on screen', () => {
  let PanoDateNote;
  let onPanoChanged;
  let task;

  const dateText = () => document.getElementById('svl-panorama-date').textContent;
  const noteHidden = () => document.getElementById('svl-pano-date-note').hidden;

  /** A pano as PanoStore hands it over, carrying only what the note reads. */
  const pano = (captureDate) => ({ getProperty: (key) => (key === 'captureDate' ? captureDate : null) });

  beforeEach(async () => {
    ({ PanoDateNote } = await loadModules('frontend/js/explore/panorama/PanoDateNote.js'));
    document.body.innerHTML = '<div id="svl-panorama-date-holder">'
      + '<span id="svl-panorama-date-pill"><span id="svl-panorama-date"></span></span></div>';
    task = { getStreetEdgeId: () => 31, getProperty: (key) => ({
      mappedByThisUser: true, lastMappedAt: '2024-07-07T19:00:00Z',
    })[key] ?? null };
  });

  /** Builds the note with `firstPano` already on screen. */
  function build(firstPano) {
    return new PanoDateNote(
      document.getElementById('svl-panorama-date-holder'),
      document.getElementById('svl-panorama-date-pill'),
      document.getElementById('svl-panorama-date'),
      { getPanoId: () => 'first', onPanoChanged: (listener) => { onPanoChanged = listener; } },
      { getPanoData: () => firstPano },
      { getCurrentTask: () => task },
      fakeTracker(),
    );
  }

  it('notes the pano already on screen, then each one landed on', () => {
    build(pano(new Date(2024, 9, 1)));
    expect(dateText()).toBe('right-ui.pano-date-note.image-date|Oct 2024');
    expect(noteHidden()).toBe(false);

    onPanoChanged(pano(new Date(2022, 2, 1)));
    expect(dateText()).toBe('right-ui.pano-date-note.image-date|Mar 2022');
  });

  it('empties the corner for a pano with no capture date, and starts empty with no pano at all', () => {
    build(undefined);
    expect(dateText()).toBe('');
    expect(noteHidden()).toBe(true);

    onPanoChanged(pano(new Date(2024, 9, 1)));
    expect(noteHidden()).toBe(false);

    onPanoChanged(pano(null));
    expect(dateText()).toBe('');
    expect(noteHidden()).toBe(true);
  });
});
