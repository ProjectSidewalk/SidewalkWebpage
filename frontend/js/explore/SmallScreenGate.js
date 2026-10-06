/**
 * Holds Explore back on a touch screen too small to label on (#5664), instead of the server redirecting phones away.
 *
 * Decided by screen shape and size, never device class:
 * - small touch screen, portrait: a rotate prompt with no way past it, since the pano is too narrow to label at all.
 *   It clears itself the moment the phone turns sideways.
 * - small touch screen, landscape: a notice with "Continue anyway". Proper landscape-phone labeling is #5668.
 * - anything else (tablets either way up, desktops): no gate.
 *
 * Nothing that bills a pano is built until the gate opens, so a phone that only reads the notice costs no Street View
 * load (#5128).
 *
 * @example
 * await waitForLabelableScreen();  // resolves at once on a tablet or desktop
 * new Main(...);
 */

import { util } from '../common/utilities.js';

/**
 * Which gate, if any, this screen gets right now.
 * @returns {'rotate'|'notice'|null}
 */
export function smallScreenGate() {
  if (util.isPortraitSmallTouch()) return 'rotate';
  if (util.isSmallTouchScreen()) return 'notice';
  return null;
}

/**
 * Shows the rotate prompt or the notice when the screen calls for one, and resolves once labeling may start.
 * @returns {Promise<void>} Resolves immediately when no gate applies; otherwise on "Continue anyway".
 */
export function waitForLabelableScreen() {
  if (!smallScreenGate()) return Promise.resolve();

  const holder = document.getElementById('explore-small-screen');
  const rotatePanel = document.getElementById('explore-rotate-prompt');
  const noticePanel = document.getElementById('explore-small-screen-notice');
  const loading = document.getElementById('page-loading');
  holder.hidden = false;
  if (loading) loading.style.visibility = 'hidden';

  return new Promise((resolve) => {
    /** Shows one panel, moving focus to its heading so a screen reader announces it. */
    const showPanel = (panel) => {
      rotatePanel.hidden = panel !== rotatePanel;
      noticePanel.hidden = panel !== noticePanel;
      panel.querySelector('h1')?.focus();
    };

    const showNotice = () => {
      showPanel(noticePanel);
      window.logWebpageActivity?.('Visit_Explore_SmallScreenNotice');
    };

    if (smallScreenGate() === 'rotate') {
      showPanel(rotatePanel);
      window.logWebpageActivity?.('Visit_Explore_RotatePrompt');
      // The one thing that can change the verdict mid-visit: turning the phone. Re-judged on each change rather than
      // trusting the media query alone, since a rotation also swaps which edge is the short one.
      const landscape = window.matchMedia('(orientation: landscape)');
      const onRotate = () => {
        const gate = smallScreenGate();
        if (gate === 'rotate') return;
        landscape.removeEventListener('change', onRotate);
        if (gate === 'notice') showNotice();
        else finish();
      };
      landscape.addEventListener('change', onRotate);
    } else {
      showNotice();
    }

    function finish() {
      holder.hidden = true;
      if (loading) loading.style.visibility = '';
      resolve();
    }

    document.getElementById('explore-small-screen-continue').addEventListener('click', () => {
      window.logWebpageActivity?.('Click_module=ExploreSmallScreenContinue');
      finish();
    }, { once: true });
  });
}
