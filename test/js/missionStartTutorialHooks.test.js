/**
 * Tests for how the mission-start tutorial hands the tool back (frontend/js/common/MissionStartTutorial.js, #5648).
 *
 * The tutorial takes a typed set of hooks from whichever tool shows it. Explore hands it no zoom control, so the
 * close path has to cope with a hook that isn't there: the Done button is the overlay's only way out, and a throw
 * on it leaves the user stuck behind the overlay with the keyboard off.
 */

const { assetPathStub, loadModules } = require('./loadGlobalScript');


/** The markup the tutorial fills in, reduced to the elements it reaches for. */
function buildFixture() {
    document.body.innerHTML = `
      <div class="mission-start-tutorial-overlay">
        <div class="mst-instruction-1"></div>
        <div class="mst-instruction-2"></div>
        <div class="mst-slide">
          <div class="label-type-title"></div>
          <div class="label-type-subtitle"></div>
          <div class="label-type-description"></div>
          <div class="example-type-label"></div>
          <img class="msts-image" alt="">
          <div class="label-on-image">
            <div class="label-on-image-type-title"></div>
          </div>
          <div class="label-on-image-description"></div>
        </div>
        <button class="previous-slide-button"></button>
        <div class="mst-carousel-location-indicator-area"></div>
        <template id="mst-carousel-location-indicator-template"><span class="mst-carousel-location-indicator"></span></template>
        <button class="next-slide-button"></button>
        <button class="mission-start-tutorial-done-btn"></button>
      </div>
      <div class="explore-mission-start-tab-bar ps-hidden">
        <button class="explore-mission-start-tab" data-label-type="CurbRamp">
          <span class="explore-mission-start-tab-text"></span>
        </button>
      </div>`;
}

describe('the mission-start tutorial closing', () => {
    let MissionStartTutorial;
    let hooks;

    beforeAll(() => {
        window.i18next = { t: (key) => key };
        window.util = { assetPath: assetPathStub };
        ({ MissionStartTutorial } = loadModules('frontend/js/common/MissionStartTutorial.js'));
    });

    beforeEach(() => {
        buildFixture();
        hooks = {
            tracker: { push: jest.fn() },
            keyboard: { enableKeyboard: jest.fn() },
            missionContainer: {
                getCurrentMission: () => ({
                    getProperty: (key) => ({ distanceProgress: 0, missionId: 7, missionType: 'audit', regionId: 3 })[key],
                    getDistance: () => 500,
                }),
            },
        };
    });

    it('hands Explore its tool back with the hooks Explore has, which do not include a zoom control', () => {
        new MissionStartTutorial('audit', 'CurbRamp', { nLength: 0.3, region: 'Downtown', resuming: false }, hooks);
        const done = jest.fn();
        document.addEventListener('ps:mission-start-tutorial:done', done, { once: true });

        document.querySelector('.mission-start-tutorial-done-btn').click();

        expect(document.querySelector('.mission-start-tutorial-overlay').style.display).toBe('none');
        expect(document.querySelector('.explore-mission-start-tab-bar').classList.contains('ps-hidden')).toBe(true);
        expect(hooks.keyboard.enableKeyboard).toHaveBeenCalled();
        expect(done).toHaveBeenCalled();
        expect(hooks.tracker.push).toHaveBeenCalledWith('MSTDoneButton_Click', { currentSlideIdx: 0 }, null);
        expect(hooks.tracker.push).toHaveBeenCalledWith('MissionStart', expect.objectContaining({ missionId: 7 }));
    });

    it('refreshes the zoom buttons for a tool that hands one in', () => {
        hooks.zoomControl = { updateZoomAvailability: jest.fn() };
        new MissionStartTutorial('validate', 'CurbRamp', { nLabels: 10 }, hooks);

        document.querySelector('.mission-start-tutorial-done-btn').click();

        expect(hooks.zoomControl.updateZoomAvailability).toHaveBeenCalled();
    });

    it('rebuilds itself from the same hooks when Explore switches the label type tab', () => {
        new MissionStartTutorial('audit', 'CurbRamp', { nLength: 0.3, region: 'Downtown', resuming: false }, hooks);

        document.querySelector('.explore-mission-start-tab').click();
        document.querySelector('.mission-start-tutorial-done-btn').click();

        expect(document.querySelector('.mission-start-tutorial-overlay').style.display).toBe('none');
        expect(hooks.keyboard.enableKeyboard).toHaveBeenCalled();
    });
});
