/**
 * Tests Explore's sound effects and mute button (frontend/js/explore/game/AudioEffect.js) (#5840): the button shows
 * the stored mute state, flips it on click, and a muted labeler hears nothing.
 */

import { loadModules } from './loader.js';

/** What `new Audio(src)` built, in order. */
let audios;

describe('Explore AudioEffect', () => {
  let AudioEffect;
  let stored;
  const storage = { get: (key) => stored[key], set: vi.fn((key, value) => { stored[key] = value; }) };
  const soundIcon = () => document.getElementById('explore-control-sound-icon');
  const muteIcon = () => document.getElementById('explore-control-mute-icon');

  beforeEach(async () => {
    document.body.innerHTML = `
      <button id="explore-control-sound">
        <span id="explore-control-sound-icon"></span><span id="explore-control-mute-icon" class="ps-hidden"></span>
      </button>`;
    audios = [];
    // jsdom's media elements can't play; a recording stand-in says what would have.
    vi.stubGlobal('Audio', class {
      constructor(src) {
        this.src = src;
        this.load = vi.fn();
        this.play = vi.fn();
        audios.push(this);
      }
    });
    stored = { muted: false };
    ({ AudioEffect } = await loadModules('frontend/js/explore/game/AudioEffect.js'));
  });

  it('loads the two effects from the asset path, quietly', () => {
    new AudioEffect(storage);
    expect(audios.map((audio) => audio.src)).toEqual(['/assets/audio/drip.mp3', '/assets/audio/success.mp3']);
    expect(audios.map((audio) => audio.volume)).toEqual([0.25, 0.05]);
  });

  it('shows the speaker when sound is on, and the mute icon when it was muted last time', () => {
    new AudioEffect(storage);
    expect(soundIcon().classList.contains('ps-hidden')).toBe(false);
    expect(muteIcon().classList.contains('ps-hidden')).toBe(true);

    stored = { muted: true };
    new AudioEffect(storage);
    expect(soundIcon().classList.contains('ps-hidden')).toBe(true);
    expect(muteIcon().classList.contains('ps-hidden')).toBe(false);
  });

  it('flips the mute state on each click of the button, and remembers it', () => {
    new AudioEffect(storage);
    const button = document.getElementById('explore-control-sound');
    button.click();
    expect(stored.muted).toBe(true);
    expect(muteIcon().classList.contains('ps-hidden')).toBe(false);
    button.click();
    expect(stored.muted).toBe(false);
    expect(soundIcon().classList.contains('ps-hidden')).toBe(false);
  });

  it('plays a named effect unless muted, and ignores a name it does not have', () => {
    const effect = new AudioEffect(storage);
    effect.play('drip');
    expect(audios[0].play).toHaveBeenCalledTimes(1);
    effect.play('fanfare');
    expect(audios.every((audio) => audio.play.mock.calls.length <= 1)).toBe(true);

    stored.muted = true;
    effect.play('success');
    expect(audios[1].play).not.toHaveBeenCalled();
  });

  it('preloads a named effect, and only a known one', () => {
    const effect = new AudioEffect(storage);
    effect.load('success');
    effect.load('fanfare');
    expect(audios[1].load).toHaveBeenCalledTimes(1);
    expect(audios[0].load).not.toHaveBeenCalled();
  });
});
