/**
 * Tests for what Validate's Form (frontend/js/validate/data/Form.js) puts in each POST: `compileSubmissionData` on a
 * page with a mission, during the first label's load before that mission exists, and on the dead-end page that has
 * none. The submit suites hand the Form a ready-made payload, so this is where the payload's shape is held (#5840).
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker } from './fakes.js';
import { routeFetch, sentRequests, flush } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (key) => key, language: 'es' } }));

/** Which UI the data comes from, and the validate params every POST echoes. */
const CONFIG = { source: 'ExpertValidate', validateParams: { admin_version: true, label_type_id: 2 } };

/**
 * A mission as MissionContainer holds one, answering from its server fields.
 * @param {Record<string, any>} props - Its properties.
 * @returns {{getProperty: (key: string) => any}} The mission.
 */
function fakeMission(props) {
  return { getProperty: (key) => props[key] };
}

/**
 * A staged pano as PanoStore hands it over: its id, and the earlier captures at the same spot.
 * @param {string} panoId - The pano's id.
 * @param {Array<{panoId: string, captureDate: Date}>} history - Its earlier captures.
 * @returns {object} The pano, with `setProperty` spied.
 */
function fakePano(panoId, history) {
  return { getProperties: () => ({ panoId, history }), setProperty: vi.fn() };
}

describe('Validate Form payload', () => {
  let Form;
  let tracker;

  beforeEach(async () => {
    ({ Form } = await loadModules('frontend/js/validate/data/Form.js'));
    tracker = fakeTracker({ getActions: () => [{ action: 'Click_Agree' }] });
  });

  test('on the dead-end page there is no mission: no progress, no verdicts, no pano history', () => {
    const form = new Form('/validationTask', CONFIG, tracker);

    const data = form.compileSubmissionData(false);

    expect(data).not.toHaveProperty('mission_progress');
    expect(data.validations).toEqual([]);
    expect(data.pano_histories).toEqual([]);
    expect(data.environment.mission_id).toBeNull();
    expect(data.source).toBe('ExpertValidate');
    expect(data.validate_params).toEqual(CONFIG.validateParams);
    expect(data.interactions).toEqual([{ action: 'Click_Agree' }]);
    expect(tracker.refresh).toHaveBeenCalledTimes(1);
  });

  describe('on a page with a mission', () => {
    let mission;
    let labelContainer;
    let panos;
    let form;
    let onMissionComplete;

    beforeEach(() => {
      mission = fakeMission({
        missionId: 11, missionType: 'validation', labelsProgress: 4, labelsValidated: 10, labelType: 'CurbRamp',
      });
      labelContainer = { getLabelsToSubmit: () => [{ label_id: 5, validation_result: 1 }], refresh: vi.fn() };
      panos = [fakePano('pano-now', [{ panoId: 'pano-2019', captureDate: new Date(2019, 6, 15) }])];
      form = new Form('/validationTask', CONFIG, tracker);
      form.attachSession({
        missionContainer: {
          getCurrentMission: () => mission,
          onMissionComplete: (listener) => { onMissionComplete = listener; },
        },
        labelContainer,
        panoStore: { getStagedPanoData: () => panos },
        modalMissionComplete: { hide: vi.fn(), nextMissionLoaded: vi.fn() },
        modalNoNewMission: { show: vi.fn() },
      });
    });

    test('a flush names the mission and its progress, still not completed', () => {
      const data = form.compileSubmissionData(false);

      expect(data.mission_progress).toEqual({
        mission_id: 11, mission_type: 'validation', labels_progress: 4, labels_total: 10, label_type: 'CurbRamp',
        completed: false,
      });
      expect(data.environment).toMatchObject({ mission_id: 11, language: 'es', css_zoom: 100 });
    });

    test('the verdicts waiting to go are sent and the container starts a fresh list', () => {
      const data = form.compileSubmissionData(false);

      expect(data.validations).toEqual([{ label_id: 5, validation_result: 1 }]);
      expect(labelContainer.refresh).toHaveBeenCalledTimes(1);
    });

    test('each staged pano goes with its earlier captures by month, and is marked as sent', () => {
      const data = form.compileSubmissionData(false);

      expect(data.pano_histories).toEqual([{
        curr_pano_id: 'pano-now', pano_history_saved: expect.any(Date), history: [{ pano_id: 'pano-2019', date: '2019-07' }],
      }]);
      expect(panos[0].setProperty).toHaveBeenCalledWith('submitted', true);
    });

    test('a flush during the first label\'s load, before the mission is set up, carries no progress', () => {
      mission = undefined;

      const data = form.compileSubmissionData(false);

      expect(data).not.toHaveProperty('mission_progress');
      expect(data.environment.mission_id).toBeNull();
      expect(data.validations).toEqual([{ label_id: 5, validation_result: 1 }]);
    });

    test('a finished mission is submitted at once, marked completed', async () => {
      const fetchStub = routeFetch({ '/validationTask': { has_mission_available: false } });

      onMissionComplete();
      await flush();

      expect(sentRequests(fetchStub)[0].body.mission_progress).toMatchObject({ mission_id: 11, completed: true });
    });
  });
});
