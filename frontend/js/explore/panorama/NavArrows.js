/**
 * The navigation arrows drawn over the pano: one per linked pano, rotated to its direction, plus the route's way
 * forward in the navigation blue (#4671). What a click or hover means is announced rather than acted on here, since
 * the moves belong to NavigationService and the matching minimap crumb to ForwardCrumbs, both built after this.
 */

import { util } from '../../common/utilities.js';
import { ForwardCrumbs } from '../navigation/ForwardCrumbs.js';
import { MinimapStyle } from '../navigation/MinimapStyle.js';
/** @typedef {import('../Main.js').ExploreConfig} ExploreConfig */
/** @typedef {import('./PanoManager.js').PanoManager} PanoManager */
/** @typedef {import('../task/TaskContainer.js').TaskContainer} TaskContainer */

/**
 * What an arrow leads to: a linked pano, or the route walk's next stop (the synthesized route-forward arrow).
 * @typedef {{panoId: string}|{routeForward: true}} ArrowTarget
 */

export class NavArrows {
  #group;
  #container;
  #config;
  #taskContainer;
  #panoManager;
  #lockHidden = false;

  /** @type {Array<(panoId: string) => void>} */
  #linkClickListeners = [];

  /** @type {Array<() => void>} */
  #routeForwardClickListeners = [];

  /** @type {Array<(target: ?ArrowTarget) => void>} */
  #hoverListeners = [];

