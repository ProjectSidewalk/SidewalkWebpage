window.util = window.util || {};
util.math = {};

/**
 * This method takes an angle value in radians and returns a value in degrees.
 * http://stackoverflow.com/questions/9705123/how-can-i-get-sin-cos-and-tan-to-return-degrees-instead-of-radians
 * @param angleInRadian
 * @returns {number}
 */
function toDegrees(angleInRadian) {
  return angleInRadian * (180 / Math.PI);
}

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
 * @param {{lat: number, lng: number}} latLng1
 * @param {{lat: number, lng: number}} latLng2
 * @returns {number} A distance in meters.
 */
function haversine(latLng1, latLng2) {
  const lat1 = toRadians(latLng1.lat);
  const lng1 = toRadians(latLng1.lng);
  const lat2 = toRadians(latLng2.lat);
  const lng2 = toRadians(latLng2.lng);
  const R = 6372800; // Earth radius in m.
  const dLat = lat2 - lat1;
  const dLon = lng2 - lng1;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.asin(Math.sqrt(a));
  return R * c;
}

util.math.haversine = haversine;

function roundToTwentyFive(num) {
  return Math.round(num / 25) * 25;
}

util.math.roundToTwentyFive = roundToTwentyFive;

/**
 * Truncates a value to a number of decimal places, rather than rounding it.
 *
 * Progress toward a goal is displayed floored so that it never reads as finished before it is: rounding 16.45 up to
 * "16.5 / 16.5 mi" claims a badge the user hasn't earned. Every display of an audited distance uses this so the same
 * total can't render two different ways on two parts of a page.
 *
 * @param {number} value - The value to truncate.
 * @param {number} decimals - How many decimal places to keep.
 * @returns {number} The value truncated toward zero at that precision.
 */
function floorTo(value, decimals) {
  return Math.floor(Number(`${value}e${decimals}`)) / 10 ** decimals;
}

util.math.floorTo = floorTo;

/**
 * Rounds a value up to a number of decimal places; the counterpart to floorTo.
 *
 * @param {number} value - The value to round up.
 * @param {number} decimals - How many decimal places to keep.
 * @returns {number} The value rounded up at that precision.
 */
function ceilTo(value, decimals) {
  // Shifts the decimal point through the number's own decimal string for the same reason floorTo does, in the other
  // direction: 1.1 * 100 is 110.00000000000001, which a plain Math.ceil would turn into 1.11.
  return Math.ceil(Number(`${value}e${decimals}`)) / 10 ** decimals;
}

util.math.ceilTo = ceilTo;

function metersToMiles(dist) {
  return dist / 1609.34;
}

function metersToKms(dist) {
  return dist / 1000;
}

function metersToFeet(dist) {
  return dist * 3.28084;
}

function milesToMeters(dist) {
  return dist * 1609.34;
}

function milesToKms(dist) {
  return dist * 1.60934;
}

function milesToFeet(dist) {
  return dist * 5280;
}

function kmsToMeters(dist) {
  return dist * 1000;
}

function kmsToMiles(dist) {
  return dist / 1.609344; // Exact: a mile is defined as 1609.344 m.
}

function kmsToFeet(dist) {
  return dist * 3280.84;
}

function feetToMeters(dist) {
  return dist / 3.28084;
}

function feetToMiles(dist) {
  return dist / 5280;
}

function feetToKms(dist) {
  return dist / 3280.84;
}

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
