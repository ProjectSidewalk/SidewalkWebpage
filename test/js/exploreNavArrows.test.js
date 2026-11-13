/**
 * The navigation arrows over the pano (frontend/js/explore/panorama/NavArrows.js, #5840): one per linked pano, turned
 * against the camera; the one that takes the route's next step drawn in the navigation blue, or a blue arrow
 * synthesized where no link goes there; what a click or hover on each announces; the highlight a hovered minimap
 * crumb puts on its arrow; and the tutorial's hold and blink.
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
      supportsLocationSearch: () => true,
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

    test('a link up to 60° off the route is the blue one, as it is the one the spacebar takes', () => {
      viewer.links = [{ panoId: 'pano-northeast', heading: 35 }, { panoId: 'pano-north', heading: 20 }];
      arrows.reset();
      expect(forwardArrows().map((image) => image.getAttribute('pano-id'))).toEqual(['pano-northeast']);
      expect(synthesized()).toBeNull();
    });

    describe('with no link the route\'s way', () => {
      beforeEach(() => {
        viewer.links = [{ panoId: 'pano-west', heading: 270 }, { panoId: 'pano-north', heading: 0 }];
      });

      test('nothing is blue until the route walk\'s landing is known', () => {
        arrows.reset();
        expect(forwardArrows()).toEqual([]);
        expect(images()).toHaveLength(2);
      });

      test('the link to the pano the walk lands on is the blue one, whichever way it points', () => {
        arrows.setWalkLanding('pano-here', { panoId: 'pano-north', heading: 2 });
        expect(forwardArrows().map((image) => image.getAttribute('pano-id'))).toEqual(['pano-north']);
        expect(synthesized()).toBeNull();
      });

      test('a landing no link leads to gets a blue arrow of its own, aimed at that pano', () => {
        arrows.setWalkLanding('pano-here', { panoId: 'pano-unlinked', heading: 120 });
        expect(synthesized().getAttribute('transform')).toBe('translate(15, 0) rotate(120, 15, 30)');
        expect(synthesized().hasAttribute('pano-id')).toBe(false);
        expect(forwardArrows()).toEqual([synthesized()]);
        expect(images()).toHaveLength(3);
      });

      test('with no pano known ahead, the blue arrow points down the street', () => {
        arrows.setWalkLanding('pano-here', null);
        expect(synthesized().getAttribute('transform')).toBe('translate(15, 0) rotate(90, 15, 30)');
      });

      test('a landing worked out for another pano is not used, here or after a redraw', () => {
        arrows.reset();
        const drawn = images();
        arrows.setWalkLanding('pano-left-behind', { panoId: 'pano-north', heading: 2 });
        expect(images()).toEqual(drawn);
        arrows.reset();
        expect(forwardArrows()).toEqual([]);
      });

      test('the landing survives the redraw that follows a move', () => {
        arrows.setWalkLanding('pano-here', { panoId: 'pano-north', heading: 2 });
        arrows.reset();
        expect(forwardArrows().map((image) => image.getAttribute('pano-id'))).toEqual(['pano-north']);
      });

      test('with the street ended here and no pano ahead it is not drawn: it could only walk nowhere (#5918)', () => {
        arrows.setWalkLanding('pano-here', null);
        arrows.setWalkEnded(true);
        expect(synthesized()).toBeNull();
      });

      test('with the street ended but a pano still ahead it stays, so the last stretch can be walked', () => {
        arrows.setWalkLanding('pano-here', { panoId: 'pano-unlinked', heading: 120 });
        arrows.setWalkEnded(true);
        expect(synthesized().getAttribute('transform')).toBe('translate(15, 0) rotate(120, 15, 30)');
      });

      test('off the route nothing is synthesized: the link arrows lead back one pano at a time', () => {
        task.isNearRoute.mockReturnValue(false);
        arrows.setWalkLanding('pano-here', { panoId: 'pano-unlinked', heading: 120 });
        expect(forwardArrows()).toEqual([]);
        expect(images()).toHaveLength(2);
      });
    });

    test('with the street ended the nearest link is not blue, so the arrow cannot flip between its last panos', () => {
      viewer.links = [{ panoId: 'pano-east', heading: 90 }, { panoId: 'pano-west', heading: 270 }];
      task.headingAlongRoute.mockReturnValue(90);
      arrows.setWalkEnded(true);
      expect(forwardArrows()).toEqual([]);
      expect(images()).toHaveLength(2);
    });

    test('with the street ended the link to a pano further down it is still blue (#5918)', () => {
      viewer.links = [{ panoId: 'pano-east', heading: 90 }, { panoId: 'pano-west', heading: 270 }];
      arrows.setWalkEnded(true);
      arrows.setWalkLanding('pano-here', { panoId: 'pano-west', heading: 270 });
      expect(forwardArrows().map((image) => image.getAttribute('pano-id'))).toEqual(['pano-west']);
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

    describe('free exploration on a pano with no links (#5968)', () => {
      const streetArrows = () => [...group.querySelectorAll('.street-walk-arrow')];

      beforeEach(() => {
        config.isExploreAddressMode = true;
        viewer.links = [];
        // The street runs east; the labeler stands partway down it.
        task.headingAlongStreet = vi.fn((_position, towardEnd) => (towardEnd ? 90 : 270));
      });

      test('a plain arrow points each way down the street, as the only ways out', () => {
        arrows.reset();
        expect(images()).toEqual(streetArrows());
        expect(streetArrows().map((arrow) => [arrow.getAttribute('toward'), arrow.getAttribute('transform')]))
          .toEqual([['end', 'translate(15, 0) rotate(90, 15, 30)'], ['start', 'translate(15, 0) rotate(270, 15, 30)']]);
        expect(forwardArrows()).toEqual([]);
        expect(images().some((image) => image.hasAttribute('pano-id'))).toBe(false);
      });

      test('at an end of the street only the arrow back down it is drawn', () => {
        task.headingAlongStreet = vi.fn((_position, towardEnd) => (towardEnd ? null : 270));
        arrows.reset();
        expect(streetArrows().map((arrow) => arrow.getAttribute('toward'))).toEqual(['start']);
      });

      test('a click says which end of the street the arrow faces', () => {
        const streetWalkClicks = vi.fn();
        const routeForwardClicks = vi.fn();
        arrows.onStreetWalkClick(streetWalkClicks);
        arrows.onRouteForwardClick(routeForwardClicks);
        arrows.reset();
        streetArrows().forEach((arrow) => fire(arrow, 'click'));
        expect(streetWalkClicks.mock.calls).toEqual([[true], [false]]);
        expect(routeForwardClicks).not.toHaveBeenCalled();
      });

      test('a pano with any link keeps only its link arrows', () => {
        viewer.links = [{ panoId: 'pano-north', heading: 0 }];
        arrows.reset();
        expect(images().map((image) => image.getAttribute('pano-id'))).toEqual(['pano-north']);
        expect(arrows.streetWalkToward(90)).toBeNull();
      });

      test('an arrow key\'s heading picks the street arrow within 60° of it, as it would a link', () => {
        expect(arrows.streetWalkToward(100)).toBe(true);
        expect(arrows.streetWalkToward(250)).toBe(false);
        expect(arrows.streetWalkToward(0)).toBeNull();
      });

      test.each([
        ['no current street', () => { task = null; }],
        ['streets not loaded yet', () => { tasksLoaded = false; }],
        ['standing off the street', () => task.isNearRoute.mockReturnValue(false)],
        [
          'street geometry not ready',
          () => task.headingAlongStreet.mockImplementation(() => { throw new Error('no geometry'); }),
        ],
        ['a viewer that cannot search the street for a pano', () => { viewer.supportsLocationSearch = () => false; }],
      ])('nothing is drawn with no street to walk: %s', (_name, arrange) => {
        arrange();
        arrows.reset();
        expect(images()).toEqual([]);
        expect(arrows.streetWalkToward(90)).toBeNull();
      });

      test.each([
        ['the tutorial', () => { config.isOnboarding = true; }],
        ['a mission, whose arrow waits for the walk\'s landing', () => {}],
      ])('outside free exploration nothing is drawn by this rule: %s', (_name, arrange) => {
        config.isExploreAddressMode = false;
        arrange();
        arrows.reset();
        expect(images()).toEqual([]);
      });
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
      arrows.setWalkLanding('pano-here', null);
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
      arrows.setWalkLanding('pano-here', null);
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