  /**
   * @param {SVGElement} group - The `<g>` the arrows are drawn into.
   * @param {HTMLElement} container - What hides and shows the whole arrow set.
   * @param {ExploreConfig} config
   * @param {TaskContainer} taskContainer - Whose current street says which way the route goes.
   * @param {PanoManager} panoManager - Whose viewer lists the linked panos, and whose view the arrows turn with.
   */
  constructor(group, container, config, taskContainer, panoManager) {
    this.#group = group;
    this.#container = container;
    this.#config = config;
    this.#taskContainer = taskContainer;
    this.#panoManager = panoManager;
    panoManager.onPovChanged((heading) => this.rotate(heading));

    group.addEventListener('click', (event) => {
      // The tutorial's walk step handles arrow clicks itself.
      if (this.#config.isOnboarding) return;
      event.stopPropagation();
      // A highlighted forward arrow that still carries a pano-id is a real link (just recolored to mark the route),
      // so it navigates like any link. Only the synthesized route-forward arrow (no pano-id, drawn when the link
      // graph offers nothing along the route) walks the compass's "straight" path. (#4671)
      const target = /** @type {Element} */ (event.target);
      const targetPanoId = target.getAttribute('pano-id');
      if (targetPanoId) {
        this.#linkClickListeners.forEach((listener) => listener(targetPanoId));
      } else if (target.classList.contains('route-forward-arrow')) {
        this.#routeForwardClickListeners.forEach((listener) => listener());
      }
    });

    // Hovering an arrow outlines the minimap crumb it leads to, so "this arrow" and "that dot" read as one thing
    // (#4682). mouseover and mouseout bubble, so one delegated pair covers the arrows reset() recreates on every move.
    group.addEventListener('mouseover', (event) => {
      const target = /** @type {Element} */ (event.target);
      const targetPanoId = target.getAttribute('pano-id');
      if (targetPanoId) this.#announceHover({ panoId: targetPanoId });
      else if (target.classList.contains('route-forward-arrow')) this.#announceHover({ routeForward: true });
    });
    group.addEventListener('mouseout', () => this.#announceHover(null));
  }

  /**
   * Told when a link arrow is clicked, with the pano it leads to.
   * @param {(panoId: string) => void} listener
   */
  onLinkClick(listener) {
    this.#linkClickListeners.push(listener);
  }

  /**
   * Told when the synthesized route-forward arrow is clicked.
   * @param {() => void} listener
   */
  onRouteForwardClick(listener) {
    this.#routeForwardClickListeners.push(listener);
  }

  /**
   * Told what the pointer is over: an arrow's target, or null once it leaves the arrows.
   * @param {(target: ?ArrowTarget) => void} listener
   */
  onHover(listener) {
    this.#hoverListeners.push(listener);
  }

  /**
   * @param {?ArrowTarget} target
   */
  #announceHover(target) {
    this.#hoverListeners.forEach((listener) => listener(target));
  }

  hide() {
    this.#container.style.display = 'none';
  }

  show() {
    if (!this.#lockHidden) this.#container.style.display = '';
  }

  /** Keeps show() from showing the arrows; the tutorial keeps them hidden. */
  lockHidden() {
    this.hide();
    this.#lockHidden = true;
  }

  /** Lets show() show the arrows again. */
  unlockHidden() {
    this.#lockHidden = false;
  }

  /**
   * Removes the old arrows and creates new ones from the current pano's links.
   *
   * The arrow pointing the way the route wants the user to go is highlighted in the navigation blue (#4671): normally
   * that is the forward link arrow, recolored; where the link graph offers nothing along the route (a dead-end), a
   * blue arrow is synthesized at the route heading and its click walks the route instead of a link.
   */
  reset() {
    while (this.#group.firstChild) {
      this.#group.removeChild(this.#group.firstChild);
    }

    // Highlight the link that best heads the route's way: forward when on route, back toward the route when off route
    // (the heading is measured from the current position). Following the blue link arrows then walks the user along,
    // or back to, the route one pano at a time.
    const links = this.#panoManager.panoViewer.getLinkedPanos();
    const targetHeading = this.#routeForwardHeading();
    const forwardIndex = targetHeading === null ? -1 : ForwardCrumbs.closestLinkIndex(links, targetHeading);

    links.forEach((link, i) => {
      const arrow = i === forwardIndex ? NavArrows.#createForwardArrow() : NavArrows.#createArrow();
      arrow.setAttribute('transform', `translate(15, 0) rotate(${(link.heading + 360) % 360}, 15, 30)`);
      arrow.setAttribute('pano-id', link.panoId);
      this.#group.appendChild(arrow);
    });

    // With no link the route's way, synthesize a forward arrow at the route heading, but only on route, where the
    // route walk steps forward along the street. Off route it would teleport back to the route rather than step, so
    // the user keeps their link arrows to walk back one pano at a time instead. (#4671)
    if (targetHeading !== null && forwardIndex === -1 && this.#isEnRoute()) {
      const arrow = NavArrows.#createForwardArrow();
      arrow.classList.add('route-forward-arrow');
      arrow.setAttribute('transform', `translate(15, 0) rotate(${targetHeading}, 15, 30)`);
      this.#group.appendChild(arrow);
    }

    this.rotate(this.#panoManager.getPov().heading);
  }

  /**
   * Turns the arrow set against the camera, so each arrow keeps pointing its own way as the user pans.
   * @param {number} heading - The viewer's heading in degrees.
   */
  rotate(heading) {
    this.#group.setAttribute('transform', `rotate(${-heading})`);
  }

  /**
   * The heading (degrees from true north) toward the route's next goal, which picks the arrow highlighted forward
   * (#4671): the way forward on route, back toward the route off it. Null when there is no route at all: free
   * exploration, the tutorial, no current task, or a task whose geometry isn't ready.
   * @returns {?number}
   */
  #routeForwardHeading() {
    if (this.#config.isExploreAddressMode || this.#config.isOnboarding) return null;
    const task = this.#taskContainer.getCurrentTask();
    if (!this.#taskContainer.tasksLoaded() || !task) return null;
    try {
      return task.headingAlongRoute(this.#panoManager.getPosition());
    } catch {
      return null; // Route geometry not ready yet (e.g. mid-initialization).
    }
  }

  /** @returns {boolean} Whether the user stands close enough to the current street to count as on the route. */
  #isEnRoute() {
    const task = this.#taskContainer.getCurrentTask();
    return !task || task.isNearRoute(this.#panoManager.getPosition());
  }

  /**
   * Lights up the arrow that leads to a pano, as hovering the arrow itself would: the other half of the "this arrow
   * ↔ that crumb" tie (#4682), for when the user hovers the crumb on the minimap.
   * @param {string} panoId - The pano the hovered crumb marks.
   * @param {boolean} isWalkNextStop - Whether that pano is the route walk's next stop, which the synthesized
   *   route-forward arrow leads to when no link does.
   */
  highlightTo(panoId, isWalkNextStop) {
    this.clearHighlight();
    let arrow = this.#group.querySelector(`image[pano-id="${CSS.escape(panoId)}"]`);
    if (!arrow && isWalkNextStop) arrow = this.#group.querySelector('.route-forward-arrow');
    if (arrow) arrow.classList.add('arrow-hover');
  }

  /** Clears any arrow highlight set by {@link highlightTo}. */
  clearHighlight() {
    for (const arrow of this.#group.querySelectorAll('.arrow-hover')) {
      arrow.classList.remove('arrow-hover');
    }
  }

  /** Makes the arrows blink; the tutorial's walk step uses it. */
  blink() {
    setTimeout(() => {
      const arrows = this.#group.querySelectorAll('image');
      // Obtain interval id to allow for the interval to be cleaned up after the arrow leaves document context.
      const intervalId = window.setInterval(() => {
        arrows.forEach((arrow) => {
          if (arrow.classList.contains('highlight')) arrow.classList.remove('highlight');
          else arrow.classList.add('highlight');

          // Once the arrow is removed from the document, stop the interval for all arrows.
          if (!document.body.contains(arrow)) window.clearInterval(intervalId);
        });
      }, 500);
    }, 500);
  }

  /**
   * One link arrow.
   * @returns {SVGImageElement}
   */
  static #createArrow() {
    const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', util.assetPath('images/icons/arrow-forward.svg'));
    image.setAttribute('width', '20');
    image.setAttribute('height', '20');
    image.setAttribute('x', '5');  // ((areaWidth / 2)  - iconWidth) / 2 = ((60 / 2 - 20) / 2 = 5

    return image;
  }

  /**
   * The blue "go this way" arrow (#4671): a link arrow's chevron filled with the peg's navigation blue through an
   * inline SVG, so the color stays sourced from the design token. The caller keeps its pano-id (a real link,
   * highlighted) or adds route-forward-arrow (synthesized at a dead end).
   * @returns {SVGImageElement}
   */
  static #createForwardArrow() {
    const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 -960 960 960">
      <path d="m 885.5,-315.5 -71,71 -329,-329 -329,329 -71,-71 400,-400 z" fill="${MinimapStyle.pegColor()}"/></svg>`;
    image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `data:image/svg+xml,${encodeURIComponent(svg)}`);
    image.setAttribute('width', '20');
    image.setAttribute('height', '20');
    image.setAttribute('x', '5');
    image.classList.add('route-forward-highlight');
    return image;
  }
}
