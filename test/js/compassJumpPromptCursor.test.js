/**
 * The compass message's pointer cursor says a click does something (frontend/js/explore/navigation/Compass.js). The
 * label-before-jump prompt stays clickable through a move, which pauses the ordinary compass click.
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker, fakePanoManager, fakeTaskContainer } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

describe('Compass cursor under the label-before-jump prompt', () => {
  let compass;
  let holder;
  let nav;

  beforeEach(async () => {
    document.body.innerHTML = '<div id="compass-message-holder"><div id="compass-message"></div></div>';
    holder = document.getElementById('compass-message-holder');
    const { Compass } = await loadModules('frontend/js/explore/navigation/Compass.js');
    nav = {};
    const navigationService = {
      onMoveStarted: (listener) => { nav.moveStarted = listener; },
      onMoveFinished: (listener) => { nav.moveFinished = listener; },
      onHeadingSettled: vi.fn(),
    };
    const streetProgress = {
      onLabelBeforeJumpChanged: (listener) => { nav.jumpPrompt = listener; },
      isLabelBeforeJumpArmed: () => false,
    };
    compass = new Compass({ isOnboarding: false }, { isRouteComplete: false, isRegionComplete: false, isRouteOrRegionComplete: () => false },
      fakeTaskContainer(), fakePanoManager(), navigationService, streetProgress, {},
      fakeTracker());
  });

  afterEach(() => compass.stopBlinking());

  it('keeps the pointer through a move while the prompt is up, and drops it once the prompt goes', () => {
    nav.jumpPrompt(true);
    expect(holder.style.cursor).toBe('pointer');

    nav.moveStarted();
    expect(holder.style.cursor).toBe('pointer');
    nav.moveFinished();
    expect(holder.style.cursor).toBe('pointer');

    nav.jumpPrompt(false);
    expect(holder.style.cursor).toBe('pointer'); // The ordinary compass click is back.
    nav.moveStarted();
    expect(holder.style.cursor).toBe('default');
    nav.moveFinished();
    expect(holder.style.cursor).toBe('pointer');
  });
});
