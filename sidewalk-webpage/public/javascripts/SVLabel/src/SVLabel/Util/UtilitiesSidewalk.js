/** @namespace */
var svl = svl || {};
svl.misc = {};

/**
 *
 * 0 for image y-axis is at *3328*! So the top-left corner of the image is (0, 3328).

 * Note: I realized I wrote a function in Point.js. (gsvImageCoordinate2CanvasCoordinate()).
 * @param ix
 * @param iy
 * @param pov
 * @param zoomFactor
 * @returns {{x: number, y: number}}
 */
function imageCoordinateToCanvasCoordinate(ix, iy, pov, zoomFactor) {
    if (!zoomFactor) {
        zoomFactor = 1;
    }
    var canvasX = (ix - svl.svImageWidth * pov.heading / 360) * zoomFactor / svl.alpha_x + svl.canvasWidth / 2;
    var canvasY = (iy - svl.svImageHeight * pov.pitch / 180) * zoomFactor / svl.alpha_y + svl.canvasHeight / 2;
    return {x: canvasX, y: canvasY};
}
svl.misc.imageCoordinateToCanvasCoordinate = imageCoordinateToCanvasCoordinate;

//self.svImageCoordinate.x = svImageWidth * pov.heading / 360 + (svl.alpha_x * (x - (svl.canvasWidth / 2)) / zoomFactor);
//self.svImageCoordinate.y = (svImageHeight / 2) * pov.pitch / 90 + (svl.alpha_y * (y - (svl.canvasHeight / 2)) / zoomFactor);


function getHeadingEstimate(SourceLat, SourceLng, TargetLat, TargetLng) {
    // This function takes a pair of lat/lng coordinates.
    //
    if (typeof SourceLat !== 'number') {
        SourceLat = parseFloat(SourceLat);
    }
    if (typeof SourceLng !== 'number') {
        SourceLng = parseFloat(SourceLng);
    }
    if (typeof TargetLng !== 'number') {
        TargetLng = parseFloat(TargetLng);
    }
    if (typeof TargetLat !== 'number') {
        TargetLat = parseFloat(TargetLat);
    }

    var dLng = TargetLng - SourceLng;
    var dLat = TargetLat - SourceLat;

    if (dLat === 0 || dLng === 0) {
        return 0;
    }

    var angle = toDegrees(Math.atan(dLng / dLat));
    //var angle = toDegrees(Math.atan(dLat / dLng));

    return 90 - angle;
}


function getLabelCursorImagePath() {
    return {
        'Walk' : {
            'id' : 'Walk',
            'cursorImagePath' : undefined
        },
        CurbRamp: {
            id: 'CurbRamp',
            cursorImagePath : svl.rootDirectory + 'img/cursors/pen.png'
        },
        NoCurbRamp: {
            id: 'NoCurbRamp',
            cursorImagePath : svl.rootDirectory + 'img/cursors/pen.png'
        },
        Obstacle: {
          id: 'Obstacle',
          cursorImagePath : svl.rootDirectory + 'img/cursors/pen.png'
        },
        SurfaceProblem: {
          id: 'SurfaceProblem',
          cursorImagePath : svl.rootDirectory + 'img/cursors/pen.png'
        },
        Other: {
            id: 'Other',
            cursorImagePath: svl.rootDirectory + 'img/cursors/pen.png'
        }
    }
}
svl.misc.getLabelCursorImagePath = getLabelCursorImagePath;


//
// Returns image paths corresponding to each label type.
//
function getLabelIconImagePath(labelType) {
    return {
        'Walk' : {
            'id' : 'Walk',
            'iconImagePath' : undefined
        },
        CurbRamp: {
            id: 'CurbRamp',
            iconImagePath : svl.rootDirectory + 'img/Icon_CurbRamp.svg'
        },
        NoCurbRamp: {
            id: 'NoCurbRamp',
            iconImagePath : svl.rootDirectory + '/img/icons/Sidewalk/Icon_NoCurbRamp.svg'
        },
        Obstacle: {
          id: 'Obstacle',
          iconImagePath: null
        },
        SurfaceProblem: {
          id: 'SurfaceProblem',
          iconImagePath: null
        },
        Other: {
            id: 'Other',
            iconImagePath: null
        },
        Void: {
            id: 'Void',
            iconImagePath : null
        },
        Unclear: {
            id: 'Unclear',
            iconImagePath : null
        },
        'StopSign' : {
            'id' : 'StopSign',
            'iconImagePath' : svl.rootDirectory + '/img/icons/Icon_BusStop.png'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'iconImagePath' : svl.rootDirectory + '/img/icons/Icon_BusStopSign_SingleLeg.png'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'iconImagePath' : svl.rootDirectory + '/img/icons/Icon_BusStopSign_TwoLegged.png'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'iconImagePath' : svl.rootDirectory + '/img/icons/Icon_BusStopSign_Column.png'
        },
        'StopSign_None' : {
            'id' : 'StopSign_None',
            'iconImagePath' : svl.rootDirectory + '/img/icons/Icon_BusStop.png'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'iconImagePath' : svl.rootDirectory + '/img/icons/Icon_BusStopShelter.png'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'iconImagePath' : svl.rootDirectory + '/img/icons/Icon_Bench.png'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'iconImagePath' : svl.rootDirectory + '/img/icons/Icon_TrashCan2.png'
        },
        'Landmark_MailboxAndNewsPaperBox' : {
            'id' : 'Landmark_MailboxAndNewsPaperBox',
            'iconImagePath' : svl.rootDirectory + '/img/icons/Icon_Mailbox2.png'
        },
        'Landmark_OtherPole' : {
            'id' : 'Landmark_OtherPole',
            'iconImagePath' : svl.rootDirectory + '/img/icons/Icon_OtherPoles.png'
        }
    }
}
svl.misc.getIconImagePaths = getLabelIconImagePath;


