/**
 * The navigation arrows drawn over the pano: one per linked pano, with the route's next step in blue (#4671). Clicks
 * and hovers are announced, not acted on: moves belong to NavigationService and crumbs to ForwardCrumbs, built later.
 */

import { Gate } from '../../common/Gate.js';
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

/**
 * Where the route walk would land, and which way that is; null when no pano is known ahead.
 * @typedef {?{panoId: string, heading: number}} WalkLanding
 */

export class NavArrows {
  #group;
  #container;
  #config;
  #taskContainer;
  #panoManager;
  /** Showing the arrows; the tutorial holds it outside its walk step. */
  showing = new Gate();

  /**
   * The walk's landing, kept with its pano: it arrives after the move, so it may be for a pano already left.
   * @type {?{forPanoId: string, landing: WalkLanding}}
   */
  #walkLanding = null;

  /** Whether the street has ended where the labeler stands. */
  #walkEnded = false;

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
    this.showing.onChanged((held) => {
      if (held) this.hide();
    });

    group.addEventListener('click', (event) => {
      // The tutorial's walk step handles arrow clicks itself.
      if (this.#config.isOnboarding) return;
      event.stopPropagation();
      // A blue arrow with a pano-id is a real link and moves like one. Only the synthesized arrow (no pano-id)
      // walks the compass's "straight" path. (#4671)
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
    if (!this.showing.isHeld()) this.#container.style.display = '';
  }

  /**
   * Removes the old arrows and creates new ones from the current pano's links.
   *
   * The blue arrow points at the pano its click lands on (#4671, #5918): the link the spacebar would take, else the
   * link to the walk's landing, else a synthesized arrow aimed at the landing (down the street when none is known).
   * On an ended street only a landing further down it is blue: the nearest link can pace between its last panos.
   */
  reset() {
    while (this.#group.firstChild) {
      this.#group.removeChild(this.#group.firstChild);
    }

    // Off route the heading points back to the route, so the blue link arrows lead back one pano at a time.
    const links = this.#panoManager.panoViewer.getLinkedPanos();
    const routeHeading = this.#routeForwardHeading();
    let blueIndex = routeHeading === null || this.#walkEnded ? -1 : ForwardCrumbs.stepLinkIndex(links, routeHeading);
    let synthesizedHeading = null;

    // On route only: off route the walk would teleport back rather than step. Until the landing is known nothing
    // is blue, since a guess could point nowhere.
    const walk = this.#walkLanding;
    if (routeHeading !== null && blueIndex === -1 && this.#isEnRoute()
      && walk && walk.forPanoId === this.#panoManager.getPanoId()) {
      const landing = walk.landing;
      blueIndex = landing ? links.findIndex((link) => link.panoId === landing.panoId) : -1;
      const leadsOn = landing || !this.#walkEnded;
      if (blueIndex === -1 && leadsOn) synthesizedHeading = landing ? landing.heading : routeHeading;
    }

    links.forEach((link, i) => {
      const arrow = i === blueIndex ? NavArrows.#createForwardArrow() : NavArrows.#createArrow();
      arrow.setAttribute('transform', `translate(15, 0) rotate(${(link.heading + 360) % 360}, 15, 30)`);
      arrow.setAttribute('pano-id', link.panoId);
      this.#group.appendChild(arrow);
    });

    if (synthesizedHeading !== null) {
      const arrow = NavArrows.#createForwardArrow();
      arrow.classList.add('route-forward-arrow');
      arrow.setAttribute('transform', `translate(15, 0) rotate(${synthesizedHeading}, 15, 30)`);
      this.#group.appendChild(arrow);
    }

    this.rotate(this.#panoManager.getPov().heading);
  }

  /**
   * Told where the route walk would land, once the minimap's lookups answer; redraws so the blue arrow points there.
   * @param {string} forPanoId - The pano the landing was worked out for.
   * @param {WalkLanding} landing
   */
  setWalkLanding(forPanoId, landing) {
    this.#walkLanding = { forPanoId, landing };
    if (forPanoId === this.#panoManager.getPanoId()) this.reset();
  }

  /**
   * Told when the prompt to move on from a finished street goes up, and when the labeler takes it (#5918).
   * @param {boolean} ended
   */
  setWalkEnded(ended) {
    this.#walkEnded = ended;
    // Taking the prompt is a move, which redraws the arrows itself.
    if (ended) this.reset();
  }

  /**
   * Turns the arrow set against the camera, so each arrow keeps pointing its own way as the user pans.
   * @param {number} heading - The viewer's heading in degrees.
   */
  rotate(heading) {
    this.#group.setAttribute('transform', `rotate(${-heading})`);
  }

  /**
   * The heading (degrees from true north) toward the route's next goal, which picks the link arrow drawn blue
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
   * highlighted) or adds route-forward-arrow (synthesized where no link leads on).
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
