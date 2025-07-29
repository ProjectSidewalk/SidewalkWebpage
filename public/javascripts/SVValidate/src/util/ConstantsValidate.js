function defineValidateConstants() {
    svv.labelTypes = {
        1: 'CurbRamp',
        2: 'NoCurbRamp',
        3: 'Obstacle',
        4: 'SurfaceProblem',
        7: 'NoSidewalk',
        9: 'Crosswalk',
        10: 'Signal'
    };

    svv.labelTypeNames = {
        1: i18next.t('common:curb-ramp'),
        2: i18next.t('common:no-curb-ramp'),
        3: i18next.t('common:obstacle'),
        4: i18next.t('common:surface-problem'),
        7: i18next.t('common:no-sidewalk'),
        9: i18next.t('common:crosswalk'),
        10: i18next.t('common:signal')
    };

    svv.validationOptions = {
        1: 'Agree',
        2: 'Disagree',
        3: 'Unsure'
    };

    if (svv.expertValidate) {
        svv.reasonButtonInfo = {
            'curb-ramp': {
                'no-button-1': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.curb-ramp.no-button-1'),
                    'tooltipText': i18next.t('common:mission-start-tutorial.curb-ramp.slide-2.description'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ValidationCounterexamples/CurbRampCounterExample3.png'
                },
                'no-button-2': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.curb-ramp.no-button-2'),
                    'tooltipText': i18next.t('validate:right-ui.incorrect.curb-ramp.example-1-2'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ValidationCounterexamples/CurbRampCounterExample2.png'
                },
                'no-button-3': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.curb-ramp.no-button-3'),
                    'tooltipText': i18next.t('validate:right-ui.disagree-reason.curb-ramp.no-button-3-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/CurbRampDisagree3.png'
                },
                'unsure-button-1': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.common.reason-1'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.common.reason-1-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/CommonUnsure1.png'
                },
                'unsure-button-2': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.common.reason-2'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.common.reason-2-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/CommonUnsure2.png'
                }
            },
            'no-curb-ramp': {
                'no-button-1': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.no-curb-ramp.no-button-1'),
                    'tooltipText': i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-2.description'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ValidationCounterexamples/NoCurbRampCounterExample1.png'
                },
                'no-button-2': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.no-curb-ramp.no-button-2'),
                    'tooltipText': i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-4.description'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/NoCurbRampDisagree2.png'
                },
                'no-button-3': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.no-curb-ramp.no-button-3'),
                    'tooltipText': i18next.t('validate:right-ui.disagree-reason.no-curb-ramp.no-button-3-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/NoCurbRampDisagree3.png'
                },
                'unsure-button-1': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.common.reason-1'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.common.reason-1-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/CommonUnsure1.png'
                },
                'unsure-button-2': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.common.reason-2'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.common.reason-2-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/CommonUnsure2.png'
                },
                'unsure-button-3': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.no-curb-ramp.unsure-button-3'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.no-curb-ramp.unsure-button-3-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/NoCurbRampUnsure3.png'
                }
            },
            'obstacle': {
                'no-button-1': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.obstacle.no-button-1'),
                    'tooltipText': i18next.t('validate:right-ui.disagree-reason.obstacle.no-button-1-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/ObstacleDisagree1.png'
                },
                'no-button-2': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.obstacle.no-button-2'),
                    'tooltipText': i18next.t('validate:right-ui.disagree-reason.obstacle.no-button-2-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/ObstacleDisagree2.png'
                },
                'no-button-3': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.obstacle.no-button-3'),
                    'tooltipText': i18next.t('validate:right-ui.disagree-reason.obstacle.no-button-3-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/ObstacleDisagree3.png'
                },
                'unsure-button-1': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.common.reason-1'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.common.reason-1-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/CommonUnsure1.png'
                },
                'unsure-button-2': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.common.reason-2'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.common.reason-2-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/CommonUnsure2.png'
                },
                'unsure-button-3': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.obstacle.unsure-button-3'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.obstacle.unsure-button-3-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/ObstacleUnsure3.png'
                }
            },
            'surface-problem': {
                'no-button-1': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.surface-problem.no-button-1'),
                    'tooltipText': i18next.t('validate:right-ui.disagree-reason.surface-problem.no-button-1-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/SurfaceProblemDisagree1.png'
                },
                'no-button-2': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.surface-problem.no-button-2'),
                    'tooltipText': i18next.t('validate:right-ui.disagree-reason.surface-problem.no-button-2-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ValidationCounterexamples/SurfaceProblemCounterExample3.png'
                },
                'no-button-3': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.surface-problem.no-button-3'),
                    'tooltipText': i18next.t('common:mission-start-tutorial.surface-problem.slide-2.description'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ValidationCounterexamples/SurfaceProblemCounterExample4.png'
                },
                'unsure-button-1': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.common.reason-1'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.common.reason-1-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/CommonUnsure1.png'
                },
                'unsure-button-2': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.common.reason-2'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.common.reason-2-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/CommonUnsure2.png'
                },
                'unsure-button-3': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.surface-problem.unsure-button-3'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.surface-problem.unsure-button-3-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/SurfaceProblemUnsure3.png'
                }
            },
            'no-sidewalk': {
                'no-button-1': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.no-sidewalk.no-button-1'),
                    'tooltipText': i18next.t('common:mission-start-tutorial.no-sidewalk.slide-3.description'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ValidationCounterexamples/NoSidewalkCounterExample1.png'
                },
                'no-button-2': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.no-sidewalk.no-button-2'),
                    'tooltipText': i18next.t('common:mission-start-tutorial.no-sidewalk.slide-2.description'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ValidationCounterexamples/NoSidewalkCounterExample3.png'
                },
                'no-button-3': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.no-sidewalk.no-button-3'),
                    'tooltipText': i18next.t('validate:right-ui.disagree-reason.no-sidewalk.no-button-3-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/NoSidewalkDisagree3.png'
                },
                'unsure-button-1': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.common.reason-1'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.common.reason-1-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/CommonUnsure1.png'
                },
                'unsure-button-2': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.common.reason-2'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.common.reason-2-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/CommonUnsure2.png'
                },
                'unsure-button-3': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.no-sidewalk.unsure-button-3'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.no-sidewalk.unsure-button-3-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/NoSidewalkUnsure3.png'
                }
            },
            'crosswalk': {
                'no-button-1': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.crosswalk.no-button-1'),
                    'tooltipText': i18next.t('common:mission-start-tutorial.crosswalk.slide-2.description'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ValidationCounterexamples/CrosswalkCounterExample1.png'
                },
                'no-button-2': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.crosswalk.no-button-2'),
                    'tooltipText': i18next.t('common:mission-start-tutorial.crosswalk.slide-3.description'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ValidationCounterexamples/CrosswalkCounterExample2.png'
                },
                'no-button-3': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.crosswalk.no-button-3'),
                    'tooltipText': i18next.t('common:mission-start-tutorial.crosswalk.slide-4.description'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ValidationCounterexamples/CrosswalkCounterExample3.png'
                },
                'unsure-button-1': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.common.reason-1'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.common.reason-1-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/CommonUnsure1.png'
                },
                'unsure-button-2': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.common.reason-2'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.common.reason-2-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/CommonUnsure2.png'
                }
            },
            'signal': {
                'no-button-1': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.signal.no-button-1'),
                    'tooltipText': i18next.t('common:mission-start-tutorial.signal.slide-4.description'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ValidationCounterexamples/SignalCounterExample3.png'
                },
                'no-button-2': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.signal.no-button-2'),
                    'tooltipText': i18next.t('common:mission-start-tutorial.signal.slide-2.description'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ValidationCounterexamples/SignalCounterExample1.png'
                },
                'no-button-3': {
                    'buttonText': i18next.t('validate:right-ui.disagree-reason.signal.no-button-3'),
                    'tooltipText': i18next.t('common:mission-start-tutorial.signal.slide-3.description'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ValidationCounterexamples/SignalCounterExample2.png'
                },
                'unsure-button-1': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.common.reason-1'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.common.reason-1-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/CommonUnsure1.png'
                },
                'unsure-button-2': {
                    'buttonText': i18next.t('validate:right-ui.unsure-reason.common.reason-2'),
                    'tooltipText': i18next.t('validate:right-ui.unsure-reason.common.reason-2-tooltip'),
                    'tooltipImage': '/assets/javascripts/SVValidate/img/ExpertValidateTooltips/CommonUnsure2.png'
                }
            }
        }
        // Append button numbers to tooltipText.
        for (const labelType in svv.reasonButtonInfo) {
            for (const buttonId in svv.reasonButtonInfo[labelType]) {
                const buttonInfo = svv.reasonButtonInfo[labelType][buttonId];
                // Extract the number from the button ID (e.g., "no-button-1" -> "1").
                const buttonNumber = buttonId.split('-').pop();
                buttonInfo.tooltipText += ` (${buttonNumber})`;
            }
        }
    }
}
