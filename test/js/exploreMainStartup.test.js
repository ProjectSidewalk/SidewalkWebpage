/**
 * Tests what Explore's start-up (frontend/js/explore/Main.js) does once its modules exist, by session (#5840): where
 * the viewer is seeded, what happens when it never loads, the notices and toasts a visit may owe, the tutorial's
 * intro and skip, free exploration at an address, the mission-start screen, the callbacks Main hands its modules,
 * and the layout pass. Runs over the recording stand-ins in support/exploreMainHarness.js.
 */

import { navigationAttempts } from './fakes.js';
import { useUtil } from './loader.js';
import {
  FIXTURE, PARAMS, SESSION, exploreMain, i18n, makeMission, makeTask, standIn, startExploreMain,
} from './support/exploreMainHarness.js';
import { flush } from './support/routeFetch.js';

/** The page moves jsdom refuses: the retake-tutorial reload, the tutorial skip, and the route exit. */
const navigations = navigationAttempts();

/** The session a first-time visitor gets: the tutorial mission on the tutorial street. */
const TUTORIAL_SESSION = {
  ...SESSION,
  mission: { mission_type: 'auditOnboarding', mission_id: 1, current_audit_task_id: 2 },
  task: { properties: { street_edge_id: PARAMS.tutorialStreetId, current_lat: 47.6, current_lng: -122.3 } },
};

/** The session a free-exploration drop-in gets (#4451). */
const ADDRESS_SESSION = {
  ...SESSION,
  mission: { mission_type: 'exploreAddress', mission_id: 8, current_audit_task_id: 9 },
  start_lat: 47.7,
  start_lng: -122.4,
};

beforeEach(() => {
  document.body.innerHTML = FIXTURE;
  window.sessionStorage.clear();
});

/** Fires what the mission-start screen fires when the labeler dismisses it. */
const dismissMissionStart = () => document.dispatchEvent(new Event('ps:mission-start-tutorial:done'));

describe('Explore Main seeds the viewer', () => {
  it('opens the tutorial on its synthetic pano, with Google Street View whatever the city uses', async () => {
    await startExploreMain({ session: TUTORIAL_SESSION });
    const { panoManager, frame } = exploreMain.built;
    expect(panoManager.ctorArgs[5]).toEqual({ startPanoId: 'tutorial' });
    expect(panoManager.ctorArgs[1].viewerType).not.toBe(PARAMS.viewerType);
    expect(frame.ctorArgs[0]).toBe('gsv');
  });

  it('lets an explicit seed win over the task\'s own position, keeping the lat/lng as the pano fallback', async () => {
    const session = { ...SESSION, start_lat: 47.7, start_lng: -122.4, start_pov: { heading: 90, pitch: 0, zoom: 1 } };
    await startExploreMain({ session });
    const { panoManager, minimap } = exploreMain.built;
    expect(panoManager.ctorArgs[5]).toEqual({
      startPanoId: 'pano1', startLat: 47.7, startLng: -122.4, startPov: session.start_pov,
    });
    expect(minimap.ctorArgs[1]).toEqual({ lat: 47.7, lng: -122.4 });
  });

  it('stops building once the viewer reports no usable imagery, leaving only the config on the handle', async () => {
    const handle = await startExploreMain({
      adjust: (fakes) => {
        fakes.PanoManager = standIn('panoManager', { ready: Promise.resolve(false) },
          { consumeStreetSkippedNotice: () => null });
      },
    });
    expect(Object.keys(handle)).toEqual(['config']);
    expect(exploreMain.built.taskContainer).toBeUndefined();
  });

  it('explains a skipped street only when the labeler landed somewhere else', async () => {
    const skipped = (id) => (fakes) => {
      fakes.PanoManager = standIn('panoManager', {
        ready: Promise.resolve(true),
        panning: new exploreMain.Gate(),
        getPosition: () => ({ lat: 47.6, lng: -122.3 }),
        getPanoId: () => 'pano1',
        getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
        panoViewer: { resize: vi.fn(), repaint: vi.fn() },
      }, { consumeStreetSkippedNotice: () => id });
    };
    await startExploreMain({ adjust: skipped(42) });
    expect(exploreMain.built.stuckAlert.announceSkippedStreetNear).not.toHaveBeenCalled();

    await startExploreMain({ adjust: skipped(7) });
    expect(exploreMain.built.stuckAlert.announceSkippedStreetNear)
      .toHaveBeenCalledWith({ lat: 47.6, lng: -122.3 }, 'token');
  });
});

