$(document).ready(function() {

    // Raleway doesn't load after being redirected from another page; redeclaring the font-face fixes that.
    let font = "<style> @@font-face{ font-family: 'raleway'; src: url('/assets/fonts/Raleway/Raleway-Regular.ttf');} </style>";
    $('head').append(font);

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
    } else {
        if (svv.modalLandscape) svv.modalLandscape.hide();
    }

    $(window).on('orientationchange', function (event) {
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
let doubleTouchStartTimestamp = 0;
document.addEventListener('touchstart', (event) =>{
    let now = +(new Date());
    if (doubleTouchStartTimestamp + 500 > now) {
        event.preventDefault();
    }

    doubleTouchStartTimestamp = now;
}, { passive: false });
