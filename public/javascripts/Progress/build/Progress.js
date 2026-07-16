class AchievementTracker {
    constructor() {
        this.mapBadges = {};
        this.mapBadges[BadgeTypes.Missions] = {
            1: new Badge(BadgeTypes.Missions, 1, 5),
            2: new Badge(BadgeTypes.Missions, 2, 10),
            3: new Badge(BadgeTypes.Missions, 3, 20),
            4: new Badge(BadgeTypes.Missions, 4, 50),
            5: new Badge(BadgeTypes.Missions, 5, 100)
        };

        this.mapBadges[BadgeTypes.Distance] = {
            // All distances currently in miles.
            1: new Badge(BadgeTypes.Distance, 1, 0.09), // approximately 500 ft
            2: new Badge(BadgeTypes.Distance, 2, 0.25),
            3: new Badge(BadgeTypes.Distance, 3, 0.5),
            4: new Badge(BadgeTypes.Distance, 4, 1),
            5: new Badge(BadgeTypes.Distance, 5, 5)
        };

        this.mapBadges[BadgeTypes.Labels] = {
            1: new Badge(BadgeTypes.Labels, 1, 50),
            2: new Badge(BadgeTypes.Labels, 2, 250),
            3: new Badge(BadgeTypes.Labels, 3, 500),
            4: new Badge(BadgeTypes.Labels, 4, 1000),
            5: new Badge(BadgeTypes.Labels, 5, 5000)
        };

        this.mapBadges[BadgeTypes.Validations] = {
            1: new Badge(BadgeTypes.Validations, 1, 100),
            2: new Badge(BadgeTypes.Validations, 2, 250),
            3: new Badge(BadgeTypes.Validations, 3, 500),
            4: new Badge(BadgeTypes.Validations, 4, 1000),
            5: new Badge(BadgeTypes.Validations, 5, 5000)
        };
    }

    /**
     * Gets the current badge given the user's progress for the given badge type.
     *
     * @param badgeType: is one of four BadgeTypes: "missions", "distance", "labels", or "validations"
     * @param value: value corresponds to the current number of completed missions, total distance, num of labels, etc.
     *               corresponding to the passed badgeType
     * @returns {null} null if no badge earned or if no badge found for the passed badgeType. Otherwise, the Badge
     *          corresponding to the highest level earned
     */
    getBadgeEarned(badgeType, value) {
        if (badgeType in this.mapBadges) {
            let mapLevelsToBadge = this.mapBadges[badgeType]
            let prevBadge = null;
            for (let level of Object.keys(mapLevelsToBadge)) {
                let badge = mapLevelsToBadge[level];
                if (badge.threshold > value) {
                    return prevBadge;
                }
                prevBadge = badge;
            }
        }
        return null;
    }

    /**
     * Updates the badge achievement grid given the user's current stats.
     *
     * @param curMissionCnt: current mission count
     * @param curDistanceInMiles: current completed distance amount (in miles)
     * @param curLabelsCnt: current label count
     * @param curValidationsCnt: current validation count
     */
    updateBadgeAchievementGrid(curMissionCnt, curDistanceInMiles, curLabelsCnt, curValidationsCnt) {
        const BADGE_NOT_YET_EARNED_CLASS_NAME = 'badge-not-yet-earned';
        let mapBadgeTypesToCurrentValues = {};
        mapBadgeTypesToCurrentValues[BadgeTypes.Missions] = curMissionCnt;
        mapBadgeTypesToCurrentValues[BadgeTypes.Distance] = curDistanceInMiles;
        mapBadgeTypesToCurrentValues[BadgeTypes.Labels] = curLabelsCnt;
        mapBadgeTypesToCurrentValues[BadgeTypes.Validations] = curValidationsCnt;

        for (let badgeType of Object.keys(this.mapBadges)) {
            let mapLevelsToBadge = this.mapBadges[badgeType]
            let curValue = mapBadgeTypesToCurrentValues[badgeType];

            for (let level of Object.keys(mapLevelsToBadge)) {
                let badge = mapLevelsToBadge[level];
                let badgeHtmlId = badge.type + '-badge' + badge.level;
                let badgeHtmlElement = document.getElementById(badgeHtmlId);

                if (badge.threshold > curValue) {
                    badgeHtmlElement.className = BADGE_NOT_YET_EARNED_CLASS_NAME;
                } else {
                    badgeHtmlElement.classList.remove(BADGE_NOT_YET_EARNED_CLASS_NAME);
                }

                // The parent element 'achievements-badge-grid' starts out invisible to make initial rendering cleaner.
                badgeHtmlElement.parentElement.style.visibility = 'visible';
            }

            let badgeEncouragementHtmlId = badgeType + '-badge-encouragement';
            document.getElementById(badgeEncouragementHtmlId).innerHTML = this.getBadgeEncouragementHtml(badgeType, curValue);
        }
    }

    /**
     * Get a dynamic encouragement statement for the given badge type with the current value.
     *
     * @param badgeType: is one of four BadgeTypes: "missions", "distance", "labels", or "validations"
     * @param curValue: value corresponds to the current number of completed missions, total distance, num of labels, etc.
     *               corresponding to the passed badgeType
     */
    getBadgeEncouragementHtml(badgeType, curValue) {
        // Find next badge to unlock.
        let mapLevelsToBadge = this.mapBadges[badgeType]
        let nextBadgeToUnlock = null;
        if (badgeType in this.mapBadges) {
            let mapLevelsToBadge = this.mapBadges[badgeType]

            for (let level of Object.keys(mapLevelsToBadge)) {
                let badge = mapLevelsToBadge[level];
                if (badge.threshold > curValue) {
                    nextBadgeToUnlock = badge;
                    break;
                }
            }
        }

        let htmlStatement = '';

        if (nextBadgeToUnlock != null) {
            let diffValue = nextBadgeToUnlock.threshold - curValue;
            let curBadge = null;
            const curBadgeLevel = nextBadgeToUnlock.level - 1;
            let fractionComplete = 0;

            // Figure out how close they are to the next badge.
            if (curBadgeLevel in mapLevelsToBadge) {
                curBadge = mapLevelsToBadge[curBadgeLevel];
                const badgeValueRange = nextBadgeToUnlock.threshold - curBadge.threshold;
                fractionComplete = (curValue - curBadge.threshold) / badgeValueRange;
            } else {
                fractionComplete = curValue / nextBadgeToUnlock.threshold;
            }

            // Add an encouraging statement based on how close they are to the next badge level.
            if (fractionComplete > 0.95) {
                htmlStatement += i18next.t('dashboard:so-close') + ' ' + i18next.t('dashboard:just') + ' ';
            } else if (fractionComplete > 0.85) {
                htmlStatement += i18next.t('dashboard:wow-almost-there') + ' ' + i18next.t('dashboard:just') + ' ';
            } else if (fractionComplete > 0.1 || curBadgeLevel > 0) {
                let randStatement = encouragingStatements[Math.floor(Math.random() * encouragingStatements.length)];
                htmlStatement += i18next.t(randStatement) + ' ';
            }

            // Convert to from miles to kilometers if using metric system.
            const measurementSystem = i18next.t('common:measurement-system');
            if (badgeType === BadgeTypes.Distance && measurementSystem === 'metric') diffValue *= 1.60934;

            // Get the appropriate distance unit, e.g., mission/misión, missions/misiones, labels/etiquetas.
            let unitTranslation;
            if (diffValue === 1) unitTranslation = 'dashboard:badge-' + badgeType + '-singular';
            else unitTranslation = 'dashboard:badge-' + badgeType + '-plural';

            const firstOrNextTranslation = curBadgeLevel === 0 ? 'dashboard:first' : 'dashboard:next';

            // Add translation for how much is left before the next achievement. For example, "1 misión más hasta tu
            // próximo logro." or "1.3 more miles until your next achievement."
            htmlStatement += i18next.t('dashboard:more-unit-until-achievement', {
                n: parseFloat(diffValue.toFixed(2)),
                unit: unitTranslation,
                firstOrNext: firstOrNextTranslation
            });
        } else {
            htmlStatement = i18next.t('dashboard:' + 'badge-' + badgeType + '-earned-all');
        }

        return htmlStatement;
    }
}

