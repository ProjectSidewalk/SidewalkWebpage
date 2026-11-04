/**
 * The navigation arrows over the pano (frontend/js/explore/panorama/NavArrows.js, #5840): one per linked pano, turned
 * against the camera; the one leading the route's way drawn in the navigation blue, or a blue arrow synthesized at a
 * dead end; what a click or hover on each announces; the highlight a hovered minimap crumb puts on its arrow; and the
 * tutorial's hold and blink.
 */

import { loadModules } from './loader.js';
import { fakePanoManager, fakeTaskContainer } from './fakes.js';

const XLINK_NS = 'http://www.w3.org/1999/xlink';

describe('NavArrows', () => {
  let arrows;
  let group;
  let container;
  let config;
  let task;
  let tasksLoaded;
  let viewer;
  let povChanged;

  beforeEach(async () => {
    const { NavArrows } = await loadModules('frontend/js/explore/panorama/NavArrows.js');
    document.body.innerHTML = '<div id="arrows"><svg><g id="arrow-group"></g></svg></div>';
    container = document.getElementById('arrows');
    group = document.getElementById('arrow-group');
    config = { isOnboarding: false, isExploreAddressMode: false };
    // The route heads east from here, and the labeler stands on it.
    task = { headingAlongRoute: vi.fn(() => 90), isNearRoute: vi.fn(() => true) };
    tasksLoaded = true;
    viewer = {
      heading: 0,
      links: [{ panoId: 'pano-east', heading: 85 }, { panoId: 'pano-west', heading: -90 }],
      getPanoId: () => 'pano-here',
      getPosition: () => ({ lat: 47.6, lng: -122.3 }),
      getPov() { return { heading: this.heading, pitch: 0, zoom: 1 }; },
      getLinkedPanos() { return this.links; },
    };
    arrows = new NavArrows(group, container, config, fakeTaskContainer(() => task, { tasksLoaded: () => tasksLoaded }),
      fakePanoManager(viewer, { onPovChanged: (listener) => { povChanged = listener; } }));
  });

  const images = () => [...group.querySelectorAll('image')];
  const href = (image) => image.getAttributeNS(XLINK_NS, 'href');
  const forwardArrows = () => images().filter((image) => image.classList.contains('route-forward-highlight'));
  const synthesized = () => group.querySelector('.route-forward-arrow');
  const fire = (target, type) => target.dispatchEvent(new MouseEvent(type, { bubbles: true }));

  describe('drawing', () => {
    test('one arrow per link, turned to its heading, and the whole set turned against the camera', () => {
      viewer.heading = 30;
      arrows.reset();

      expect(images().map((image) => image.getAttribute('pano-id'))).toEqual(['pano-east', 'pano-west']);
      expect(images().map((image) => image.getAttribute('transform')))
        .toEqual(['translate(15, 0) rotate(85, 15, 30)', 'translate(15, 0) rotate(270, 15, 30)']);
      expect(group.getAttribute('transform')).toBe('rotate(-30)');

      povChanged(120);
      expect(group.getAttribute('transform')).toBe('rotate(-120)');
    });

    test('the link nearest the route\'s way is the blue one; the rest are plain link arrows', () => {
      arrows.reset();

      const [east, west] = images();
      expect(forwardArrows()).toEqual([east]);
      expect(href(east)).toMatch(/^data:image\/svg\+xml,/);
      expect(decodeURIComponent(href(east))).toContain('fill="#3E8BD9"');
      expect(href(west)).toBe('/assets/images/icons/arrow-forward.svg');
      expect(synthesized()).toBeNull();
    });

    test('with no link the route\'s way, a blue arrow at the route heading is added, but only on the route', () => {
      viewer.links = [{ panoId: 'pano-west', heading: 270 }];
      arrows.reset();

      expect(synthesized()).not.toBeNull();
      expect(synthesized().getAttribute('transform')).toBe('translate(15, 0) rotate(90, 15, 30)');
      expect(synthesized().hasAttribute('pano-id')).toBe(false);
      expect(images()).toHaveLength(2);

      // Off the route the link arrows lead back one pano at a time; a synthesized arrow would teleport instead.
      task.isNearRoute.mockReturnValue(false);
      arrows.reset();
      expect(synthesized()).toBeNull();
      expect(images()).toHaveLength(1);
    });

    test('off the route the blue arrow is the link that leads back toward it', () => {
      task.isNearRoute.mockReturnValue(false);
      task.headingAlongRoute.mockReturnValue(270);
      arrows.reset();
      expect(forwardArrows().map((image) => image.getAttribute('pano-id'))).toEqual(['pano-west']);
    });

    test('with no street at all, every link stands close enough to count as on route', () => {
      task = null;
      arrows.reset();
      expect(images()).toHaveLength(2);
      expect(forwardArrows()).toEqual([]);
    });

    test.each([
      ['free exploration', () => { config.isExploreAddressMode = true; }],
      ['the tutorial', () => { config.isOnboarding = true; }],
      ['streets not loaded yet', () => { tasksLoaded = false; }],
      ['no current street', () => { task = null; }],
      [
        'route geometry not ready',
        () => task.headingAlongRoute.mockImplementation(() => { throw new Error('no geometry'); }),
      ],
    ])('nothing is highlighted with no route to follow: %s', (_name, arrange) => {
      arrange();
      viewer.links = [{ panoId: 'pano-north', heading: 0 }];
      arrows.reset();
      expect(images()).toHaveLength(1);
      expect(forwardArrows()).toEqual([]);
      expect(synthesized()).toBeNull();
    });

    test('a redraw replaces the arrows of the pano left behind', () => {
      arrows.reset();
      viewer.links = [{ panoId: 'pano-next', heading: 90 }];
      arrows.reset();
      expect(images().map((image) => image.getAttribute('pano-id'))).toEqual(['pano-next']);
    });
  });

  describe('clicks', () => {
    let linkClicks;
    let routeForwardClicks;
    let reachedContainer;

    beforeEach(() => {
      linkClicks = vi.fn();
      routeForwardClicks = vi.fn();
      reachedContainer = vi.fn();
      arrows.onLinkClick(linkClicks);
      arrows.onRouteForwardClick(routeForwardClicks);
      container.addEventListener('click', reachedContainer);
      viewer.links = [{ panoId: 'pano-west', heading: 270 }];
      arrows.reset();
    });

    test('a link arrow names the pano it leads to, and the click goes no further', () => {
      fire(group.querySelector('image[pano-id]'), 'click');
      expect(linkClicks).toHaveBeenCalledWith('pano-west');
      expect(routeForwardClicks).not.toHaveBeenCalled();
      expect(reachedContainer).not.toHaveBeenCalled();
    });

    test('the synthesized arrow asks for a step along the route', () => {
      fire(synthesized(), 'click');
      expect(routeForwardClicks).toHaveBeenCalledTimes(1);
      expect(linkClicks).not.toHaveBeenCalled();
    });

    test('a click on the group between arrows does nothing', () => {
      fire(group, 'click');
      expect(linkClicks).not.toHaveBeenCalled();
      expect(routeForwardClicks).not.toHaveBeenCalled();
    });

    test('in the tutorial the walk step handles the click itself', () => {
      config.isOnboarding = true;
      fire(group.querySelector('image[pano-id]'), 'click');
      expect(linkClicks).not.toHaveBeenCalled();
      expect(reachedContainer).toHaveBeenCalledTimes(1);
    });
  });

  describe('hover', () => {
    let hovered;

    beforeEach(() => {
      hovered = vi.fn();
      arrows.onHover(hovered);
      viewer.links = [{ panoId: 'pano-west', heading: 270 }];
      arrows.reset();
    });

    test('says which pano or route step is under the pointer, and when it leaves', () => {
      fire(group.querySelector('image[pano-id]'), 'mouseover');
      fire(synthesized(), 'mouseover');
      fire(group, 'mouseover');
      fire(group, 'mouseout');
      expect(hovered.mock.calls).toEqual([[{ panoId: 'pano-west' }], [{ routeForward: true }], [null]]);
    });

    test('a hovered minimap crumb lights its arrow, the synthesized one for the walk\'s next stop', () => {
      arrows.highlightTo('pano-west', false);
      expect(group.querySelector('.arrow-hover').getAttribute('pano-id')).toBe('pano-west');

      arrows.highlightTo('pano-unlinked', true);
      expect(group.querySelectorAll('.arrow-hover')).toHaveLength(1);
      expect(group.querySelector('.arrow-hover')).toBe(synthesized());

      arrows.highlightTo('pano-unlinked', false);
      expect(group.querySelector('.arrow-hover')).toBeNull();

      arrows.highlightTo('pano-west', false);
      arrows.clearHighlight();
      expect(group.querySelector('.arrow-hover')).toBeNull();
    });
  });

  describe('showing', () => {
    test('the tutorial\'s hold hides the arrows and keeps them hidden until it lets go', () => {
      arrows.show();
      expect(container.style.display).toBe('');

      arrows.showing.hold('tutorial');
      expect(container.style.display).toBe('none');
      arrows.show();
      expect(container.style.display).toBe('none');

      arrows.showing.release('tutorial');
      expect(container.style.display).toBe('none');
      arrows.show();
      expect(container.style.display).toBe('');
      arrows.hide();
      expect(container.style.display).toBe('none');
    });

    test('blinking toggles the arrows every half second, and stops once they are redrawn', () => {
      vi.useFakeTimers();
      arrows.reset();
      const [first] = images();
      arrows.blink();

      vi.advanceTimersByTime(1000);
      expect(first.classList.contains('highlight')).toBe(true);
      vi.advanceTimersByTime(500);
      expect(first.classList.contains('highlight')).toBe(false);

      arrows.reset();
      vi.advanceTimersByTime(500);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