describe('Explore Main takes the audit task id', () => {
  it('from the session when the task has none yet', async () => {
    const task = makeTask({ auditTaskId: null });
    await startExploreMain({ task });
    expect(task.setProperty).toHaveBeenCalledWith('auditTaskId', 9);
    expect(exploreMain.built.form.submitData).not.toHaveBeenCalled();
  });

  it('leaves a task that already has one alone', async () => {
    const task = makeTask();
    await startExploreMain({ task });
    expect(task.setProperty).not.toHaveBeenCalled();
  });

  it('asks the server for one when the session has none', async () => {
    await startExploreMain({ session: { ...SESSION, mission: { ...SESSION.mission, current_audit_task_id: null } } });
    expect(exploreMain.built.form.submitData).toHaveBeenCalledTimes(1);
  });
});

describe('Explore Main wires the callbacks its modules call back on', () => {
  beforeEach(async () => {
    await startExploreMain();
  });

  it('logs a route-forward arrow click and whether the move landed', async () => {
    const { navArrows, navigationService, tracker } = exploreMain.built;
    const onRouteForward = navArrows.onRouteForwardClick.mock.calls[0][0];
    onRouteForward();
    await flush();
    expect(tracker.push).toHaveBeenCalledWith('Click_RouteForwardArrow');
    expect(tracker.push).toHaveBeenCalledWith('RouteForwardArrow_Success');

    navigationService.moveForward.mockImplementation(() => Promise.reject(new Error('no pano')));
    onRouteForward();
    await flush();
    expect(tracker.push).toHaveBeenCalledWith('RouteForwardArrow_PanoNotAvailable');
    navArrows.onLinkClick.mock.calls[0][0]('pano2');
    expect(navigationService.moveToPano).toHaveBeenCalledWith('pano2');
  });

  it('fits the overview to the mission\'s streets plus the one walked and the ones previewed', () => {
    const { minimap, taskContainer, missionContainer, walkPlanLayer, regionModel } = exploreMain.built;
    const overview = minimap.setOverviewStreets.mock.calls[0][0];
    const current = taskContainer.getCurrentTask();
    const routed = { id: 'routed' };
    const previewed = { id: 'previewed' };
    missionContainer.getCurrentMission = () => ({ getRoute: () => [routed] });
    walkPlanLayer.getPreviewedTasks = () => [previewed, routed];
    expect(overview()).toEqual([routed, current, previewed]);

    // Already among the mission's streets, so it isn't listed twice.
    missionContainer.getCurrentMission = () => ({ getRoute: () => [current] });
    walkPlanLayer.getPreviewedTasks = () => [];
    expect(overview()).toEqual([current]);
    missionContainer.getCurrentMission = () => undefined;
    expect(overview()).toEqual([current]);

    // A route is walked whole, so the overview is every street of it.
    regionModel.isRoute = true;
    expect(overview()).toEqual(taskContainer.getTasks());
  });

  it('hands immersive mode what it needs: the frame, the hint anchor, and the menu to close first', () => {
    const { immersiveMode, contextMenu, canvas, urlSync, panoManager } = exploreMain.built;
    const options = immersiveMode.ctorArgs[0];
    expect(options.isDisabled()).toBe(false);
    expect(options.frame()).toEqual({ width: 720, height: 480 });
    expect(options.hintReference()).toBe(document.getElementById('pano'));

    options.beforeToggle();
    expect(contextMenu.hide).not.toHaveBeenCalled();
    contextMenu.isOpen = () => true;
    options.beforeToggle();
    expect(contextMenu.hide).toHaveBeenCalledTimes(1);
    expect(canvas.showLabelHoverInfo).toHaveBeenCalledWith(undefined);

    options.onChange();
    expect(urlSync.request).toHaveBeenCalledTimes(1);
    options.relayout();
    expect(panoManager.panoViewer.resize).toHaveBeenCalled();
  });

  it('pauses the shortcuts while the image adjustments panel is open, and logs its use', () => {
    const { imageAdjustmentsPopover, imageAdjustments, keyboard, tracker, panoOverlayControls, immersiveMode }
      = exploreMain.built;
    const keyboardLock = keyboard.ctorArgs[0];
    const options = imageAdjustmentsPopover.ctorArgs[3];
    expect(options.placement()).toBe('below');
    immersiveMode.isActive = () => true;
    expect(options.placement()).toBe('right');

    // The mission-start screen's hold is let go first, so the panel's own hold is what's measured.
    keyboardLock.release('tutorial');
    options.onOpen();
    expect(keyboardLock.isHeld()).toBe(true);
    expect(tracker.push).toHaveBeenCalledWith('Click_ImageAdjustments_Open');
    options.onClose('escape');
    expect(keyboardLock.isHeld()).toBe(false);
    expect(tracker.push).toHaveBeenCalledWith('Click_ImageAdjustments_Close', { via: 'escape' });
    options.onChange({ brightness: 1.2 });
    expect(tracker.push).toHaveBeenCalledWith('ImageAdjustments_Change', { brightness: 1.2 });
    options.onReset();
    expect(tracker.push).toHaveBeenCalledWith('Click_ImageAdjustments_Reset');

    // The chevron mirrors whether an adjustment is on while the Image pill hides in its menu.
    expect(panoOverlayControls.setCollapsedIndicator).toHaveBeenCalledWith(false);
    imageAdjustments.isDefault = () => false;
    imageAdjustments.onChange.mock.calls[0][0]();
    expect(panoOverlayControls.setCollapsedIndicator).toHaveBeenLastCalledWith(true);
    expect(tracker.push).not.toHaveBeenCalledWith('ImageAdjustments_Restored', expect.anything());
  });

  it('tells the pano info popover and the speed limit sign where the labeler is', () => {
    const { panoInfoPopover, speedLimit, panoManager, tracker } = exploreMain.built;
    const [, viewer, position, panoId, streetEdgeId, regionId, captureDate, address, pov, , onClick, onCopy, onView]
      = panoInfoPopover.ctorArgs;
    expect(viewer()).toBe(panoManager.panoViewer);
    expect(position()).toEqual({ lat: 47.6, lng: -122.3 });
    expect(panoId()).toBe('pano1');
    streetEdgeId();
    expect(exploreMain.built.taskContainer.getCurrentTaskStreetEdgeId).toHaveBeenCalled();
    expect(regionId()).toBe(5);
    expect(captureDate()).toBe('2024-05');
    expect(address()).toBe('2024-05');
    expect(pov()).toEqual({ heading: 0, pitch: 0, zoom: 1 });
    onClick();
    onCopy();
    onView();
    expect(tracker.push.mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining(
      ['PanoInfoButton_Click', 'PanoInfoCopyToClipboard_Click', 'PanoInfoViewInPano_Click']));

    const [speedViewer, speedPosition, isOnboarding, countryId] = speedLimit.ctorArgs;
    expect(speedViewer()).toBe(panoManager.panoViewer);
    expect(speedPosition()).toEqual({ lat: 47.6, lng: -122.3 });
    expect(isOnboarding()).toBe(false);
    expect(countryId).toBe('usa');
  });

  it('keeps the address bar on the pano as it changes, naming the mission for the labeler\'s own reloads', () => {
    const { urlSync, panoManager } = exploreMain.built;
    expect(urlSync.start).toHaveBeenCalledTimes(1);
    const [viewer, isImmersive, sessionParams] = urlSync.ctorArgs;
    expect(viewer).toBe(panoManager.panoViewer);
    expect(isImmersive()).toBe(false);
    expect(sessionParams()).toEqual({ missionId: 7 });
    panoManager.onPanoChanged.mock.calls[0][0]();
    expect(urlSync.request).toHaveBeenCalledTimes(1);
  });
});

