/**
 * The message a labeler gets when Explore moves them off a street it couldn't show them (#4918).
 *
 * This one is not a tip. Explore relocates the labeler without being asked, and the banner is the only thing that
 * accounts for the screen changing under them — so unlike the keyboard-shortcut nudges it is shown without a "don't
 * show again" link, and a labeler who silenced it back when it had one gets it back. The opt-out list lives in
 * localStorage and never expires, so "silenced once" otherwise means "silenced on that browser forever": the account
 * this was found on had it silenced, which is exactly why the teleports looked unexplained.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const readSrc = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

const ALERT_SRC = readSrc('public/js/explore/src/alert/Alert.js');
const ALERT_CONTROLLER_SRC = readSrc('public/js/explore/src/alert/AlertController.js');
const STUCK_ALERT_SRC = readSrc('public/js/explore/src/alert/StuckAlert.js');

describe('the "we moved you off that street" message', () => {
    let stored;
    let getStreetNameNear;
    let alertController;
    let stuckAlert;

    /** Builds the banner markup AlertController binds to, and the collaborators it reads at construction. */
    const setUp = ({ silenced = [] } = {}) => {
        document.body.innerHTML = `
            <div id="alert-holder" class="ps-hidden">
              <span id="alert-message"></span>
              <button id="alert-close"></button>
              <button id="alert-dont-show"></button>
            </div>`;
        stored = { alertDontShowList: silenced };
        window.svl = {
            storage: {
                get: (key) => stored[key],
                set: (key, value) => { stored[key] = value; },
            },
        };
        alertController = new window.AlertController();
        stuckAlert = new window.StuckAlert(alertController);
    };

    beforeEach(() => {
        // jsdom has no Web Animations API, and the banner fades in and out through it.
        Element.prototype.animate = jest.fn(() => ({
            addEventListener: (_event, handler) => handler(),
        }));

        getStreetNameNear = jest.fn(() => Promise.resolve(null));
        window.util = { misc: { getStreetNameNear } };
        window.i18next = { t: (key, interpolation) => JSON.stringify({ key, ...interpolation }) };

        window.eval(`${ALERT_SRC}; window.Alert = Alert;`);
        window.eval(`${ALERT_CONTROLLER_SRC}; window.AlertController = AlertController;`);
        window.eval(`${STUCK_ALERT_SRC}; window.StuckAlert = StuckAlert;`);
    });

    /** The i18next key the banner currently displays, per the stub's serialization. */
    const shownKey = () => JSON.parse(document.getElementById('alert-message').innerHTML).key;
    const bannerVisible = () => !document.getElementById('alert-holder').classList.contains('ps-hidden');
    const optOutOffered = () => document.getElementById('alert-dont-show').style.display !== 'none';

    it('is shown without the option to silence it', () => {
        setUp();

        stuckAlert.stuckSkippedStreet();

        expect(bannerVisible()).toBe(true);
        expect(shownKey()).toBe('popup.stuck-skipped-street');
        expect(optOutOffered()).toBe(false);
    });

    it('reaches a labeler who silenced it, and clears the silence', () => {
        setUp({ silenced: ['zoomMessage', 'stuckStreetSkipped'] });

        stuckAlert.stuckSkippedStreet();

        expect(bannerVisible()).toBe(true);
        expect(stored.alertDontShowList).toEqual(['zoomMessage']);
    });

    it('leaves other messages silenced, since those still offer the choice', () => {
        setUp({ silenced: ['stuckSuggestion'] });

        stuckAlert.panoVisited('pano-a');
        stuckAlert.panoVisited('pano-a');
        stuckAlert.panoVisited('pano-a');

        expect(bannerVisible()).toBe(false);
        expect(stored.alertDontShowList).toEqual(['stuckSuggestion']);
    });

    it('names the street the labeler landed on when the lookup finds one', async () => {
        setUp();
        getStreetNameNear.mockResolvedValue('Palisade Ave');

        await stuckAlert.announceSkippedStreetNear({ lat: 40.9, lng: -74.0 }, 'mapbox-token');

        const shown = JSON.parse(document.getElementById('alert-message').innerHTML);
        expect(shown.key).toBe('popup.stuck-skipped-street-named');
        expect(shown.streetName).toBe('Palisade Ave');
    });

    it('still says something when the street cannot be named', async () => {
        setUp();
        getStreetNameNear.mockResolvedValue(null);

        await stuckAlert.announceSkippedStreetNear({ lat: 40.9, lng: -74.0 }, 'mapbox-token');

        // Geocoding is decoration; losing it must not cost the labeler the explanation itself.
        expect(shownKey()).toBe('popup.stuck-skipped-street');
        expect(bannerVisible()).toBe(true);
    });
});
