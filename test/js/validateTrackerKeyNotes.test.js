/**
 * Tests for frontend/js/validate/Tracker.js's notes: key events log the key's position, never the character typed,
 * and nothing for a password field (#5618); a scripted click logs no cursor; and every detail of an action reaches
 * the note the server stores (#5840).
 */

import { loadModules } from './loader.js';

const { Tracker } = await loadModules('frontend/js/validate/Tracker.js');

describe('Tracker notes', () => {
  let tracker;

  beforeAll(() => {
    // One instance for the file: the constructor adds document listeners that are never removed.
    tracker = new Tracker();
  });

  beforeEach(() => {
    document.body.innerHTML = '<input id="comment"><input id="password" type="password">';
  });

  /** Presses a key on the element and returns the note its keydown row was logged with. */
  function noteFor(el) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', bubbles: true }));
    return tracker.getActions().filter((a) => a.action === 'LowLevelEvent_keydown').at(-1).note;
  }

  test('notes the key code, not the character typed', () => {
    expect(noteFor(document.getElementById('comment'))).toBe('code:KeyA');
  });

  test('notes nothing about a key pressed in a password field', () => {
    expect(noteFor(document.getElementById('password'))).toBe('');
  });

  // A real click's isTrusted is true, but jsdom won't let a test make one, so only the scripted case is pinned here.
  test('a scripted click, as a keyboard shortcut sends, logs no cursor rather than one in the corner', () => {
    document.getElementById('comment').click();

    expect(tracker.getActions().filter((a) => a.action === 'LowLevelEvent_click').at(-1).note)
      .toBe('cursorX:null,cursorY:null');
  });

  test('an action’s details are each noted as key:value, in the order given', () => {
    tracker.push('Click_ImageAdjustments_Close', { via: 'escape', brightness: 1.2, contrast: 0.9 });

    expect(tracker.getActions().at(-1).note).toBe('via:escape,brightness:1.2,contrast:0.9');
  });

  test('an action with no details has an empty note', () => {
    tracker.push('PageGainedFocus');

    expect(tracker.getActions().at(-1).note).toBe('');
  });
});