const BadgeTypes = Object.freeze({
    Missions: 'missions',
    Distance: 'distance',
    Labels: 'labels',
    Validations: 'validations'
});

const encouragingStatements = [
    'dashboard:awesome',
    'dashboard:woohoo',
    'dashboard:you-can-do-it',
    'dashboard:amazing-work',
    'dashboard:nice-job',
    'dashboard:keep-it-up',
    'dashboard:now-were-rolling',
    'dashboard:thanks-for-helping',
    'dashboard:making-great-progress',
    'dashboard:great-job'
];

class Badge {

    /**
     *
     * @param type
     * @param level
     * @param badgeAwardThreshold
     */
    constructor(type, level, badgeAwardThreshold) {
        const imagePath = 'images/badges';

        this.type = type;
        this.level = level;
        this.threshold = badgeAwardThreshold;
        this.imagePath = imagePath + '/' + 'badge_' + type + '_badge' + level + '.png';
    }
}

/**
 * Query for labels most recently validated as incorrect by other users. Build a set of image carousels using that info.
 */
function MistakeCarousel() {
    fetch('/userapi/mistakes?n=7').then(response => {
        if (response.status === 404) throw new Error('URL not found');
        else if (!response.ok) throw new Error('Other network error');
        return response.json();
    }).then(data => {
        // Separate label types into a list of types with validation data and those without.
        const labelTypes = ['CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'Crosswalk', 'Signal'];
        let labelTypesWithData = [];
        let labelTypesWithoutData = [];
        labelTypes.forEach((l) => (data[l].length > 0 ? labelTypesWithData : labelTypesWithoutData).push(l));

        // Add subheader for labeling mistakes section, listing label types without validations.
        let mistakesSubheader = document.getElementById('mistakes-subheader');
        const translatedTypes = labelTypesWithoutData.map((l) => i18next.t(`common:${util.camelToKebab(l)}`));
        mistakesSubheader.textContent = i18next.t('mistakes-subheader', { labelTypes: translatedTypes });

        let mistakesHolder = document.getElementById('mistake-carousels-holder');
        for (const [typeIndex, labelType] of labelTypesWithData.entries()) {
            // Add the header for this label type.
            let labelTypeHeader = document.createElement('h3');
            labelTypeHeader.textContent = i18next.t(`common:${util.camelToKebab(labelType)}`);
            labelTypeHeader.style.gridColumn = 1 + (typeIndex % 2);
            labelTypeHeader.style.gridRow = (1 + Math.floor(typeIndex / 2)) * 2 - 1;
            mistakesHolder.appendChild(labelTypeHeader);

            // Create the div for the carousel of images for this label type.
            let carousel = document.createElement('div');
            let carouselId = `carousel-example-${labelType}`;
            carousel.id = carouselId;
            carousel.classList.add('carousel', 'slide');
            carousel.style.gridColumn = 1 + (typeIndex % 2);
            carousel.style.gridRow = (1 + Math.floor(typeIndex / 2)) * 2;
            carousel.setAttribute('data-interval', 'false');

            // Add the circles at bottom of carousel that indicates which image in the carousel you're seeing.
            let carouselNavigation = document.createElement('ol');
            carouselNavigation.classList.add('carousel-indicators');
            for (const [labelIndex, label] of data[labelType].entries()) {
                let indicator = document.createElement('li');
                indicator.setAttribute('data-target', `#${carouselId}`);
                indicator.setAttribute('data-slide-to', labelIndex);
                if (labelIndex === 0) indicator.classList.add('active');
                carouselNavigation.appendChild(indicator);
            }
            carousel.appendChild(carouselNavigation);

            // Create a wrapper that will hold each image in the carousel.
            let slideWrapper = document.createElement('div');
            slideWrapper.classList.add('carousel-inner');
            slideWrapper.setAttribute('role', 'listbox');

            for (const [labelIndex, label] of data[labelType].entries()) {
                // Add div to hold everything for the current image.
                let slide = document.createElement('div');
                if (labelIndex === 0) {
                    slide.classList.add('item', 'active');
                } else {
                    slide.classList.add('item');
                }

                // Add a wrapper div to help position label on image using proportions that exclude comments.
                let imageWrapper = document.createElement('div');
                imageWrapper.style.position = 'relative';

                // Add the actual GSV image using the URL provided by the backend.
                let gsvImage = document.createElement('img');
                gsvImage.src = label.image_url;
                gsvImage.classList.add('mistake-img');
                gsvImage.id = `label_id_${label.label_id}`;
                imageWrapper.appendChild(gsvImage);

                // Add the label icon onto the GSV image.
                let labelIcon = document.createElement('img');
                labelIcon.src = `/assets/images/icons/AdminTool_${labelType}.png`;
                labelIcon.classList.add('label-icon');
                Object.assign(labelIcon.style, {
                    left: `${100 * label.canvas_x / label.canvas_width}%`,
                    top: `${100 * label.canvas_y / label.canvas_height}%`
                });
                imageWrapper.appendChild(labelIcon);
                slide.appendChild(imageWrapper);

                // Add any comment from the validator if there is one.
                let validatorComment = document.createElement('div');
                validatorComment.classList.add('validation-comment', 'carousel-caption');
                if (label.validator_comment) {
                    validatorComment.textContent = i18next.t('validator-comment', {c: label.validator_comment});
                } else {
                    validatorComment.textContent = i18next.t('validator-no-comment');
                    validatorComment.style.fontStyle = 'italic';
                }
                slide.appendChild(validatorComment);

                slideWrapper.append(slide);
            }
            carousel.appendChild(slideWrapper);

            // Add the arrows to navigate images in the carousel (provided by Bootstrap).
            let leftControl = document.createElement('a');
            leftControl.classList.add('left', 'carousel-control');
            leftControl.href = `#${carouselId}`;
            leftControl.setAttribute('role', 'button');
            leftControl.setAttribute('data-slide', 'prev');

            let leftControlIcon = document.createElement('span');
            leftControlIcon.classList.add('glyphicon', 'glyphicon-chevron-left');
            leftControlIcon.setAttribute('aria-hidden', 'true');
            leftControl.appendChild(leftControlIcon);

            let leftControlScreenReading = document.createElement('span');
            leftControlScreenReading.textContent = i18next.t('previous');
            leftControlScreenReading.classList.add('sr-only');
            leftControl.appendChild(leftControlScreenReading);
            carousel.appendChild(leftControl);

            let rightControl = document.createElement('a');
            rightControl.classList.add('right', 'carousel-control');
            rightControl.href = `#${carouselId}`;
            rightControl.setAttribute('role', 'button');
            rightControl.setAttribute('data-slide', 'next');

            let rightControlIcon = document.createElement('span');
            rightControlIcon.classList.add('glyphicon', 'glyphicon-chevron-right');
            rightControlIcon.setAttribute('aria-hidden', 'true');
            rightControl.appendChild(rightControlIcon);

            let rightControlScreenReading = document.createElement('span');
            rightControlScreenReading.textContent = i18next.t('next');
            rightControlScreenReading.classList.add('sr-only');
            rightControl.appendChild(rightControlScreenReading);
            carousel.appendChild(rightControl);

            mistakesHolder.appendChild(carousel);
        }
    });
}

function Progress (_, $, difficultRegionIds, userRole) {
    var params = {
        popupType: 'completionRate',
        neighborhoodPolygonStyle: {
            color: '#407770',
            weight: 2,
            opacity: 0.6,
            fillColor: '#5d6d6b', 
            fillOpacity: 0.1, 
            dashArray: '6,6' 
        },
        mouseoverStyle: {
            color: '#5d6d6b',
            opacity: 1.0,
            weight: 2
        },
        mouseoutStyle: {
            color: '#407770',
            opacity: 0.6,
            weight: 2
        },
        webpageActivity: 'Click_module=UserMap_regionId=',
        defaultZoomIncrease: -1.0,
        polygonFillMode: 'singleColor',
        zoomControl: true,
        scrollWheelZoom: true,
        clickData: true,
        mapName: 'map',
        mapStyle: 'mapbox://styles/mapbox/streets-v11'
    };
    var streetParams = {
        includeLabelCounts: true,
        auditedStreetColor: 'black',
        userRole: userRole
    };
    var map;
    var layers = [];
    var loadPolygons = $.getJSON('/neighborhoods');
    var loadPolygonRates = $.getJSON('/adminapi/neighborhoodCompletionRate');
    var loadMapParams = $.getJSON('/cityMapParams');
    var loadAuditedStreets = $.getJSON('/contribution/streets');
    var loadSubmittedLabels = $.getJSON('/userapi/labels');
    // When the polygons, polygon rates, and map params are all loaded the polygon regions can be rendered.
    var renderPolygons = $.when(loadPolygons, loadPolygonRates, loadMapParams).done(function(data1, data2, data3) {
        map = Choropleth(_, $, 'null', params, layers, data1[0], data2[0], data3[0]);
    });
    // When the polygons have been rendered and the audited streets have loaded,
    // the audited streets can be rendered.
    var renderAuditedStreets = $.when(renderPolygons, loadAuditedStreets).done(function(data1, data2) {
        InitializeStreets(map, streetParams, data2[0]);
    });
    // When the audited streets have been rendered and the submitted labels have loaded,
    // the submitted labels can be rendered.
    $.when(renderAuditedStreets, loadSubmittedLabels).done(function(data1, data2) {
        InitializeSubmittedLabels(map, streetParams, 'null', InitializeMapLayerContainer(), data2[0])
        setRegionFocus(map, layers);
    });

    function logWebpageActivity(activity){
        var url = "/userapi/logWebpageActivity";
        var async = false;
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'post',
            data: JSON.stringify(activity),
            dataType: 'json',
            success: function(result){},
            error: function (result) {
                console.error(result);
            }
        });
    }

    function putUserOrg(e) {
        var parsedId = $(this).attr('id').split("-"); // the id comes in the form of "from-startOrg-to-endOrg"
        var startOrg = parsedId[1];
        var endOrg = parsedId[3];
        $.ajax({
            async: true,
            url: '/userapi/setUserOrg/' + endOrg,
            type: 'put',
            success: function (result) {
                window.location.reload();
                if (endOrg != startOrg) {
                    if (startOrg != 0) {
                        logWebpageActivity("Click_module=leaving_org=" + startOrg);
                    }
                    if (endOrg != 0) {
                        logWebpageActivity("Click_module=joining_org=" + endOrg);
                    }
                }
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    $('.put-user-org').on('click', putUserOrg);
}

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
if(typeof(String.prototype.trim) === "undefined")
{
    String.prototype.trim = function()
    {
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

// Array Remove - By John Resig (MIT Licensed)
// http://stackoverflow.com/questions/500606/javascript-array-delete-elements
Array.prototype.remove = function(from, to) {
    // var rest = this.slice((to || from) + 1 || this.length);
    var rest = this.slice(parseInt(to || from) + 1 || this.length);
    this.length = from < 0 ? this.length + from : from;
    return this.push.apply(this, rest);
};

// Array min/max
// http://stackoverflow.com/questions/1669190/javascript-min-max-array-values
Array.prototype.max = function() {
    return Math.max.apply(null, this)
};

Array.prototype.min = function() {
    return Math.min.apply(null, this)
};

Array.prototype.sum = function () {
    return this.reduce(function(a, b) { return a + b;});
};

Array.prototype.mean = function () {
    return this.sum() / this.length;
};

/*
 json2.js
 2011-10-19

 Public Domain.

 NO WARRANTY EXPRESSED OR IMPLIED. USE AT YOUR OWN RISK.

 See http://www.JSON.org/js.html
 ...

 Check Douglas Crockford's code for a more recent version of json2.js
 https://github.com/douglascrockford/JSON-js/blob/master/json2.js
 */
if(typeof JSON!=="object"){JSON={}}(function(){"use strict";function f(e){return e<10?"0"+e:e}function quote(e){escapable.lastIndex=0;return escapable.test(e)?'"'+e.replace(escapable,function(e){var t=meta[e];return typeof t==="string"?t:"\\u"+("0000"+e.charCodeAt(0).toString(16)).slice(-4)})+'"':'"'+e+'"'}function str(e,t){var n,r,i,s,o=gap,u,a=t[e];if(a&&typeof a==="object"&&typeof a.toJSON==="function"){a=a.toJSON(e)}if(typeof rep==="function"){a=rep.call(t,e,a)}switch(typeof a){case"string":return quote(a);case"number":return isFinite(a)?String(a):"null";case"boolean":case"null":return String(a);case"object":if(!a){return"null"}gap+=indent;u=[];if(Object.prototype.toString.apply(a)==="[object Array]"){s=a.length;for(n=0;n<s;n+=1){u[n]=str(n,a)||"null"}i=u.length===0?"[]":gap?"[\n"+gap+u.join(",\n"+gap)+"\n"+o+"]":"["+u.join(",")+"]";gap=o;return i}if(rep&&typeof rep==="object"){s=rep.length;for(n=0;n<s;n+=1){if(typeof rep[n]==="string"){r=rep[n];i=str(r,a);if(i){u.push(quote(r)+(gap?": ":":")+i)}}}}else{for(r in a){if(Object.prototype.hasOwnProperty.call(a,r)){i=str(r,a);if(i){u.push(quote(r)+(gap?": ":":")+i)}}}}i=u.length===0?"{}":gap?"{\n"+gap+u.join(",\n"+gap)+"\n"+o+"}":"{"+u.join(",")+"}";gap=o;return i}}if(typeof Date.prototype.toJSON!=="function"){Date.prototype.toJSON=function(e){return isFinite(this.valueOf())?this.getUTCFullYear()+"-"+f(this.getUTCMonth()+1)+"-"+f(this.getUTCDate())+"T"+f(this.getUTCHours())+":"+f(this.getUTCMinutes())+":"+f(this.getUTCSeconds())+"Z":null};String.prototype.toJSON=Number.prototype.toJSON=Boolean.prototype.toJSON=function(e){return this.valueOf()}}var cx=/[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,escapable=/[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,gap,indent,meta={"\b":"\\b","	":"\\t","\n":"\\n","\f":"\\f","\r":"\\r",'"':'\\"',"\\":"\\\\"},rep;if(typeof JSON.stringify!=="function"){JSON.stringify=function(e,t,n){var r;gap="";indent="";if(typeof n==="number"){for(r=0;r<n;r+=1){indent+=" "}}else if(typeof n==="string"){indent=n}rep=t;if(t&&typeof t!=="function"&&(typeof t!=="object"||typeof t.length!=="number")){throw new Error("JSON.stringify")}return str("",{"":e})}}if(typeof JSON.parse!=="function"){JSON.parse=function(text,reviver){function walk(e,t){var n,r,i=e[t];if(i&&typeof i==="object"){for(n in i){if(Object.prototype.hasOwnProperty.call(i,n)){r=walk(i,n);if(r!==undefined){i[n]=r}else{delete i[n]}}}}return reviver.call(e,t,i)}var j;text=String(text);cx.lastIndex=0;if(cx.test(text)){text=text.replace(cx,function(e){return"\\u"+("0000"+e.charCodeAt(0).toString(16)).slice(-4)})}if(/^[\],:{}\s]*$/.test(text.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,"@").replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,"]").replace(/(?:^|:|,)(?:\s*\[)+/g,""))){j=eval("("+text+")");return typeof reviver==="function"?walk({"":j},""):j}throw new SyntaxError("JSON.parse")}}})()


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

function getBrowserVersion () {
    // Return a browser version
    return $.browser.version;
}
util.getBrowserVersion = getBrowserVersion;

function getOperatingSystem () {
    var OSName="Unknown OS";
    if (navigator.appVersion.indexOf("Win")!=-1) OSName="Windows";
    if (navigator.appVersion.indexOf("Mac")!=-1) OSName="MacOS";
    if (navigator.appVersion.indexOf("X11")!=-1) OSName="UNIX";
    if (navigator.appVersion.indexOf("Linux")!=-1) OSName="Linux";
    if (navigator.appVersion.indexOf("Android")!=-1) OSName="Android";
    if (navigator.appVersion.indexOf("iPad")!=-1 ||
        navigator.appVersion.indexOf("iPhone")!=-1 ||
        navigator.appVersion.indexOf("iPod")!=-1) OSName="iOS";
    return OSName;
}
util.getOperatingSystem = getOperatingSystem;

// Changes a string in camelCase to kebab-case.
function camelToKebab (theString) {
    return theString.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
util.camelToKebab = camelToKebab;
