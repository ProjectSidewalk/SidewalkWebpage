var util = util || {};
util.math = {};



/**
 * This method takes an angle value in radian and returns a value in degree
 * http://stackoverflow.com/questions/9705123/how-can-i-get-sin-cos-and-tan-to-return-degrees-instead-of-radians
 * @param angleInRadian
 * @returns {number}
 */
function toDegrees (angleInRadian) { return angleInRadian * (180 / Math.PI); }
util.math.toDegrees = toDegrees;

/**
 * This function takes an angle in degree and returns a value in radian
 * http://stackoverflow.com/questions/9705123/how-can-i-get-sin-cos-and-tan-to-return-degrees-instead-of-radians
 * @param angleInDegree
 * @returns {number}
 */
function toRadians (angleInDegree) {
    return angleInDegree * (Math.PI / 180);
}
util.math.toRadians = toRadians;

/**
 * Given a latlng point and a dx and dy (in meters), return a latlng offset (dlng, dlat) .
 * I.e., the new point would be (lng + dlng, lat + dlat)
 * @param lat Current latitude.
 * @param dx Distance along the x-axis in meters
 * @param dy Distance along the y-axis in meters
 */
function latlngOffset(lat, dx, dy) {
    var dlat = dy / 111111;
    var dlng = dx / (111111 * Math.cos(toRadians(lat)));
    return {dlat: dlat, dlng: dlng};
}
util.math.latlngOffset = latlngOffset;

/**
 * This function takes two latlon coordinates and returns the angle that forms aroud the z-axis.
 *
 * @param lat1
 * @param lng1
 * @param lat2
 * @param lng2
 * @param relativeToNorth If this is true, then measure it from north and clockwise.
 * @returns {number} An angle in radians
 */
function latLngToAngle (lat1, lng1, lat2, lng2, relativeToNorth) {
    var deltaLat, deltaLng, theta;

    deltaLat = lat2 - lat1;
    deltaLng = lng2 - lng1;
    theta = Math.atan2(deltaLng, deltaLat);

    if (relativeToNorth) {
        theta = Math.PI / 2 - theta;
    }
    return theta;
}
util.math.latLngToAngle = latLngToAngle;


/**
 * This function takes two pairs of latlng positions and returns distance in meters.
 * http://rosettacode.org/wiki/Haversine_formula#JavaScript
 *
 * @param lat1
 * @param lon1
 * @param lat2
 * @param lon2
 * @returns {number} A distance in meters.
 */
function haversine(lat1, lon1, lat2, lon2) {
    //var radians = Array.prototype.map.call(arguments, function(deg) { return deg / 180.0 * Math.PI; });
    //var lat1 = radians[0], lon1 = radians[1], lat2 = radians[2], lon2 = radians[3];
    lat1 = toRadians(lat1);
    lon1 = toRadians(lon1);
    lat2 = toRadians(lat2);
    lon2 = toRadians(lon2);
    var R = 6372800; // earth radius in m
    var dLat = lat2 - lat1;
    var dLon = lon2 - lon1;
    var a = Math.sin(dLat / 2) * Math.sin(dLat /2) + Math.sin(dLon / 2) * Math.sin(dLon /2) * Math.cos(lat1) * Math.cos(lat2);
    var c = 2 * Math.asin(Math.sqrt(a));
    return R * c;
}
util.math.haversine = haversine;

/**
 * This function takes a pair of latlng position, a bearing (heading), and distance
 * and returns latlng position
 * http://stackoverflow.com/questions/2637023/how-to-calculate-the-latlng-of-a-point-a-certain-distance-away-from-another
 *
 * Concepts:
 * http://www.movable-type.co.uk/scripts/latlong.html
 *
 * @param currentLat
 * @param currentLng
 * @param heading
 * @param distance
 * @returns {*}
 */
function reverseHaversine(currentLat, currentLng, heading, distance) {

    //Convert to radians
    currentLat = toRadians(currentLat);
    currentLng = toRadians(currentLng);

    var bearing = toRadians(heading);

    var newLat, newLng;
    var R = 6372800; // earth radius in m

    var angDist = distance / R;

    var a = Math.sin(currentLat) * Math.cos(angDist);
    var b = Math.cos(currentLat) * Math.sin(angDist) * Math.cos(bearing);
    newLat = toDegrees(Math.asin(a + b));

    var x = Math.sin(bearing) * Math.sin(angDist) * Math.cos(currentLat);
    var y = Math.cos(angDist) - Math.sin(currentLat) * Math.sin(newLat);
    newLng = toDegrees(currentLng + Math.atan2(x, y));

    if (isNaN(newLat) || isNaN(newLng)) return null;

    return new google.maps.LatLng(newLat, newLng);
}
util.math.reverseHaversine = reverseHaversine;