//
// This function is used in OverlayMessageBox.js.
//
function getLabelInstructions () {
    return {
        'Walk' : {
            'id' : 'Walk',
            'instructionalText' : 'Explore mode: Find and label curb ramps at this intersection.',
            'textColor' : 'rgba(255,255,255,1)'
        },
        CurbRamp: {
            id: 'CurbRamp',
            instructionalText: 'Label mode: Locate and draw an outline around the <span class="underline">curb ramp</span>',
            textColor: 'rgba(255,255,255,1)'
        },
        NoCurbRamp: {
            id: 'NoCurbRamp',
            instructionalText: 'Label mode: Locate and draw an outline around where a <span class="underline">curb ramp is missing</span>',
            textColor: 'rgba(255,255,255,1)'
        },
        Obstacle: {
          id: 'Obstacle',
          instructionalText: 'Label mode: Locate and draw an outline around a <span class="underline">obstacle in path</span>',
          textColor: 'rgba(255,255,255,1)'
        },
        Other: {
            id: 'Other',
            instructionalText: 'Label mode',
            textColor: 'rgba(255,255,255,1)'
        },
        SurfaceProblem: {
          id: 'SurfaceProblem',
          instructionalText: 'Label mode: Locate and draw an outline around a <span class="underline">sidewalk surface problem</span>',
          textColor: 'rgba(255,255,255,1)'
        },
        'StopSign' : {
            'id' : 'StopSign',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">stop sign</span>',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bus stop sign</span>',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'instructionalText' :'Label mode: Locate and click at the bottom of the <span class="underline">bus stop sign</span>',
            'textColor' :'rgba(255,255,255,1)'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bus stop sign</span>',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bus shelter</span>',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bench</span> nearby a bus stop',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">trash can</span> nearby a bus stop',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'Landmark_MailboxAndNewsPaperBox' : {
            'id' : 'Landmark_MailboxAndNewsPaperBox',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">mailbox or news paper box</span> nearby a bus stop',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'Landmark_OtherPole' : {
            'id' : 'Landmark_OtherPole',
            'instructionalText' : 'Label mode: Locate and click at the bottom of poles such as <span class="underline bold">traffic sign, traffic light, and light pole</span> nearby a bus stop',
            'textColor' : 'rgba(255,255,255,1)'
        }
    }
}
svl.misc.getLabelInstructions = getLabelInstructions;

function getRibbonConnectionPositions () {
    return {
        'Walk' : {
            'id' : 'Walk',
            'text' : 'Walk',
            'labelRibbonConnection' : '25px'
        },
        CurbRamp: {
            id: 'CurbRamp',
            labelRibbonConnection: '100px'
        },
        NoCurbRamp: {
            id: 'NoCurbRamp',
            labelRibbonConnection: '174px'
        },
        Obstacle: {
          id: 'Obstacle',
          labelRibbonConnection: '248px'
        },
        SurfaceProblem: {
          id: 'SurfaceProblem',
          labelRibbonConnection: '322px'
        },
        Other: {
            id: 'Other',
            labelRibbonConnection: '396px'
        },
        'StopSign' : {
            'id' : 'StopSign',
            'text' : 'Stop Sign',
            'labelRibbonConnection' : '112px'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'text' : 'One-leg Stop Sign',
            'labelRibbonConnection' : '112px'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'text' : 'Two-leg Stop Sign',
            'labelRibbonConnection' : '112px'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'text' : 'Column Stop Sign',
            'labelRibbonConnection' : '112px'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'text' : 'Bus Shelter',
            'labelRibbonConnection' : '188px'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'text' : 'Bench',
            'labelRibbonConnection' : '265px'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'text' : 'Trash Can',
            'labelRibbonConnection' : '338px'
        },
        'Landmark_MailboxAndNewsPaperBox' : {
            'id' : 'Landmark_MailboxAndNewsPaperBox',
            'labelRibbonConnection' : '411px'
        },
        'Landmark_OtherPole' : {
            'id' : 'Landmark_OtherPole',
            'labelRibbonConnection' : '484px'
        }
    }
}

// Todo. Get rid of this global function.
function getLabelDescriptions () {
    return {
        'Walk' : {
            'id' : 'Walk',
            'text' : 'Walk'
        },
        CurbRamp: {
            id: 'CurbRamp',
            text: 'Curb Ramp'
        },
        NoCurbRamp: {
            id: 'NoCurbRamp',
            text: 'Missing Curb Ramp'
        },
        Obstacle: {
          id: 'Obstacle',
          text: 'Obstacle in a Path'
        },
        Other: {
            id: 'Other',
            text: 'Other'
        },
        SurfaceProblem: {
          id: 'SurfaceProblem',
          text: 'Surface Problem'
        },
        Void: {
            id: 'Void',
            text: 'Void'
        },
        Unclear: {
            id: 'Unclear',
            text: 'Unclear'
        },
        'StopSign' : {
            'id' : 'StopSign',
            'text' : 'Bus Stop Sign'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'text' : 'One-leg Stop Sign'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'text' : 'Two-leg Stop Sign'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'text' : 'Column Stop Sign'
        },
        'StopSign_None' : {
            'id' : 'StopSign_None',
            'text' : 'Not provided'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'text' : 'Bus Stop Shelter'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'text' : 'Bench'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'text' : 'Trash Can / Recycle Can'
        },
        'Landmark_MailboxAndNewsPaperBox' : {
            'id' : 'Landmark_MailboxAndNewsPaperBox',
            'text' : 'Mailbox / News Paper Box'
        },
        'Landmark_OtherPole' : {
            'id' : 'Landmark_OtherPole',
            'text' : 'Traffic Sign / Pole'
        }
    }
}
svl.misc.getLabelDescriptions = getLabelDescriptions;

// Todo. Get rid of this global function.
function getLabelColors () {
    return SidewalkColorScheme();
}
svl.misc.getLabelColors = getLabelColors;


function SidewalkColorScheme () {
    return {
        'Walk' : {
            'id' : 'Walk',
            'fillStyle' : 'rgba(0, 0, 0, 0.9)'
        },
        CurbRamp: {
            id: 'CurbRamp',
            fillStyle: 'rgba(0, 244, 38, 0.9)'
        },
        NoCurbRamp: {
            id: 'NoCurbRamp',
            fillStyle: 'rgba(255, 39, 113, 0.9)'
        },
        Obstacle: {
          id: 'Obstacle',
          fillStyle: 'rgba(0, 161, 203, 0.9)'
        },
        Other: {
            id: 'Other',
            fillStyle: 'rgba(204, 204, 204, 0.9)'
        },
        SurfaceProblem: {
          id: 'SurfaceProblem',
          fillStyle: 'rgba(215, 0, 96, 0.9)'
        },
        Void: {
            id: 'Void',
            fillStyle: 'rgba(255, 255, 255, 0)'
        },
        Unclear: {
            id: 'Unclear',
            fillStyle: 'rgba(128, 128, 128, 0.5)'
        }
    }
}

//
// http://www.colourlovers.com/business/trends/branding/7880/Papeterie_Haute-Ville_Logo
function colorScheme2 () {
    return {
        'Walk' : {
            'id' : 'Walk',
            'fillStyle' : 'rgba(0, 0, 0, 0.9)'
        },
        CurbRamp: {
            id: 'CurbRamp',
            fillStyle: 'rgba(106, 230, 36, 0.9)'
        },
        NoCurbRamp: {
            id: 'NoCurbRamp',
            fillStyle: 'rgba(215, 0, 96, 0.9)'
        },
        'StopSign' : {
            'id' : 'StopSign',
            'fillStyle' : 'rgba(0, 161, 203, 0.9)'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'fillStyle' : 'rgba(0, 161, 203, 0.9)'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'fillStyle' : 'rgba(0, 161, 203, 0.9)'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'fillStyle' : 'rgba(0, 161, 203, 0.9)'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'fillStyle' : 'rgba(215, 0, 96, 0.9)'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            // 'fillStyle' : 'rgba(229, 64, 40, 0.9)' // Kind of hard to distinguish from pink
            // 'fillStyle' : 'rgba(209, 209, 2, 0.9)' // Puke-y
            'fillStyle' : 'rgba(252, 217, 32, 0.9)'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'fillStyle' : 'rgba(97, 174, 36, 0.9)'
        },
        'Landmark_MailboxAndNewsPaperBox' : {
            'id' : 'Landmark_MailboxAndNewsPaperBox',
            'fillStyle' : 'rgba(67, 113, 190, 0.9)'
        },
        'Landmark_OtherPole' : {
            'id' : 'Landmark_OtherPole',
            'fillStyle' : 'rgba(249, 79, 101, 0.9)'
        }
    }
}
