var util = util || {};

// A cross-browser function to capture a mouse position.
function mouseposition(e, dom) {
    var mx, my;
    mx = e.pageX - $(dom).offset().left;
    my = e.pageY - $(dom).offset().top;
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