function distance3d(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    var dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}
util.math.distance3d = distance3d;

function roundToTwentyFive(num) { return Math.round(num / 25) * 25; }
util.math.roundToTwentyFive = roundToTwentyFive;

function metersToMiles(dist) { return dist / 1609.34; }
function metersToKilometers(dist) { return dist / 1000; }
function metersToFeet(dist) { return dist * 3.28084; }
function milesToMeters(dist) { return dist * 1609.34; }
function milesToKilometers(dist) { return dist * 1.60934; }
function milesToFeet(dist) { return dist * 5280; }
function kilometersToMeters(dist) { return dist * 1000; }
function kilometersToMiles(dist) { return dist / 1.60934; }
function kilometersToFeet(dist) { return dist * 3280.84; }
function feetToMeters(dist) { return dist / 3.28084; }
function feetToMiles(dist) { return dist / 5280; }
function feetToKilometers(dist) { return dist / 3280.84; }
util.math.metersToMiles = metersToMiles;
util.math.metersToKilometers = metersToKilometers;
util.math.metersToFeet = metersToFeet;
util.math.milesToMeters = milesToMeters;
util.math.milesToKilometers = milesToKilometers;
util.math.milesToFeet = milesToFeet;
util.math.kilometersToMeters = kilometersToMeters;
util.math.kilometersToMiles = kilometersToMiles;
util.math.kilometersToFeet = kilometersToFeet;
util.math.feetToMeters = feetToMeters;
util.math.feetToMiles = feetToMiles;
util.math.feetToKilometers = feetToKilometers;

// http://clauswitt.com/simple-statistics-in-javascript.html
function Stats(arr) {
    var self = this;
    var theArray = arr || [];

    //http://en.wikipedia.org/wiki/Mean#Arithmetic_mean_.28AM.29
    self.getArithmeticMean = function() {
        var sum = 0, length = theArray.length;
        for(var i=0;i<length;i++) {
            sum += theArray[i];
        }
        return sum/length;
    };

    //http://en.wikipedia.org/wiki/Mean#Geometric_mean_.28GM.29
    self.getGeometricMean = function() {
        var product = 1, length = theArray.length;
        for(var i=0;i<length;i++) {
            product = product * theArray[i];
        }
        return Math.pow(product,(1/length));
    };

    //http://en.wikipedia.org/wiki/Mean#Harmonic_mean_.28HM.29
    self.getHarmonicMean = function() {
        var sum = 0, length = theArray.length;
        for(var i=0;i<length;i++) {
            sum += (1/theArray[i]);
        }
        return length/sum;
    };

    //http://en.wikipedia.org/wiki/Standard_deviation
    self.getStandardDeviation = function() {
        var arithmeticMean = this.getArithmeticMean();
        var sum = 0, length = theArray.length;
        for(var i=0;i<length;i++) {
            sum += Math.pow(theArray[i]-arithmeticMean, 2);
        }
        return Math.pow(sum/length, 0.5);
    };

    // Added by Kotaro
    // http://en.wikipedia.org/wiki/Standard_error
    self.getStandardError = function () {
        var stdev = this.getStandardDeviation();
        var len = theArray.length;
        return stdev / Math.sqrt(len);
    };


    //http://en.wikipedia.org/wiki/Median
    self.getMedian = function() {
        var length = theArray.length;
        var middleValueId = Math.floor(length/2);
        var arr = theArray.sort(function(a, b){return a-b;});
        return arr[middleValueId];
    };


    // http://stackoverflow.com/questions/1669190/javascript-min-max-array-values
    self.getMin = function () {
        return Math.min.apply(Math, theArray);
    };


    // Added by Kotaro
    // http://stackoverflow.com/questions/1669190/javascript-min-max-array-values
    self.getMax = function () {
        return Math.max.apply(Math, theArray);
    };


    self.setArray = function(arr) {
        theArray = arr;
        return self;
    };

    self.getArray = function() {
        return theArray;
    };

    return self;
}