describe('Explore Main logs adjustments carried in from an earlier visit', () => {
  it('records the restored values once, and lights the chevron', async () => {
    await startExploreMain({
      adjust: (fakes) => {
        fakes.PanoImageAdjustments = standIn('imageAdjustments', {
          isDefault: () => false, values: () => ({ contrast: 1.5 }),
        });
      },
    });
    const { tracker, panoOverlayControls } = exploreMain.built;
    expect(tracker.push).toHaveBeenCalledWith('ImageAdjustments_Restored', { contrast: 1.5 });
    expect(panoOverlayControls.setCollapsedIndicator).toHaveBeenCalledWith(true);
  });
});

describe('Explore Main loads the region\'s data', () => {
  it('shows the tool only once the tasks, the completed missions and the label tags are all in', async () => {
    let tagsLoaded;
    await startExploreMain({
      adjust: (fakes) => {
        fakes.ContextMenu = standIn('contextMenu', {
          isOpen: () => false, fetchLabelTags: (done) => { tagsLoaded = done; },
        });
      },
    });
    const loading = document.getElementById('page-loading');
    expect(loading.style.visibility).toBe('');
    expect(exploreMain.built.missionStartTutorial).toBeUndefined();
    tagsLoaded();
    expect(loading.style.visibility).toBe('hidden');
    expect(document.querySelector('.tool-ui').classList.contains('ps-invisible')).toBe(false);
    const { taskContainer, missionContainer } = exploreMain.built;
    expect(taskContainer.fetchTasks).toHaveBeenCalledWith(missionContainer.getCurrentMission());
  });

  it('plants a route\'s start and finish flags once its streets are known', async () => {
    const endpoints = { start: { lat: 1, lng: 2 }, finish: { lat: 3, lng: 4 } };
    const onRoute = (ends) => (fakes) => {
      fakes.RegionModel = standIn('regionModel', { isRoute: true, currentRegion: () => ({ getRegionId: () => 5,
        getProperty: () => 'Ballard' }) });
      fakes.TaskContainer = standIn('taskContainer', {
        getCurrentTask: () => makeTask(),
        getTasks: () => [],
        fetchTasks: vi.fn(() => Promise.resolve()),
        hasMaxPriorityTask: () => true,
        getCompletedTaskDistance: () => 0,
        getRouteEndpoints: () => ends,
      });
    };
    await startExploreMain({ adjust: onRoute(endpoints) });
    expect(exploreMain.built.minimapMissionProgress.showRouteEndpoints)
      .toHaveBeenCalledWith(endpoints.start, endpoints.finish);

    await startExploreMain({ adjust: onRoute(null) });
    expect(exploreMain.built.minimapMissionProgress.showRouteEndpoints).not.toHaveBeenCalled();
  });

  it('marks the region done for everyone when no street is left at top priority', async () => {
    await startExploreMain();
    expect(exploreMain.built.regionModel.setRegionCompleteAcrossAllUsers).not.toHaveBeenCalled();
    await startExploreMain({
      adjust: (fakes) => {
        fakes.TaskContainer = standIn('taskContainer', {
          getCurrentTask: () => makeTask(),
          fetchTasks: vi.fn(() => Promise.resolve()),
          hasMaxPriorityTask: () => false,
          getCompletedTaskDistance: () => 0,
        });
      },
    });
    expect(exploreMain.built.regionModel.setRegionCompleteAcrossAllUsers).toHaveBeenCalledTimes(1);
  });

  it('faces the route unless the visit came with its own point of view', async () => {
    await startExploreMain();
    expect(exploreMain.built.compass.faceRoute).toHaveBeenCalledTimes(1);
    await startExploreMain({ session: { ...SESSION, start_pov: { heading: 90, pitch: 0, zoom: 1 } } });
    expect(exploreMain.built.compass.faceRoute).not.toHaveBeenCalled();
  });

  it('nets the mission\'s banked distance against the streets already walked', async () => {
    await startExploreMain({
      mission: makeMission({ distanceProgress: 30 }),
      adjust: (fakes) => {
        fakes.MissionContainer = standIn('missionContainer', {
          getCurrentMission: () => makeMission({ distanceProgress: 30 }),
          isTheFirstMission: () => false,
          getCompletedMissionDistance: () => 100,
        });
        fakes.TaskContainer = standIn('taskContainer', {
          getCurrentTask: () => makeTask(),
          fetchTasks: vi.fn(() => Promise.resolve()),
          hasMaxPriorityTask: () => true,
          getCompletedTaskDistance: () => 0.2,
        });
      },
    });
    expect(exploreMain.built.missionContainer.setTasksMissionsOffset).toHaveBeenCalledWith(100 - 200 + 30);
  });
});

