var util = util || {};

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
util.exploreDisplayScale = function() {
    const layer = document.getElementById('labelDrawingLayer');
    return layer ? layer.getBoundingClientRect().width / util.EXPLORE_CANVAS_WIDTH : 1;
};

/**
 * Uniformly scales the whole Explore tool to fit the available viewport, like browser zoom.
 *
 * Sets the --ui-scale CSS variable on .tool-ui; every Explore dimension is expressed as base-size * var(--ui-scale),
 * so the pano, ribbon, sidebar, and text all grow/shrink together in proportion.
 * @returns {number} The applied scale factor.
 */
util.applyExploreScale = function() {
    const toolUI = document.querySelector('.tool-ui');
    if (!toolUI) return 1;

    // Reference layout size at --ui-scale = 1, read from the unscaled base dimensions defined in svl.css.
    const styles = getComputedStyle(toolUI);
    const cssPx = (name) => parseFloat(styles.getPropertyValue(name));
    const refWidth = cssPx('--pano-base-width') + cssPx('--sidebar-base-gap') + cssPx('--sidebar-base-width');
    const refHeight = cssPx('--ribbon-base-top') + cssPx('--ribbon-base-height') + cssPx('--pano-base-height');
    if (!refWidth || !refHeight) return 1; // Base vars missing (page doesn't load svl.css); leave --ui-scale at 1.
    const MIN_SCALE = 0.65;
    const MAX_SCALE = 1.8;
    const H_MARGIN = 24;       // Breathing room on each side of the tool.
    const BOTTOM_RESERVE = 50; // Space below the tool for the footer and a little margin.

    // Everything above the tool (the navbar) is fixed chrome that does not scale, so reserve it.
    const topOffset = Math.max(0, toolUI.getBoundingClientRect().top + window.scrollY);
    const availWidth = window.innerWidth - H_MARGIN * 2;
    const availHeight = window.innerHeight - topOffset - BOTTOM_RESERVE;

    let scale = Math.min(availWidth / refWidth, availHeight / refHeight);
    scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    const scaleStr = scale.toFixed(4);
    toolUI.style.setProperty('--ui-scale', scaleStr);
    // Also expose the scale at the document root so self-contained overlays rendered outside .tool-ui (e.g. the
    // mission-complete modal) can scale to match via var(--ui-scale, 1).
    document.documentElement.style.setProperty('--ui-scale', scaleStr);

    return scale;
};

// Browser detection helpers backed by Bowser 2.x.
const _bowserParser = bowser.getParser(window.navigator.userAgent);
util.getBrowserName = () => _bowserParser.getBrowserName();
util.isSafari = () => util.getBrowserName() === 'Safari';
util.isChrome = () => util.getBrowserName() === 'Chrome';
util.isFirefox = () => util.getBrowserName() === 'Firefox';

// A cross-browser function to capture a mouse position, relative to the given DOM element. The UI is scaled through
// real layout sizes (var(--ui-scale)), so offset() already reflects the scaled position and no compensation is needed.
function mousePosition(e, dom) {
    const mx = e.pageX - $(dom).offset().left;
    const my = e.pageY - $(dom).offset().top;
    return { 'x': parseInt(mx, 10), 'y': parseInt(my, 10) };
}
util.mousePosition = mousePosition;

// Object prototype
// http://www.smipple.net/snippet/insin/jQuery.fn.disableTextSelection
if (typeof Object.create !== 'function') {
    Object.create = function (o) {
        var F = function () {};
        F.prototype = o;
        return new F();
    };
}

// Trim function
// Based on a code on: http://stackoverflow.com/questions/498970/how-do-i-trim-a-string-in-javascript
if (typeof(String.prototype.trim) === "undefined") {
    String.prototype.trim = function() {
        return String(this).replace(/^\s+|\s+$/g, '');
    };
}

