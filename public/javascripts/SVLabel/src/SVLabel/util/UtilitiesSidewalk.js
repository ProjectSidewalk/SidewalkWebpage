var util = util || {};
util.misc = util.misc || {};

function UtilitiesMisc (JSON) {
    var self = { className: "UtilitiesMisc" };

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
                cursorImagePath: svl.rootDirectory + 'img/cursors/Cursor_NoSidewalk.png'
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
                iconImagePath: svl.rootDirectory + 'img/icons/Sidewalk/Icon_NoSidewalk.png',
                googleMapsIconImagePath: svl.rootDirectory + '/img/icons/Sidewalk/GMapsStamp_NoSidewalk.png'
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
                'instructionalText' : i18next.t('instruction-text'),
                'textColor' : 'rgba(255,255,255,1)'
            },
            CurbRamp: {
                id: 'CurbRamp',
                instructionalText: 'Locate and label a <span class="underline overlay-message-label-type" val="CurbRamp">curb ramp</span>',
                textColor: 'rgba(255,255,255,1)'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                instructionalText: 'Locate and label a <span class="underline overlay-message-label-type" val="NoCurbRamp">missing curb ramp</span>',
                textColor: 'rgba(255,255,255,1)'
            },
            Obstacle: {
                id: 'Obstacle',
                instructionalText: 'Locate and label an <span class="underline overlay-message-label-type" val="Obstacle">obstacle in path</span>',
                textColor: 'rgba(255,255,255,1)'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                instructionalText: 'Locate and label a <span class="underline overlay-message-label-type" val="SurfaceProblem">surface problem</span>',
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

    function getLabelDescriptions(category) {
        var descriptions = {
            'Walk': {
                'id': 'Walk',
                'text': 'Walk',
                shortcut: {
                    keyNumber: 69,
                    keyChar: 'E'
                }
            },
            CurbRamp: {
                id: 'CurbRamp',
                text: 'Curb Ramp',
                shortcut: {
                    keyNumber: 67,
                    keyChar: 'C'
                },
                tagInfo: {
                    'narrow': {
                        keyNumber: 65,
                        keyChar: 'A',
                        text: 'n<tag-underline>a</tag-underline>rrow',
                        id: 'narrow'
                    },
                    'points into traffic': {
                        keyNumber: 80,
                        keyChar: 'P',
                        text: '<tag-underline>p</tag-underline>oints into traffic',
                        id: 'pointIntoTraffic'
                    },
                    'missing friction strip': {
                        keyNumber: 70,
                        keyChar: 'F',
                        text: 'missing <tag-underline>f</tag-underline>riction strip',
                        id: 'missingFrictionStrip'
                    },
                    'steep': {
                        keyNumber: 84,
                        keyChar: 'T',
                        text: 's<tag-underline>t</tag-underline>eep',
                        id: 'steep'
                    },
                    'not enough landing space': {
                        keyNumber: 76,
                        keyChar: 'L',
                        text: 'not enough <tag-underline>l</tag-underline>anding space',
                        id: 'notEnoughLandingSpace'
                    }
                }
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                text: 'Missing Curb Ramp',
                shortcut: {
                    keyNumber: 77,
                    keyChar: 'M'
                },
                tagInfo: {
                    'alternate route present': {
                        keyNumber: 65,
                        keyChar: 'A',
                        text: '<tag-underline>a</tag-underline>lternate route present',
                        id: 'alternateRoutePresent'
                    },
                    'no alternate route': {
                        keyNumber: 76,
                        keyChar: 'L',
                        text: 'no a<tag-underline>l</tag-underline>ternate route',
                        id: 'noAlternateRoute'
                    },
                    'unclear if needed': {
                        keyNumber: 85,
                        keyChar: 'U',
                        text: '<tag-underline>u</tag-underline>nclear if needed',
                        id: 'unclearIfNeeded'
                    }
                }
            },
            Obstacle: {
                id: 'Obstacle',
                text: 'Obstacle in Path',
                shortcut: {
                    keyNumber: 79,
                    keyChar: 'O'
                },
                tagInfo: {
                    'trash/recycling can': {
                        keyNumber: 82,
                        keyChar: 'R',
                        text: 't<tag-underline>r</tag-underline>ash/recycling can',
                        id: 'trashCan'
                    },
                    'fire hydrant': {
                        keyNumber: 70,
                        keyChar: 'F',
                        text: '<tag-underline>f</tag-underline>ire hydrant',
                        id: 'fireHydrant'
                    },
                    'pole': {
                        keyNumber: 80,
                        keyChar: 'P',
                        text: '<tag-underline>p</tag-underline>ole',
                        id: 'pole'
                    },
                    'tree': {
                        keyNumber: 84,
                        keyChar: 'T',
                        text: '<tag-underline>t</tag-underline>ree',
                        id: 'tree'
                    },
                    'vegetation': {
                        keyNumber: 86,
                        keyChar: 'V',
                        text: '<tag-underline>v</tag-underline>egetation',
                        id: 'vegetation'
                    },
                    'parked car': {
                        keyNumber: 65,
                        keyChar: 'A',
                        text: 'p<tag-underline>a</tag-underline>rked car',
                        id: 'parkedCar'
                    },
                    'parked bike': {
                        keyNumber: 73,
                        keyChar: 'I',
                        text: 'parked b<tag-underline>i</tag-underline>ke',
                        id: 'parkedBike'
                    }
                }
            },
            Other: {
                id: 'Other',
                text: 'Other',
                tagInfo: {
                    'missing crosswalk': {
                        keyNumber: 73,
                        keyChar: 'I',
                        text: 'm<tag-underline>i</tag-underline>ssing crosswalk',
                        id: 'missingCrosswalk'
                    },
                    'no bus stop access': {
                        keyNumber: 65,
                        keyChar: 'A',
                        text: 'no bus stop <tag-underline>a</tag-underline>ccess',
                        id: 'noBusStopAccess'
                    }
                }
            },
            Occlusion: {
                id: 'Occlusion',
                text: "Can't see the sidewalk",
                shortcut: {
                    keyNumber: 66,
                    keyChar: 'B'
                }
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                text: 'No Sidewalk',
                shortcut: {
                    keyNumber: 78,
                    keyChar: 'N'
                },
                tagInfo: {
                    'ends abruptly': {
                        keyNumber: 65,
                        keyChar: 'A',
                        text: 'ends <tag-underline>a</tag-underline>bruptly',
                        id: 'endsAbruptly'
                    },
                    'street has a sidewalk': {
                        keyNumber: 82,
                        keyChar: 'R',
                        text: 'st<tag-underline>r</tag-underline>eet has a sidewalk',
                        id: 'streetHasASidewalk'
                    },
                    'street has no sidewalks': {
                        keyNumber: 84,
                        keyChar: 'T',
                        text: 's<tag-underline>t</tag-underline>reet has no sidewalks',
                        id: 'streetHasNoSidewalks'
                    }
                }
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                text: 'Surface Problem',
                shortcut: {
                    keyNumber: 83,
                    keyChar: 'S'
                },
                tagInfo: {
                    'bumpy': {
                        keyNumber: 80,
                        keyChar: 'P',
                        text: 'bum<tag-underline>p</tag-underline>y',
                        id: 'bumpy'
                    },
                    'uneven': {
                        keyNumber: 85,
                        keyChar: 'U',
                        text: '<tag-underline>u</tag-underline>neven',
                        id: 'uneven'
                    },
                    'cracks': {
                        keyNumber: 75,
                        keyChar: 'K',
                        text: 'crac<tag-underline>k</tag-underline>s',
                        id: 'cracks'
                    },
                    'grass': {
                        keyNumber: [71, 82],
                        keyChar: ['G', 'R'],
                        text: 'g<tag-underline>r</tag-underline>ass',
                        id: 'grass'
                    },
                    'narrow sidewalk': {
                        keyNumber: 65,
                        keyChar: 'A',
                        text: 'n<tag-underline>a</tag-underline>rrow sidewalk',
                        id: 'narrowSidewalk'
                    }
                }
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
     * Gets the severity message and severity image location that is displayed on a label tag
     * @returns {{1: {message: string, severityImage: string}, 2: {message: string, severityImage: string},
     *              3: {message: string, severityImage: string}, 4: {message: string, severityImage: string},
     *              5: {message: string, severityImage: string}}}
     */
    function getSeverityDescription() {
        return {
            1: {
                message: 'Passable',
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_1_White_Small.png'
            },

            2: {
                message: 'Somewhat Passable',
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_2_White_Small.png'
            },

            3: {
                message: 'Difficult to pass',
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_3_White_Small.png'
            },

            4: {
                message: 'Very difficult to pass',
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_4_White_Small.png'
            },

            5: {
                message: 'Not passable',
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_5_White_Small.png'
            }
        };
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

    self.getHeadingEstimate = getHeadingEstimate;
    self.getLabelCursorImagePath = getLabelCursorImagePath;
    self.getIconImagePaths = getIconImagePaths;
    self.getLabelInstructions = getLabelInstructions;
    self.getRibbonConnectionPositions = getRibbonConnectionPositions;
    self.getLabelDescriptions = getLabelDescriptions;
    self.getSeverityDescription = getSeverityDescription;
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
            NoSidewalk: {
                id: 'NoSidewalk',
                fillStyle: 'rgba(153, 131, 239, 0.9)'
            },
            Other: {
                id: 'Other',
                fillStyle: 'rgba(204, 204, 204, 0.9)',
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
                fillStyle : 'rgba(0, 0, 0, 1)',
                strokeStyle: '#ffffff'
            },
            CurbRamp: {
                id: 'CurbRamp',
                fillStyle: 'rgba(0, 222, 38, 1)',  // 'rgba(0, 244, 38, 1)'
                strokeStyle: '#ffffff'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                fillStyle: 'rgba(233, 39, 113, 1)',  // 'rgba(255, 39, 113, 1)'
                strokeStyle: '#ffffff'
            },
            Obstacle: {
                id: 'Obstacle',
                fillStyle: 'rgba(0, 161, 203, 1)',
                strokeStyle: '#ffffff'
            },
            Other: {
                id: 'Other',
                fillStyle: 'rgba(179, 179, 179, 1)', //'rgba(204, 204, 204, 1)'
                strokeStyle: '#0000ff'

            },
            Occlusion: {
                id: 'Occlusion',
                fillStyle: 'rgba(179, 179, 179, 1)',
                strokeStyle: '#009902'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                fillStyle: 'rgba(153, 131, 239, 1)',
                strokeStyle: '#ffffff'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                fillStyle: 'rgba(241, 141, 5, 1)',
                strokeStyle: '#ffffff'
            },
            Void: {
                id: 'Void',
                fillStyle: 'rgba(255, 255, 255, 1)',
                strokeStyle: '#ffffff'
            },
            Unclear: {
                id: 'Unclear',
                fillStyle: 'rgba(128, 128, 128, 0.5)',
                strokeStyle: '#ffffff'
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
                fillStyle: 'rgba(153, 131, 239, 1)'
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

    return {
        className: 'ColorScheme',
        SidewalkColorScheme: SidewalkColorScheme,
        SidewalkColorScheme2: SidewalkColorScheme2
    };
}());

util.misc = UtilitiesMisc(JSON);