describe('Explore Main starts the mission', () => {
  it('explains the first mission with the instruction walkthrough, and later ones with the AI note', async () => {
    await startExploreMain();
    let m = exploreMain.built;
    expect(m.initialMissionInstruction).toBeUndefined();
    expect(m.aiGuidance.showAiGuidanceMessage).toHaveBeenCalledTimes(1);

    await startExploreMain({
      adjust: (fakes) => {
        fakes.MissionContainer = standIn('missionContainer', {
          getCurrentMission: () => makeMission(),
          isTheFirstMission: () => true,
          getCompletedMissionDistance: () => 0,
        });
      },
    });
    m = exploreMain.built;
    expect(m.initialMissionInstruction.ctorArgs).toEqual(expect.arrayContaining([m.compass, m.popUpMessage]));
    expect(m.initialMissionInstruction.start).toHaveBeenCalledWith(m.regionModel.currentRegion());
    expect(m.aiGuidance.showAiGuidanceMessage).not.toHaveBeenCalled();
  });

  it('paints the resumed labels on the pano once the icons are warm', async () => {
    await startExploreMain();
    const { labelContainer, canvas, streetSweep } = exploreMain.built;
    const [regionId, userRouteId, onLoaded] = labelContainer.fetchLabelsToResumeMission.mock.calls[0];
    expect([regionId, userRouteId]).toEqual([5, null]);
    onLoaded();
    expect(canvas.setOnlyLabelsOnPanoAsVisible).toHaveBeenCalledWith('pano1');
    await Promise.resolve();
    expect(canvas.render).toHaveBeenCalledTimes(1);
    expect(streetSweep.prefetchAlongStreet).toHaveBeenCalledWith(makeTask().getFeature());
  });
});

