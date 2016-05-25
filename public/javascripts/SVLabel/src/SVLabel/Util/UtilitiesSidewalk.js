var svl = svl || {};
svl.misc = svl.misc || {};

function UtilitiesMisc (JSON) {
    var self = { className: "UtilitiesMisc" };

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

    function canvasCoordinateToImageCoordinate (canvasX, canvasY, pov) {
        var zoomFactor = svl.zoomFactor[pov.zoom];
        var x = svl.svImageWidth * pov.heading / 360 + (svl.alpha_x * (canvasX - (svl.canvasWidth / 2)) / zoomFactor);
        var y = (svl.svImageHeight / 2) * pov.pitch / 90 + (svl.alpha_y * (canvasY - (svl.canvasHeight / 2)) / zoomFactor);
        return { x: x, y: y };
    }

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
            },
            Occlusion: {
                id: 'Occlusion',
                cursorImagePath: svl.rootDirectory + 'img/cursors/Cursor_Other.png'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                cursorImagePath: svl.rootDirectory + 'img/cursors/Cursor_Other.png'
            }
        }
    }

    // Returns image paths corresponding to each label type.
    function getIconImagePaths(category) {
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
            Occlusion: {
                id: 'Occlusion',
                iconImagePath: svl.rootDirectory + 'img/icons/Sidewalk/Icon_Other.svg',
                googleMapsIconImagePath: svl.rootDirectory + '/img/icons/Sidewalk/GMapsStamp_Other.png'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
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

    function getLabelInstructions () {
        return {
            'Walk' : {
                'id' : 'Walk',
                'instructionalText' : 'Audit the streets and find all the accessibility attributes',
                'textColor' : 'rgba(255,255,255,1)'
            },
            CurbRamp: {
                id: 'CurbRamp',
                instructionalText: 'Locate and label a <span class="underline">curb ramp</span>',
                textColor: 'rgba(255,255,255,1)'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                instructionalText: 'Locate and label a <span class="underline">missing curb ramp</span>',
                textColor: 'rgba(255,255,255,1)'
            },
            Obstacle: {
                id: 'Obstacle',
                instructionalText: 'Locate and label an <span class="underline">obstacle in path</span>',
                textColor: 'rgba(255,255,255,1)'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                instructionalText: 'Locate and label a <span class="underline">surface problem</span>',
                textColor: 'rgba(255,255,255,1)'
            },
            Other: {
                id: 'Other',
                instructionalText: 'Label mode',
                textColor: 'rgba(255,255,255,1)'
            },
            Occlusion: {
                id: 'Occlusion',
                instructionalText: 'Label a <span class="underline">part of sidewalk that cannot be observed</span>',
                textColor: 'rgba(255,255,255,1)'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                instructionalText: 'Label <span class="underline">missing sidewalk</span>',
                textColor: 'rgba(255,255,255,1)'
            }
        }
    }

    /**
     * Todo. This should be moved to RibbonMenu.js
     * @returns {{Walk: {id: string, text: string, labelRibbonConnection: string}, CurbRamp: {id: string, labelRibbonConnection: string}, NoCurbRamp: {id: string, labelRibbonConnection: string}, Obstacle: {id: string, labelRibbonConnection: string}, SurfaceProblem: {id: string, labelRibbonConnection: string}, Other: {id: string, labelRibbonConnection: string}, Occlusion: {id: string, labelRibbonConnection: string}, NoSidewalk: {id: string, labelRibbonConnection: string}}}
     */
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
            Occlusion: {
                id: 'Occlusion',
                labelRibbonConnection: '396px'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                labelRibbonConnection: '396px'
            }
        }
    }

    function getLabelDescriptions (category) {
        var descriptions = {
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
                text: 'Obstacle in Path'
            },
            Other: {
                id: 'Other',
                text: 'Other'
            },
            Occlusion: {
                id: 'Occlusion',
                text: "Can't see the sidewalk"
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                text: 'No Sidewalk'
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
            }
        };
        return category ? descriptions[category] : descriptions;
    }

    /**
     * References: Ajax without jQuery.
     * http://stackoverflow.com/questions/8567114/how-to-make-an-ajax-call-without-jquery
     * http://stackoverflow.com/questions/6418220/javascript-send-json-object-with-ajax
     * @param streetEdgeId
     */
    function reportNoStreetView (streetEdgeId) {
        var x = new XMLHttpRequest(), async = true, url = "/audit/nostreetview";
        x.open('POST', url, async);
        x.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        x.send(JSON.stringify({issue: "NoStreetView", street_edge_id: streetEdgeId}));
    }

    self.imageCoordinateToCanvasCoordinate = imageCoordinateToCanvasCoordinate;
    self.canvasCoordinateToImageCoordinate = canvasCoordinateToImageCoordinate;
    self.getHeadingEstimate = getHeadingEstimate;
    self.getLabelCursorImagePath = getLabelCursorImagePath;
    self.getIconImagePaths = getIconImagePaths;
    self.getLabelInstructions = getLabelInstructions;
    self.getRibbonConnectionPositions = getRibbonConnectionPositions;
    self.getLabelDescriptions = getLabelDescriptions;
    self.getLabelColors = ColorScheme.SidewalkColorScheme2;
    self.reportNoStreetView = reportNoStreetView;

    return self;
}

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
            Occlusion: {
                id: 'Occlusion',
                fillStyle: 'rgba(179, 179, 179, 1)'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                fillStyle: 'rgba(179, 179, 179, 1)'
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

    function SidewalkColorScheme3 (category) {
        var colors = {
            Walk : {
                id : 'Walk',
                fillStyle : 'rgba(0, 0, 0, 1)'
            },
            CurbRamp: {
                id: 'CurbRamp',
                fillStyle: 'rgba(79, 180, 105, 1)'  // 'rgba(0, 244, 38, 1)'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                fillStyle: 'rgba(210, 48, 30, 1)'  // 'rgba(255, 39, 113, 1)'
            },
            Obstacle: {
                id: 'Obstacle',
                fillStyle: 'rgba(29, 150 , 240, 1)'
            },
            Other: {
                id: 'Other',
                fillStyle: 'rgba(180, 150, 200, 1)' //'rgba(204, 204, 204, 1)'
            },
            Occlusion: {
                id: 'Occlusion',
                fillStyle: 'rgba(179, 179, 179, 1)'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                fillStyle: 'rgba(179, 179, 179, 1)'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                fillStyle: 'rgba(240, 200, 30, 1)'
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

svl.misc = UtilitiesMisc(JSON);
