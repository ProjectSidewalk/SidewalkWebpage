/** @namespace */
var svl = svl || {};
svl.util = svl.util || {};
svl.util.shape = {};


function lineWithRoundHead (ctx, x1, y1, r1, x2, y2, r2, sourceFormIn, sourceStrokeStyleIn, sourceFillStyleIn, targetFormIn, targetStrokeStyleIn, targetFillStyleIn) {
    // sourceStyle and targetStyle:
    // - none: do not draw anything
    // - fill: fill the circle
    // - stroke: stroke the circle
    // - both: stroke and fill
    var sourceForm = 'none';
    var targetForm = 'none';
    var sourceStrokeStyle = sourceStrokeStyleIn ? sourceStrokeStyleIn : 'rgba(255,255,255,1)';
    var sourceFillStyle = 'rgba(255,255,255,1)';
    var targetStrokeStyle = 'rgba(255,255,255,1)';
    var targetFillStyle = 'rgba(255,255,255,1)';
    if (sourceFormIn) {
        if (sourceFormIn !== 'none' &&
            sourceFormIn !== 'stroke' &&
            sourceFormIn !== 'fill' &&
            sourceFormIn !== 'both') {
            throw 'lineWithRoundHead(): ' + sourceFormIn + ' is not a valid input.';
        }
        sourceForm = sourceFormIn;
    }
    if (targetFormIn) {
        if (targetFormIn !== 'none' &&
            targetFormIn !== 'stroke' &&
            targetFormIn !== 'fill' &&
            targetFormIn !== 'both') {
            throw 'lineWithRoundHead(): ' + targetFormIn + ' is not a valid input.';
        }
        targetForm = targetFormIn;
    }
    if (sourceStrokeStyleIn) {
        sourceStrokeStyle = sourceStrokeStyleIn;
    }
    if (sourceFillStyleIn) {
        sourceFillStyle = sourceFillStyleIn;
    }
    if (targetStrokeStyleIn) {
        targetStrokeStyle = targetStrokeStyleIn;
    }
    if (targetFillStyleIn) {
        targetFillStyle = targetFillStyleIn;
    }

    var theta = Math.atan2(y2 - y1, x2 - x1);
    var lineXStart = x1 + r1 * Math.cos(theta);
    var lineYStart = y1 + r1 * Math.sin(theta);
    var lineXEnd =  x2 - r2 * Math.cos(theta);
    var lineYEnd = y2 - r2 * Math.sin(theta);

    ctx.save();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lineXStart, lineYStart);
    ctx.lineTo(lineXEnd, lineYEnd);
    ctx.stroke();
    ctx.closePath();
    ctx.restore();

    if (sourceForm !== 'none') {
        ctx.save();
        ctx.fillStyle = sourceFillStyle;
        ctx.strokeStyle = sourceStrokeStyle;
        ctx.beginPath();
        ctx.arc(x1, y1, r1, 0, 2 * Math.PI, true);
        if (sourceForm === 'stroke') {
            ctx.stroke();
        } else if (sourceForm === 'fill') {
            ctx.fill();
        } else if (sourceForm === 'both') {
            ctx.fill();
            ctx.stroke();
        }
        ctx.closePath();
        ctx.restore();
    }
    if (targetForm !== 'none') {
        ctx.save();
        ctx.fillStyle = targetFillStyle;
        ctx.strokeStyle = targetStrokeStyle;
        ctx.beginPath();
        ctx.arc(x2, y2, r2, 0, 2 * Math.PI, true);
        if (targetForm === 'stroke') {
            ctx.stroke();
        } else if (targetForm === 'fill') {
            ctx.fill();
        } else if (targetForm === 'both') {
            ctx.fill();
            ctx.stroke();
        }
        ctx.closePath();
        ctx.restore();
    }
}
svl.util.shape.lineWithRoundHead = lineWithRoundHead;
