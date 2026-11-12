/**
 * What the page-chrome suites share (#5840): the navbar, the auth dialog, the toasts and the dialogs that any page can
 * raise. jsdom has a <dialog> element but neither opens nor closes one, so `installDialogs` gives it a browser's.
 */

/**
 * Makes jsdom's dialogs open and close the way a browser's do: `showModal` sets `open`, and `close` clears it and
 * fires `close` on a later task, as a browser queues it. Esc and a `method="dialog"` submit close the same way, so a
 * suite stands in for those with `dialog.close()`.
 */
export function installDialogs() {
  const proto = window.HTMLDialogElement.prototype;
  proto.showModal = function showModal() { this.setAttribute('open', ''); };
  proto.close = function close() {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    setTimeout(() => this.dispatchEvent(new Event('close')));
  };
}

/**
 * Gives an element the box a layout engine would, since jsdom lays nothing out.
 * @param {Element} el - The element to measure.
 * @param {{left: number, top: number, width: number, height: number}} box - Where it sits, in viewport px.
 */
export function stubRect(el, { left, top, width, height }) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }),
  });
}

/**
 * Fires a pointer event with coordinates at an element. jsdom has no PointerEvent, and a MouseEvent carries the same
 * coordinates the code under test reads.
 * @param {Element} el - Where the event lands.
 * @param {string} type - E.g. 'pointerdown' or 'click'.
 * @param {number} [clientX] - Viewport x.
 * @param {number} [clientY] - Viewport y.
 */
export function pointerAt(el, type, clientX = 0, clientY = 0) {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }));
}

/**
 * Renders common/missionStartTutorial.scala.html as Explore and Validate include it, cut down to two of its seven
 * label-type tabs (the code reads whichever are there).
 */
export function renderMissionStartTutorial() {
  document.body.innerHTML = `
    <div class="mission-start-tutorial-overlay">
      <div class="mst-content">
        <div class="mst-instruction-1"></div>
        <div class="mst-instruction-2"></div>
        <div class="explore-mission-start-tab-bar ps-hidden">
          <div class="explore-mission-start-tab" data-label-type="CurbRamp">
            <div class="explore-mission-start-tab-text">Curb Ramp</div>
          </div>
          <div class="explore-mission-start-tab" data-label-type="NoCurbRamp">
            <div class="explore-mission-start-tab-text">No Curb Ramp</div>
          </div>
        </div>
        <div class="mst-carousel">
          <div class="previous-slide-button"></div>
          <div class="mst-slide">
            <div class="msts-image-area">
              <img class="msts-image" alt="">
              <div class="label-on-image">
                <div class="label-on-image-type"><div class="label-on-image-type-title"></div></div>
                <div class="label-on-image-description"></div>
              </div>
            </div>
            <div class="mst-text-area">
              <div class="example-type-area"><div class="example-type-label"></div></div>
              <div class="label-type-title"></div>
              <div class="label-type-subtitle"></div>
              <div class="label-type-description"></div>
              <div class="button mission-start-tutorial-done-btn" role="button">Start mission</div>
            </div>
          </div>
          <div class="next-slide-button"></div>
        </div>
        <div class="mst-carousel-location-indicator-area">
          <template id="mst-carousel-location-indicator-template">
            <div class="mst-carousel-location-indicator"></div>
          </template>
        </div>
      </div>
    </div>`;
}

/**
 * The navbar's city switcher, from common/navbar.scala.html, cut down to the current city and two countries. The
 * navbar always renders it, so every navbar a suite builds carries one.
 */
export const NAVBAR_CITY_DROPDOWN = `
  <li id="navbar-city-dropdown" class="navbar-item">
    <button type="button" id="nav-city-dropdown" class="navbar-button" data-nav-dropdown aria-haspopup="true"
            aria-expanded="false" aria-controls="nav-city-panel">Seattle</button>
    <div id="nav-city-panel" class="navbar-menu nav-city-panel">
      <div class="nav-city-search-wrap">
        <input type="search" id="nav-city-search" class="nav-city-search" autocomplete="off">
      </div>
      <ul id="nav-city-menu" class="nav-city-list">
        <li class="nav-city-item nav-city-current" data-search="seattle, wa united states">
          <span class="current-city" aria-current="true"><span>Seattle, WA</span></span>
        </li>
        <li class="nav-city-group" data-country="canada">
          <span class="nav-city-group-header">Canada</span>
          <ul class="nav-city-group-list">
            <li class="nav-city-item" data-search="burnaby, bc canada">
              <a id="burnaby-bc" href="https://sidewalk-burnaby.cs.washington.edu">Burnaby, BC</a>
            </li>
          </ul>
        </li>
        <li class="nav-city-group" data-country="usa">
          <span class="nav-city-group-header">United States</span>
          <ul class="nav-city-group-list">
            <li class="nav-city-item" data-search="chicago, il united states">
              <a id="chicago-il" href="https://sidewalk-chicago.cs.washington.edu">Chicago, IL</a>
            </li>
            <li class="nav-city-item" data-search="columbus, oh united states">
              <a id="columbus-oh" href="https://sidewalk-columbus.cs.washington.edu">Columbus, OH</a>
            </li>
          </ul>
        </li>
        <li class="nav-city-empty" hidden>No cities match</li>
      </ul>
      <div class="nav-city-footer">
        <a id="new-city" class="new-city" href="https://accessiblecommunities.org/use-project-sidewalk/">Your city?</a>
        <a id="navbar-cities-btn" class="nav-city-viewall" href="/cities">View all</a>
      </div>
    </div>
  </li>`;