describe('Explore Main raises the mission-start screen', () => {
  it('says the mission is resumed when distance is banked or a street was already under way', async () => {
    await startExploreMain();
    expect(exploreMain.built.missionStartTutorial.ctorArgs[2].resuming).toBe(false);

    await startExploreMain({ mission: makeMission({ distanceProgress: 40 }) });
    expect(exploreMain.built.missionStartTutorial.ctorArgs[2].resuming).toBe(true);

    const task = { properties: { ...SESSION.task.properties, audit_task_id: 9 } };
    await startExploreMain({ session: { ...SESSION, task } });
    expect(exploreMain.built.missionStartTutorial.ctorArgs[2]).toEqual({
      nLength: 1,
      region: 'Ballard',
      resuming: true,
    });
  });

  it('shows the re-audit notice once the screen closes, with no toast owed', async () => {
    await startExploreMain();
    const { reauditNotice, taskContainer } = exploreMain.built;
    expect(reauditNotice.showForTask).not.toHaveBeenCalled();
    dismissMissionStart();
    expect(reauditNotice.showForTask).toHaveBeenCalledWith(taskContainer.getCurrentTask());
    expect(exploreMain.fakes.Toast.show).not.toHaveBeenCalled();
  });

  /** The toast Main queued behind the mission-start screen, with the event it logged. */
  function toastShown() {
    dismissMissionStart();
    const { tracker } = exploreMain.built;
    const { show } = exploreMain.fakes.Toast;
    const event = tracker.push.mock.calls.map(([name]) => name).find((name) => name.endsWith('Toast_Shown'));
    return { event, options: show.mock.calls[0]?.[0] };
  }

  it('says when the route in the link could not be opened', async () => {
    await startExploreMain({ session: { ...SESSION, route_unavailable: true, region_finished: true } });
    const { event, options } = toastShown();
    expect(event).toBe('RouteUnavailableToast_Shown');
    expect(options).toMatchObject({
      reference: document.getElementById('pano'), dark: true, duration: 10000,
      message: 'right-ui.route-unavailable.message',
    });
  });

  it('says when the street in the link could not be handed out, taking a notice parked over the tutorial', async () => {
    window.sessionStorage.setItem('sidewalk.streetUnavailable', '1');
    await startExploreMain();
    expect(toastShown().event).toBe('StreetUnavailableToast_Shown');
    expect(window.sessionStorage.getItem('sidewalk.streetUnavailable')).toBeNull();
  });

  it('drops a parked route notice once a route has resolved, since the labeler is in one now', async () => {
    window.sessionStorage.setItem('sidewalk.routeUnavailable', '1');
    await startExploreMain({ session: { ...SESSION, route_id: 3, user_route_id: 4, route_resumed: false } });
    expect(toastShown().event).toBeUndefined();
    expect(window.sessionStorage.getItem('sidewalk.routeUnavailable')).toBeNull();
  });

  it('says a neighborhood was already finished', async () => {
    await startExploreMain({ session: { ...SESSION, region_finished: true } });
    const { event, options } = toastShown();
    expect(event).toBe('RegionFinishedToast_Shown');
    expect(options.message).toBe('right-ui.region-finished.message');
    expect(i18n.t).toHaveBeenCalledWith('right-ui.region-finished.message', { regionName: 'Ballard' });
  });

  it('offers to leave a resumed route, logging the exit as coming from the toast', async () => {
    await startExploreMain({
      session: { ...SESSION, route_id: 3, user_route_id: 4, route_name: 'Loop', route_resumed: true },
    });
    const { event, options } = toastShown();
    expect(event).toBe('RouteResumeToast_Shown');
    expect(i18n.t).toHaveBeenCalledWith('right-ui.route-resume.message', { routeName: 'Loop' });
    expect(options.button.label).toBe('right-ui.route-resume.exit');
    options.button.onClick();
    expect(exploreMain.built.tracker.push).toHaveBeenCalledWith('Click_ExitRoute', { source: 'toast' });
    expect(navigations).toHaveBeenCalledTimes(1);
  });

  it('says how far is left in a resumed mission', async () => {
    await startExploreMain({ mission: makeMission({ distanceProgress: 0.4 }) });
    expect(toastShown().event).toBe('MissionResumeToast_Shown');
    expect(i18n.t).toHaveBeenCalledWith('right-ui.mission-resume.message', {
      regionName: 'Ballard',
      distanceLeft: 0.6,
    });
  });

  it('falls back to the session\'s own flag when storage is unreadable', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('blocked'); } });
    try {
      await startExploreMain({ session: { ...SESSION, street_unavailable: true } });
      expect(toastShown().event).toBe('StreetUnavailableToast_Shown');
    } finally {
      Object.defineProperty(window, 'sessionStorage', descriptor);
    }
  });
});

