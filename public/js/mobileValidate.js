$(document).ready(() => {
  // Add the 'animate-button' class to all validation buttons so an animation is performed to confirm click.
  document.getElementById('validate-no-button').classList.add('animate-button');
  document.getElementById('validate-unsure-button').classList.add('animate-button');
  document.getElementById('validate-yes-button').classList.add('animate-button');
  document.getElementById('no-menu-submit-button').classList.add('animate-button');
  document.getElementById('unsure-menu-submit-button').classList.add('animate-button');
  document.getElementById('modal-mission-complete-close-button-primary').classList.add('animate-button');
  document.getElementById('modal-mission-complete-close-button-secondary').classList.add('animate-button');
  document.getElementById('label-visibility-control-button').classList.add('animate-button');
});

// Suppresses double-tap-to-zoom over the imagery, where two quick taps around a label would otherwise leave the
// validator zoomed into a corner of the pano they are being asked to judge.
//
// Scoped to the imagery itself — the primary viewer's canvas and the Pannellum fallback's — rather than to the page
// with the controls exempted. Cancelling a touchstart cancels that touch's click and its scrolling along with the
// zoom, so every control drawn over the pano has to be left alone: a verdict tap loads the next label for the one
// after it to land on, the marker toggles the label card, Undo follows a verdict, and a reason panel scrolls once a
// landscape phone caps its height and then takes tap-a-reason-then-tap-Submit. Naming the two canvases means the
// next control added over them doesn't have to remember to opt out.
//
// Single-finger taps only: the second finger of a pinch also arrives inside the window, and cancelling its touchstart
// would take the page's pinch zoom with it — the WCAG 1.4.4 affordance the viewport meta leaves open.
const DOUBLE_TAP_MS = 500;
const PANO_CANVASES = '#svv-panorama, #svv-panorama-pannellum';
let doubleTouchStartTimestamp = 0;
document.addEventListener('touchstart', (event) => {
  const now = +(new Date());
  const isSecondTap = doubleTouchStartTimestamp + DOUBLE_TAP_MS > now;
  doubleTouchStartTimestamp = now;

  if (isSecondTap && event.touches.length === 1 && event.target?.closest?.(PANO_CANVASES)) {
    event.preventDefault();
  }
}, { passive: false });
