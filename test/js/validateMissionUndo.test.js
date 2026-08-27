const fs = require('fs');
const path = require('path');

function loadClass(relativePath, className) {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', relativePath), 'utf8');
    return (0, eval)('(() => {\n' + src + '\nreturn ' + className + ';\n})()');
}

const Mission = loadClass(
    'public/js/validate/src/mission/Mission.js',
    'Mission'
);

const UndoValidation = loadClass(
    'public/js/validate/src/menu/UndoValidation.js',
    'UndoValidation'
);

describe('Validate final-validation undo (#4034)', () => {
    afterEach(() => {
        delete global.svv;
    });

    test('a completed 10/10 mission can roll back to 9/10', () => {
        global.svv = {
            labelContainer: {
                getPriorLabelFormData: jest.fn(() => ({
                    validation_result: 'Agree'
                })),
                getLabelsToSubmit: jest.fn(() => [{ label_id: 1 }]),
                pop: jest.fn(),
                pushUndoValidation: jest.fn()
            },
            statusField: {
                decrementLabelCounts: jest.fn(),
                incrementLabelCounts: jest.fn(),
                setProgressBar: jest.fn(),
                setProgressText: jest.fn()
            },
            missionContainer: {
                cancelMissionCompletion: jest.fn(),
                completeAMission: jest.fn()
            }
        };

        const mission = new Mission({
            agreeCount: 1,
            disagreeCount: 0,
            unsureCount: 0,
            completed: true,
            labelsProgress: 10,
            labelsValidated: 10,
            missionId: 1,
            missionType: 'validation',
            labelTypeId: 1
        });

        mission.updateMissionProgress(true);

        expect(mission.getProperty('labelsProgress')).toBe(9);
        expect(mission.getProperty('completed')).toBe(false);
        expect(mission.getProperty('agreeCount')).toBe(0);

        expect(svv.labelContainer.pop).toHaveBeenCalled();
        expect(svv.missionContainer.cancelMissionCompletion).toHaveBeenCalled();
        expect(svv.missionContainer.completeAMission).not.toHaveBeenCalled();

        expect(svv.statusField.setProgressBar).toHaveBeenCalledWith(9, 10);
        expect(svv.statusField.setProgressText).toHaveBeenCalledWith(9, 10);
    });

    test('undoing the final validation keeps the current label on screen', async () => {
        let clickHandler;

        const undoButton = {
            on: jest.fn((event, handler) => {
                clickHandler = handler;
            }),
            prop: jest.fn()
        };

        global.svv = {
            tracker: {
                push: jest.fn()
            },
            validationMenu: {
                saveValidationState: jest.fn()
            },
            labelContainer: {
                undoLabel: jest.fn(() => Promise.resolve(true))
            },
            missionContainer: {
                getCurrentMission: jest.fn(() => ({
                    isComplete: () => true
                })),
                updateAMissionUndoValidation: jest.fn()
            }
        };

        new UndoValidation({ undoButton });

        await clickHandler();

        expect(svv.labelContainer.undoLabel).not.toHaveBeenCalled();
        expect(svv.missionContainer.updateAMissionUndoValidation).toHaveBeenCalled();
        expect(undoButton.prop).toHaveBeenCalledWith('disabled', true);
    });
});
