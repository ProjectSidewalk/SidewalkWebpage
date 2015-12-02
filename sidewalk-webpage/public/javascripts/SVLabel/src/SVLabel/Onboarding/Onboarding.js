/**
 * Created with JetBrains PhpStorm.
 * User: kotarohara
 * Date: 3/7/13
 * Time: 1:25 AM
 * To change this template use File | Settings | File Templates.
 */

function Onboarding (params, $) {
    var oPublic = {
        className : 'Onboarding'
        };
    var properties = {
            canvas : {
                height : undefined,
                width : undefined
            },
            lineHeight : 15,
            messageArrow : {
                arrowWidth: 3,
                fillStyle : 'rgba(255,255,255,1)',
                headSize : 5,
                lineWidth : 1,
                radius : 20,
                strokeStyle : 'rgba(96,96,96,1)'
            },
            messageBox : {
                fillStyle : 'rgba(69,183,214,0.95)',
                font : "14px SegoeUILight",
                fontColor : 'rgba(255,255,255,1)',
                height: undefined,
                heightPerLine : 20,
                lineWidth : 3,
                padding : 10,
                strokeStyle : 'rgba(255,255,255,1)',
                textLineOffset : 20,
                width : undefined
            },
            highlight : {
                fill : 'rgba(252, 237, 62, 0.7)',
                border: '2px solid rgba(252, 217, 32, 0.9)'
            }
        };
        var status = {

        };

        //
        var ctx;

        // jQuery doms
        var $divHolderOnboarding = $("#Holder_Onboarding");
        var $divHolderOnboardingCanvas = $("#Holder_OnboardingCanvas");
        var $divOnboardingMessageBox = $("#Holder_OnboardingMessageBox");
        var $divOnboardingMessage = $("#Holder_OnboardingMessage");
        var $canvasOnboardingMessage = $("#onboardingCanvas");
        var $divHoldeOverlayMessage = $("#Holder_OverlayMessage");

    ////////////////////////////////////////////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////////////////////////////////////////////
    function init (params) {
        if (('domIds' in params) && ('canvas' in params.domIds)) {
            var el = document.getElementById(params.domIds.canvas);
        }

        if (el) {
            ctx = el.getContext('2d');
            properties.canvas.width = el.width;
            properties.canvas.height = el.height;
        } else {
            ctx = undefined;
            properties.canvas.width = undefined;
            properties.canvas.height = undefined;
        }

        $divHolderOnboarding.css({
            'visibility' : 'visible'
        });
        $divHoldeOverlayMessage.css({
            'visibility' : 'hidden'
        });
    }


    ////////////////////////////////////////////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////////////////////////////////////////////
    oPublic.clear = function () {
        oPublic.hideMessage();
        ctx.clearRect(0, 0, properties.canvas.width, properties.canvas.height);
        return this;
    };

    oPublic.generateLabel = function (turkerId, labelId, panoId, labelType, heading, pitch, zoom, lat, lng, points, photographerHeading, photographerPitch) {
        // This method takes a bunch of parameters and point coordinates to generate a fake label.
        var i = 0;
        var len = 0;
        var label = [];
        var pointFormat = {
            "AmazonTurkerId": turkerId,
            "LabelId": labelId,
            "LabelGSVPanoramaId": panoId,
            "LabelType": labelType,
            "LabelPointId": "-1",
            "svImageX": undefined,
            "svImageY": undefined,
            "originalHeading": heading,
            "originalPitch": pitch,
            "originalZoom": zoom,
            "heading": heading,
            "pitch": pitch,
            "zoom": zoom,
            "Lat": lat,
            "Lng": lat
        };

        if (photographerHeading && photographerPitch) {
            pointFormat.PhotographerHeading = photographerHeading;
            pointFormat.PhotographerPitch = photographerPitch;
        }

        len = points.length;
        for (i = 0; i < len; i++) {
            label.push($.extend(true, {svImageX: points[i].x, svImageY: points[i].y}, pointFormat))
        }

        return label;
    };

    oPublic.getProperties = function () {
        return $.extend(true, {}, properties);
    };


    oPublic.hideMessage = function () {
        $divOnboardingMessageBox.css('visibility', 'hidden');
    };


    oPublic.renderMessage = function (x, y, message, widthIn, heightIn, zIndexIn) {
        // This method renders a message in the onboarding message box.
        var height = heightIn ? heightIn : 150;
        var width = widthIn ? widthIn : 200;
        var zIndex = zIndexIn ? zIndex : 100;

        $divOnboardingMessageBox.css({
            visibility: 'visible',
            position: 'absolute',
            'text-align': 'justify',
            left: x,
            top: y
        });

        if (zIndexIn) {
            $divHolderOnboardingCanvas.css({
                'z-index' : zIndex
            });
        }

        $divOnboardingMessageBox.css('width', width + 'px');
        $divOnboardingMessageBox.css('height', height + 'px');
        $divOnboardingMessage.html(message);
    };

    oPublic.renderCanvasMessage = function (x, y, message, param) {
        // This method renders a message on the onboarding canvas
        // How to add stroke
        // http://stackoverflow.com/questions/1421082/how-to-add-a-border-on-html5-canvas-text
        param = param || {};

        if ('fontSize' in param) {
            var fontSize = param.fontSize;
        } else {
            var fontSize = 24;
        }

        if ('lineWidth' in param) {
            var lineWidth = param.lineWidth;
        } else {
            var lineWidth = 1;
        }

        if ('bold' in param) {
            var bold = param.bold;
        } else {
            var bold = false;
        }

        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = "white";
        ctx.strokeStyle = "rgba(0,0,0,1)";
        ctx.lineWidth = lineWidth;
        ctx.font = bold ? ("bold " + fontSize + "pt Arial") : (fontSize + "pt Arial");
        ctx.fillText(message, x, y);
        ctx.strokeText(message, x, y);
        ctx.fill();
        ctx.stroke();
        ctx.closePath();
        ctx.restore();
    };

    oPublic.renderArrow = function (x1, y1, x2, y2, param) {
        param = param || {};
        if ('lineWidth' in param) {
            var lineWidth = param.lineWidth;
        } else {
            var lineWidth = properties.messageArrow.lineWidth;
        }
        if ('fillStyle' in param) {
            var fillStyle = param.fillStyle;
        } else {
            var fillStyle = properties.messageArrow.fillStyle;
        }
        if ('strokeStyle' in param) {
            var strokeStyle = param.strokeStyle;
        } else {
            var strokeStyle = properties.messageArrow.strokeStyle;
        }
        if ('arrowWidth' in param) {
            var arrowWidth = param.arrowWidth;
        } else {
            var arrowWidth = 3;
        }

        var dx = x2 - x1;
        var dy = y2 - y1;
        var theta = Math.atan2(dy, dx);

        ctx.save();
        ctx.fillStyle = fillStyle;
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = properties.messageArrow.lineCap;

        ctx.translate(x1, y1);
        ctx.beginPath();
        ctx.moveTo(arrowWidth * Math.sin(theta), - arrowWidth * Math.cos(theta));
        ctx.lineTo(dx + arrowWidth * Math.sin(theta), dy - arrowWidth * Math.cos(theta))

        //
        // Draw an arrow head
        ctx.lineTo(dx + 3 * arrowWidth * Math.sin(theta), dy - 3 * arrowWidth * Math.cos(theta));
        ctx.lineTo(dx + 3 * arrowWidth * Math.cos(theta), dy + 3 * arrowWidth * Math.sin(theta));
        ctx.lineTo(dx - 3 * arrowWidth * Math.sin(theta), dy + 3 * arrowWidth * Math.cos(theta));

        ctx.lineTo(dx - arrowWidth * Math.sin(theta), dy + arrowWidth * Math.cos(theta));
        ctx.lineTo(- arrowWidth * Math.sin(theta), + arrowWidth * Math.cos(theta));

        ctx.fill();
        ctx.stroke();
        ctx.closePath();
        ctx.restore();
    };

    //
    // Nict tutorial of drawing an arrow
    // http://www.dbp-consulting.com/tutorials/canvas/CanvasArrow.html
    oPublic.renderRoundArrow = function (x1, y1, x2, y2, direction, lineWidth, fillStyle, strokeStyle) {
        var r = properties.messageArrow.radius;
        var h = properties.messageArrow.headSize;
        var lw;
        var r1
        var r2;
        var angle = 0;
        var dx;
        var dy;
        var dtemp;

        // Check if arguments were passed. If not, set default values.
        // Use these values to set styling
        if (!direction) {
            direction = 'cw';
        }
        if (!lineWidth) {
            lineWidth = properties.messageArrow.lineWidth;
        }
        if (!fillStyle) {
            fillStyle = properties.messageArrow.fillStyle;
        }
        if (!strokeStyle) {
            strokeStyle = properties.messageArrow.strokeStyle;
        }
        ctx.fillStyle = fillStyle;
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = properties.messageArrow.lineCap;

        // Drawing an arrow.
        lw = 2.5;
        h = 10;
        r1 = r + lw;
        r2 = r - lw;
        dx = x2 - x1;
        dy = y2 - y1;

        ctx.save();
        ctx.translate(x1, y1);

        //

        if (direction === 'ccw') {
            if (x1 < x2 && y1 < y2) {
                angle = 0;
            } else if (x1 < x2 && y1 >= y2) {
                angle = -Math.PI / 2;
                dtemp = dx;
                dx = -dy;
                dy = dtemp;;
            } else if (x1 >= x2 && y1 >= y2) {
                angle = -Math.PI;
                dx = -dx;
                dy = -dy;
            } else {
                angle = - 3 * Math.PI / 2;
                dtemp = dx;
                dx = dy;
                dy = -dtemp;
            }
        } else if (direction === 'cw') {
            if (x1 > x2 && y1 < y2) {
                angle = 0;
                dx = -dx;
            } else if (x1 > x2 && y1 >= y2) {
                angle = Math.PI / 2;
                dtemp = dx;
                dx = -dy;
                dy = -dtemp;
            } else if (x1 <= x2 && y1 >= y2) {
                angle = Math.PI;
                dx = dx;
                dy = -dy;
            } else {
                angle = 3 * Math.PI / 2;
                dtemp = dx;
                dx = dy;
                dy = dtemp;
            }
        }
        ctx.rotate(angle);



        if (direction === 'ccw') {
            // Draw line

            ctx.beginPath();
            ctx.moveTo(-lw, 0);
            ctx.lineTo(-lw, dy - r1);

            ctx.arcTo(-lw, dy + lw, r1, dy + lw, r1);
            ctx.lineTo(dx, dy + lw);

            // Arrow head
            ctx.lineTo(dx, dy + h);
            ctx.lineTo(dx + h, dy);
            ctx.lineTo(dx, dy - h);
            ctx.lineTo(dx, dy - lw);

            // Going back
            ctx.lineTo(lw + r2, dy - lw);
            ctx.arcTo(lw, dy - lw, lw, dy - r2 - lw, r2);
            ctx.lineTo(lw, 0);
            ctx.fill();
            ctx.stroke();
            ctx.closePath();
        } else if (direction === 'cw') {
            // cw
            ctx.beginPath();
            ctx.moveTo(lw, 0);
            ctx.lineTo(lw, dy - r1);

            ctx.arcTo(lw, dy + lw, - r1, dy + lw, r1);
            ctx.lineTo(- dx, dy + lw);

            // Arrow head
            ctx.lineTo(- dx, dy + h);
            ctx.lineTo(- dx - h, dy);
            ctx.lineTo(- dx, dy - h);
            ctx.lineTo(- dx, dy - lw);

            // Going back
            ctx.lineTo(- lw - r2, dy - lw);
            ctx.arcTo(- lw, dy - lw, -lw, dy - r2 - lw, r2);
            ctx.lineTo(- lw, 0);
            ctx.fill();
            ctx.stroke();
            ctx.closePath();
        }
        ctx.restore();
    };

    oPublic.renderArrowWithShadow = function (x1, y1, x2, y2, direction, lineWidth) {
        // oPublic.renderArrow(x1 + 2, y1 - 2, x2 + 2, y2 - 2, direction , lineWidth, '#000', '#000');
        oPublic.renderArrow(x1, y1, x2, y2, direction, lineWidth);
    };

    oPublic.resetMessageBoxFill = function () {
        // This method changes the color of the text box background to the default color.
        var rgba = properties.messageBox.fillStyle;
        $divOnboardingMessageBox.css('background', rgba);
    };

    oPublic.setBackground = function (rgba) {
        // This method changes the color of the text box background
        if (!rgba) {
            rgba = properties.messageBox.fillStyle;
        }
        $divOnboardingMessageBox.css('background', rgba);
        return this;
    };

    oPublic.setMessageBoxFill = function (rgba) {
        // This method changes the color of the text box background
        return oPublic.setBackground(rgba);
    }

    ////////////////////////////////////////////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////////////////////////////////////////////
    init(params);

    return oPublic;
}