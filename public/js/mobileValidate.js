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

  // If the site is loaded in landscape mode first, 'loadedScreenLandscape' will be set to true, and when the screen
  // is flipped back to portrait mode the site will be reloaded to set the panoramas correctly.
  let loadedScreenLandscape = false;

  // If we are in landscape, wait for the modal to load and then show it.
  if (window.screen.orientation.type.includes('landscape')) {
    const landscapeInterval = setInterval(() => {
      if (svv.modalLandscape) {
        svv.modalLandscape.show();
        loadedScreenLandscape = true;
        clearInterval(landscapeInterval);
      }
    }, 20); // 20 ms.
  } else if (svv.modalLandscape) {
    svv.modalLandscape.hide();
  }

  $(window).on('orientationchange', () => {
    if (window.screen.orientation.type.includes('landscape')) {
      svv.modalLandscape.show();
    } else if (loadedScreenLandscape) {
      location.reload();
    } else {
      svv.modalLandscape.hide();
    }
  });
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
