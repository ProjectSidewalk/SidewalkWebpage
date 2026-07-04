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
    const layer = document.getElementById('labelDrawingLayer');
    return layer ? layer.getBoundingClientRect().width / util.EXPLORE_CANVAS_WIDTH : 1;
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
        // The reference width and breathing room live in missionStartTutorial.css so they stay in one place.
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
