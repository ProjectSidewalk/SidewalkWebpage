var util = util || {};

/**
 * Color utilities
 * @constructor
 * @memberof svl
 */
function UtilitiesColor () {
    var self = { className: "UtilitiesColor" };

    function changeAlphaRGBA(rgba, alpha) {
        // This function updates alpha value of the given rgba value. Example: if the input is rgba(200, 200, 200, 0.5)
        // and alpha 0.8, the output will be rgba(200, 200, 200, 0.8).
        var rgbaList = rgba.replace('rgba(','').replace(')','').split(",");
        if (rgbaList.length === 4 && !isNaN(parseInt(alpha))) {
            var newRgba;
            newRgba = 'rgba(' +
                rgbaList[0].trim() + ',' +
                rgbaList[1].trim() + ',' +
                rgbaList[2].trim() + ',' +
                alpha + ')';
            return newRgba;
        } else {
            return rgba;
        }
    }

    function changeDarknessRGBA(rgba, value) {
        // This function takes rgba and value as arguments
        // rgba: a string such as "rgba(10, 20, 30, 0.5)"
        // value: a value between [0, 1]
        var rgbaList = rgba.replace('rgba(','').replace(')','').split(",");

        if (rgbaList.length === 4) {
            var r;
            var g;
            var b;
            var a;
            var hsvList;
            var newRgbList;
            var newR;
            var newG;
            var newB;
            var newRgba;
            r = parseInt(rgbaList[0].trim());
            g = parseInt(rgbaList[1].trim());
            b = parseInt(rgbaList[2].trim());
            a = rgbaList[3].trim();
            hsvList = rgbToHsv(r,g,b);

            newRgbList = hsvToRgb(hsvList[0],hsvList[1],value);
            newR = parseInt(newRgbList[0]);
            newG = parseInt(newRgbList[1]);
            newB = parseInt(newRgbList[2]);
            newRgba = 'rgba(' + newR + ',' +
                newG + ',' +
                newB + ',' +
                a + ')';
            return newRgba;
        }
        return rgba;
    }

    /**
     * Converts an RGB color value to HSV. Conversion formula adapted from http://en.wikipedia.org/wiki/HSV_color_space.
     * Assumes r, g, and b are contained in the set [0, 255] and returns h, s, and v in the set [0, 1].
     *
     * @param r
     * @param g
     * @param b
     */
    function rgbToHsv(r, g, b){
        r = r / 255;
        g = g / 255;
        b = b / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var h, s, v = max;

        var d = max - min;
        s = max === 0 ? 0 : d / max;

        if(max == min){
            h = 0; // achromatic
        }else{
            switch(max){
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        return [h, s, v];
    }

    /**
     * Converts an HSV color value to RGB. Conversion formula adapted from http://en.wikipedia.org/wiki/HSV_color_space.
     * Assumes h, s, and v are contained in the set [0, 1] and returns r, g, and b in the set [0, 255].
     *
     * @param h
     * @param s
     * @param v
     */
    function hsvToRgb(h, s, v){
        var r, g, b;

        var i = Math.floor(h * 6);
        var f = h * 6 - i;
        var p = v * (1 - s);
        var q = v * (1 - f * s);
        var t = v * (1 - (1 - f) * s);

        switch(i % 6){
            case 0: r = v, g = t, b = p; break;
            case 1: r = q, g = v, b = p; break;
            case 2: r = p, g = v, b = t; break;
            case 3: r = p, g = q, b = v; break;
            case 4: r = t, g = p, b = v; break;
            case 5: r = v, g = p, b = q; break;
        }

        return [r * 255, g * 255, b * 255];
    }

    self.changeAlphaRGBA = changeAlphaRGBA;
    self.changeDarknessRGBA = changeDarknessRGBA;
    self.rgbToHsv = rgbToHsv;
    self.hsvToRgb = hsvToRgb;

    return self;
}
util.color = UtilitiesColor();
