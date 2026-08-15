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

// Prevents double tap functionality. We only want to pinch zoom in the pano.
//
// Cancelling a touchstart cancels that touch's scrolling and its click as well as the zoom, so the mission screens
// are exempt: they scroll (a long briefing, its examples carousel) and their way forward is a tap, and a second
// flick or tap arriving inside half a second of the last one is ordinary use there, not a zoom gesture.
const DOUBLE_TAP_MS = 500;
const DOUBLE_TAP_EXEMPT = '#modal-mission-foreground, #modal-mission-complete-foreground';
let doubleTouchStartTimestamp = 0;
document.addEventListener('touchstart', (event) => {
  const now = +(new Date());
  const isSecondTap = doubleTouchStartTimestamp + DOUBLE_TAP_MS > now;
  doubleTouchStartTimestamp = now;

  if (isSecondTap && !event.target?.closest?.(DOUBLE_TAP_EXEMPT)) {
    event.preventDefault();
  }
}, { passive: false });