// Based on a snipped posted by Eric Scheid ("ironclad") on November 17, 2000 at:
// http://www.evolt.org/article/Javascript_to_Parse_URLs_in_the_Browser/17/14435/
function getURLParameter(argName) {
    // Get the value of one of the URL parameters. For example, if this were called with the URL
    // http://your.server.name/foo.html?bar=123 then getURLParameter("bar") would return the string "123". If the
    // parameter is not found, this will return an empty string, "".

    var argString = location.search.slice(1).split('&');
    var r = '';
    for (var i = 0; i < argString.length; i++) {
        if (argString[i].slice(0,argString[i].indexOf('=')) == argName) {
            r = argString[i].slice(argString[i].indexOf('=')+1);
            break;
        }
    }
    r = (r.length > 0  ? unescape(r).split(',') : '');
    r = (r.length == 1 ? r[0] : '');
    return r;
}
util.getURLParameter = getURLParameter;

// Converts a blob that we get from `fetch` into base64. Necessary to display images acquired through `fetch`.
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

// Asynchronously acquire an image using `fetch` and convert it into base64. Returns a promise.
function getImage(imageUrl) {
    return fetch(imageUrl)
        .then(response => {
            if (response.status === 404) throw new Error('Image not found');
            else if (!response.ok) throw new Error('Other network error');
            return response.blob();
        }).then(myBlob => {
            return convertBlobToBase64(myBlob);
        });
}
util.getImage = getImage;

// Array min/max
// http://stackoverflow.com/questions/1669190/javascript-min-max-array-values
Array.prototype.max = function() {
    return Math.max.apply(null, this)
};

Array.prototype.min = function() {
    return Math.min.apply(null, this)
};

Array.prototype.sum = function() {
    return this.reduce(function(a, b) { return a + b;});
};

Array.prototype.mean = function() {
    return this.sum() / this.length;
};

// Get what browser the user is using.
// This code was taken from an answer in the following SO page:
// http://stackoverflow.com/questions/3303858/distinguish-chrome-from-safari-using-jquery-browser
// addendum 6-21-2017: chrome detection now supports iOS devices, added edge recognition
var userAgent = navigator.userAgent.toLowerCase();

// Figure out what browser is being used
jQuery.browser = {
    version: (userAgent.match( /.+(?:rv|it|ra|ie|me)[\/: ]([\d.]+)/ ) || [])[1],
    edge: /edge/.test( userAgent ),
    chrome: /chrome/.test( userAgent ) || /crios/.test( userAgent ),
    safari: /webkit/.test( userAgent ) && !/chrome/.test( userAgent ) && !/crios/.test( userAgent ),
    opera: /opera/.test( userAgent ),
    msie: /msie/.test( userAgent ) && !/opera/.test( userAgent ),
    mozilla: /mozilla/.test( userAgent ) && !/(compatible|webkit)/.test( userAgent )
};

/**
 * This method identifies the type of the user's browser
 *
 * @returns {*}
 */
function getBrowser() {
    // Return a browser name
    var b;
    for (b in $.browser) {
        if($.browser[b] === true) {
            return b;
        }
    }
    return undefined;
}
util.getBrowser = getBrowser;

function getBrowserVersion() {
    // Return a browser version
    return $.browser.version;
}
util.getBrowserVersion = getBrowserVersion;

function getOperatingSystem() {
    var OSName="Unknown OS";
    if (navigator.appVersion.indexOf("Win") !==-1) OSName="Windows";
    if (navigator.appVersion.indexOf("Mac") !==-1) OSName="MacOS";
    if (navigator.appVersion.indexOf("X11") !==-1) OSName="UNIX";
    if (navigator.appVersion.indexOf("Linux") !==-1) OSName="Linux";
    if (navigator.appVersion.indexOf("Android") !==-1) OSName="Android";
    if (navigator.appVersion.indexOf("iPad") !==-1 ||
        navigator.appVersion.indexOf("iPhone") !==-1 ||
        navigator.appVersion.indexOf("iPod") !==-1) OSName="iOS";
    return OSName;
}
util.getOperatingSystem = getOperatingSystem;

// Changes a string in camelCase to kebab-case.
function camelToKebab(theString) {
    return theString.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
util.camelToKebab = camelToKebab;

function escapeHTML(str) {
    return str.replace(/[&<>"']/g, function(match) {
        switch (match) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#039;';
            default: return match;
        }
    });
}
util.escapeHTML = escapeHTML;
