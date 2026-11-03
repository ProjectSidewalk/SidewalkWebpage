/**
 * Tests what Explore's Form (frontend/js/explore/data/Form.js) sends and what it does with the answer (#5840): the
 * events that make it submit on its own, the payload a street's labels and panos become, and how the server's reply
 * updates the task, the tracker, the labels and the street priorities. Pano staging and ensureLabelSaved have their
 * own suites, so neither is repeated here.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakePanoManager, fakeTaskContainer, fakeTracker, navigationAttempts } from './fakes.js';
import { flush, routeFetch, sentRequests } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { language: 'en' } }));

/** How the suite sees the reload a broken reply ends in. */
const reloads = navigationAttempts();

/**
 * @param {string} panoId
 * @param {Record<string, any>} [extra] - Properties beyond the bare pano's.
 * @returns {object} A pano in the store, with the metadata the submission reads.
 */
function panoStub(panoId, extra = {}) {
  const props = {
    panoId, source: 'gsv', captureDate: new Date(2024, 5, 3), width: 8192, height: 4096, tileWidth: 512,
    tileHeight: 512, lat: 41.87, lng: -87.62, cameraHeading: 180, cameraPitch: 0, cameraRoll: 0, linkedPanos: [],
    history: [], submitted: false, ...extra,
  };
  return {
    getProperties: () => props,
    getProperty: (key) => props[key],
    setProperty: vi.fn((key, value) => { props[key] = value; }),
  };
}

/**
 * @param {string} panoId
 * @param {number} tempLabelId
 * @param {Record<string, any>} [extra] - Properties beyond a bare curb ramp's.
 * @returns {object} A label placed this session.
 */
function labelStub(panoId, tempLabelId, extra = {}) {
  const props = {
    panoId, tutorial: false, panoXY: { x: 100.4, y: 99.6 }, originalCanvasXY: { x: 200, y: 200 },
    originalCanvasFrame: { width: 720, height: 480 }, originalPov: { heading: 90, pitch: 0, zoom: 1 },
    temporaryLabelId: tempLabelId, severity: 2, tagIds: [3], description: '', labelId: null, ...extra,
  };
  return {
    getProperties: () => props,
    getProperty: (key) => props[key],
    toLatLng: () => props.latLng ?? null,
    isDeleted: () => false,
    getLabelType: () => 'CurbRamp',
    updateLabelIdAndUploadCrop: vi.fn(),
  };
}

/**
 * @param {Record<string, any>} [answers] - What the task answers differently from a fresh one.
 * @returns {object} The audit task the submission describes.
 */
function taskStub(answers = {}) {
  const props = { taskStart: '2024-06-03T10:00:00Z', startPointReversed: false, routeStreetId: null };
  let ranges = [{ start: 0, end: 0.3 }];
  return {
    getAuditTaskId: () => 12,
    getStreetEdgeId: () => 34,
    getProperty: (key) => props[key],
    setProperty: vi.fn((key, value) => { props[key] = value; }),
    isComplete: () => false,
    getMissionStart: () => 0.1,
    getAuditedDistance: () => 70,
    lineDistance: () => 100,
    getCoveredRanges: () => ranges,
    setCoveredRanges: vi.fn((next) => { ranges = next; }),
    ...answers,
  };
}

