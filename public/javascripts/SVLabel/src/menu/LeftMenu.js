class LeftMenu {
    #blinkInterval = null;

    constructor(uiLeftColumn, tracker, navigationService, stuckAlert) {
        this.uiLeftColumn = uiLeftColumn;
        this.tracker = tracker;
        this.navigationService = navigationService;
        this.stuckAlert = stuckAlert;

        // Initialize Event Listeners.
        this.enableStuckButton();
    }

    /**
     * Callback for clicking stuck button.
     *
     * The algorithm searches for available imagery along the street you are assigned to. If the pano you are put in
     * doesn't help, you can click the Stuck button again; we save the attempted panos so we'll try something new. If we
     * can't find anything along the street, we just mark it as complete and move you to a new street.
     */
    #handleClickStuck = (e) => {
        e.preventDefault();
        this.stuckAlert.compassOrStuckClicked();
        this.tracker.push('ModalStuck_ClickStuck');
        this.navigationService.moveForward()
            .then(() => {
                this.tracker.push('ModalStuck_Unstuck');
                this.stuckAlert.stuckClicked();
            })
            .catch(() => this.tracker.push('ModalStuck_PanoNotAvailable'));
    }

    /* Enable the stuck button. */
    enableStuckButton = () => {
        this.uiLeftColumn.stuck.on('click', this.#handleClickStuck);
    }

    /* Disable the stuck button. */
    disableStuckButton = () => {
        this.uiLeftColumn.stuck.off('click');
    }

    /* Blink the stuck button. */
    blinkStuckButton = () => {
        self.stopBlinking();
        this.#blinkInterval = window.setInterval(function () {
            this.uiLeftColumn.stuck.toggleClass("highlight-100");
        }, 500);
    };

    /* Stop blinking the stuck button. */
    stopBlinkingStuckButton = () => {
        window.clearInterval(this.#blinkInterval);
        this.uiLeftColumn.stuck.removeClass("highlight-100");
    };
}
