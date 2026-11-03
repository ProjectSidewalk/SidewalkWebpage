/**
 * The pop-ups a labeler gets on their first real mission (frontend/js/explore/onboarding/InitialMissionInstruction.js,
 * #5840): the welcome, the "check both sides" picture after 100 m, the "labels disappear" note after the first label,
 * and the "follow the line" nudge for someone who spins around at the start without moving.
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker } from './fakes.js';

mockModule('i18next', () => ({ default: {
  t: (key, opts) => {
    const vars = Object.entries(opts ?? {}).filter(([name]) => name !== 'interpolation')
      .map(([name, value]) => `${name}=${value}`);
    return vars.length ? `${key}[${vars.join(',')}]` : key;
  },
} }));

let InitialMissionInstruction;
let c;

/** @returns {InitialMissionInstruction} The instructions over fresh collaborators the test drives. */
function instruction() {
  c = {
    compass: { blink: vi.fn(), stopBlinking: vi.fn() },
    navigationService: { onMoved: vi.fn(), offMoved: vi.fn() },
    popUpMessage: { notify: vi.fn(), notifyWithImage: vi.fn() },
    taskContainer: { getCompletedTaskDistance: () => c.metersWalked },
    labelContainer: { getAllLabels: () => c.labels },
    aiGuidance: { showAiGuidanceMessage: vi.fn() },
    minimap: { blinkMinimap: vi.fn(), stopBlinkingMinimap: vi.fn() },
    panoManager: { getPanoId: () => c.panoId },
    observedArea: { getFractionObserved: () => c.fractionObserved },
    tracker: fakeTracker(),
    metersWalked: 0,
    labels: [],
    panoId: 'start',
    fractionObserved: 0,
  };
  return new InitialMissionInstruction(c.compass, c.navigationService, c.popUpMessage, c.taskContainer,
    c.labelContainer, c.aiGuidance, c.minimap, c.panoManager, c.observedArea, c.tracker);
}

/** @returns {Function} The move handler most recently registered. */
const lastMoveHandler = () => c.navigationService.onMoved.mock.calls.at(-1)[0];

/**
 * @param {boolean} [withImage] - Whether the pop-up in question carried a picture.
 * @returns {Function} The OK callback of the pop-up of that kind most recently shown.
 */
const lastOk = (withImage = false) => (
  (withImage ? c.popUpMessage.notifyWithImage : c.popUpMessage.notify).mock.calls.at(-1).at(-1)
);

beforeEach(async () => {
  vi.useFakeTimers();
  window.cityNameShort = 'Seattle';
  ({ InitialMissionInstruction } = await loadModules('frontend/js/explore/onboarding/InitialMissionInstruction.js'));
});

const start = (i) => i.start({ getProperty: (key) => ({ name: 'Ballard' })[key] });

describe('InitialMissionInstruction', () => {
  it('welcomes the labeler to the region, then watches their walking and shows the AI guidance after OK', () => {
    start(instruction());

    expect(c.tracker.push).toHaveBeenCalledWith('PopUpShow_LetsGetStarted');
    expect(c.popUpMessage.notify).toHaveBeenCalledWith('popup.start-title',
      'popup.start-body[region=Ballard,city=Seattle]', expect.any(Function));
    expect(c.navigationService.onMoved).not.toHaveBeenCalled();

    lastOk()();
    expect(c.navigationService.onMoved).toHaveBeenCalledTimes(1);
    expect(c.aiGuidance.showAiGuidanceMessage).toHaveBeenCalledTimes(1);
  });

  it('after 100 m, shows the look-both-ways picture, then waits for the first label to explain the minimap', () => {
    start(instruction());
    lastOk()();
    const checkSidewalks = lastMoveHandler();

    c.metersWalked = 60;
    checkSidewalks();
    expect(c.popUpMessage.notifyWithImage).not.toHaveBeenCalled();

    c.metersWalked = 100;
    checkSidewalks();
    expect(c.tracker.push).toHaveBeenCalledWith('PopUpShow_CheckBothSides');
    expect(c.popUpMessage.notifyWithImage).toHaveBeenCalledWith('popup.both-sides-title', 'popup.both-sides-body',
      '/assets/images/examples/lookaround-example.gif', '450px', '291px', '50px', expect.any(Function));

    lastOk(true)();
    expect(c.navigationService.offMoved).toHaveBeenCalledWith(checkSidewalks);
    const labelsDisappear = lastMoveHandler();
    expect(labelsDisappear).not.toBe(checkSidewalks);

    labelsDisappear();
    expect(c.popUpMessage.notify).toHaveBeenCalledTimes(1);

    c.labels = [{}];
    labelsDisappear();
    expect(c.tracker.push).toHaveBeenCalledWith('PopUpShow_LabelDisappear');
    expect(c.popUpMessage.notify).toHaveBeenLastCalledWith('popup.labels-disappear-title',
      'popup.labels-disappear-body', expect.any(Function));
    expect(c.minimap.blinkMinimap).toHaveBeenCalled();

    lastOk()();
    expect(c.minimap.stopBlinkingMinimap).toHaveBeenCalled();
    expect(c.navigationService.offMoved).toHaveBeenCalledWith(labelsDisappear);
  });

  it('points at the compass and minimap once the labeler has looked all the way around without moving', () => {
    start(instruction());
    c.popUpMessage.notify.mockClear();

    c.fractionObserved = 0.5;
    vi.advanceTimersByTime(200);
    expect(c.popUpMessage.notify).not.toHaveBeenCalled();

    c.fractionObserved = 1;
    vi.advanceTimersByTime(50);
    expect(c.tracker.push).toHaveBeenCalledWith('PopUpShow_LookAroundIntersection');
    expect(c.popUpMessage.notify).toHaveBeenCalledWith('popup.step-title', 'popup.step-body', expect.any(Function));
    expect(c.compass.blink).toHaveBeenCalled();
    expect(c.minimap.blinkMinimap).toHaveBeenCalled();

    // Said once: the check stops as soon as it has fired.
    vi.advanceTimersByTime(500);
    expect(c.popUpMessage.notify).toHaveBeenCalledTimes(1);

    lastOk()();
    expect(c.compass.stopBlinking).toHaveBeenCalled();
    expect(c.minimap.stopBlinkingMinimap).toHaveBeenCalled();
  });

  it('stops checking once the labeler has walked somewhere', () => {
    start(instruction());
    c.popUpMessage.notify.mockClear();

    c.panoId = 'elsewhere';
    vi.advanceTimersByTime(50);
    c.panoId = 'start';
    c.fractionObserved = 1;
    vi.advanceTimersByTime(500);

    expect(c.popUpMessage.notify).not.toHaveBeenCalled();
  });
});
