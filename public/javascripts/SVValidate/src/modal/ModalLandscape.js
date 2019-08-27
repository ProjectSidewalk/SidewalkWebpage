/**
 * Displays modal popup if user is on mobile and in landscape mode.
 * @param uiModal
 * @returns {Modal Info}
 * @constructor
 */

function ModalLandscape (uiModal) {
    let self = this;

    $(document).ready(function() {
        // If the site is loaded in landscape mode first, 'loadedScreenLandscape' will be set to true
        // and when the screen is flipped back to portrait mode the site will be reloaded to set the panoramas
        // correctly.
        let loadedScreenLandscape = false;

        if (orientation != 0) {
            self.show();
            loadedScreenLandscape = true;
        } else {
            self.hide();
        }

        $(window).on('orientationchange', function(event) {
            if (orientation != 0) {
                self.show();
            } else if (loadedScreenLandscape) {
                location.reload();
            } else {
                self.hide();

            }
        });
    });

    function hide () {
        uiModal.background.css('visibility', 'hidden');
        uiModal.holder.css('visibility', 'hidden');
        uiModal.foreground.css('visibility', 'hidden');
    }

    function show () {
        uiModal.background.css('visibility', 'visible');
        uiModal.holder.css('visibility', 'visible');
        uiModal.foreground.css('visibility', 'visible');
    }

    self.hide = hide;
    self.show = show;

    return this;
}
