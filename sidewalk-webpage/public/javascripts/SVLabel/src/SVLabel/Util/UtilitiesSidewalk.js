/** @namespace */
var svl = svl || {};
svl.misc = {};


/**
 *
 * 0 for image y-axis is at *3328*! So the top-left corner of the image is (0, 3328).

 * Note: I realized I wrote the same function in Point.js. (gsvImageCoordinate2CanvasCoordinate()).
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
            cursorImagePath : svl.rootDirectory + 'img/cursors/Cursor_CurbRamp.png'
        },
        NoCurbRamp: {
            id: 'NoCurbRamp',
            cursorImagePath : svl.rootDirectory + 'img/cursors/Cursor_NoCurbRamp.png'
        },
        Obstacle: {
          id: 'Obstacle',
          cursorImagePath : svl.rootDirectory + 'img/cursors/Cursor_Obstacle.png'
        },
        SurfaceProblem: {
          id: 'SurfaceProblem',
          cursorImagePath : svl.rootDirectory + 'img/cursors/Cursor_SurfaceProblem.png'
        },
        Other: {
            id: 'Other',
            cursorImagePath: svl.rootDirectory + 'img/cursors/Cursor_Other.png'
        }
    }
}
svl.misc.getLabelCursorImagePath = getLabelCursorImagePath;


// Returns image paths corresponding to each label type.
function getLabelIconImagePath(category) {
    var imagePaths = {
        Walk : {
            id : 'Walk',
            iconImagePath : null,
            googleMapsIconImagePath: null
        },
        CurbRamp: {
            id: 'CurbRamp',
            iconImagePath : svl.rootDirectory + 'img/icons/Sidewalk/Icon_CurbRamp.svg',
            googleMapsIconImagePath: svl.rootDirectory + '/img/icons/Sidewalk/GMapsStamp_CurbRamp.png'
        },
        NoCurbRamp: {
            id: 'NoCurbRamp',
            iconImagePath : svl.rootDirectory + 'img/icons/Sidewalk/Icon_NoCurbRamp.svg',
            googleMapsIconImagePath: svl.rootDirectory + '/img/icons/Sidewalk/GMapsStamp_NoCurbRamp.png'
        },
        Obstacle: {
            id: 'Obstacle',
            iconImagePath: svl.rootDirectory + 'img/icons/Sidewalk//Icon_Obstacle.svg',
            googleMapsIconImagePath: svl.rootDirectory + '/img/icons/Sidewalk/GMapsStamp_Obstacle.png'
        },
        SurfaceProblem: {
            id: 'SurfaceProblem',
            iconImagePath: svl.rootDirectory + 'img/icons/Sidewalk/Icon_SurfaceProblem.svg',
            googleMapsIconImagePath: svl.rootDirectory + '/img/icons/Sidewalk/GMapsStamp_SurfaceProblem.png'
        },
        Other: {
            id: 'Other',
            iconImagePath: svl.rootDirectory + 'img/icons/Sidewalk/Icon_Other.svg',
            googleMapsIconImagePath: svl.rootDirectory + '/img/icons/Sidewalk/GMapsStamp_Other.png'
        },
        Void: {
            id: 'Void',
            iconImagePath : null
        }
    };

    return category ? imagePaths[category] : imagePaths;
}
svl.misc.getIconImagePaths = getLabelIconImagePath;


// This function is used in OverlayMessageBox.js.
svl.misc.getLabelInstructions = function () {
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
};

svl.misc.getRibbonConnectionPositions = function  () {
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

svl.misc.getLabelDescriptions = function () {
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
};

var ColorScheme = (function () {
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

    function SidewalkColorScheme2 (category) {
        var colors = {
            Walk : {
                id : 'Walk',
                fillStyle : 'rgba(0, 0, 0, 1)'
            },
            CurbRamp: {
                id: 'CurbRamp',
                fillStyle: 'rgba(0, 222, 38, 1)'  // 'rgba(0, 244, 38, 1)'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                fillStyle: 'rgba(233, 39, 113, 1)'  // 'rgba(255, 39, 113, 1)'
            },
            Obstacle: {
                id: 'Obstacle',
                fillStyle: 'rgba(0, 161, 203, 1)'
            },
            Other: {
                id: 'Other',
                fillStyle: 'rgba(179, 179, 179, 1)' //'rgba(204, 204, 204, 1)'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                fillStyle: 'rgba(241, 141, 5, 1)'
            },
            Void: {
                id: 'Void',
                fillStyle: 'rgba(255, 255, 255, 1)'
            },
            Unclear: {
                id: 'Unclear',
                fillStyle: 'rgba(128, 128, 128, 0.5)'
            }
        };
        return category ? colors[category].fillStyle : colors;
    }

    /**
     * http://www.colourlovers.com/business/trends/branding/7880/Papeterie_Haute-Ville_Logo
     * @returns {{Walk: {id: string, fillStyle: string}, CurbRamp: {id: string, fillStyle: string}, NoCurbRamp: {id: string, fillStyle: string}, StopSign: {id: string, fillStyle: string}, StopSign_OneLeg: {id: string, fillStyle: string}, StopSign_TwoLegs: {id: string, fillStyle: string}, StopSign_Column: {id: string, fillStyle: string}, Landmark_Shelter: {id: string, fillStyle: string}, Landmark_Bench: {id: string, fillStyle: string}, Landmark_TrashCan: {id: string, fillStyle: string}, Landmark_MailboxAndNewsPaperBox: {id: string, fillStyle: string}, Landmark_OtherPole: {id: string, fillStyle: string}}}
     */
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

    return {
        className: 'ColorScheme',
        SidewalkColorScheme: SidewalkColorScheme,
        SidewalkColorScheme2: SidewalkColorScheme2
    };
}());

svl.misc.getLabelColors = ColorScheme.SidewalkColorScheme2;

// Ajax without jQuery.
// http://stackoverflow.com/questions/8567114/how-to-make-an-ajax-call-without-jquery
// http://stackoverflow.com/questions/6418220/javascript-send-json-object-with-ajax
svl.misc.reportNoStreetView = function (streetEdgeId) {
    var x = new XMLHttpRequest(), async = true, url = "/audit/nostreetview";
    x.open('POST', url, async);
    x.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    x.send(JSON.stringify({issue: "NoStreetView", street_edge_id: streetEdgeId}));
};