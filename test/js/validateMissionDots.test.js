/**
 * Tests for the phone pill's progress dots (#5580): Mission keeps the verdict behind each label validated in this
 * page load, and StatusField draws a dot per label in that verdict's colour. Undo has to take the last dot back, and
 * a mission resumed from an earlier page load, whose first verdicts this page never saw, shows those as plain done.
 */

const { loadModules } = require('./loadGlobalScript');

describe('mission progress dots', () => {
    let Mission;
    let statusField;

    /** @returns {string[]} Each dot's modifier, or '' for one still to come. */
    const dots = () => [...document.querySelectorAll('#mission-progress-dots .svv-mission-dot')]
        .map((d) => [...d.classList].find((c) => c.startsWith('svv-mission-dot--'))?.slice('svv-mission-dot--'.length)
            ?? '');

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="mission-progress-dots" class="svv-mission-dots" aria-hidden="true"></div>
            <div id="mission-progress-bar-complete"></div><div id="mission-progress-bar-text"></div>`;
        window.svv = { ui: { status: {} } };
        window.ProgressBar = class { setFraction() {} setLabel() {} };
        ({ Mission } = loadModules('frontend/js/validate/mission/Mission.js'));
        const { StatusField } = loadModules('frontend/js/validate/status/StatusField.js');
        statusField = new StatusField(0);
    });

    test('a dot per label, each validated one in its verdict, the rest still to come', () => {
        const mission = new Mission({ labelsProgress: 0, labelsValidated: 5 });
        for (const verdict of ['Agree', 'Disagree', 'Unsure']) {
            mission.updateValidationResult(verdict, false);
            mission.setProperty('labelsProgress', mission.getProperty('labelsProgress') + 1);
        }
        statusField.setProgressDots(mission.getVerdicts(), 5);
        expect(dots()).toEqual(['agree', 'disagree', 'unsure', '', '']);
    });

    test('undo takes the last verdict back', () => {
        const mission = new Mission({ labelsProgress: 0, labelsValidated: 3 });
        mission.updateValidationResult('Agree', false);
        mission.updateValidationResult('Disagree', false);
        mission.setProperty('labelsProgress', 2);
        mission.updateValidationResult('Disagree', true);
        mission.setProperty('labelsProgress', 1);
        statusField.setProgressDots(mission.getVerdicts(), 3);
        expect(dots()).toEqual(['agree', '', '']);
    });

    test('a resumed mission shows the labels from before this page load as done, in no verdict', () => {
        const mission = new Mission({ labelsProgress: 4, labelsValidated: 10 });
        mission.updateValidationResult('Agree', false);
        mission.setProperty('labelsProgress', 5);
        expect(mission.getVerdicts()).toEqual([null, null, null, null, 'Agree']);
        statusField.setProgressDots(mission.getVerdicts(), 10);
        expect(dots().slice(0, 6)).toEqual(['done', 'done', 'done', 'done', 'agree', '']);
    });

    test('a mission too long for the pill hides the dots and leaves the bar', () => {
        statusField.setProgressDots([], 30);
        expect(document.getElementById('mission-progress-dots').hidden).toBe(true);
        statusField.setProgressDots([], 10);
        expect(document.getElementById('mission-progress-dots').hidden).toBe(false);
        expect(dots()).toHaveLength(10);
    });
});
