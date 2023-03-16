var util = util || {};
util.misc = util.misc || {};

function UtilitiesMisc (JSON) {
    var self = { className: "UtilitiesMisc" };

    // Returns image paths corresponding to each label type.
    function getIconImagePaths(category) {
        var imagePaths = {
            Walk : {
                id : 'Walk',
                iconImagePath : null,
                minimapIconImagePath: null
            },
            CurbRamp: {
                id: 'CurbRamp',
                iconImagePath : svl.rootDirectory + 'img/icons/CurbRamp_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/CurbRamp_tiny.png'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                iconImagePath : svl.rootDirectory + 'img/icons/NoCurbRamp_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/NoCurbRamp_tiny.png'
            },
            Obstacle: {
                id: 'Obstacle',
                iconImagePath: svl.rootDirectory + 'img/icons/Obstacle_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/Obstacle_tiny.png'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                iconImagePath: svl.rootDirectory + 'img/icons/SurfaceProblem_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/SurfaceProblem_tiny.png'
            },
            Other: {
                id: 'Other',
                iconImagePath: svl.rootDirectory + 'img/icons/Other_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/Other_tiny.png'
            },
            Occlusion: {
                id: 'Occlusion',
                iconImagePath: svl.rootDirectory + 'img/icons/Occlusion_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/Occlusion_tiny.png'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                iconImagePath: svl.rootDirectory + 'img/icons/NoSidewalk_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/NoSidewalk_tiny.png'
            },
            Crosswalk: {
                id: 'Crosswalk',
                iconImagePath: svl.rootDirectory + 'img/icons/Crosswalk_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/Crosswalk_tiny.png'
            },
            Signal: {
                id: 'Signal',
                iconImagePath: svl.rootDirectory + 'img/icons/Signal_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/Signal_tiny.png'
            }
        };

        return category ? imagePaths[category] : imagePaths;
    }

    // TODO either explain why the translations aren't found programmatically, or make it programmatic.
    function getLabelDescriptions(category) {
        var descriptions = {
            'Walk': {
                'id': 'Walk',
                keyChar: 'E'
            },
            CurbRamp: {
                id: 'CurbRamp',
                keyChar: 'C',
                tagInfo: {
                    'narrow': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.narrow')
                    },
                    'points into traffic': {
                        keyChar: 'I',
                        text: i18next.t('center-ui.context-menu.tag.points-into-traffic')
                    },
                    'missing tactile warning': {
                        keyChar: 'E',
                        text: i18next.t('center-ui.context-menu.tag.missing-tactile-warning')
                    },
                    'tactile warning': {
                        keyChar: 'H',
                        text: i18next.t('center-ui.context-menu.tag.tactile-warning')
                    },
                    'steep': {
                        keyChar: 'T',
                        text: i18next.t('center-ui.context-menu.tag.steep')
                    },
                    'not enough landing space': {
                        keyChar: 'L',
                        text: i18next.t('center-ui.context-menu.tag.not-enough-landing-space')
                    },
                    'not level with street': {
                        keyChar: 'V',
                        text: i18next.t('center-ui.context-menu.tag.not-level-with-street')
                    },
                    'surface problem': {
                        keyChar: 'R',
                        text: i18next.t('center-ui.context-menu.tag.surface-problem')
                    },
                    'pooled water': {
                        keyChar: 'D',
                        text: i18next.t('center-ui.context-menu.tag.pooled-water')
                    }
                }
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                keyChar: 'M',
                tagInfo: {
                    'alternate route present': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.alternate-route-present')
                    },
                    'no alternate route': {
                        keyChar: 'L',
                        text: i18next.t('center-ui.context-menu.tag.no-alternate-route')
                    },
                    'unclear if needed': {
                        keyChar: 'U',
                        text: i18next.t('center-ui.context-menu.tag.unclear-if-needed')
                    }
                }
            },
            Obstacle: {
                id: 'Obstacle',
                keyChar: 'O',
                tagInfo: {
                    'trash/recycling can': {
                        keyChar: 'H',
                        text: i18next.t('center-ui.context-menu.tag.trash-recycling-can')
                    },
                    'fire hydrant': {
                        keyChar: 'F',
                        text: i18next.t('center-ui.context-menu.tag.fire-hydrant')
                    },
                    'pole': {
                        keyChar: 'L',
                        text: i18next.t('center-ui.context-menu.tag.pole')
                    },
                    'tree': {
                        keyChar: 'E',
                        text: i18next.t('center-ui.context-menu.tag.tree')
                    },
                    'vegetation': {
                        keyChar: 'V',
                        text: i18next.t('center-ui.context-menu.tag.vegetation')
                    },
                    'parked car': {
                        keyChar: 'U',
                        text: i18next.t('center-ui.context-menu.tag.parked-car')
                    },
                    'parked bike': {
                        keyChar: 'K',
                        text: i18next.t('center-ui.context-menu.tag.parked-bike')
                    },
                    'construction': {
                        keyChar: 'T',
                        text: i18next.t('center-ui.context-menu.tag.construction')
                    },
                    'sign': {
                        keyChar: 'I',
                        text: i18next.t('center-ui.context-menu.tag.sign')
                    },
                    'garage entrance': {
                        keyChar: 'G',
                        text: i18next.t('center-ui.context-menu.tag.garage-entrance')
                    },
                    'stairs': {
                        keyChar: 'R',
                        text: i18next.t('center-ui.context-menu.tag.stairs')
                    },
                    'street vendor': {
                        keyChar: 'J',
                        text: i18next.t('center-ui.context-menu.tag.street-vendor')
                    },
                    'height difference': {
                        keyChar: 'D',
                        text: i18next.t('center-ui.context-menu.tag.height-difference')
                    },
                    'narrow': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.narrow')
                    },
                    'litter/garbage': {
                        keyChar: 'X',
                        text: i18next.t('center-ui.context-menu.tag.litter-garbage')
                    },
                    'parked scooter/motorcycle': {
                        keyChar: 'Y',
                        text: i18next.t('center-ui.context-menu.tag.parked-scooter-motorcycle')
                    }
                }
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                keyChar: 'S',
                tagInfo: {
                    'bumpy': {
                        keyChar: 'Y',
                        text: i18next.t('center-ui.context-menu.tag.bumpy')
                    },
                    'uneven/slanted': {
                        keyChar: 'U',
                        text: i18next.t('center-ui.context-menu.tag.uneven-slanted')
                    },
                    'cracks': {
                        keyChar: 'K',
                        text: i18next.t('center-ui.context-menu.tag.cracks')
                    },
                    'grass': {
                        keyChar: 'G',
                        text: i18next.t('center-ui.context-menu.tag.grass')
                    },
                    'narrow sidewalk': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.narrow')
                    },
                    'brick/cobblestone': {
                        keyChar: 'I',
                        text: i18next.t('center-ui.context-menu.tag.brick-cobblestone')
                    },
                    'construction': {
                        keyChar: 'T',
                        text: i18next.t('center-ui.context-menu.tag.construction')
                    },
                    'very broken': {
                        keyChar: 'R',
                        text: i18next.t('center-ui.context-menu.tag.very-broken')
                    },
                    'height difference': {
                        keyChar: 'D',
                        text: i18next.t('center-ui.context-menu.tag.height-difference')
                    },
                    'rail/tram track': {
                        keyChar: 'L',
                        text: i18next.t('center-ui.context-menu.tag.rail-tram-track')
                    },
                    'sand/gravel': {
                        keyChar: 'V',
                        text: i18next.t('center-ui.context-menu.tag.sand-gravel')
                    },
                    'uncovered manhole': {
                        keyChar: 'E',
                        text: i18next.t('center-ui.context-menu.tag.uncovered-manhole')
                    }
                }
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                keyChar: 'N',
                tagInfo: {
                    'ends abruptly': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.ends-abruptly')
                    },
                    'street has a sidewalk': {
                        keyChar: 'R',
                        text: i18next.t('center-ui.context-menu.tag.street-has-a-sidewalk')
                    },
                    'street has no sidewalks': {
                        keyChar: 'T',
                        text: i18next.t('center-ui.context-menu.tag.street-has-no-sidewalks')
                    },
                    'gravel/dirt road': {
                        keyChar: 'D',
                        text: i18next.t('center-ui.context-menu.tag.gravel-dirt-road')
                    },
                    'shared pedestrian/car space': {
                        keyChar: 'E',
                        text: i18next.t('center-ui.context-menu.tag.shared-pedestrian-car-space')
                    }
                }
            },
            Crosswalk: {
                id: 'Crosswalk',
                keyChar: 'W',
                tagInfo: {
                    'paint fading': {
                        keyChar: 'F',
                        text: i18next.t('center-ui.context-menu.tag.paint-fading')
                    },
                    'broken surface': {
                        keyChar: 'R',
                        text: i18next.t('center-ui.context-menu.tag.broken-surface')
                    },
                    'uneven surface': {
                        keyChar: 'E',
                        text: i18next.t('center-ui.context-menu.tag.uneven-surface')
                    },
                    'brick/cobblestone': {
                        keyChar: 'I',
                        text: i18next.t('center-ui.context-menu.tag.brick-cobblestone')
                    },
                    'bumpy': {
                        keyChar: 'Y',
                        text: i18next.t('center-ui.context-menu.tag.bumpy')
                    },
                    'rail/tram track': {
                        keyChar: 'L',
                        text: i18next.t('center-ui.context-menu.tag.rail-tram-track')
                    },
                    'no pedestrian priority': {
                        keyChar: 'V',
                        text: i18next.t('center-ui.context-menu.tag.no-pedestrian-priority')
                    },
                    'very long crossing': {
                        keyChar: 'U',
                        text: i18next.t('center-ui.context-menu.tag.very-long-crossing')
                    },
                    'level with sidewalk': {
                        keyChar: 'D',
                        text: i18next.t('center-ui.context-menu.tag.level-with-sidewalk')
                    }
                }
            },
            Signal: {
                id: 'Signal',
                keyChar: 'P',
                tagInfo: {
                    'has button': {
                        keyChar: 'U',
                        text: i18next.t('center-ui.context-menu.tag.has-button')
                    },
                    'button waist height': {
                        keyChar: 'H',
                        text: i18next.t('center-ui.context-menu.tag.button-waist-height')
                    },
                    'APS': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.APS')
                    }
                }
            },
            Other: {
                id: 'Other',
                tagInfo: {
                    'missing crosswalk': {
                        keyChar: 'I',
                        text: i18next.t('center-ui.context-menu.tag.missing-crosswalk')
                    },
                    'no bus stop access': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.no-bus-stop-access')
                    }
                }
            },
            Occlusion: {
                id: 'Occlusion',
                keyChar: 'B'
            }
        };
        return category ? descriptions[category] : descriptions;
    }

    /**
     * Gets the severity message and severity image location that is displayed on a label tag.
     * @returns {{1: {message: string, severityImage: string}, 2: {message: string, severityImage: string},
     *              3: {message: string, severityImage: string}, 4: {message: string, severityImage: string},
     *              5: {message: string, severityImage: string}}}
     */
    function getSeverityDescription() {
        return {
            1: {
                message: i18next.t('center-ui.context-menu.tooltip.passable'),
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_1_White_Small.png'
            },

            2: {
                message: i18next.t('center-ui.context-menu.tooltip.somewhat-passable'),
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_2_White_Small.png'
            },

            3: {
                message: i18next.t('center-ui.context-menu.tooltip.difficult-to-pass'),
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_3_White_Small.png'
            },

            4: {
                message: i18next.t('center-ui.context-menu.tooltip.very-difficult-to-pass'),
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_4_White_Small.png'
            },

            5: {
                message: i18next.t('center-ui.context-menu.tooltip.not-passable'),
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
    function reportNoStreetView(streetEdgeId) {
        var x = new XMLHttpRequest(), async = true, url = "/audit/nostreetview";
        x.open('POST', url, async);
        x.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        x.send(streetEdgeId);
    }

    const colors = {
        Walk : {
            id : 'Walk',
            fillStyle : 'rgba(0, 0, 0, 1)',
            strokeStyle: '#FFFFFF'
        },
        CurbRamp: {
            id: 'CurbRamp',
            fillStyle: '#90C31F',
            strokeStyle: '#FFFFFF'
        },
        NoCurbRamp: {
            id: 'NoCurbRamp',
            fillStyle: '#E679B6',
            strokeStyle: '#FFFFFF'
        },
        Obstacle: {
            id: 'Obstacle',
            fillStyle: '#78B0EA',
            strokeStyle: '#FFFFFF'
        },
        Other: {
            id: 'Other',
            fillStyle: '#B3B3B3',
            strokeStyle: '#0000FF'
        },
        Occlusion: {
            id: 'Occlusion',
            fillStyle: '#B3B3B3',
            strokeStyle: '#009902'
        },
        NoSidewalk: {
            id: 'NoSidewalk',
            fillStyle: '#BE87D8',
            strokeStyle: '#FFFFFF'
        },
        SurfaceProblem: {
            id: 'SurfaceProblem',
            fillStyle: '#F68D3E',
            strokeStyle: '#FFFFFF'
        },
        Crosswalk: {
            id: 'Crosswalk',
            fillStyle: '#FABF1C',
            strokeStyle: '#FFFFFF'
        },
        Signal: {
            id: 'Signal',
            fillStyle: '#63C0AB',
            strokeStyle: '#FFFFFF'
        }
    };
    function getLabelColors(category) {
        return category ? colors[category].fillStyle : colors;
    }

    self.getIconImagePaths = getIconImagePaths;
    self.getLabelDescriptions = getLabelDescriptions;
    self.getSeverityDescription = getSeverityDescription;
    self.getLabelColors = getLabelColors;
    self.reportNoStreetView = reportNoStreetView;

    return self;
}

util.misc = UtilitiesMisc(JSON);