describe('Explore Main in free exploration at an address', () => {
  it('hides the mission UI, greets the labeler by place name, and skips the mission-start screen', async () => {
    await startExploreMain({
      session: { ...ADDRESS_SESSION, start_place_name: 'Teaneck High School' },
      mission: makeMission({ missionType: 'exploreAddress' }),
    });
    const m = exploreMain.built;
    expect(document.getElementById('mission-progress-group').classList.contains('ps-hidden')).toBe(true);
    expect(document.getElementById('compass-message-holder').classList.contains('ps-hidden')).toBe(true);
    expect(m.tracker.push).toHaveBeenCalledWith('ExploreAddress_SessionStart');
    // The name comes from the URL, so it is escaped even though the banner renders its message as HTML.
    expect(i18n.t).toHaveBeenCalledWith('popup.free-explore-start-named',
      { placeName: 'Teaneck High School', interpolation: { escapeValue: true } });
    expect(m.alertController.showAlert)
      .toHaveBeenCalledWith('popup.free-explore-start-named', 'exploreAddressStart', true);
    expect(m.reauditNotice.showForTask).toHaveBeenCalledWith(m.taskContainer.getCurrentTask());
    expect(m.missionStartTutorial).toBeUndefined();
    // No mission id in the URL: the lat/lng already resumes the labeler's own drop-in.
    expect(m.urlSync.ctorArgs[2]()).toEqual({});
  });

  it('greets generically when the search gave no name', async () => {
    await startExploreMain({ session: ADDRESS_SESSION, mission: makeMission({ missionType: 'exploreAddress' }) });
    expect(exploreMain.built.alertController.showAlert)
      .toHaveBeenCalledWith('popup.free-explore-start', 'exploreAddressStart', true);
  });
});

