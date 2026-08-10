window.util = window.util || {};

// Some constants that are used across the site.
util.EXPLORE_CANVAS_WIDTH = 720;
util.EXPLORE_CANVAS_HEIGHT = 480;
util.EXPLORE_CANVAS_ASPECT_RATIO = util.EXPLORE_CANVAS_WIDTH / util.EXPLORE_CANVAS_HEIGHT;

/**
 * Ratio between the Explore street view's on-screen size and its fixed 720x480 logical coordinate frame.
 *
 * The pano is displayed larger than the logical frame (see the --pano-width CSS variable), but all coordinate
 * math, stored canvas_x/canvas_y, and pano_x/pano_y stay in the 720x480 frame. This ratio converts between the
 * two: multiply a logical coordinate by it to position a DOM element over the pano, or divide an on-screen
 * coordinate by it to map a click back into the logical frame. Measured live so it is robust to any scaling.
 *
 * @returns {number} displayWidth / EXPLORE_CANVAS_WIDTH, or 1 if the street view is not present
 */
util.exploreDisplayScale = function () {
  const layer = document.getElementById('label-drawing-layer');
  return layer ? layer.getBoundingClientRect().width / util.EXPLORE_CANVAS_WIDTH : 1;
};

/**
 * Sizes an Explore-tool canvas bitmap to its on-screen size times the device pixel ratio, and scales the 2D
 * context so all drawing done in the fixed 720x480 logical frame renders at full resolution.
 *
 * Shared by the label canvas and the onboarding canvas so the two can't drift: both draw in the logical frame and
 * are displayed at pano size, and a canvas left at its authored 720x480 bitmap gets CSS-stretched into visible
 * pixelation on HiDPI displays (#4817).
 *
 * @param {HTMLCanvasElement} el - The canvas element to size.
 * @param {CanvasRenderingContext2D} ctx - That canvas's 2D context.
 */
util.sizeCanvasToDisplay = function (el, ctx) {
  const rect = el.getBoundingClientRect();
  const displayWidth = rect.width || util.EXPLORE_CANVAS_WIDTH;
  const dpr = window.devicePixelRatio || 1;
  el.width = Math.round(displayWidth * dpr);
  el.height = Math.round(displayWidth / util.EXPLORE_CANVAS_ASPECT_RATIO * dpr);
  // Map the 720x480 logical frame onto the full-resolution bitmap. Setting el.width/height above resets the
  // context, so this transform must be (re)applied here.
  const scale = el.width / util.EXPLORE_CANVAS_WIDTH;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  // Label icons are drawn from a raster sized for the densest display we support (see Label.preloadIcons), so on
  // anything less dense they arrive downscaled; the default 'low' filter frays their outer circle.
  ctx.imageSmoothingQuality = 'high';
};

/**
 * Positions a panel beside a label's icon in a pano and points its tail at that icon.
 *
 * Explore's hover card and its context menu are two states of one panel — read-only, then editable — so they share
 * this routine and land on the same anchor: beside the icon on whichever side has room, vertically centered on it,
 * and nudged to stay inside the tool. Clicking a label then expands the card into the menu roughly in place instead
 * of moving it somewhere else. Validate's label card is the same panel again, over a different pano frame (#4726).
 * Panels styled with .label-anchored-panel read the values this sets.
 *
 * Coordinates are given in a logical frame that `scale` converts to on-screen pixels, so a caller whose marker is
 * already positioned in on-screen pixels divides by the same `scale` before calling. Both tools' panos are 720x480
 * at --ui-scale = 1, so the default `frameHeight` suits either.
 *
 * @param {jQuery} panel - The panel to position. Must be .label-anchored-panel and a child of `opts.originEl`.
 * @param {{x: number, y: number}} labelCanvasXY - The label icon's center in the logical canvas frame.
 * @param {number} iconRadius - The label icon's radius, in that same logical frame.
 * @param {object} [opts] - Frame overrides. Omit them entirely for Explore, whose frame is the default.
 * @param {number} [opts.scale] - Logical-to-screen ratio, also applied to the gap/edge constants below.
 * @param {HTMLElement} [opts.originEl] - The panel's offset parent, whose left edge is its coordinate origin.
 * @param {HTMLElement} [opts.boundsEl] - Supplies the horizontal bounds the panel is kept inside.
 * @param {number} [opts.frameHeight] - Vertical bound, in on-screen pixels, measured from `originEl`'s top.
 */
