/**
 * Fog.js
 *
 * @Author: Ruofei Du
 * @InitialCreator: Sean Panella and Vicki Le & Kotaro (Aug 12th, 2013.)
 * @Date: Sep 17, 2013
 * @Comment: we don't need Fog/Clipper.js now
 *
 **/

 /** @namespace */
 var svl = svl || {};
 
/** Google Maps Fog API
 *
 * @ Requirements:
 *   Google Maps JavaScript V3 API (https://developers.google.com/maps/documentation/javascript/)
 *   Javascript Clipper (http://sourceforge.net/projects/jsclipper/)
 * @ Public Functions:
 *   updateFromPOV: Updates the fog based on the new POV
 *   clearMap: Clears all of the fog

 * Creates a new GMFog Object
 *
 * @ Required Parameters
 * map: google.maps.Map object for the map that the fog will overlay (should already be loaded)
 * center: google.maps.LatLng object for the center of the circle
 * radius: Radius of the fog (decimal)
 * @ Optional Parameters
 * strokeColor: String of hex color representing the outline of the fog ("#080A17" for example)
 * strokeOpacity: Opacity of the outline of the fog (decimal)
 * strokeWeight: Weight of the outline of the fog (decimal)
 * fillColor: Color of the fog (same format as strokeColor)
 * fillOpacity: Opacity of the fog (decimal)
 **/
