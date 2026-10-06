/**
 * Tests for Validate's label card opening on load on Infra3d cities (#5675), in
 * frontend/js/validate/label/LabelVisibilityControl.js.
 *
 * The card normally lives only while hovered. A card opened on load has to outlast the pointer wandering off it, yet
 * still close on the deliberate actions (hiding the label, or anything calling hideLabelCard), and a city on another
 * imagery source must never see it.
 */

const { loadModules } = require('./loadGlobalScript');

describe('LabelVisibilityControl opening the card on load', () => {
    /** Stands in for the Infra3d viewer class; only its identity matters. */
    class FakeInfra3dViewer {}

    let control;
    const card = () => document.getElementById('label-card');

    /**
     * Builds a fresh control for a city whose viewer is `viewerType`.
     * @param {Function} viewerType - The class the city's imagery uses.
     * @param {boolean} [mobile] - Whether this is the mobile page.
     */
    function build(viewerType, mobile = false) {
        window.svv = {
            legacyMobile: mobile,
            viewerType,
            tracker: { push: jest.fn() },
            labelCard: { closePopovers: jest.fn(), isPopoverOpen: () => false },
            panoManager: { getPanoMarker: () => null },
            ui: { viewer: { controlLayer: document.getElementById('view-control-layer') } },
        };
        window.util = { anchorPanelToLabel: jest.fn() };
        window.ValidateLayout = { isCompact: () => false }; // jsdom has no matchMedia; a wide window.
        window.Infra3dViewer = FakeInfra3dViewer;
        const { LabelVisibilityControl } = loadModules('frontend/js/validate/label/LabelVisibilityControl.js');
        control = new LabelVisibilityControl();
    }

    beforeEach(() => {
        jest.useFakeTimers();
        window.i18next = { t: (key) => key };
        document.body.innerHTML = `
          <div id="view-control-layer"><div id="validate-pano-marker" tabindex="0"></div></div>
          <button id="label-visibility-control-button"></button>
          <div id="label-card"><button type="button" id="label-visibility-button-on-label"></button></div>`;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('opens the card and logs it on an Infra3d city', () => {
        build(FakeInfra3dViewer);
        control.openCardOnLoad();

        expect(control.isCardVisible()).toBe(true);
        expect(control.isCardHeldOpen()).toBe(true);
        expect(window.svv.tracker.push).toHaveBeenCalledWith('LabelCard_OpenedOnLoad');
    });

    it('does nothing on a city with other imagery', () => {
        build(class OtherViewer {});
        control.openCardOnLoad();

        expect(control.isCardVisible()).toBe(false);
        expect(window.svv.tracker.push).not.toHaveBeenCalled();
    });

    it('does nothing on mobile', () => {
        build(FakeInfra3dViewer, true);
        control.openCardOnLoad();

        expect(control.isCardVisible()).toBe(false);
    });

    it('stays open when the pointer leaves the marker or the card', () => {
        build(FakeInfra3dViewer);
        control.openCardOnLoad();
        control.scheduleHideLabelCard();
        card().dispatchEvent(new MouseEvent('mouseleave'));
        jest.runAllTimers();

        expect(control.isCardVisible()).toBe(true);
    });

    it('closes when the label is hidden, and becomes a hover card again', () => {
        build(FakeInfra3dViewer);
        control.openCardOnLoad();
        control.hideLabel();

        expect(control.isCardVisible()).toBe(false);
        expect(control.isCardHeldOpen()).toBe(false);

        control.showLabelCard();
        control.scheduleHideLabelCard();
        jest.runAllTimers();

        expect(control.isCardVisible()).toBe(false);
    });

    it('sends focus back to the marker when its Hide-label button closes it', () => {
        build(FakeInfra3dViewer);
        control.openCardOnLoad();
        document.getElementById('label-visibility-button-on-label').focus();
        document.getElementById('label-visibility-button-on-label').click();

        expect(control.isCardVisible()).toBe(false);
        expect(document.activeElement).toBe(document.getElementById('validate-pano-marker'));
    });

    it('marks the card as held only while it is held, for the immersive dock rule', () => {
        build(FakeInfra3dViewer);
        control.openCardOnLoad();
        expect(card().classList.contains('label-card--held')).toBe(true);

        control.hideLabelCard();
        expect(card().classList.contains('label-card--held')).toBe(false);
    });
});