util.anchorPanelToLabel = function (panel, labelCanvasXY, iconRadius, opts = {}) {
  const scale = opts.scale ?? util.exploreDisplayScale();

  // All three scale with the tool, like the panel's own dimensions: the tail is 8px * --ui-scale wide, so an
  // unscaled GAP would be narrower than the tail once the tool scales past 1.5x and the tail would overlap the icon.
  const GAP = 12 * scale;  // Between the icon and the panel.
  const EDGE = 4 * scale;  // Smallest gap left between the panel and the bounds below.
  const TAIL_MARGIN = 18 * scale; // Keeps the tail's base clear of the panel's rounded corners.
  const centerX = labelCanvasXY.x * scale;
  const centerY = labelCanvasXY.y * scale;
  const radius = iconRadius * scale;
  const width = panel.outerWidth();
  const height = panel.outerHeight();
  const panoHeight = opts.frameHeight ?? util.EXPLORE_CANVAS_HEIGHT * scale;

  // In Explore the panel is bounded horizontally by the whole tool, not the pano: the pano's right edge is not a
  // wall, and a panel is welcome to float over the sidebar beside it. That matters because the context menu is over
  // half the pano's width, so confining it to the pano would leave a label in the middle no room on either side.
  // Validate passes its pano as both elements instead — the validation menu beside it is the thing being answered,
  // so a card must not cover it. Vertically the pano IS the bound in both: something sits above and below it.
  // Bounds are in the panel's own coordinate space, whose origin is originEl's top-left (its offset parent).
  const originEl = opts.originEl ?? document.getElementById('street-view-holder');
  const boundsEl = opts.boundsEl ?? document.getElementById('svl-application-holder');
  const panoLeft = originEl?.getBoundingClientRect().left ?? 0;
  const appRect = boundsEl?.getBoundingClientRect();
  const minLeft = (appRect ? appRect.left - panoLeft : 0) + EDGE;
  const rightBound = (appRect ? appRect.right - panoLeft : util.EXPLORE_CANVAS_WIDTH * scale) - EDGE;

  // A panel bigger than the space left for it still has to go somewhere: these maxima collapse to the near edge
  // rather than going past it, so it overhangs the far edge instead of being pushed off the near one.
  const maxLeft = Math.max(minLeft, rightBound - width);
  const maxTop = Math.max(EDGE, panoHeight - height - EDGE);

  const flipped = centerX + radius + GAP + width > rightBound;
  const left = flipped ? centerX - radius - GAP - width : centerX + radius + GAP;
  const top = Math.min(Math.max(centerY - height / 2, EDGE), maxTop);
  const tailTop = Math.min(Math.max(centerY - top, TAIL_MARGIN), height - TAIL_MARGIN);

  panel.toggleClass('label-anchored-panel--flipped', flipped);
  panel[0].style.setProperty('--panel-tail-top', `${tailTop}px`);
  panel.css({ left: Math.min(Math.max(left, minLeft), maxLeft), top });
};

/**
 * Uniformly scales a whole tool (Explore, Validate) to fit the available viewport, like browser zoom.
 *
 * Sets the --ui-scale CSS variable on .tool-ui; every tool dimension is expressed as base-size * var(--ui-scale),
 * so the pano, menus, and text all grow/shrink together in proportion. The tool's reference footprint at
 * --ui-scale = 1 is the sum of the given base-size CSS variables, which each tool defines on its .tool-ui element.
 * @param {string[]} widthVarNames Base-size CSS variables that sum to the tool's reference width.
 * @param {string[]} heightVarNames Base-size CSS variables that sum to the tool's reference height.
 * @returns {number} The applied scale factor.
 */