// function Fog(map, center, radius, max, strokeColor, strokeOpacity, strokeWeight, fillColor, fillOpacity) {
function Fog(mapIn, params) {
    var self = {className: 'Fog'};
    var properties = {};
    var pointerVisitedLeft = 0;
    var pointerVisitedRight = 0;
    var dirCurrentLeft = 0;
    var dirCurrentRight = 0;
    var dirCurrentMid = 0;
    var dirVisitedMid = 0;
    var dirVisitedMidLeftHandside = 0;
    var dirVisitedMidRightHandside = 0;
    var polygonVisitedLeft = null;
    var polygonVisitedRight = null;
    var polygonFog = null;
    var pathVisitedLeft = null;
    var pathVisitedRight = null;
    var pathFog = null;
    var deltaHeading = 0;
    var rotateThreshold = 1.0;
    var m_firstRun = true;
    var m_isCompleted = false;
    var m_completionRate = 0;
    var m_completionRate2 = 0;

    var map = mapIn;

    ////////////////////////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////////////////////////
    function _init(params) {
        // This method initializes the object properties.
        if (!("center" in params) || !params.center) {
            throw "Center cannot be null when constructing a GMFog!";
        } else {
            properties.center = params.center;
        }
        if (!("radius" in params) || !params.radius) {
            throw "Radius cannot be null when constructing a GMFog!";
        } else {
            properties.radius = params.radius;
        }
        if (!("max" in params) || params.max) {
            properties.max = 700;
        } else {
            properties.max = 360;
        }
        if (!("strokeColor" in params) || params.strokeColor) {
            properties.strokeColor = "#080A17";
        } else {
            properties.strokeColor = params.strokeColor;
        }
        if (!("fillColor" in params) || params.fillColor) {
            properties.fillColor = "#080A17";
        } else {
            properties.fillColor = params.fillColor;
        }
        if (!("strokeOpacity" in params) || params.strokeOpacity) {
            properties.strokeOpacity = 0.7;
        } else {
            properties.strokeOpacity = params.strokeOpacity;
        }
        if (!("fillOpacity" in params) || params.fillOpacity) {
            properties.fillOpacity = 0.7;
        } else {
            properties.fillOpacity = params.fillOpacity;
        }
        if (!("strokeWeight" in params) || params.strokeWeight) {
            properties.strokeWeight = 0.7;
        } else {
            properties.strokeWeight = params.strokeWeight;
        }

        //
        // Initialize the zoom view angle
        if ("zoomViewAngles" in params && params.zoomViewAngles) {
            properties.zoomviewAngle = params.zoomViewAngles;
        } else {
            properties.zoomviewAngle    = [];
            properties.zoomviewAngle[1] = Math.PI / 6; // Math.PI / 4;
            properties.zoomviewAngle[2] = Math.PI / 10; // Math.PI / 6;
            properties.zoomviewAngle[3] = Math.PI / 14; //Math.PI / 8;
        }

        properties.visitedColor = "#66c2a5";
        properties.visitedOpacity = 0.3;
        properties.infiniteDistance = 1;        // 1 in latitude is enough.
    }

    //
    // Unify the angel between 0 and 2PI
    function unifyAngel(radius) {
        var ans = radius;
        while (ans < 0) ans += Math.PI * 2;
        while (ans > Math.PI * 2) ans -= Math.PI * 2;
        return ans;
    }

    //
    // Calculate the angular bisector between 2 rays with directions.
    function midAngel(left, right, clockwise) {
        clockwise = typeof clockwise !== 'undefined' ? clockwise : true;

        var ans = (left + right) / 2;
        if (left < Math.PI) {
            if (right < Math.PI) {
                if (right < left) {
                    ans += Math.PI;
                }
            }
        } else {
            if (right < Math.PI) {
                ans += Math.PI;
            } else {
                if (left > right) {
                    ans += Math.PI;
                }
            }
        }

        return unifyAngel(ans);
    }

    ////////////////////////////////////////////////////////////
    // Public:
    ////////////////////////////////////////////////////////////
    self.completionRate = function (strategy) {
        strategy = typeof strategy !== 'undefined' ? strategy : 0;
        return strategy == 0 ? m_completionRate : m_completionRate2;
    };

    self.updateFromPOV = function(current, povRadius, dir, arc) {
        /**
         * Main iterative method updates the fog according to the new direction & zoom level.
         *
         * current: new position in google latlng
         * povRadius: line of sight
         * dir: direction in radians
         * arc: arc size in radians
         *
         * TODO: when zooming in, updateFromPOV is not called.
         **/
        var lat = current.lat();
        var lng = current.lng();

        // 1. remember the delta, make the left pointer to 2PI and the right 0
        if (m_firstRun) {
            deltaHeading = dir;
        }

        var pov = getPOV();
        var deltaViewAngel = properties.zoomviewAngle[pov.zoom];

        var heading = unifyAngel(dir - deltaHeading);
        dirCurrentLeft = unifyAngel(heading - deltaViewAngel);
        dirCurrentRight = unifyAngel(heading + deltaViewAngel);

        // 2. calculate current pointer and update visited pointer
        if (m_firstRun) {
            pointerVisitedLeft = dirCurrentLeft;
            pointerVisitedRight = dirCurrentRight;
        } else {
            if (dirCurrentLeft < pointerVisitedLeft && Math.abs(dirCurrentLeft - pointerVisitedLeft) < rotateThreshold) pointerVisitedLeft = dirCurrentLeft;
            if (dirCurrentRight > pointerVisitedRight && Math.abs(dirCurrentRight - pointerVisitedRight) < rotateThreshold) pointerVisitedRight = dirCurrentRight;
            if (pointerVisitedLeft < pointerVisitedRight && !m_isCompleted) m_isCompleted = true;
        }

        // 3. update the completion rate
        m_completionRate = (pointerVisitedRight + Math.PI * 2 - pointerVisitedLeft) / (Math.PI * 2);
        m_completionRate2 = (pointerVisitedRight + Math.PI * 2 - pointerVisitedLeft - properties.zoomviewAngle[1]) / (Math.PI * 2);

        if (m_completionRate > 1.0) m_completionRate = 1.0;
        if (m_completionRate2 > 1.0) m_completionRate2 = 1.0;

        dirCurrentLeft = unifyAngel(dirCurrentLeft + deltaHeading);
        dirCurrentRight = unifyAngel(dirCurrentRight + deltaHeading);

        // 4. calculate the angular bisector
        if (!m_isCompleted)
        {
            dirCurrentMid = midAngel(dirCurrentLeft, dirCurrentRight, true);
            var dirVisitedLeft = unifyAngel(pointerVisitedLeft + deltaHeading);
            var dirVisitedRight = unifyAngel(pointerVisitedRight + deltaHeading);
            dirVisitedMidLeftHandside = midAngel(dirVisitedLeft, dirCurrentLeft, true);
            dirVisitedMidRightHandside = midAngel(dirCurrentRight, dirVisitedRight, true);
            dirVisitedMid = midAngel(dirVisitedRight, dirVisitedLeft, true);

            // 5. calculate the polygons
            pathFog = [
                new google.maps.LatLng(lat, lng),
                new google.maps.LatLng(lat + Math.cos(dirVisitedRight), lng + Math.sin(dirVisitedRight)),
                new google.maps.LatLng(lat + Math.cos(dirVisitedMid), lng + Math.sin(dirVisitedMid)),
                new google.maps.LatLng(lat + Math.cos(dirVisitedLeft), lng + Math.sin(dirVisitedLeft))
            ];

            pathVisitedLeft = [
                new google.maps.LatLng(lat, lng),
                new google.maps.LatLng(lat + Math.cos(dirVisitedLeft), lng + Math.sin(dirVisitedLeft)),
                new google.maps.LatLng(lat + Math.cos(dirVisitedMidLeftHandside), lng + Math.sin(dirVisitedMidLeftHandside)),
                new google.maps.LatLng(lat + Math.cos(dirCurrentLeft), lng + Math.sin(dirCurrentLeft))
            ];

            pathVisitedRight = [
                new google.maps.LatLng(lat, lng),
                new google.maps.LatLng(lat + Math.cos(dirCurrentRight), lng + Math.sin(dirCurrentRight)),
                new google.maps.LatLng(lat + Math.cos(dirVisitedMidRightHandside), lng + Math.sin(dirVisitedMidRightHandside)),
                new google.maps.LatLng(lat + Math.cos(dirVisitedRight), lng + Math.sin(dirVisitedRight))
            ];
        } else {
            dirCurrentMid = unifyAngel(midAngel(dirCurrentLeft, dirCurrentRight, false) + Math.PI);
            pathVisitedLeft = [
                new google.maps.LatLng(lat, lng),
                new google.maps.LatLng(lat + Math.cos(dirCurrentRight), lng + Math.sin(dirCurrentRight)),
                new google.maps.LatLng(lat + Math.cos(dirCurrentMid), lng + Math.sin(dirCurrentMid)),
                new google.maps.LatLng(lat + Math.cos(dirCurrentLeft), lng + Math.sin(dirCurrentLeft))
            ];

            // TODO: Hide the following 2 polygons by API.
            pathFog = [
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance),
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance),
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance),
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance)
            ];

            pathVisitedRight = [
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance),
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance),
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance),
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance)
            ];
        }

        if (m_firstRun) {
            polygonVisitedLeft = new google.maps.Polygon({
                paths: pathVisitedLeft,
                strokeColor: properties.strokeColor,
                strokeOpacity: properties.strokeOpacity,
                strokeWeight: properties.strokeWeight,
                fillColor: properties.visitedColor,
                fillOpacity: properties.visitedOpacity,
                map: map
            });

            polygonVisitedRight = new google.maps.Polygon({
                paths: pathVisitedRight,
                strokeColor: properties.strokeColor,
                strokeOpacity: properties.strokeOpacity,
                strokeWeight: properties.strokeWeight,
                fillColor: properties.visitedColor,
                fillOpacity: properties.visitedOpacity,
                map: map
            });

            polygonFog = new google.maps.Polygon({
                paths: pathFog,
                strokeColor: properties.strokeColor,
                strokeOpacity: properties.strokeOpacity,
                strokeWeight: properties.strokeWeight,
                fillColor: properties.fillColor,
                fillOpacity: properties.fillOpacity,
                map: map
            });

            m_firstRun = false;
        } else {
            polygonVisitedLeft.setPath(pathVisitedLeft);
            polygonVisitedRight.setPath(pathVisitedRight);
            polygonFog.setPath(pathFog);
        }
        return;
    };

    self.setProperty = function (key, val) {
        // This method sets the property
        properties[key] = val;
        return;
    };

    _init(params);
    return self;
}
