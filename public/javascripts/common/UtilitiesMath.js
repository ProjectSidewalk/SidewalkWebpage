var util = util || {};
util.math = {};

/**
 * This method takes an angle value in radians and returns a value in degrees.
 * http://stackoverflow.com/questions/9705123/how-can-i-get-sin-cos-and-tan-to-return-degrees-instead-of-radians
 * @param angleInRadian
 * @returns {number}
 */
function toDegrees(angleInRadian) { return angleInRadian * (180 / Math.PI); }
util.math.toDegrees = toDegrees;

/**
 * This function takes an angle in degree and returns a value in radian.
 * http://stackoverflow.com/questions/9705123/how-can-i-get-sin-cos-and-tan-to-return-degrees-instead-of-radians
 * @param angleInDegree
 * @returns {number}
 */
function toRadians(angleInDegree) {
    return angleInDegree * (Math.PI / 180);
}
util.math.toRadians = toRadians;

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
    lat1 = toRadians(lat1);
    lon1 = toRadians(lon1);
    lat2 = toRadians(lat2);
    lon2 = toRadians(lon2);
    var R = 6372800; // Earth radius in m.
    var dLat = lat2 - lat1;
    var dLon = lon2 - lon1;
    var a = Math.sin(dLat / 2) * Math.sin(dLat /2) + Math.sin(dLon / 2) * Math.sin(dLon /2) * Math.cos(lat1) * Math.cos(lat2);
    var c = 2 * Math.asin(Math.sqrt(a));
    return R * c;
}
util.math.haversine = haversine;

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