util.applyToolScale = function (widthVarNames, heightVarNames) {
  const toolUI = document.querySelector('.tool-ui');
  if (!toolUI) return 1;

  // Reference layout size at --ui-scale = 1, read from the unscaled base dimensions in the tool's CSS.
  const styles = getComputedStyle(toolUI);
  const cssPx = (name) => parseFloat(styles.getPropertyValue(name));
  const refWidth = widthVarNames.reduce((sum, name) => sum + cssPx(name), 0);
  const refHeight = heightVarNames.reduce((sum, name) => sum + cssPx(name), 0);
  if (!refWidth || !refHeight) return 1; // Base vars missing (page doesn't define them); leave --ui-scale at 1.
  const MIN_SCALE = 0.65;
  const MAX_SCALE = 1.8;
  const H_MARGIN = 40;       // Breathing room on each side of the tool.
  const BOTTOM_RESERVE = 60; // Space below the tool for the footer and a little margin.

  // Everything above the tool (the navbar) is fixed chrome that does not scale, so reserve it.
  const topOffset = Math.max(0, toolUI.getBoundingClientRect().top + window.scrollY);
  const availWidth = window.innerWidth - H_MARGIN * 2;
  const availHeight = window.innerHeight - topOffset - BOTTOM_RESERVE;

  let scale = Math.min(availWidth / refWidth, availHeight / refHeight);
  scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
  const scaleStr = scale.toFixed(4);
  toolUI.style.setProperty('--ui-scale', scaleStr);
  // Also expose the scale at the document root so self-contained overlays rendered outside .tool-ui (e.g. the
  // mission-complete modal) can scale to match via var(--ui-scale).
  document.documentElement.style.setProperty('--ui-scale', scaleStr);

  // The mission-start-tutorial overlay's content is wider than the tool's reference footprint, so when the tool's
  // scale is limited by height it can overflow the viewport horizontally (its nav arrow runs off the right edge).
  // Give the overlay its own --ui-scale, capped so its fixed-width content plus a little breathing room always fits.
  const mstOverlay = document.querySelector('.mission-start-tutorial-overlay');
  if (mstOverlay) {
    // The reference width and breathing room live in mission-start-tutorial.css so they stay in one place.
    const mstStyles = getComputedStyle(mstOverlay);
    const mstRefWidth = parseFloat(mstStyles.getPropertyValue('--mst-base-width'));
    const mstHMargin = parseFloat(mstStyles.getPropertyValue('--mst-h-margin'));
    if (mstRefWidth) {
      const mstScale = Math.max(MIN_SCALE, Math.min(scale, (window.innerWidth - mstHMargin * 2) / mstRefWidth));
      mstOverlay.style.setProperty('--ui-scale', mstScale.toFixed(4));
    }
  }

  return scale;
};

/**
 * Returns the uniform UI scale factor currently applied to the page (see util.applyToolScale), or 1 if unscaled.
 * @returns {number} The current --ui-scale value.
 */
util.uiScale = function () {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
};

// Browser detection helpers backed by Bowser 2.x.
const _bowserParser = bowser.getParser(window.navigator.userAgent);
util.getBrowserName = () => _bowserParser.getBrowserName();
util.getBrowser = () => util.getBrowserName();
util.getBrowserVersion = () => _bowserParser.getBrowserVersion();
util.getOperatingSystem = () => _bowserParser.getOSName();
util.isSafari = () => util.getBrowserName() === 'Safari';
util.isChrome = () => util.getBrowserName() === 'Chrome';
util.isFirefox = () => util.getBrowserName() === 'Firefox';
// Tablets count as mobile: they get the touch-oriented mobile UI (and the /mobile redirect) same as phones.
util.isMobile = () => ['mobile', 'tablet'].includes(_bowserParser.getPlatformType());

// A cross-browser function to capture a mouse position, relative to the given DOM element. The UI is scaled through
// real layout sizes (var(--ui-scale)), so offset() already reflects the scaled position and no compensation is needed.
function mousePosition(e, dom) {
  const mx = e.pageX - $(dom).offset().left;
  const my = e.pageY - $(dom).offset().top;
  return { x: parseInt(mx, 10), y: parseInt(my, 10) };
}

util.mousePosition = mousePosition;

/**
 * Reads a single URL query parameter from the current page's query string.
 *
 * @param {string} argName - The query parameter name.
 * @returns {string} The parameter's decoded value, or '' if it is not present.
 */
function getURLParameter(argName) {
  return new URLSearchParams(window.location.search).get(argName) ?? '';
}

util.getURLParameter = getURLParameter;

/**
 * Converts a blob that we get from `fetch` into base64. Necessary to display images acquired through `fetch`.
 *
 * @param {Blob} blob - The image blob to convert.
 * @returns {Promise<string>} Resolves with the image as a base64 data URL.
 */
function convertBlobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

util.convertBlobToBase64 = convertBlobToBase64;

