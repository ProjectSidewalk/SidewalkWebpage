/**
 * Handles interaction with the buttons on to the left of the panorama on the Explore page.
 */
class LeftMenu {
    #blinkInterval = null;
    #stuck;
    #feedback;
    #controlButtonsHolder;
    #controlButtonsToggle;
    #controlButtonsToggleIcon;

    /**
     * Initializes the LeftMenu object's properties from parameters.
     * @param {Tracker} tracker
     * @param {NavigationService} navigationService
     * @param {StuckAlert} stuckAlert
     */
    constructor(tracker, navigationService, stuckAlert) {
        this.tracker = tracker;
        this.navigationService = navigationService;
        this.stuckAlert = stuckAlert;

        this.#stuck = document.getElementById('left-column-stuck-button');
        this.#controlButtonsHolder = document.getElementById('explore-control-buttons-holder');
        this.#controlButtonsToggle = document.getElementById('explore-control-buttons-toggle');
        this.#controlButtonsToggleIcon = document.getElementById('explore-control-buttons-toggle-icon');

        // Initialize Event Listeners.
        this.enableStuckButton();
        this.#controlButtonsToggle.addEventListener('click', this.#handleToggleControls);
    }

    /**
     * Callback for the chevron toggle: expands/collapses the optional control buttons (sound, feedback).
     * Swaps the chevron direction and updates aria-expanded for screen readers.
     * @param {Event} e
     */
    #handleToggleControls = (e) => {
        e.preventDefault();
        const expanded = this.#controlButtonsHolder.classList.toggle('expanded');
        this.#controlButtonsToggle.setAttribute('aria-expanded', expanded);
        const chevron = expanded ? 'chevron-left-white-feather.svg' : 'chevron-right-white-feather.svg';
        this.#controlButtonsToggleIcon.setAttribute('src', `/assets/images/icons/${chevron}`);
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
        this.#stuck.removeEventListener('click', this.#handleClickStuck);
        this.#stuck.addEventListener('click', this.#handleClickStuck);
    }

    /* Disable the stuck button. */
    disableStuckButton = () => {
        this.#stuck.removeEventListener('click', this.#handleClickStuck);
    }

    /* Visually disable the stuck and control-toggle buttons (used while onboarding takes over the UI). */
    disableButtons = () => {
        this.#stuck.classList.add('disabled');
        this.#controlButtonsToggle.classList.add('disabled');
    }

    /* Blink the stuck button. */
    blinkStuckButton = () => {
        this.stopBlinkingStuckButton();
        this.#blinkInterval = window.setInterval(() => {
            this.#stuck.classList.toggle("highlight-100");
        }, 500);
    };

    /* Stop blinking the stuck button. */
    stopBlinkingStuckButton = () => {
        window.clearInterval(this.#blinkInterval);
        this.#stuck.classList.remove("highlight-100");
    };
}
