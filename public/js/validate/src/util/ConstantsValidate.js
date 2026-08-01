function defineValidateConstants() {
  svv.labelTypes = {
    1: 'CurbRamp',
    2: 'NoCurbRamp',
    3: 'Obstacle',
    4: 'SurfaceProblem',
    7: 'NoSidewalk',
    9: 'Crosswalk',
    10: 'Signal',
  };

  svv.labelTypeNames = {
    1: i18next.t('common:curb-ramp'),
    2: i18next.t('common:no-curb-ramp'),
    3: i18next.t('common:obstacle'),
    4: i18next.t('common:surface-problem'),
    7: i18next.t('common:no-sidewalk'),
    9: i18next.t('common:crosswalk'),
    10: i18next.t('common:signal'),
  };

  svv.reasonButtonInfo = {
    'curb-ramp': {
      'no-button-1': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.curb-ramp.no-button-1'),
        tooltipText: i18next.t('common:mission-start-tutorial.curb-ramp.slide-2.description'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 1, 'CurbRamp'),
      },
      'no-button-2': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.curb-ramp.no-button-2'),
        tooltipText: i18next.t('validate:validate-menu.disagree-reason.curb-ramp.no-button-2-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 2, 'CurbRamp'),
      },
      'no-button-3': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.curb-ramp.no-button-3'),
        tooltipText: i18next.t('validate:validate-menu.disagree-reason.curb-ramp.no-button-3-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 3, 'CurbRamp'),
      },
      'unsure-button-1': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.common.reason-1'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.common.reason-1-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 1, null),
      },
      'unsure-button-2': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.common.reason-2'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.common.reason-2-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 2, null),
      },
      'unsure-button-3': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.no-curb-ramp.unsure-button-3'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.curb-ramp.unsure-button-3-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 3, 'CurbRamp'),
      },
    },
    'no-curb-ramp': {
      'no-button-1': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.no-curb-ramp.no-button-1'),
        tooltipText: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-2.description'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 1, 'NoCurbRamp'),
      },
      'no-button-2': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.no-curb-ramp.no-button-2'),
        tooltipText: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-4.description'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 2, 'NoCurbRamp'),
      },
      'no-button-3': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.no-curb-ramp.no-button-3'),
        tooltipText: i18next.t('validate:validate-menu.disagree-reason.no-curb-ramp.no-button-3-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 3, 'NoCurbRamp'),
      },
      'unsure-button-1': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.common.reason-1'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.common.reason-1-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 1, null),
      },
      'unsure-button-2': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.common.reason-2'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.common.reason-2-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 2, null),
      },
      'unsure-button-3': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.no-curb-ramp.unsure-button-3'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.no-curb-ramp.unsure-button-3-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 3, 'NoCurbRamp'),
      },
    },
    'obstacle': {
      'no-button-1': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.obstacle.no-button-1'),
        tooltipText: i18next.t('validate:validate-menu.disagree-reason.obstacle.no-button-1-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 1, 'Obstacle'),
      },
      'no-button-2': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.obstacle.no-button-2'),
        tooltipText: i18next.t('validate:validate-menu.disagree-reason.obstacle.no-button-2-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 2, 'Obstacle'),
      },
      'no-button-3': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.obstacle.no-button-3'),
        tooltipText: i18next.t('validate:validate-menu.disagree-reason.obstacle.no-button-3-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 3, 'Obstacle'),
      },
      'unsure-button-1': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.common.reason-1'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.common.reason-1-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 1, null),
      },
      'unsure-button-2': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.common.reason-2'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.common.reason-2-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 2, null),
      },
      'unsure-button-3': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.obstacle.unsure-button-3'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.obstacle.unsure-button-3-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 3, 'Obstacle'),
      },
    },
    'surface-problem': {
      'no-button-1': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.surface-problem.no-button-1'),
        tooltipText: i18next.t('validate:validate-menu.disagree-reason.surface-problem.no-button-1-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 1, 'SurfaceProblem'),
      },
      'no-button-2': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.surface-problem.no-button-2'),
        tooltipText: i18next.t('validate:validate-menu.disagree-reason.surface-problem.no-button-2-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 2, 'SurfaceProblem'),
      },
      'no-button-3': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.surface-problem.no-button-3'),
        tooltipText: i18next.t('common:mission-start-tutorial.surface-problem.slide-2.description'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 3, 'SurfaceProblem'),
      },
      'unsure-button-1': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.common.reason-1'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.common.reason-1-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 1, null),
      },
      'unsure-button-2': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.common.reason-2'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.common.reason-2-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 2, null),
      },
      'unsure-button-3': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.surface-problem.unsure-button-3'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.surface-problem.unsure-button-3-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 3, 'SurfaceProblem'),
      },
    },
    'no-sidewalk': {
      'no-button-1': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.no-sidewalk.no-button-1'),
        tooltipText: i18next.t('common:mission-start-tutorial.no-sidewalk.slide-3.description'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 1, 'NoSidewalk'),
      },
      'no-button-2': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.no-sidewalk.no-button-2'),
        tooltipText: i18next.t('common:mission-start-tutorial.no-sidewalk.slide-2.description'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 2, 'NoSidewalk'),
      },
      'no-button-3': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.no-sidewalk.no-button-3'),
        tooltipText: i18next.t('validate:validate-menu.disagree-reason.no-sidewalk.no-button-3-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 3, 'NoSidewalk'),
      },
      'unsure-button-1': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.common.reason-1'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.common.reason-1-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 1, null),
      },
      'unsure-button-2': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.common.reason-2'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.common.reason-2-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 2, null),
      },
      'unsure-button-3': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.no-sidewalk.unsure-button-3'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.no-sidewalk.unsure-button-3-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 3, 'NoSidewalk'),
      },
    },
    'crosswalk': {
      'no-button-1': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.crosswalk.no-button-1'),
        tooltipText: i18next.t('common:mission-start-tutorial.crosswalk.slide-2.description'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 1, 'Crosswalk'),
      },
      'no-button-2': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.crosswalk.no-button-2'),
        tooltipText: i18next.t('common:mission-start-tutorial.crosswalk.slide-3.description'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 2, 'Crosswalk'),
      },
      'no-button-3': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.crosswalk.no-button-3'),
        tooltipText: i18next.t('common:mission-start-tutorial.crosswalk.slide-4.description'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 3, 'Crosswalk'),
      },
      'unsure-button-1': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.common.reason-1'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.common.reason-1-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 1, null),
      },
      'unsure-button-2': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.common.reason-2'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.common.reason-2-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 2, null),
      },
    },
    'signal': {
      'no-button-1': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.signal.no-button-1'),
        tooltipText: i18next.t('common:mission-start-tutorial.signal.slide-4.description'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 1, 'Signal'),
      },
      'no-button-2': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.signal.no-button-2'),
        tooltipText: i18next.t('common:mission-start-tutorial.signal.slide-2.description'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 2, 'Signal'),
      },
      'no-button-3': {
        buttonText: i18next.t('validate:validate-menu.disagree-reason.signal.no-button-3'),
        tooltipText: i18next.t('common:mission-start-tutorial.signal.slide-3.description'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('disagree', 3, 'Signal'),
      },
      'unsure-button-1': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.common.reason-1'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.common.reason-1-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 1, null),
      },
      'unsure-button-2': {
        buttonText: i18next.t('validate:validate-menu.unsure-reason.common.reason-2'),
        tooltipText: i18next.t('validate:validate-menu.unsure-reason.common.reason-2-tooltip'),
        tooltipImage: util.misc.getValidateReasonExampleImageUrl('unsure', 2, null),
      },
    },
  };
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