describe('Explore Main in the tutorial', () => {
  it('skips the region fetch, pins the URL, and shows the intro before the tutorial itself', async () => {
    await startExploreMain({ session: TUTORIAL_SESSION, mission: makeMission({ missionType: 'auditOnboarding' }) });
    const m = exploreMain.built;
    expect(m.taskContainer.fetchTasks).not.toHaveBeenCalled();
    expect(exploreMain.fakes.ExploreUrlSync.pinTutorialUrl).toHaveBeenCalledTimes(1);
    expect(m.urlSync).toBeUndefined();
    expect(m.immersiveMode.ctorArgs[0].isDisabled()).toBe(true);
    expect(m.speedLimit.ctorArgs[2]()).toBe(true);
    expect(m.tutorialIntro.ctorArgs[0]).toBe(false);
    expect(m.tutorialIntro.show).toHaveBeenCalledTimes(1);
    expect(m.missionStartTutorial).toBeUndefined();
  });

  it('tells the intro a route is waiting when the link named one that resolved', async () => {
    // The intro is built once the label tags arrive, which on the page is after the URL has been read.
    let tagsLoaded;
    const tagsArriveLater = (fakes) => {
      fakes.ContextMenu = standIn('contextMenu', {
        isOpen: () => false, fetchLabelTags: (done) => { tagsLoaded = done; },
      });
    };
    window.history.replaceState(null, '', '/explore?routeId=3');
    try {
      await startExploreMain({
        session: TUTORIAL_SESSION, mission: makeMission({ missionType: 'auditOnboarding' }), adjust: tagsArriveLater,
      });
      tagsLoaded();
      expect(exploreMain.built.tutorialIntro.ctorArgs[0]).toBe(true);

      await startExploreMain({
        session: { ...TUTORIAL_SESSION, route_unavailable: true },
        mission: makeMission({ missionType: 'auditOnboarding' }),
        adjust: tagsArriveLater,
      });
      tagsLoaded();
      expect(exploreMain.built.tutorialIntro.ctorArgs[0]).toBe(false);
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('parks an unresolvable-link notice for the visit after the tutorial, surviving unwritable storage', async () => {
    await startExploreMain({
      session: { ...TUTORIAL_SESSION, route_unavailable: true },
      mission: makeMission({ missionType: 'auditOnboarding' }),
    });
    expect(window.sessionStorage.getItem('sidewalk.routeUnavailable')).toBe('1');
    expect(window.sessionStorage.getItem('sidewalk.streetUnavailable')).toBeNull();

    const descriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('blocked'); } });
    try {
      await expect(startExploreMain({
        session: { ...TUTORIAL_SESSION, street_unavailable: true },
        mission: makeMission({ missionType: 'auditOnboarding' }),
      })).resolves.toBeDefined();
    } finally {
      Object.defineProperty(window, 'sessionStorage', descriptor);
    }
  });

  it('builds the tutorial once when the intro starts it, and reuses it after', async () => {
    await startExploreMain({ session: TUTORIAL_SESSION, mission: makeMission({ missionType: 'auditOnboarding' }) });
    const m = exploreMain.built;
    const { onStart } = m.tutorialIntro.ctorArgs[2];
    onStart();
    expect(m.alertController.hideAlert).toHaveBeenCalledTimes(1);
    expect(m.onboardingStates.ctorArgs).toEqual([m.contextMenu, m.compass, m.panoManager, expect.any(Object)]);
    expect(m.onboarding.ctorArgs).toEqual(expect.arrayContaining([m.onboardingStates, m.minimap, m.canvas]));
    const first = m.onboarding;
    onStart();
    expect(exploreMain.built.onboarding).toBe(first);
    expect(first.start).toHaveBeenCalledTimes(2);
  });

  it('skips the tutorial by marking its mission done, submitting, then reloading into a real one', async () => {
    const mission = makeMission({ missionType: 'auditOnboarding' });
    await startExploreMain({ session: TUTORIAL_SESSION, mission });
    const m = exploreMain.built;
    m.tutorialIntro.ctorArgs[2].onSkip();
    expect(m.tracker.push).toHaveBeenCalledWith('Onboarding_Skip');
    expect(mission.setProperty).toHaveBeenCalledWith('skipped', true);
    expect(mission.setProperty).toHaveBeenCalledWith('isComplete', true);
    expect(m.form.submitData).toHaveBeenCalledTimes(1);
    await flush();
    expect(navigations).toHaveBeenCalledTimes(1);
  });

  it('retakes the tutorial from the navbar button', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="navbar-retake-tutorial-btn"></button>');
    await startExploreMain();
    document.getElementById('navbar-retake-tutorial-btn').click();
    expect(navigations).toHaveBeenCalledTimes(1);
  });
});

