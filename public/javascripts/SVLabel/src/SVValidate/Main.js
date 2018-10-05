/** @namespace */
var svv = svv || {};

/**
 * Main module of SVValidate
 * @param params
 * @returns {{className: string}}
 * @constructor
 */
function Main (params) {
    console.log("Main initialized");

    svv.panorama = new Panorama();

}