var util = util || {};

/**
 * Color utilities
 * @constructor
 * @memberof svl
 */
function UtilitiesColor () {
    var self = { className: "UtilitiesColor" };

    /**
     * Convert RGB to RGBA
     * @param rgb
     * @param alpha
     * @returns {*}
     * @constructor
     */
    function RGBToRGBA (rgb, alpha) {
        if(!alpha){
            alpha = '0.5';
        }

        var newRGBA;
        if(rgb !== undefined) {
            newRGBA = 'rgba(';
            newRGBA+=rgb.substring(4,rgb.length-1)+','+alpha+')';
        }
        return newRGBA;
    }

    function RGBAToRGB (rgba) {
        var rgbaValueArray = rgba.substring(5, rgba.length - 1).split(",");
        return "rgb(" + rgbaValueArray[0] + "," + rgbaValueArray[1] + "," + rgbaValueArray[2] + ")";
    }

    function changeAlphaRGBA(rgba, alpha) {
        // This function updates alpha value of the given rgba value.
        // Ex. if the input is rgba(200,200,200,0.5) and alpha 0.8,
        // the out put will be rgba(200,200,200,0.8)
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
     * Converts an RGB color value to HSL. Conversion formula
     * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
     * Assumes r, g, and b are contained in the set [0, 255] and
     * returns h, s, and l in the set [0, 1].
     *
     * @param   r       The red color value
     * @param   g       The green color value
     * @param   b       The blue color value
     * @return  Array           The HSL representation
     *
     * http://mjijackson.com/2008/02/rgb-to-hsl-and-rgb-to-hsv-color-model-conversion-algorithms-in-javascript
     */
    function rgbToHsl(r, g, b){
        r /= 255, g /= 255, b /= 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var h, s, l = (max + min) / 2;

        if(max == min){
            h = s = 0; // achromatic
        }else{
            var d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch(max){
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        return [h, s, l];
    }

    /**
     * Converts an HSL color value to RGB. Conversion formula
     * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
     * Assumes h, s, and l are contained in the set [0, 1] and
     * returns r, g, and b in the set [0, 255].
     *
     * @param     h       The hue
     * @param     s       The saturation
     * @param     l       The lightness
     * @return  Array           The RGB representation
     */
    function hslToRgb(h, s, l){
        var r, g, b;

        if(s == 0){
            r = g = b = l; // achromatic
        } else {
            function hue2rgb(p, q, t){
                if(t < 0) t += 1;
                if(t > 1) t -= 1;
                if(t < 1/6) return p + (q - p) * 6 * t;
                if(t < 1/2) return q;
                if(t < 2/3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            }

            var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            var p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        return [r * 255, g * 255, b * 255];
    }

    /**
     * Converts an RGB color value to HSV. Conversion formula
     * adapted from http://en.wikipedia.org/wiki/HSV_color_space.
     * Assumes r, g, and b are contained in the set [0, 255] and
     * returns h, s, and v in the set [0, 1].
     *
     * @param b
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
     * Converts an HSV color value to RGB. Conversion formula
     * adapted from http://en.wikipedia.org/wiki/HSV_color_space.
     * Assumes h, s, and v are contained in the set [0, 1] and
     * returns r, g, and b in the set [0, 255].
     *
     * @param v
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

    self.RGBToRGBA = RGBToRGBA;
    self.RGBAToRGB = RGBAToRGB;
    self.changeAlphaRGBA = changeAlphaRGBA;
    self.changeDarknessRGBA = changeDarknessRGBA;
    self.rgbToHsl = rgbToHsl;
    self.hslToRgb = hslToRgb;
    self.rgbToHsv = rgbToHsv;
    self.hsvToRgb = hsvToRgb;

    return self;
}
util.color = UtilitiesColor();
