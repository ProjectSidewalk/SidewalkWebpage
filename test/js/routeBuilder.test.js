/**
 * Tests for RouteBuilder (frontend/js/route-builder/RouteBuilder.js, #5840), the /routeBuilder page: the staged
 * overview-then-place flow, clicking out a route over the street network, the derived stats and flags, undo and
 * reverse, saving and updating, loading a saved route into the editor, and the sign-in round trip.
 *
 * Everything runs through what the page's user touches (map clicks, buttons, the address fields) and reads back what
 * they would see (drawn streets, flags, stats, toasts, the save button). The map and the page's other parts are
 * doubles from support/routeBuilderHarness.js, which also draws the street network the routes run over.
 */

import {
  A, B, D, E, F, NOWHERE, RouteBuilder, buildRoute, clickMap, drawnRoute, flags, flush, logged, openPopups,
  regionData, setupRouteBuilder, streetData, world,
} from './support/routeBuilderHarness.js';

const $ = (id) => document.getElementById(id);
const click = (id) => $(id).click();
const panelState = () => $('routebuilder-panel').dataset.state;
const toastMessages = () => world.toasts.map((t) => t.message ?? t.title);
const at = ({ lng, lat }) => [lng, lat];

/**
 * Stubs fetch with a handler per request.
 * @param {(url: string, init?: object) => any} respond - Returns the JSON body, a Response-like with `status`, or a
 *   promise of either.
 * @returns {import('vitest').Mock} The stub, for reading its calls.
 */