describe('Explore Form submission', () => {
  let Form;
  let config;
  let currentTask;
  let panos;
  let labels;
  let interactions;
  let tracker;
  let missionModel;
  let missionContainer;
  let taskContainer;
  let labelContainer;
  let mission;
  /** What the server answers a submission with. */
  let reply;

  /** @returns {Form} A Form over the suite's stand-ins, as Main builds it. */
  function buildForm() {
    const panoStore = {
      getStagedPanoData: () => panos.filter((pano) => !pano.getProperty('submitted')),
      getPanoData: (id) => panos.find((pano) => pano.getProperty('panoId') === id) ?? null,
    };
    return new Form('/explore/store', config, labelContainer, missionModel, missionContainer, panoStore,
      taskContainer, fakePanoManager({ getPosition: () => ({ lat: 41.85, lng: -87.65 }) }), tracker);
  }

  beforeEach(async () => {
    ({ Form } = await loadModules('frontend/js/explore/data/Form.js'));
    useUtil({ getBrowser: () => 'chrome', getBrowserVersion: () => '1', getOperatingSystem: () => 'linux' });
    config = { userRouteId: null, regionId: 1, isOnboarding: false, isExploreAddressMode: false };
    currentTask = taskStub();
    panos = [panoStub('pano-A')];
    labels = [];
    interactions = [];
    reply = { audit_task_id: 12, label_ids: [], refresh_page: false };
    tracker = fakeTracker({ getActions: () => interactions });
    const missionProps = { missionId: 5, distanceProgress: 120, distance: 100, isComplete: false, skipped: false };
    mission = { getProperty: (key) => missionProps[key] };
    missionModel = { on: vi.fn(), createAMission: vi.fn() };
    missionContainer = { getCurrentMission: () => mission, updateDistanceProgress: vi.fn() };
    taskContainer = fakeTaskContainer(() => currentTask, {
      updateTaskPriorities: vi.fn(), renderTask: vi.fn(), onTaskEnded: vi.fn(), onTaskLeft: vi.fn(),
    });
    labelContainer = { getLabelsToLog: () => labels, clearLabelsToLog: vi.fn(), getAllLabels: () => labels };
    routeFetch({ 'POST /explore/store': () => reply });
  });

  describe('submits on its own', () => {
    it('when the mission\'s distance is done, for the street being walked', async () => {
      buildForm();
      const [event, onComplete] = missionModel.on.mock.calls[0];
      expect(event).toBe('MissionProgress:complete');
      onComplete();
      await flush();
      expect(sentRequests(fetch)[0].body.audit_task.street_edge_id).toBe(34);
    });

    it('when a street ends or is left, for that street', async () => {
      buildForm();
      taskContainer.onTaskEnded.mock.calls[0][0](taskStub({ getStreetEdgeId: () => 35 }));
      taskContainer.onTaskLeft.mock.calls[0][0](taskStub({ getStreetEdgeId: () => 36 }));
      await flush();
      expect(sentRequests(fetch).map((request) => request.body.audit_task.street_edge_id)).toEqual([35, 36]);
    });

    it('as the page goes away, with a request that outlives it', () => {
      buildForm();
      window.dispatchEvent(new Event('pagehide'));
      expect(tracker.push).toHaveBeenCalledWith('Unload');
      expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', keepalive: true });
      expect(JSON.parse(fetch.mock.calls[0][1].body).audit_task.audit_task_id).toBe(12);
    });
  });

  describe('describes the street and the session', () => {
    it('with the mission, the task, the environment and the drained interaction log', async () => {
      interactions = [{ action: 'Click_Something' }];
      await buildForm().submitData();
      const { body } = sentRequests(fetch)[0];
      expect(body).toMatchObject({
        user_route_id: null,
        mission: {
          mission_id: 5, distance_progress: 100, region_id: 1, completed: false, audit_task_id: 12, skipped: false,
        },
        audit_task: {
          street_edge_id: 34, audit_task_id: 12, completed: false, current_lat: 41.85, current_lng: -87.65,
          start_point_reversed: false, current_mission_start: 0.1, covered_ranges: [{ start: 0, end: 0.3 }],
          route_street_id: null,
        },
        environment: {
          browser: 'chrome',
          browser_version: '1',
          operating_system: 'linux',
          language: 'en',
          css_zoom: 100,
        },
        interactions: [{ action: 'Click_Something' }],
      });
      expect(tracker.refresh).toHaveBeenCalledTimes(1);
      expect(missionContainer.updateDistanceProgress).toHaveBeenCalledWith(mission);
      expect(labelContainer.clearLabelsToLog).toHaveBeenCalledTimes(1);
    });

    it('asks for fresh street priorities past 60% of a street, but never on a route or in the tutorial', async () => {
      await buildForm().submitData();
      expect(sentRequests(fetch)[0].body.audit_task.request_updated_street_priority).toBe(true);

      await buildForm().submitData(taskStub({ getAuditedDistance: () => 50 }));
      expect(sentRequests(fetch)[1].body.audit_task.request_updated_street_priority).toBe(false);

      config = { ...config, userRouteId: 8 };
      await buildForm().submitData();
      expect(sentRequests(fetch)[2].body.audit_task.request_updated_street_priority).toBe(false);

      config = { ...config, userRouteId: null, isOnboarding: true };
      await buildForm().submitData();
      expect(sentRequests(fetch)[3].body.audit_task.request_updated_street_priority).toBe(false);
    });

    it('with each label\'s point, its estimated position, when it was placed, and its pano', async () => {
      const latLng = { lat: 41.871, lng: -87.621, latLngComputationMethod: 'depth' };
      labels = [labelStub('pano-A', 7, { latLng, description: 'bumpy' }), labelStub('pano-A', 8)];
      const placed = new Date(2024, 5, 3, 10, 5);
      interactions = [
        { action: 'LabelingCanvas_FinishLabeling', temporary_label_id: 7, timestamp: placed },
        { action: 'ContextMenu_Close', temporary_label_id: 8, timestamp: placed },
      ];
      panos = [panoStub('pano-A', {
        linkedPanos: [{ panoId: 'pano-B', heading: 90, description: 'Main St' }, { panoId: 'pano-C', heading: 270 }],
        history: [{ panoId: 'pano-old', captureDate: new Date(2019, 0, 15) }],
        copyright: '© Google', license: 'CC', address: '1 Main St',
      })];
      await buildForm().submitData();
      const [first, second] = sentRequests(fetch)[0].body.labels;
      expect(first).toMatchObject({
        deleted: false, label_type: 'CurbRamp', temporary_label_id: 7, pano_id: 'pano-A', pano_source: 'gsv',
        severity: 2, tag_ids: [3], description: 'bumpy', time_created: placed.toISOString(), tutorial: false,
        label_point: {
          pano_x: 100, pano_y: 100, canvas_x: 200, canvas_y: 200, canvas_width: 720, canvas_height: 480,
          heading: 90, pitch: 0, zoom: 1, lat: 41.871, lng: -87.621, computation_method: 'depth',
        },
      });
      expect(first.pano).toEqual({
        pano_id: 'pano-A', source: 'gsv', capture_date: '2024-06', width: 8192, height: 4096, tile_width: 512,
        tile_height: 512, lat: 41.87, lng: -87.62, camera_heading: 180, camera_pitch: 0, camera_roll: 0,
        links: [
          { target_pano_id: 'pano-B', yaw_deg: 90, description: 'Main St' },
          { target_pano_id: 'pano-C', yaw_deg: 270, description: null },
        ],
        copyright: '© Google', license: 'CC', address: '1 Main St',
        history: [{ pano_id: 'pano-old', date: '2019-01' }],
      });
      // No placement in this batch's log, no estimate, and an empty description, which is sent as none.
      expect(second).toMatchObject({ time_created: null, description: null, label_point: { lat: null, lng: null } });
      expect(second.label_point.computation_method).toBeUndefined();
    });
  });

  describe('applies the server\'s answer', () => {
    it('writes the audit task id onto the task and the tracker', async () => {
      await buildForm().submitData();
      expect(currentTask.setProperty).toHaveBeenCalledWith('auditTaskId', 12);
      expect(tracker.setAuditTaskID).toHaveBeenCalledWith(12);
    });

    it('unions the server\'s covered ranges with the local ones and redraws the street', async () => {
      reply = { ...reply, covered_ranges: [{ start: 0.5, end: 0.6 }] };
      await buildForm().submitData();
      expect(currentTask.setCoveredRanges).toHaveBeenCalledWith([{ start: 0, end: 0.3 }, { start: 0.5, end: 0.6 }]);
      expect(taskContainer.renderTask).toHaveBeenCalledWith(currentTask);
    });

    it('starts the next mission the server sends, outside the tutorial', async () => {
      reply = { ...reply, mission: { mission_id: 6 } };
      await buildForm().submitData();
      expect(missionModel.createAMission).toHaveBeenCalledWith({ mission_id: 6 });

      config = { ...config, isOnboarding: true };
      await buildForm().submitData();
      expect(missionModel.createAMission).toHaveBeenCalledTimes(1);
    });

    it('takes updated street priorities, and dates the next request from them', async () => {
      reply = {
        ...reply,
        updated_streets: { last_priority_update_time: '2024-06-03T10:10:00Z', updated_street_priorities: [{ id: 1 }] },
      };
      const form = buildForm();
      await form.submitData();
      expect(taskContainer.updateTaskPriorities).toHaveBeenCalledWith([{ id: 1 }]);
      reply = { audit_task_id: 12, label_ids: [] };
      await form.submitData();
      expect(sentRequests(fetch)[1].body.audit_task.last_priority_update_time).toBe('2024-06-03T10:10:00Z');
    });

    it('gives each label its id, which starts its crop upload, outside the tutorial', async () => {
      labels = [labelStub('pano-A', 7), labelStub('pano-A', 8)];
      reply = { ...reply, label_ids: [{ temporary_label_id: 8, label_id: 801 }] };
      await buildForm().submitData();
      expect(labels[1].updateLabelIdAndUploadCrop).toHaveBeenCalledWith(801);
      expect(labels[0].updateLabelIdAndUploadCrop).not.toHaveBeenCalled();

      config = { ...config, isOnboarding: true };
      reply = { audit_task_id: 12, mission: { mission_id: 6 } };
      await buildForm().submitData();
      expect(labels[1].updateLabelIdAndUploadCrop).toHaveBeenCalledTimes(1);
    });

    it('reloads when the server says the session is out of step', async () => {
      reply = { ...reply, refresh_page: true };
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await buildForm().submitData();
      expect(reloads).toHaveBeenCalledTimes(1);
    });
  });

  it('serializes overlapping submissions, so each carries only its own batch', async () => {
    const form = buildForm();
    labels = [labelStub('pano-A', 7)];
    const first = form.submitData();
    labels = [];
    const second = form.submitData();
    await Promise.all([first, second]);
    expect(sentRequests(fetch).map((request) => request.body.labels.length)).toEqual([1, 0]);
  });
});