describe('Explore Main lays the tool out', () => {
  it('rescales on resize, and re-rasters and logs the settled size once the drag ends', async () => {
    await startExploreMain();
    const m = exploreMain.built;
    const applyToolScale = vi.fn(() => 1);
    useUtil({ applyToolScale });
    expect(exploreMain.fakes.Toast.repositionAll).toHaveBeenCalledTimes(1);
    expect(m.panoManager.panoViewer.resize).toHaveBeenCalledTimes(1);
    expect(m.panoManager.panoViewer.repaint).toHaveBeenCalledTimes(1);
    expect(m.tracker.push).not.toHaveBeenCalledWith('Window_Resized', expect.anything());

    vi.useFakeTimers();
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    expect(applyToolScale).toHaveBeenLastCalledWith(
      ['--pano-base-width', '--sidebar-base-gap', '--sidebar-base-width'],
      ['--ribbon-base-top', '--ribbon-base-height', '--pano-base-height'], {},
    );
    vi.advanceTimersByTime(149);
    expect(m.panoManager.panoViewer.resize).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    // Two events, one settled size: the viewer hears once, and the log holds one line.
    expect(m.panoManager.panoViewer.resize).toHaveBeenCalledTimes(2);
    expect(m.canvas.resize).toHaveBeenCalledTimes(2);
    expect(m.tracker.push).toHaveBeenCalledWith('Window_Resized', { width: 0, height: 0 });
    expect(m.tracker.push.mock.calls.filter(([event]) => event === 'Window_Resized')).toHaveLength(1);
  });

  it('fits only the pano in immersive mode and keeps toasts under the label-type strip', async () => {
    const applyToolScale = vi.fn(() => 1);
    let immersive = true;
    await startExploreMain({
      adjust: (fakes) => {
        fakes.ImmersiveMode = standIn('immersiveMode', { isActive: () => immersive });
      },
    });
    useUtil({ applyToolScale });
    const pano = document.getElementById('pano');
    window.dispatchEvent(new Event('resize'));
    expect(applyToolScale).toHaveBeenLastCalledWith(['--pano-base-width'],
      ['--ribbon-base-top', '--ribbon-base-height', '--pano-base-height'],
      { maxScale: 3, hMargin: 0, bottomReserve: 0 });
    expect(pano.style.getPropertyValue('--toast-min-top')).toBe('8px');

    immersive = false;
    window.dispatchEvent(new Event('resize'));
    expect(pano.style.getPropertyValue('--toast-min-top')).toBe('');
  });
});
