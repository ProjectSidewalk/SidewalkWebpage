var util = util || {};

// Some constants that are used across the site.
util.EXPLORE_CANVAS_WIDTH = 720;
util.EXPLORE_CANVAS_HEIGHT = 480;

// A cross-browser function to capture a mouse position.
function mouseposition(e, dom) {
    var mx, my, zoomFactor;
    var toolUIElem = dom.closest('.tool-ui')
    if (toolUIElem && toolUIElem.style.zoom) {
        zoomFactor = parseFloat(toolUIElem.style.zoom) / 100.0 || 1;
    } else {
        zoomFactor = 1;
    }
    mx = (e.pageX / zoomFactor) - $(dom).offset().left;
    my = (e.pageY / zoomFactor) - $(dom).offset().top;
    return {'x': parseInt(mx, 10) , 'y': parseInt(my, 10) };
}
util.mouseposition = mouseposition;

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

/**
 * Scales the UI on the Explore or Validate pages using CSS zoom. This is necessary because the UI is not responsive.
 *
 * This should only be called from the Explore or Validate pages at this time. We can always make this function more
 * generic in the future.
 * @returns {number}
 */
function scaleUI() {
    var toolCSSZoom = 100;
    if (!bowser.safari) return toolCSSZoom; // Only tested for Chrome/Safari so far.

    var toolUI = document.querySelector('.tool-ui');
    var mst = document.querySelector('.mst-content');
    var zoomPercent = 50;

    // Start with the tool-ui at 50% zoom and find the maximum zoom level that is still visible.
    if (!!toolUI.offsetParent) {
        zoomPercent = _findMaxZoomLevel(toolUI, zoomPercent);
        toolCSSZoom = zoomPercent;
    }

    // If the Mission Start Tutorial is visible, scale it as well.
    if (!!mst.offsetParent) {
        document.querySelector('.mission-start-tutorial-overlay').style.height = 'calc(100% - 70px)';
        if (zoomPercent > 50) zoomPercent -= 20; // Should be similar as tool-ui, don't need to start at 50%.
        zoomPercent = _findMaxZoomLevel(mst, zoomPercent);
    }

    return toolCSSZoom;
}
util.scaleUI = scaleUI;

// Returns true if the element is fully visible, false otherwise. Takes into account CSS zoom (tested on chrome/safari).
function _isVisible(elem) {
    var zoomFactor = parseFloat(elem.style.zoom) / 100.0 || 1;
    var scaledRect = elem.getBoundingClientRect();
    if (zoomFactor !== 1) {
        scaledRect = {
            left: scaledRect.left * zoomFactor,
            bottom: scaledRect.bottom * zoomFactor,
            right: scaledRect.right * zoomFactor
        };
    }
    return scaledRect.left >= 0 &&
        scaledRect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        scaledRect.right <= (window.innerWidth || document.documentElement.clientWidth);
}

// Finds the maximum CSS zoom level for an element (tested on chrome/safari).
function _findMaxZoomLevel(elem, startZoom) {
    var zoomPercent = startZoom;
    elem.style.zoom = zoomPercent + '%';
    while (_isVisible(elem) && zoomPercent < 500) {
        zoomPercent += 10;
        elem.style.zoom = zoomPercent + '%';
    }
    while (!_isVisible(elem) && zoomPercent > 10) {
        zoomPercent -= 1;
        elem.style.zoom = zoomPercent + '%';
    }
    return zoomPercent;
}

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

/**
 * Initialize i18next with the given language and a callback function. Handles India-specific overrides.
 *
 * @param language The language to use for translations, e.g., "en", "en-US", "es", etc.
 * @param namespaces An array of namespaces to load for translations, e.g., ["common", "explore"]
 * @param defaultNS The default namespace to use if no specific namespace is provided, e.g., "common"
 * @param countryId The server's country ID to determine if we need to load India-specific overrides
 * @param callback Optional callback function to call after initialization is complete and translations have loaded
 */
function initializeI18Next(language, namespaces, defaultNS, countryId, callback) {
    // Add "-india" suffix to each namespace to be used if this is an India server.
    const namespacesWithIndiaOverrides = [...namespaces, ...namespaces.map(str => `${str}-india`)];
    i18next.use(i18nextHttpBackend).init({
        backend: {
            loadPath: '/assets/locales/{{lng}}/{{ns}}.json',
            allowMultiLoading: true
        },
        fallbackLng: 'en',
        // Also include india-specific namespaces if appropriate.
        ns: countryId === "india" ? namespacesWithIndiaOverrides : namespaces,
        defaultNS: defaultNS,
        lng: language,
        partialBundledLanguages: true,
        debug: false
    }, function(err, t) {
        // Ignore errors loading translations, but log any other errors.
        if (err && err.filter(e => !e.includes('status code: 404')).length > 0) {
            return console.error(err.filter(e => !e.includes('status code: 404')));
        }

        // After loading, merge the india-specific override namespaces into the base ones.
        if (countryId === "india") {
            // Going through list of languages so that we still get the en translations when using en-US.
            for (const l of i18next.languages) {
                for (const ns of namespaces) {
                    i18next.addResourceBundle(l, ns, i18next.getResourceBundle(l, `${ns}-india`) || {}, true, true);
                }
            }
        }

        if (callback) callback();
    });
}
util.initializeI18Next = initializeI18Next;