/**
 * Asynchronously acquires an image using `fetch` and converts it into base64.
 *
 * @param {string} imageUrl - URL of the image to fetch.
 * @returns {Promise<string>} Resolves with the image as a base64 data URL; rejects on a network error or 404.
 */
function getImage(imageUrl) {
  return fetch(imageUrl)
    .then((response) => {
      if (response.status === 404) throw new Error('Image not found');
      else if (!response.ok) throw new Error('Other network error');
      return response.blob();
    }).then((myBlob) => {
      return convertBlobToBase64(myBlob);
    });
}

util.getImage = getImage;

/** The anonymous-session mint currently in flight, if any, so simultaneous first writes share one. */
let anonSessionMint = null;

/**
 * Mints the shared anonymous session, joining a mint already in flight instead of starting a second one.
 *
 * Two quick clicks on the landing validation grid both reach the server unauthenticated and both come back needing a
 * session; minting twice would create two accounts, let the second cookie win, and file the two votes under different
 * users with one account orphaned. Collapsing concurrent callers onto one request avoids that. The handle is released
 * once the request settles, so a session that expires later can still be re-minted.
 *
 * @returns {Promise<Response>} The mint response; `redirect: 'manual'` keeps it cheap, storing the Set-Cookie on the
 *   redirect without fetching the page it points at.
 */
function mintAnonSession() {
  if (!anonSessionMint) {
    anonSessionMint = fetch('/anonSignUp?url=%2F', { redirect: 'manual' }).finally(() => {
      anonSessionMint = null;
    });
  }
  return anonSessionMint;
}

/**
 * Fetches a session-requiring write (POST/PUT), lazily minting the shared anonymous session when it's missing.
 *
 * Public pages render with no session at all (#4643), so a first-time visitor's very first interaction — a validation
 * vote, a comment, a story, a guest route save — reaches the server with no identity. When that comes back
 * auth-shaped, mint the anonymous session via GET /anonSignUp (idempotent: it just redirects when a session already
 * exists) and retry the original request ONCE with the same options, so the submission survives rather than being
 * dropped on the way through the bounce (#4442). Every later interaction has a session, so the extra round-trip
 * never happens.
 *
 * Auth-shaped means 401/403, an opaque redirect, or a followed redirect — the ways a SecuredAction answers a
 * session-less write. Anything else (400 validation, 409 duplicate, 429 rate limit, 500) surfaces unchanged: a
 * rejected submission must never be silently re-posted. If the mint is itself refused (429 from the anon-signup
 * budget), the retry comes back auth-shaped again and that response is returned, so the caller's normal error path
 * shows.
 *
 * @param {string} url - The endpoint to fetch.
 * @param {object} options - The fetch options (method, headers, body, ...). The same object is reused verbatim for
 *   the retry, so the body has to be re-readable: a string, FormData, or Blob — never a ReadableStream.
 * @returns {Promise<Response>} The first non-auth-failure response, or the retry's response (which may not be OK).
 */
async function lazyIdentityFetch(url, options) {
  const attempt = () => fetch(url, options);
  const authShaped = (res) =>
    !res.ok && (res.status === 401 || res.status === 403 || res.type === 'opaqueredirect' || res.redirected);
  let res = await attempt();
  if (authShaped(res)) {
    await mintAnonSession();
    res = await attempt();
  }
  return res;
}

util.lazyIdentityFetch = lazyIdentityFetch;

/**
 * Whether the server rendered this page for a visitor who has an identity — signed in or on an anonymous account.
 *
 * This is exactly what a SecuredAction endpoint answers 200 vs 401 on, so an init-time read of one should consult
 * this and skip the request rather than handle the failure: a 401 is logged as a console error by the browser
 * itself, no matter how gracefully the caller catches it. Writes don't need this — they should go through
 * util.lazyIdentityFetch, which mints the session on demand.
 *
 * @returns {?boolean} What the navbar's data-has-session says, or null on the few pages rendered without a navbar.
 */
function hasSession() {
  const navbar = document.getElementById('header');
  if (!navbar || navbar.dataset.hasSession === undefined) return null;
  return navbar.dataset.hasSession === 'true';
}

util.hasSession = hasSession;

