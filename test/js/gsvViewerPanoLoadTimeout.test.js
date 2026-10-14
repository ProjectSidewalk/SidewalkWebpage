/**
 * Tests for GsvViewer._loadPanoWithTimeout — the guard that keeps a hung GSV pano load from wedging the tool.
 *
 * When GSV's internal metadata RPC 502s, its `position_changed` event can never fire, so the load promise would hang
 * forever; the in-flight move (NavigationService.moveToPano) would then never restore the UI it disabled, freezing the
 * pano and the minimap. The guard rejects after a timeout so the move can recover. These tests exercise that race
 * directly: resolve on position_changed, reject on timeout, and settle only once. The google.maps and PanoData
 * references live in methods these tests never call, so only `google.maps.event` is stubbed.
 */

import { loadModules } from './loader.js';

describe('GsvViewer._loadPanoWithTimeout', () => {
    let GsvViewer;

    beforeAll(async () => {
        ({ GsvViewer } = await loadModules('frontend/js/common/pano-viewer/GsvViewer.js'));
    });

    beforeEach(() => {
        vi.useFakeTimers();
        // The race detaches its position_changed listener via google.maps.event.removeListener.
        vi.stubGlobal('google', { maps: { event: { removeListener: vi.fn() } } });
    });

    /**
     * Builds a viewer whose gsvPano stub captures the position_changed callback (so a test can fire it — or not, to
     * simulate a hang) and records setPano calls.
     */
    function viewerWithCapturedListener() {
        const viewer = new GsvViewer();
        const captured = {};
        viewer.gsvPano = {
            addListener: (event, cb) => { captured.event = event; captured.cb = cb; return { event }; },
            setPano: vi.fn(),
        };
        return { viewer, captured };
    }

    test('sets the pano and resolves with the given value once position_changed fires', async () => {
        const { viewer, captured } = viewerWithCapturedListener();
        const panoData = { id: 'CURR' };

        const promise = viewer._loadPanoWithTimeout('newpano', panoData);
        expect(viewer.gsvPano.setPano).toHaveBeenCalledWith('newpano');
        expect(captured.event).toBe('position_changed');

        captured.cb(); // GSV finished loading.

        await expect(promise).resolves.toBe(panoData);
        // Listener detached, and the timeout cleared (advancing time must not also reject).
        expect(window.google.maps.event.removeListener).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(60000);
        await expect(promise).resolves.toBe(panoData);
    });

    test('rejects after the timeout when position_changed never fires (the 502 hang)', async () => {
        const { viewer } = viewerWithCapturedListener();

        const promise = viewer._loadPanoWithTimeout('deadpano', { id: 'CURR' });
        const assertion = expect(promise).rejects.toThrow(/Timed out loading pano deadpano/);

        vi.advanceTimersByTime(60000); // well past the load timeout.

        await assertion;
        expect(window.google.maps.event.removeListener).toHaveBeenCalledTimes(1);
    });

    test('a late position_changed after the timeout does not flip the rejected promise', async () => {
        const { viewer, captured } = viewerWithCapturedListener();

        const promise = viewer._loadPanoWithTimeout('deadpano', { id: 'CURR' });
        const assertion = expect(promise).rejects.toThrow(/Timed out/);
        vi.advanceTimersByTime(60000);
        await assertion;

        // A late load event must be a no-op (promises settle once), not throw or resolve.
        expect(() => captured.cb()).not.toThrow();
    });
});