function stubFetch(respond) {
  const fetch = vi.fn(async (url, init) => {
    const result = await respond(url, init);
    if (result?.status && result.status >= 400) return { ok: false, status: result.status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => result };
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** The /userapi/routes/<id>/streets body for a stored street list of [id, reversed] pairs. */
const storedStreets = (...pairs) => ({ streets: pairs.map(([id, reverse]) => ({ street_id: id, reverse })) });

/**
 * The harness's streets plus one more, for data shapes the shared network doesn't have.
 * @param {number} id
 * @param {Array<[number, number]>} coords
 * @returns {GeoJSON.FeatureCollection}
 */
function streetsWith(id, coords) {
  const data = streetData();
  data.features.push({
    type: 'Feature',
    properties: { street_edge_id: id, region_id: 2 },
    geometry: { type: 'LineString', coordinates: coords },
  });
  return data;
}

/**
 * Opens a saved route made of the given streets in the editor, as a click on its card would.
 * @param {...[number, boolean]} pairs - The stored [street id, reversed] pairs.
 */
async function openSavedRoute(...pairs) {
  stubFetch(() => storedStreets(...pairs));
  world.savedRoutes.opts.onView(5);
  await flush();
}

/** Presses Ctrl+Z (or another modifier combo) on the page body. */
const pressUndo = (init = { ctrlKey: true }) => document.body.dispatchEvent(
  new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true, ...init }));

describe('RouteBuilder', () => {
  describe('the overview', () => {
    test('a click on a region zooms in to frame it, without placing a point', async () => {
      const { map } = await setupRouteBuilder();
      map.rendered['regions-fill'] = [{ properties: { region_id: 1 } }];
      map.framed = { center: [0.0002, 0.0002], zoom: 15 };

      clickMap(map, A);

      expect(map.camera.at(-1)).toEqual(['easeTo', { center: [0.0002, 0.0002], zoom: 15, duration: 1200 }]);
      expect(panelState()).toBe('empty');
      expect(flags(map)).toEqual([]);
      expect(logged()).toContain('RouteBuilder_Click=ZoomToRegion_RegionId=1');
    });

    test('a region too big to frame at placing zoom zooms to the clicked spot instead', async () => {
      const { map } = await setupRouteBuilder();
      map.rendered['regions-fill'] = [{ properties: { region_id: 1 } }];
      map.framed = { center: [0, 0], zoom: 11 };

      clickMap(map, B);

      expect(map.camera.at(-1)).toEqual(['easeTo', { center: at(B), zoom: RouteBuilder.PLACE_ZOOM, duration: 1200 }]);
    });

    test('a click outside every region does nothing', async () => {
      const { map } = await setupRouteBuilder();

      clickMap(map, A);

      expect(map.camera).toEqual([]);
      expect(panelState()).toBe('empty');
    });

    test('the regions are washed and named in the overview, and fade to outlines once zoomed in to place points',
      async () => {
        const { map } = await setupRouteBuilder();
        expect(map.layout['regions-label.visibility']).toBe('visible');
        expect(map.paint['regions-outline.line-opacity']).toBe(RouteBuilder.REGION_PAINT_OVERVIEW.lineOpacity);

        map.zoomTo(RouteBuilder.PLACE_ZOOM);

        expect(map.layout['regions-label.visibility']).toBe('none');
        expect(map.paint['regions-fill.fill-opacity']).toBe(0);
        expect(map.paint['regions-outline.line-opacity']).toBe(RouteBuilder.REGION_PAINT_BUILDING.lineOpacity);
      });

    test('the call to action names the next step for each stage, and goes once the route starts', async () => {
      const { map } = await setupRouteBuilder();
      const [selectRegion] = world.toasts;
      expect(selectRegion).toMatchObject({ title: 'cta-select-region', duration: 0 });

      map.zoomTo(RouteBuilder.PLACE_ZOOM);
      expect(selectRegion.dismissed).toBe(true);
      const pickStart = world.toasts.at(-1);
      expect(pickStart.title).toBe('cta-pick-start');

      clickMap(map, A);
      expect(pickStart.dismissed).toBe(true);
      expect(world.toasts.filter((t) => t.title)).toHaveLength(2);
    });

    test('a call to action the user closed stays closed when they come back to its stage', async () => {
      const { map } = await setupRouteBuilder();
      world.toasts[0].onClose();
      expect(logged()).toContain('RouteBuilder_Click=DismissCta_Stage=SelectRegion');

      map.zoomTo(RouteBuilder.PLACE_ZOOM);
      map.zoomTo(12);

      expect(world.toasts.map((t) => t.title)).toEqual(['cta-select-region', 'cta-pick-start']);
    });

    test('hovering a region in the overview tints it and says a click zooms in to it by name', async () => {
      const { map } = await setupRouteBuilder();
      map.rendered['regions-fill'] = [{ properties: { region_id: 2 } }];

      map.fire('mousemove', { features: [{ properties: { region_id: 2 } }] }, 'regions-fill');
      map.fire('mousemove', { lngLat: E });
      world.frame();

      expect(map.stateOf('regions', 2)).toEqual({ hover: true });
      expect(openPopups('rb-cursor-guide').map((p) => p.text)).toEqual(['guide-select-region region=Uptown']);

      // Zooming in leaves the overview, so its hover tint and guide go with it.
      map.zoomTo(RouteBuilder.PLACE_ZOOM);
      expect(map.stateOf('regions', 2)).toEqual({ hover: false });
      expect(openPopups('rb-cursor-guide')).toEqual([]);
    });
    test('moving off a region drops its tint, and hovering one past the overview never tints it', async () => {
      const { map } = await setupRouteBuilder();
      const hover = (regionId) => map.fire('mousemove', { features: [{ properties: { region_id: regionId } }] },
        'regions-fill');

      hover(1);
      map.fire('mouseleave', {}, 'regions-fill');
      expect(map.stateOf('regions', 1)).toEqual({ hover: false });

      map.zoomTo(RouteBuilder.PLACE_ZOOM);
      hover(2);
      expect(map.stateOf('regions', 2)).toEqual({});
    });

    test('regions and streets that arrive before the map has loaded are drawn once it does', async () => {
      const { map } = await setupRouteBuilder({ dataBeforeMap: true });

      expect(map.layers).toHaveProperty('regions-fill');
      expect(map.layers).toHaveProperty('streets-chosen');
      buildRoute(map, A, D);
      expect(drawnRoute(map)).toEqual([[1, false], [2, false]]);
    });

    test('once its layers exist, the map stacks them regions, streets, route, then flags, and stops listening',
      async () => {
        const { map } = await setupRouteBuilder();

        map.fire('sourcedataloading');
        map.fire('sourcedataloading');

        expect(map.layerOrder).toEqual(['regions-fill', 'regions-outline', 'streets', 'streets-chosen', 'regions-label',
          'ghost-start', 'route-endpoints', 'route-explorer']);
      });
  });

  describe('placing points', () => {
    test('the pointer previews where the start would land with a ghost flag and a guide', async () => {
      const { map } = await setupRouteBuilder();
      map.zoomTo(RouteBuilder.PLACE_ZOOM);

      map.fire('mousemove', { lngLat: { lng: 0.00005, lat: 0.00005 } });
      world.frame();

      const ghost = map.getSource('ghost-start').data.features;
      expect(ghost.map((f) => [f.properties.kind, f.geometry.coordinates])).toEqual([['start', at(A)]]);
      expect(openPopups('rb-cursor-guide').map((p) => p.text)).toEqual(['guide-pick-start']);

      // Nowhere near a street, a click would place nothing, so neither shows.
      map.fire('mousemove', { lngLat: NOWHERE });
      world.frame();
      expect(map.getSource('ghost-start').data.features).toEqual([]);
      expect(openPopups('rb-cursor-guide')).toEqual([]);
    });

    test('after the start, the pointer previews the end flag, and the guide retires once the end is down',
      async () => {
        const { map } = await setupRouteBuilder();
        buildRoute(map, A);
        const hoverAt = (lngLat) => {
          map.fire('mousemove', { lngLat });
          world.frame();
        };

        hoverAt(D);
        expect(map.getSource('ghost-start').data.features[0].properties.kind).toBe('end');
        expect(openPopups('rb-cursor-guide').map((p) => p.text)).toEqual(['guide-pick-end']);

        clickMap(map, D);
        hoverAt(E);
        expect(openPopups('rb-cursor-guide')).toEqual([]);
      });

    test('pointer moves within one frame are handled once, at the latest position', async () => {
      const { map } = await setupRouteBuilder();
      map.zoomTo(RouteBuilder.PLACE_ZOOM);

      map.fire('mousemove', { lngLat: NOWHERE });
      map.fire('mousemove', { lngLat: A });
      expect(world.frames.size).toBe(1);
      world.frame();

      expect(map.getSource('ghost-start').data.features[0].geometry.coordinates).toEqual(at(A));
    });

    test('the pointer leaving the map takes the ghost flag and the guide with it', async () => {
      const { map } = await setupRouteBuilder();
      map.zoomTo(RouteBuilder.PLACE_ZOOM);
      map.fire('mousemove', { lngLat: A });
      world.frame();

      map.fire('mouseout');

      expect(map.getSource('ghost-start').data.features).toEqual([]);
      expect(openPopups('rb-cursor-guide')).toEqual([]);
    });

    test('resting the pointer on the route opens its menu after a beat; passing over it does not', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      map.fire('mousemove', { lngLat: B }, 'streets-chosen');
      expect(map.getCanvas().style.cursor).toBe('pointer');
      map.fire('mouseleave', {}, 'streets-chosen');
      vi.advanceTimersByTime(RouteBuilder.ROUTE_MENU_HOVER_MS);
      expect(world.popover.open).not.toHaveBeenCalled();
      expect(map.getCanvas().style.cursor).toBe('');

      map.fire('mousemove', { lngLat: B }, 'streets-chosen');
      vi.advanceTimersByTime(RouteBuilder.ROUTE_MENU_HOVER_MS);
      expect(world.popover.open).toHaveBeenCalledWith(B);
      expect(logged()).toContain('RouteBuilder_Hover=RouteMenu_Open');
    });

    test('a route undone back to its start while the pointer rests on it opens no menu', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      map.fire('mousemove', { lngLat: B }, 'streets-chosen');
      click('undo-button');
      vi.advanceTimersByTime(RouteBuilder.ROUTE_MENU_HOVER_MS);

      expect(world.popover.open).not.toHaveBeenCalled();
    });

    test('a cleared route the map is still drawing gets neither the pointer cursor nor its menu', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      click('undo-button');
      // The map renders a frame or two behind, so the old route is still there to be hit.
      map.rendered['streets-chosen'] = [{}];

      map.fire('mousemove', { lngLat: B }, 'streets-chosen');
      clickMap(map, D);

      expect(map.getCanvas().style.cursor).toBe('');
      expect(world.popover.open).not.toHaveBeenCalled();
      expect(drawnRoute(map)).toEqual([[1, false], [2, false]]);
    });

    test('a hover-opened menu is told when the pointer leaves the route and when it comes back', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);

      map.fire('mouseleave', {}, 'streets-chosen');
      expect(world.popover.scheduleHoverClose).toHaveBeenCalledTimes(1);
      map.fire('mousemove', { lngLat: B }, 'streets-chosen');
      expect(world.popover.cancelHoverClose).toHaveBeenCalledTimes(1);
    });

    test('the first click plants a start flag at the nearest intersection and eases in to street level', async () => {
      const { map } = await setupRouteBuilder();

      buildRoute(map, { lng: 0.00003, lat: -0.00002 });

      expect(panelState()).toBe('building');
      expect(flags(map)).toEqual([['start', at(A)]]);
      expect(map.camera.at(-1)).toEqual(['easeTo', { center: at(A), zoom: RouteBuilder.BUILD_ZOOM, duration: 1200 }]);
      expect(world.directions.updateStart).toHaveBeenCalledWith(at(A));
      // A lone start isn't a route yet: nothing to measure or save.
      expect($('route-stats').hidden).toBe(true);
      expect($('save-button').disabled).toBe(true);
      expect(logged()).toContain('RouteBuilder_AddWaypoint=Success_Count=1_Source=MapClick');
    });

    test('each further click extends the route along the shortest walking path', async () => {
      const { map } = await setupRouteBuilder();

      buildRoute(map, A, D);

      expect(drawnRoute(map)).toEqual([[1, false], [2, false]]);
      expect(flags(map)).toEqual([['start', at(A)], ['end', at(D)]]);
      // The base copy of a street in the route is hidden under the drawn one.
      expect(map.stateOf('streets', 1)).toEqual({ chosen: true });
      expect(map.stateOf('streets', 3)).toEqual({});
      expect(world.directions.updateFromRoute).toHaveBeenLastCalledWith(at(A), at(D));
      expect($('save-button').disabled).toBe(false);
      expect($('preview-button').disabled).toBe(false);
      expect(openPopups('rb-map-hint').map((p) => p.text)).toEqual(['hint-extend']);
    });

    test('a street walked against its drawn direction is marked reversed', async () => {
      const { map } = await setupRouteBuilder();

      buildRoute(map, D, A);

      expect(drawnRoute(map)).toEqual([[2, true], [1, true]]);
      expect(map.getSource('streets-chosen').data.features[0].geometry.coordinates).toEqual([at(D), at(B)]);
    });

    test('a click too far from any street is refused with a message', async () => {
      const { map } = await setupRouteBuilder();

      buildRoute(map, A, NOWHERE);

      expect(toastMessages()).toContain('no-street-nearby');
      expect(flags(map)).toEqual([['start', at(A)]]);
      expect(logged()).toContain('RouteBuilder_AddWaypoint=NoStreetNearby_Source=MapClick');
    });

    test('a point the route\'s end has no walking path to is refused with a message', async () => {
      const { map } = await setupRouteBuilder();

      buildRoute(map, A, F);

      expect(toastMessages()).toContain('no-path-error');
      expect(drawnRoute(map)).toEqual([]);
      expect(flags(map)).toEqual([['start', at(A)]]);
    });

    test('a click on the drawn route opens its menu instead of extending it', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      map.rendered['streets-chosen'] = [{}];

      clickMap(map, E);

      expect(world.popover.open).toHaveBeenCalledWith(E, true);
      expect(drawnRoute(map)).toEqual([[1, false], [2, false]]);
    });

    test('a typed start address plants the first point, and a typed end extends to it', async () => {
      const { map } = await setupRouteBuilder();

      world.directions.opts.onSetStart(A);
      world.directions.opts.onSetEnd(E);

      expect(drawnRoute(map)).toEqual([[1, false], [2, false], [3, false]]);
      expect(logged()).toEqual(expect.arrayContaining([
        'RouteBuilder_AddWaypoint=Success_Count=1_Source=AddressStart',
        'RouteBuilder_AddWaypoint=Success_Count=2_Source=AddressEnd',
      ]));
    });

    test('a typed start address once the route exists is refused, and the real start is put back', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      world.directions.updateFromRoute.mockClear();

      world.directions.opts.onSetStart(E);

      expect(toastMessages()).toContain('start-locked-warning');
      expect(drawnRoute(map)).toEqual([[1, false], [2, false]]);
      expect(world.directions.updateFromRoute).toHaveBeenCalledWith(at(A), at(D));
    });

    test('the next-step hint clears itself after a while', async () => {
      const { map } = await setupRouteBuilder();
      vi.useFakeTimers();
      buildRoute(map, A, D);
      expect(openPopups('rb-map-hint')).toHaveLength(1);

      vi.advanceTimersByTime(RouteBuilder.HINT_DURATION_MS);

      expect(openPopups('rb-map-hint')).toEqual([]);
    });
  });

  describe('stats', () => {
    test('shows the distance, the labeling-time estimate, and the street count in one region', async () => {
      const { map } = await setupRouteBuilder({ minutesPer100m: 2 });

      buildRoute(map, A, D);

      expect($('route-stats').hidden).toBe(false);
      expect($('route-length-val').innerText).toBe('0.22 km');
      expect($('route-time-val').innerText).toBe('est-time-minutes min=4');
      expect($('route-time-tip').textContent).toBe('est-time-tooltip time=est-time-minutes min=4 pace=2.0');
      expect($('route-stats-caption').textContent).toBe('street-count-in-region count=2 region=Downtown');
    });

    test('counts the regions a route crosses into, and writes an hour-plus estimate in hours', async () => {
      const { map } = await setupRouteBuilder({ minutesPer100m: 30 });

      buildRoute(map, A, E);

      expect($('route-stats-caption').textContent).toBe('street-count-across-regions streets=3 regions=2');
      // ~333 m at 30 min per 100 m.
      expect($('route-time-val').innerText).toBe('est-time-hours hours=1 min=40');
    });

    test('describes a saved-route card by its distance, estimate, and region', async () => {
      await setupRouteBuilder({ minutesPer100m: 2 });
      const { formatMeta } = world.savedRoutes.opts;

      expect(formatMeta(1500, 'Downtown')).toBe('1.50 km · est-time-minutes min=30 · Downtown');
      expect(formatMeta(10, null)).toBe('0.01 km · est-time-minutes min=1');
    });

    test('the estimate\'s tip opens on hover, focus, or a tap, and closes on Escape or a tap elsewhere', async () => {
      await setupRouteBuilder();
      const val = $('route-time-val');
      const tip = $('route-time-tip');

      val.dispatchEvent(new MouseEvent('mouseenter'));
      expect(tip.hidden).toBe(false);
      val.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(tip.hidden).toBe(true);
      val.click();
      expect(tip.hidden).toBe(false);
      document.body.click();
      expect(tip.hidden).toBe(true);
    });

    test('the estimate\'s tip opens from the keyboard with Enter or Space', async () => {
      await setupRouteBuilder();
      const val = $('route-time-val');
      const tip = $('route-time-tip');

      for (const key of ['Enter', ' ']) {
        const press = new KeyboardEvent('keydown', { key, cancelable: true });
        val.dispatchEvent(press);
        expect(tip.hidden).toBe(false);
        expect(press.defaultPrevented).toBe(true);
        val.dispatchEvent(new FocusEvent('blur'));
        expect(tip.hidden).toBe(true);
      }
    });
  });

  describe('editing', () => {
    test('undo takes back the newest point and its leg, then the start, back to the empty planner', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D, E);

      click('undo-button');
      expect(drawnRoute(map)).toEqual([[1, false], [2, false]]);
      click('undo-button');
      expect(drawnRoute(map)).toEqual([]);
      expect(flags(map)).toEqual([['start', at(A)]]);
      click('undo-button');

      expect(flags(map)).toEqual([]);
      expect(panelState()).toBe('empty');
      expect($('undo-button').disabled).toBe(true);
    });

    test('Ctrl+Z undoes, except while typing in a form field', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      const ctrlZ = { key: 'z', ctrlKey: true, bubbles: true, cancelable: true };

      $('some-text-field').dispatchEvent(new KeyboardEvent('keydown', ctrlZ));
      expect(drawnRoute(map)).toHaveLength(2);

      const press = new KeyboardEvent('keydown', ctrlZ);
      document.body.dispatchEvent(press);
      expect(drawnRoute(map)).toEqual([]);
      expect(press.defaultPrevented).toBe(true);
      expect(logged()).toContain('RouteBuilder_KeyboardShortcut=Undo');
    });

    test('Ctrl+Z still undoes with Caps Lock on, but Ctrl+Shift+Z does not', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D, E);
      const press = (init) => document.body.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, bubbles: true, ...init }));

      press({ key: 'Z', shiftKey: true });
      expect(drawnRoute(map)).toHaveLength(3);
      press({ key: 'Z' });
      expect(drawnRoute(map)).toHaveLength(2);
    });

    test('Ctrl+Z does nothing while the save or delete dialog is open over the route', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      const ctrlZ = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));

      click('save-button');
      ctrlZ();
      expect(drawnRoute(map)).toHaveLength(2);
      world.saveModal.hide();

      click('cancel-button');
      ctrlZ();
      expect(drawnRoute(map)).toHaveLength(2);
      click('cancel-delete-route-button');

      ctrlZ();
      expect(drawnRoute(map)).toEqual([]);
    });

    test('reverse swaps the start and end along the same streets, and undo puts it back exactly', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);

      world.popover.onReverse();
      expect(drawnRoute(map)).toEqual([[2, true], [1, true]]);
      expect(flags(map)).toEqual([['start', at(D)], ['end', at(A)]]);

      click('undo-button');
      expect(drawnRoute(map)).toEqual([[1, false], [2, false]]);
      expect(flags(map)).toEqual([['start', at(A)], ['end', at(D)]]);
    });

    test('a route extended after a reverse continues from its new end', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, D, E);
      world.popover.onReverse();

      clickMap(map, A);

      expect(drawnRoute(map)).toEqual([[3, true], [2, true], [1, true]]);
    });

    test('a lone start point has nothing to reverse', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A);

      world.popover.onReverse();
      click('undo-button');

      expect(flags(map)).toEqual([]);
    });

    test('delete asks first, and confirming clears the route and the undo history', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);

      click('cancel-button');
      expect($('delete-route-modal-backdrop').style.visibility).toBe('visible');
      expect($('delete-route-title').textContent).toBe('Delete route?');
      click('delete-route-button');

      expect(drawnRoute(map)).toEqual([]);
      expect(flags(map)).toEqual([]);
      expect(panelState()).toBe('empty');
      expect($('delete-route-modal-backdrop').style.visibility).toBe('hidden');
      expect($('undo-button').disabled).toBe(true);
      expect(map.stateOf('streets', 1)).toEqual({ chosen: false });
    });

    test('backing out of delete keeps the route', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);

      world.popover.onDelete();
      click('cancel-delete-route-button');

      expect($('delete-route-modal-backdrop').style.visibility).toBe('hidden');
      expect(drawnRoute(map)).toHaveLength(2);
    });

    test('New route asks before discarding an unsaved route, and flies back out to the city', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);

      world.confirmAnswer = false;
      click('new-route-button');
      await flush();
      expect(drawnRoute(map)).toHaveLength(2);

      world.confirmAnswer = true;
      click('new-route-button');
      await flush();
      expect(world.confirms).toHaveLength(2);
      expect(drawnRoute(map)).toEqual([]);
      expect(map.camera.at(-1)[0]).toBe('flyTo');
      expect(map.getZoom()).toBe(12);
    });

    test('the preview walks the explorer from start to end, then takes it away', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      // Timers only: the animation frames stay on the harness's stepper.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const explorerAt = () => map.getSource('route-explorer').data.features.map((f) => f.geometry.coordinates);

      click('preview-button');
      world.frame(0);
      expect(explorerAt()).toEqual([at(A)]);
      world.frame(RouteBuilder.EXPLORER_ANIMATION_MS / 2);
      expect(explorerAt()[0][0]).toBeCloseTo(B.lng, 6);
      world.frame(RouteBuilder.EXPLORER_ANIMATION_MS);
      expect(explorerAt()[0]).toEqual([expect.closeTo(D.lng, 9), expect.closeTo(D.lat, 9)]);

      vi.advanceTimersByTime(500);
      expect(explorerAt()).toEqual([]);
    });

    test('clearing the route mid-preview stops the explorer and takes it off the map', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      click('preview-button');
      world.frame(0);

      click('cancel-button');
      click('delete-route-button');

      expect(world.frames.size).toBe(0);
      expect(map.getSource('route-explorer').data.features).toEqual([]);
    });

    test('the points-of-interest toggle shows and hides only the basemap\'s POI labels', async () => {
      const { map } = await setupRouteBuilder();
      map.styleLayers = [{ id: 'poi-label', type: 'symbol' }, { id: 'road-label', type: 'symbol' }];
      const toggle = $('poi-toggle-checkbox');

      toggle.checked = false;
      toggle.dispatchEvent(new Event('change'));

      expect(map.layout).toMatchObject({ 'poi-label.visibility': 'none' });
      expect(map.layout['road-label.visibility']).toBeUndefined();
    });
  });

  describe('saving', () => {
    test('saving a new route goes through the name modal, with the route\'s streets in walking order', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, D, A);

      click('save-button');

      expect(world.saveModal.open).toHaveBeenCalled();
      expect(world.saveModal.opts.getStreetsPayload()).toEqual([
        { street_id: 2, reverse: true }, { street_id: 1, reverse: true },
      ]);
    });

    test('suggests a name from the endpoint streets, falling back to the region the route starts in', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, E);
      const { getSuggestedName } = world.saveModal.opts;

      expect(getSuggestedName()).toBe('route-name-default region=Downtown');
      world.streetNames = { start: 'Main St', end: 'Oak Ave' };
      expect(getSuggestedName()).toBe('route-name-streets start=Main St end=Oak Ave');
      world.streetNames = { start: 'Main St', end: 'Main St' };
      expect(getSuggestedName()).toBe('Main St');
    });

    test('a saved route stays open for editing: "Saved" until changed, then "Update route"', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);

      world.saveModal.opts.onSaved({ route_id: 7 });

      expect(toastMessages()).toContain('route-saved');
      expect(world.savedRoutes.markActive).toHaveBeenLastCalledWith(7);
      expect(world.savedRoutes.refresh).toHaveBeenLastCalledWith(7);
      expect($('save-button')).toMatchObject({ textContent: 'save-saved', disabled: true });
      expect($('routebuilder-panel').dataset.editing).toBe('true');

      clickMap(map, E);
      expect($('save-button')).toMatchObject({ textContent: 'save-update', disabled: false });
      // Undoing back to what was saved is clean again.
      click('undo-button');
      expect($('save-button')).toMatchObject({ textContent: 'save-saved', disabled: true });
    });

    test('updating a saved route writes the new streets back in place', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      world.saveModal.opts.onSaved({ route_id: 7 });
      clickMap(map, E);
      const fetch = stubFetch(() => ({ route_id: 7 }));

      click('save-button');
      await flush();

      expect(world.saveModal.open).not.toHaveBeenCalled();
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe('/userapi/routes/7');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body).streets.map((s) => s.street_id)).toEqual([1, 2, 3]);
      expect(toastMessages()).toContain('route-updated');
      expect($('save-button')).toMatchObject({ textContent: 'save-saved', disabled: true });
      expect(world.savedRoutes.recordGuestRoute).not.toHaveBeenCalled();
    });

    test('a guest\'s saves and updates refresh their device-local card from the server\'s answer', async () => {
      const { map } = await setupRouteBuilder({ signedIn: false });
      buildRoute(map, A, D);
      const saved = {
        route_id: 7, name: 'Loop', slug: 'loop-7', region_name: 'Downtown', region_count: 1, distance_meters: 222,
        thumbnail_url: '/t.png',
      };

      world.saveModal.opts.onSaved(saved);

      expect(world.savedRoutes.recordGuestRoute).toHaveBeenCalledWith({
        routeId: 7, name: 'Loop', slug: 'loop-7', regionName: 'Downtown', regionCount: 1,
        url: 'http://localhost/r/loop-7', distanceMeters: 222, thumbnailUrl: '/t.png',
      });

      clickMap(map, E);
      stubFetch(() => ({ ...saved, distance_meters: 333 }));
      click('save-button');
      await flush();
      expect(world.savedRoutes.recordGuestRoute).toHaveBeenLastCalledWith(
        expect.objectContaining({ distanceMeters: 333 }));
    });

    test.each([
      [404, 'route-update-gone'],
      [403, 'route-update-gone'],
      [500, 'save-error'],
    ])('a failed update (%i) says why and leaves the edits unsaved', async (status, message) => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      world.saveModal.opts.onSaved({ route_id: 7 });
      clickMap(map, E);
      stubFetch(() => ({ status }));

      click('save-button');
      await flush();

      expect(toastMessages()).toContain(message);
      expect($('save-button').textContent).toBe('save-update');
    });

    test('the leave guard counts an unsaved route, but not one away for the sign-in round trip', async () => {
      const { map } = await setupRouteBuilder();
      expect(world.guard.isDirty()).toBe(false);
      buildRoute(map, A, D);
      expect(world.guard.isDirty()).toBe(true);

      world.saveModal.opts.onSignIn();

      expect(world.guard.isDirty()).toBe(false);
    });

    test('"save first" on leaving a new route waits for the save modal, however it closes', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);

      const cancelled = world.guard.save();
      expect(world.saveModal.open).toHaveBeenCalled();
      world.saveModal.opts.onClose();
      await expect(cancelled).resolves.toBe(false);

      const saved = world.guard.save();
      world.saveModal.opts.onSaved({ route_id: 7 });
      await expect(saved).resolves.toBe(true);
    });

    test('"save first" on leaving a loaded route updates it in place', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      world.saveModal.opts.onSaved({ route_id: 7 });
      clickMap(map, E);
      stubFetch(() => ({ route_id: 7 }));

      await expect(world.guard.save()).resolves.toBe(true);
      expect(world.saveModal.open).not.toHaveBeenCalled();
    });
  });

  describe('loading a saved route', () => {
    test('a card opens its route in the editor, drawn exactly as stored and clean until changed', async () => {
      const { map } = await setupRouteBuilder();
      const fetch = stubFetch(() => storedStreets([3, true], [2, true]));

      world.savedRoutes.opts.onView(5);
      await flush();

      expect(fetch.mock.calls[0][0]).toBe('/userapi/routes/5/streets');
      expect(drawnRoute(map)).toEqual([[3, true], [2, true]]);
      expect(flags(map)).toEqual([['start', at(E)], ['end', at(B)]]);
      expect(panelState()).toBe('building');
      expect($('save-button')).toMatchObject({ textContent: 'save-saved', disabled: true });
      expect(world.savedRoutes.markActive).toHaveBeenLastCalledWith(5);
      expect(map.camera.at(-1)[0]).toBe('fitBounds');

      // Its waypoints are rebuilt at every street boundary, so it extends like one clicked out by hand.
      clickMap(map, A);
      expect(drawnRoute(map)).toEqual([[3, true], [2, true], [1, true]]);
      expect($('save-button').textContent).toBe('save-update');
    });

    test('streets gone since the route was saved are dropped, and the user is told', async () => {
      const { map } = await setupRouteBuilder();
      stubFetch(() => storedStreets([1, false], [404, false], [2, false]));

      world.savedRoutes.opts.onView(5);
      await flush();

      expect(drawnRoute(map)).toEqual([[1, false], [2, false]]);
      expect(toastMessages()).toContain('route-adjusted');
    });

    test('a route with none of its streets left keeps what was open and says so', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      world.saveModal.opts.onSaved({ route_id: 7 });
      stubFetch(() => storedStreets([404, false]));

      world.savedRoutes.opts.onView(5);
      await flush();

      expect(toastMessages()).toContain('route-load-empty');
      expect(drawnRoute(map)).toEqual([[1, false], [2, false]]);
    });

    test('a load that fails says so', async () => {
      await setupRouteBuilder();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      stubFetch(() => ({ status: 500 }));

      world.savedRoutes.opts.onView(5);
      await flush();

      expect(toastMessages()).toContain('route-load-error');
    });

    test('when two cards are clicked in quick succession, the later click wins however the loads finish',
      async () => {
        const { map } = await setupRouteBuilder();
        let finishFirst;
        stubFetch((url) => (url.includes('/5/')
          ? new Promise((resolve) => { finishFirst = () => resolve(storedStreets([1, false])); })
          : storedStreets([3, false])));

        world.savedRoutes.opts.onView(5);
        await flush();
        world.savedRoutes.opts.onView(6);
        await flush();
        finishFirst();
        await flush();

        expect(drawnRoute(map)).toEqual([[3, false]]);
        expect(world.savedRoutes.markActive).toHaveBeenLastCalledWith(6);
      });

    test('opening a route over unsaved work asks first, and declining keeps the work', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      const fetch = stubFetch(() => storedStreets([3, false]));
      world.confirmAnswer = false;

      world.savedRoutes.opts.onView(5);
      await flush();

      expect(world.confirms).toHaveLength(1);
      expect(fetch).not.toHaveBeenCalled();
      expect(drawnRoute(map)).toEqual([[1, false], [2, false]]);
    });

    test('clicking the open route\'s card again closes it, leaving the saved route alone', async () => {
      const { map } = await setupRouteBuilder();
      const fetch = stubFetch(() => storedStreets([1, false]));
      world.savedRoutes.opts.onView(5);
      await flush();

      world.savedRoutes.opts.onView(5);
      await flush();

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(drawnRoute(map)).toEqual([]);
      expect(panelState()).toBe('empty');
      expect(world.savedRoutes.markActive).toHaveBeenLastCalledWith(null);
      expect(logged()).toContain('RouteBuilder_Click=ExitEditSession');
    });

    test('deleting an unchanged loaded route just closes it; with edits it asks to discard them', async () => {
      const { map } = await setupRouteBuilder();
      stubFetch(() => storedStreets([1, false]));
      world.savedRoutes.opts.onView(5);
      await flush();

      clickMap(map, D);
      world.popover.onDelete();
      expect($('delete-route-modal-backdrop').style.visibility).toBe('visible');
      expect($('delete-route-title').textContent).toBe('discard-edit-title');
      expect($('delete-route-button').textContent).toBe('discard-edit-button');

      click('cancel-delete-route-button');
      click('undo-button');
      world.popover.onDelete();
      expect($('delete-route-modal-backdrop').style.visibility).toBe('hidden');
      expect(drawnRoute(map)).toEqual([]);

      // A new route afterwards gets the page's own delete copy back.
      buildRoute(map, A, D);
      world.popover.onDelete();
      expect($('delete-route-title').textContent).toBe('Delete route?');
    });

    test('a ?preview= link from the dashboard opens that route in the editor', async () => {
      const fetch = stubFetch(() => storedStreets([1, false]));
      const { map } = await setupRouteBuilder({ url: '/routeBuilder?preview=5' });
      await flush();

      expect(fetch.mock.calls[0][0]).toBe('/userapi/routes/5/streets');
      expect(drawnRoute(map)).toEqual([[1, false]]);
    });
  });

  describe('the sign-in round trip', () => {
    test('back from signing in to a route whose streets are all gone, the planner starts empty', async () => {
      const { map } = await setupRouteBuilder({
        pendingRoute: { streets: [{ street_id: 404, reverse: false }], name: 'Loop', camera: null },
      });

      expect(drawnRoute(map)).toEqual([]);
      expect(panelState()).toBe('empty');
      expect(world.saveModal.open).not.toHaveBeenCalled();
    });

    test('back from signing in, the stashed route is redrawn and the save modal reopens with what was typed',
      async () => {
        const { map } = await setupRouteBuilder({
          pendingRoute: {
            streets: [{ street_id: 1, reverse: false }, { street_id: 2, reverse: false }],
            name: 'Loop',
            description: '',
            camera: { center: [0.001, 0], zoom: 17 },
          },
        });

        expect(drawnRoute(map)).toEqual([[1, false], [2, false]]);
        expect(panelState()).toBe('building');
        expect(map.camera.at(-1)).toEqual(['jumpTo', { center: [0.001, 0], zoom: 17, bearing: 0, pitch: 0 }]);
        expect(world.saveModal.open).toHaveBeenCalledWith('Loop', null);
      });
  });

  describe('data that arrives out of order', () => {
    test('before the regions arrive, zooming and clicking do nothing, and the regions then draw for the zoom',
      async () => {
        const { rb, map } = await setupRouteBuilder({ regions: null });

        map.fire('mousemove', { lngLat: A });
        world.frame();
        clickMap(map, A);
        expect(openPopups('rb-cursor-guide')).toEqual([]);
        expect(map.camera).toEqual([]);

        map.zoomTo(RouteBuilder.PLACE_ZOOM);
        world.directions.opts.onSetStart(A);
        expect(flags(map)).toEqual([]);

        rb.renderRegions(regionData());
        await flush();
        expect(map.layout['regions-label.visibility']).toBe('none');
      });

    test('the layers are stacked only once the street layers exist too', async () => {
      const { rb, map } = await setupRouteBuilder({ streets: null });

      map.fire('sourcedataloading');
      expect(map.layerOrder).toEqual([]);

      rb.renderStreets(streetData());
      await flush();
      map.fire('sourcedataloading');
      expect(map.layerOrder).toContain('streets-chosen');
    });

    test('before the streets arrive, there is nothing to lose and no name to suggest', async () => {
      await setupRouteBuilder({ streets: null });

      expect(world.guard.isDirty()).toBe(false);
      expect(world.saveModal.opts.getSuggestedName()).toBe('');
    });

    test('a page without the estimate tip still starts', async () => {
      await setupRouteBuilder();
      $('route-time-tip').remove();
      const mapParams = {
        city_center: { lng: 0, lat: 0 },
        default_zoom: 12,
        southwest_boundary: { lng: -1, lat: -1 },
        northeast_boundary: { lng: 1, lat: 1 },
      };

      expect(() => new RouteBuilder('pk.test', mapParams, true, 2)).not.toThrow();
    });
  });

  describe('smaller interactions', () => {
    test('Cmd+Z undoes on a Mac', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);

      pressUndo({ metaKey: true });

      expect(drawnRoute(map)).toEqual([]);
    });

    test('Ctrl+Z on an empty planner changes nothing', async () => {
      const { map } = await setupRouteBuilder();

      pressUndo();

      expect(flags(map)).toEqual([]);
      expect(panelState()).toBe('empty');
    });

    test('other keys on the estimate leave its tip alone', async () => {
      await setupRouteBuilder();
      const press = new KeyboardEvent('keydown', { key: 'a', cancelable: true });

      $('route-time-val').dispatchEvent(press);

      expect($('route-time-tip').hidden).toBe(true);
      expect(press.defaultPrevented).toBe(false);
    });

    test('the points-of-interest toggle turns POI labels back on, and does nothing before the style loads',
      async () => {
        const { map } = await setupRouteBuilder();
        map.styleLayers = [{ id: 'poi-label', type: 'symbol' }];
        const toggle = $('poi-toggle-checkbox');

        toggle.dispatchEvent(new Event('change'));
        expect(map.layout['poi-label.visibility']).toBe('visible');

        map.getStyle = () => undefined;
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change'));
        expect(map.layout['poi-label.visibility']).toBe('visible');
      });

    test('moving within one region keeps its tint without setting it again', async () => {
      const { map } = await setupRouteBuilder();
      const setState = vi.spyOn(map, 'setFeatureState');

      map.fire('mousemove', { features: [{ properties: { region_id: 1 } }] }, 'regions-fill');
      map.fire('mousemove', { features: [{ properties: { region_id: 1 } }] }, 'regions-fill');

      expect(setState).toHaveBeenCalledTimes(1);
      expect(map.stateOf('regions', 1)).toEqual({ hover: true });
    });

    test('hovering open space in the overview shows no guide', async () => {
      const { map } = await setupRouteBuilder();

      map.fire('mousemove', { lngLat: NOWHERE });
      world.frame();

      expect(openPopups('rb-cursor-guide')).toEqual([]);
    });

    test('the guide is one bubble whose words follow the stage', async () => {
      const { map } = await setupRouteBuilder();
      map.zoomTo(RouteBuilder.PLACE_ZOOM);
      const hoverAt = (lngLat) => {
        map.fire('mousemove', { lngLat });
        world.frame();
      };

      hoverAt(A);
      hoverAt(B);
      clickMap(map, A);
      hoverAt(D);

      expect(world.popups.filter((p) => p.options.className === 'rb-cursor-guide')).toHaveLength(1);
      expect(openPopups('rb-cursor-guide').map((p) => p.text)).toEqual(['guide-pick-end']);
    });

    test('pointing at the drawn route hides the guide, since a click there opens its menu', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      map.rendered['streets-chosen'] = [{}];

      map.fire('mousemove', { lngLat: B });
      world.frame();

      expect(openPopups('rb-cursor-guide')).toEqual([]);
    });

    test('resting on the route while its menu is already open does not reopen it', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      world.popover.isOpen = () => true;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      map.fire('mousemove', { lngLat: B }, 'streets-chosen');
      vi.advanceTimersByTime(RouteBuilder.ROUTE_MENU_HOVER_MS);

      expect(world.popover.cancelHoverClose).toHaveBeenCalled();
      expect(world.popover.open).not.toHaveBeenCalled();
    });

    test('a first click already at street level keeps the zoom where it is', async () => {
      const { map } = await setupRouteBuilder();
      map.zoomTo(17);

      clickMap(map, A);

      expect(map.camera.map(([method]) => method)).toEqual(['scroll']);
      expect(flags(map)).toEqual([['start', at(A)]]);
    });

    test('the save modal stashes the current camera, and closing it hands focus back to Save', async () => {
      const { map } = await setupRouteBuilder();
      map.zoomTo(16);

      expect(world.saveModal.opts.getCamera()).toEqual({ center: [0.001, 0.0005], zoom: 16, bearing: 0, pitch: 0 });
      world.saveModal.opts.onClose();
      expect(document.activeElement).toBe($('save-button'));
    });

    test('the choice made in the leave prompt is logged', async () => {
      await setupRouteBuilder();

      world.guard.onChoice('Discard');

      expect(logged()).toContain('RouteBuilder_Click=UnsavedLeave_Discard');
    });

    test('a route in a region the page has no name for is counted and named plainly', async () => {
      const regions = regionData();
      regions.features = regions.features.filter((r) => r.properties.region_id === 1);
      const { map } = await setupRouteBuilder({ regions });

      buildRoute(map, D, E);

      expect($('route-stats-caption').textContent).toBe('street-count count=1');
      expect(world.saveModal.opts.getSuggestedName()).toBe('');
    });
  });

  describe('the preview, again', () => {
    test('pressing Preview mid-walk keeps the one walk going', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);

      click('preview-button');
      world.frame(0);
      click('preview-button');

      expect(world.frames.size).toBe(1);
      world.frame(RouteBuilder.EXPLORER_ANIMATION_MS);
      expect(map.getSource('route-explorer').data.features).toHaveLength(1);
    });

    test('a second preview started during the first one\'s linger is not cut short', async () => {
      const { map } = await setupRouteBuilder();
      buildRoute(map, A, D);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      click('preview-button');
      world.frame(0);
      world.frame(RouteBuilder.EXPLORER_ANIMATION_MS);
      click('preview-button');
      world.frame(0);
      vi.advanceTimersByTime(500);

      expect(map.getSource('route-explorer').data.features).toHaveLength(1);
    });

    test('a route with no length has nothing to walk', async () => {
      const here = [0.003, 0.003];
      const { map } = await setupRouteBuilder({ streets: streetsWith(50, [here, here]) });
      await openSavedRoute([50, false]);

      click('preview-button');

      expect(drawnRoute(map)).toEqual([[50, false]]);
      expect(world.frames.size).toBe(0);
    });

    test('a street that repeats its first point still walks from its start', async () => {
      const { map } = await setupRouteBuilder({ streets: streetsWith(51, [[0.004, 0], [0.004, 0], [0.005, 0]]) });
      await openSavedRoute([51, false]);

      click('preview-button');
      world.frame(0);

      expect(map.getSource('route-explorer').data.features[0].geometry.coordinates).toEqual([0.004, 0]);
    });
  });

  describe('loading and restoring, edge cases', () => {
    test('declining to discard edits keeps the open route open when its card is clicked again', async () => {
      const { map } = await setupRouteBuilder();
      await openSavedRoute([1, false]);
      clickMap(map, D);
      world.confirmAnswer = false;

      world.savedRoutes.opts.onView(5);
      await flush();

      expect(world.confirms).toHaveLength(1);
      expect(drawnRoute(map)).toEqual([[1, false], [2, false]]);
    });

    test('a load the user has already moved past fails quietly', async () => {
      const { map } = await setupRouteBuilder();
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      let failFirst;
      stubFetch((url) => (url.includes('/5/')
        ? new Promise((resolve) => { failFirst = () => resolve({ status: 500 }); })
        : storedStreets([3, false])));

      world.savedRoutes.opts.onView(5);
      await flush();
      world.savedRoutes.opts.onView(6);
      await flush();
      failFirst();
      await flush();

      expect(toastMessages()).not.toContain('route-load-error');
      expect(error).not.toHaveBeenCalled();
      expect(drawnRoute(map)).toEqual([[3, false]]);
    });

    test('back from signing in, the typed description is put back too', async () => {
      await setupRouteBuilder({
        pendingRoute: { streets: [{ street_id: 1, reverse: false }], name: 'Loop', description: 'Flat', camera: null },
      });

      expect(world.saveModal.open).toHaveBeenCalledWith('Loop', 'Flat');
    });

    test('back from signing in with an unusable camera, the map stays where it is', async () => {
      const { map } = await setupRouteBuilder({
        pendingRoute: { streets: [{ street_id: 1, reverse: false }], name: '', camera: { center: [NaN, 0], zoom: 17 } },
      });

      expect(map.camera.filter(([method]) => method === 'jumpTo')).toEqual([]);
      expect(world.saveModal.open).toHaveBeenCalledWith(null, null);
    });

    test('back from signing in, a tilted, turned camera is restored as it was', async () => {
      const { map } = await setupRouteBuilder({
        pendingRoute: {
          streets: [{ street_id: 1, reverse: false }],
          name: 'Loop',
          camera: { center: [0.001, 0], zoom: 17, bearing: 30, pitch: 45 },
        },
      });

      expect(map.camera.at(-1)).toEqual(['jumpTo', { center: [0.001, 0], zoom: 17, bearing: 30, pitch: 45 }]);
    });
  });
});
