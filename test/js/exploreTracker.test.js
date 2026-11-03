/**
 * Explore's interaction log (frontend/js/explore/data/Tracker.js, #5840): what each row carries, which rows are filed
 * under a label, the low-level window events it records on its own, when the buffer is flushed, and the page reload
 * that follows an hour away from the keyboard.
 */

import { loadModules } from './loader.js';
import { fakePanoManager, navigationAttempts } from './fakes.js';

/** How the suite sees the reload a long gap between interactions ends in. */
const reloads = navigationAttempts();

/**
 * @param {Record<string, any>} props - What `getProperty` answers by key.
 * @returns {object} A label with the one method the tracker calls on it.
 */
const labelStub = (props) => ({ getProperty: (key) => props[key] });

/** A viewer that is on a pano. */
const viewer = {
  getPanoId: () => 'pano1',
  getPosition: () => ({ lat: 47.6, lng: -122.3 }),
  getPov: () => ({ heading: 90, pitch: -5, zoom: 2 }),
};

describe('Explore Tracker', () => {
  let Tracker;
  let tracker;
  /** The rows pushed so far, after the start-up focus row. */
  const rows = () => tracker.getActions().slice(1);

  beforeEach(async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    ({ Tracker } = await loadModules('frontend/js/explore/data/Tracker.js'));
    tracker = new Tracker();
  });

  it('starts by noting whether the page has focus, and follows it from then on', () => {
    expect(tracker.getActions().map((row) => row.action)).toEqual(['PageGainedFocus']);
    document.hasFocus.mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
    document.hasFocus.mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    expect(rows().map((row) => row.action)).toEqual(['PageLostFocus', 'PageGainedFocus']);
  });

  it('stamps a row with the pano, position and view, or nulls before a pano has loaded', () => {
    tracker.push('Click_Something');
    expect(rows()[0]).toMatchObject({
      action: 'Click_Something', pano_id: null, lat: null, lng: null, heading: null, pitch: null, zoom: null,
      note: '', temporary_label_id: null, audit_task_id: null,
    });
    expect(rows()[0].timestamp).toBeInstanceOf(Date);

    // Registered, but the viewer is not up yet.
    const panoManager = fakePanoManager(viewer);
    let loaded = false;
    Object.defineProperty(panoManager, 'panoViewer', { get: () => (loaded ? viewer : null) });
    tracker.trackPano(panoManager);
    tracker.push('Click_Early');
    expect(rows()[1]).toMatchObject({ pano_id: null, lat: null, heading: null });

    loaded = true;
    tracker.setAuditTaskID(12);
    tracker.push('Click_Late', { key: 'value', other: 2 });
    expect(rows()[2]).toMatchObject({
      pano_id: 'pano1', lat: 47.6, lng: -122.3, heading: 90, pitch: -5, zoom: 2, note: 'key:value,other:2',
      audit_task_id: 12,
    });
  });

  it('files a label\'s rows under it until the labeler is done with it', () => {
    tracker.setAuditTaskID(12);
    const label = labelStub({ temporaryLabelId: 3, auditTaskId: 8 });
    tracker.push('LabelingCanvas_FinishLabeling', { labelType: 'CurbRamp' }, label);
    tracker.push('ContextMenu_TagClick');
    tracker.push('ContextMenu_Close');
    tracker.push('Click_Elsewhere');
    expect(rows().map(({ temporary_label_id, audit_task_id, note }) => [temporary_label_id, audit_task_id, note]))
      .toEqual([
        // A label from an earlier session is filed under its own audit task, and the row says so.
        [3, 8, 'labelType:CurbRamp,auditTaskId:8'],
        [3, 8, ''],
        [3, 8, ''],
        [null, 12, ''],
      ]);
  });

  it('lets go of the label when it is removed, or when an Occlusion is placed, which opens no menu', () => {
    const label = labelStub({ temporaryLabelId: 3, auditTaskId: 8 });
    tracker.push('Click_LabelDelete', null, label);
    tracker.push('RemoveLabel');
    tracker.push('Click_Next');
    expect(rows().at(-1).temporary_label_id).toBeNull();

    tracker.push('LabelingCanvas_FinishLabeling', { labelType: 'Occlusion' }, label);
    tracker.push('Click_Next');
    expect(rows().at(-1).temporary_label_id).toBeNull();
    tracker.push('LabelingCanvas_FinishLabeling', { labelType: 'Obstacle' }, label);
    tracker.push('Click_Next');
    expect(rows().at(-1).temporary_label_id).toBe(3);
  });

  it('records a scripted click without a cursor, rather than as one in the page corner', () => {
    // jsdom can't dispatch a trusted event, so a real pointer's cursor is checked on the page, not here.
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 20 }));
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    const [click, move] = rows();
    expect(click).toMatchObject({ action: 'LowLevelEvent_click', note: 'cursorX:null,cursorY:null' });
    expect(move.action).toBe('LowLevelEvent_mousemove');
  });

  it('records which key was pressed, except into a password field', () => {
    document.body.innerHTML = '<input id="pw" type="password"><input id="name" type="text">';
    document.getElementById('name').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyA' }));
    document.getElementById('pw').dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, code: 'KeyB' }));
    expect(rows().map(({ action, note }) => [action, note])).toEqual([
      ['LowLevelEvent_keydown', 'code:KeyA'],
      ['LowLevelEvent_keyup', ''],
    ]);
  });

  describe('flushing the buffer', () => {
    it('asks for a flush once it holds more than 200 rows, and not again until that flush is done', async () => {
      let finish;
      const onFlush = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
      tracker.onFlush(onFlush);
      // The start-up focus row is the first of the 200.
      for (let i = 0; i < 199; i++) tracker.push('LowLevelEvent_mousemove');
      expect(onFlush).not.toHaveBeenCalled();
      tracker.push('LowLevelEvent_mousemove');
      expect(onFlush).toHaveBeenCalledTimes(1);
      tracker.push('LowLevelEvent_mousemove');
      expect(onFlush).toHaveBeenCalledTimes(1);

      finish();
      await Promise.resolve();
      tracker.push('LowLevelEvent_mousemove');
      expect(onFlush).toHaveBeenCalledTimes(2);
    });

    it('waits out a label being placed or its menu being used, so a submission does not split them', () => {
      const onFlush = vi.fn(() => Promise.resolve());
      tracker.onFlush(onFlush);
      for (let i = 0; i < 199; i++) tracker.push('LowLevelEvent_mousemove');
      tracker.push('LabelingCanvas_StartLabeling');
      tracker.push('ContextMenu_Open');
      expect(onFlush).not.toHaveBeenCalled();
      tracker.push('LowLevelEvent_mouseup');
      expect(onFlush).toHaveBeenCalledTimes(1);
    });

    it('keeps buffering when nothing has registered to flush yet', () => {
      for (let i = 0; i < 202; i++) tracker.push('LowLevelEvent_mousemove');
      expect(tracker.getActions().length).toBe(203);
    });

    it('starts over with a marker row on refresh', () => {
      tracker.push('Click_Something');
      tracker.refresh();
      expect(tracker.getActions().map((row) => row.action)).toEqual(['RefreshTracker']);
    });
  });

  it('reloads the page after an hour away, since a stale session misbehaves', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    tracker.push('Click_One');
    vi.setSystemTime(1_000_000 + 3600000);
    tracker.push('Click_Two');
    expect(reloads).not.toHaveBeenCalled();
    vi.setSystemTime(1_000_000 + 2 * 3600000 + 1);
    tracker.push('Click_Three');
    expect(reloads).toHaveBeenCalledTimes(1);
  });
});