/**
 * Runs fn once the page has finished loading and the main thread next goes idle.
 *
 * The "deferred but eager" pattern for below-the-fold work (#4486). Keeping something off the critical path and
 * deciding when it starts loading are separate choices: gating on an IntersectionObserver or a click answers both at
 * once, which is right for work a visitor probably won't reach, but leaves them watching a blank space for anything
 * they usually do reach. Waiting for `load` keeps the work out of the critical path; running it at idle rather than
 * on an interaction means it has long since finished by the time the visitor arrives.
 *
 * When the work also costs the server something, prefer util.onFirstInteractionOrIdle, which adds an engagement gate
 * on top of this.
 *
 * @param {Function} fn - The work to run. Called once.
 * @param {number} [timeout=2000] - Idle deadline in ms. Past it the browser runs the callback anyway (as a normal
 *   task, with didTimeout set), so a busy main thread can delay the work but never starve it.
 */
function afterLoadIdle(fn, timeout = 2000) {
  const schedule = () => {
    // requestIdleCallback is unavailable before Safari 17.4; a short timeout approximates it well enough here.
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout });
    else setTimeout(fn, 200);
  };
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
}

util.afterLoadIdle = afterLoadIdle;

// Any of these means a human is present. pointermove is the earliest of them by a wide margin — a single mouse
// twitch — which is the point: the gate has to clear long before the visitor could scroll to the deferred content.
const INTERACTION_EVENTS = ['pointermove', 'pointerdown', 'scroll', 'keydown', 'touchstart', 'wheel'];

/**
 * Runs fn at the visitor's first sign of engagement, falling back to util.afterLoadIdle plus a delay if none comes.
 *
 * For deferred work that costs the *server* — a query, an API call — where afterLoadIdle alone would spend that cost
 * on every crawler, link-preview prefetch, and drive-by load. An input event is a cheap, near-perfect filter for
 * those, and it still fires far sooner than a human could reach anything below the fold.
 *
 * The fallback is deliberately slow, and its delay is nearly invisible in practice: deferred content sits below the
 * fold, so actually looking at it requires a scroll, which trips the interaction path first. It exists only so a
 * visitor who somehow generates no input events still ends up with a working page.
 *
 * @param {Function} fn - The work to run. Called once, whichever path gets there first.
 * @param {number} [fallbackMs=5000] - How long after load-idle to give up waiting for an interaction.
 */
function onFirstInteractionOrIdle(fn, fallbackMs = 5000) {
  let fired = false;
  const run = () => {
    if (fired) return;
    fired = true;
    // once:true retires the listener that fired; the rest have to be taken down by hand.
    for (const type of INTERACTION_EVENTS) window.removeEventListener(type, run);
    fn();
  };
  for (const type of INTERACTION_EVENTS) window.addEventListener(type, run, { once: true, passive: true });
  afterLoadIdle(() => setTimeout(run, fallbackMs));
}

util.onFirstInteractionOrIdle = onFirstInteractionOrIdle;

/**
 * Injects scripts that fetch in parallel but execute in insertion order.
 *
 * Dynamically created scripts default to async, so a dependent bundle can run before its dependencies exist. Setting
 * `async = false` restores ordered execution without serializing the downloads — what `defer` does for scripts that
 * were in the markup at parse time. Pair with util.afterLoadIdle to pull a heavy, below-the-fold bundle in after load.
 *
 * @param {string[]} srcs - Script URLs, in the order they must execute.
 * @returns {Promise} Resolves once all of them have run; rejects on the first that fails to load.
 */
function loadScriptsInOrder(srcs) {
  return Promise.all(srcs.map((src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  })));
}

util.loadScriptsInOrder = loadScriptsInOrder;

/**
 * Whether the visitor asked the browser to conserve data, in which case optional prefetching should be skipped.
 * @returns {boolean} True only if Save-Data is explicitly on; unsupported browsers report false.
 */
function saveDataEnabled() {
  return navigator.connection?.saveData === true;
}

util.saveDataEnabled = saveDataEnabled;

// Sums an array's numbers (a helper, not an Array.prototype extension, to avoid polluting native prototypes).
util.array = util.array || {};
util.array.sum = (arr) => arr.reduce((a, b) => a + b, 0);

// Changes a string in camelCase to kebab-case.
function camelToKebab(theString) {
  return theString.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

util.camelToKebab = camelToKebab;

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, (match) => {
    switch (match) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case '\'': return '&#039;';
      default: return match;
    }
  });
}

util.escapeHTML = escapeHTML;
