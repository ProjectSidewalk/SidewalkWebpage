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
 * @param lng1
 * @param lat2
 * @param lng2
 * @returns {number} A distance in meters.
 */
function haversine(lat1, lng1, lat2, lng2) {
    lat1 = toRadians(lat1);
    lng1 = toRadians(lng1);
    lat2 = toRadians(lat2);
    lng2 = toRadians(lng2);
    var R = 6372800; // Earth radius in m.
    var dLat = lat2 - lat1;
    var dLon = lng2 - lng1;
    var a = Math.sin(dLat / 2) * Math.sin(dLat /2) + Math.sin(dLon / 2) * Math.sin(dLon /2) * Math.cos(lat1) * Math.cos(lat2);
    var c = 2 * Math.asin(Math.sqrt(a));
    return R * c;
}
util.math.haversine = haversine;

function roundToTwentyFive(num) { return Math.round(num / 25) * 25; }
util.math.roundToTwentyFive = roundToTwentyFive;

function metersToMiles(dist) { return dist / 1609.34; }
function metersToKms(dist) { return dist / 1000; }
function metersToFeet(dist) { return dist * 3.28084; }
function milesToMeters(dist) { return dist * 1609.34; }
function milesToKms(dist) { return dist * 1.60934; }
function milesToFeet(dist) { return dist * 5280; }
function kmsToMeters(dist) { return dist * 1000; }
function kmsToMiles(dist) { return dist / 1.60934; }
function kmsToFeet(dist) { return dist * 3280.84; }
function feetToMeters(dist) { return dist / 3.28084; }
function feetToMiles(dist) { return dist / 5280; }
function feetToKms(dist) { return dist / 3280.84; }
util.math.metersToMiles = metersToMiles;
util.math.metersToKms = metersToKms;
util.math.metersToFeet = metersToFeet;
util.math.milesToMeters = milesToMeters;
util.math.milesToKms = milesToKms;
util.math.milesToFeet = milesToFeet;
util.math.kmsToMeters = kmsToMeters;
util.math.kmsToMiles = kmsToMiles;
util.math.kmsToFeet = kmsToFeet;
util.math.feetToMeters = feetToMeters;
util.math.feetToMiles = feetToMiles;
util.math.feetToKms = feetToKms;
