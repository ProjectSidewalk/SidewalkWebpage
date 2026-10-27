import i18next from 'i18next';
import { util } from '../../common/utilities.js';
import { validationReasons } from '../../common/validationReasons.js';

/**
 * One reason button's rendering: its text, a tooltip with an optional example image, and whether it is the "wrong
 * label type" reason that Expert Validate turns into a type pick.
 * @typedef {{reasonId: string, buttonText: string, tooltipText: string, tooltipImage?: string, wrongType?: boolean}}
 *     ReasonButton
 */

/**
 * Builds the disagree and unsure reasons each label type's menu offers, keyed by kebab-case type and then by the
 * reason button's id. Built on demand rather than at import, since the texts are translations and i18next is only
 * ready once the page's setup has run.
 * @returns {Record<string, Record<string, ReasonButton>>} The reasons, frozen.
 */
export function buildReasonButtonInfo() {
  const expert = (file) => util.assetPath(`images/validate/ExpertValidateTooltips/${file}`);
  const example = (file) => util.assetPath(`images/examples/${file}`);
  const mst = (type, slide) => `common:mission-start-tutorial.${type}.slide-${slide}.description`;
  /**
   * Validate's tooltip extras per reason, on top of the shared text: an example image, and for reasons whose
   * explanation is one of the mission-start tutorial's slides, that slide's text in place of the shared tooltip.
   * Keyed by label type (kebab-case) and reason id; `common` holds the per-reason defaults every type shares.
   * Presentation only: which reasons a type offers comes from the backend's catalog via validationReasons.
   *
   * @type {Record<string, Record<string, {image?: string, textKey?: string}>>}
   */
  const tooltipExtras = {
    'common': {
      'better-image': { image: expert('CommonUnsure1.png') },
      'placement-incorrect': { image: expert('CommonUnsure2.png') },
    },
    'curb-ramp': {
      'wrong-type': { image: expert('CurbRampDisagree3.png') },
      'driveway': { textKey: mst('curb-ramp', 2), image: example('CurbRampCounterExample3.png') },
      'driveway-transition': { image: example('CurbRampCounterExample2.png') },
      'ramp-required-unsure': { image: expert('CurbRampUnsure3.png') },
    },
    'no-curb-ramp': {
      'wrong-type': { image: expert('NoCurbRampDisagree3.png') },
      'residential-walkway': { textKey: mst('no-curb-ramp', 2), image: example('NoCurbRampCounterExample1.png') },
      'no-sidewalk-here': { textKey: mst('no-curb-ramp', 4), image: expert('NoCurbRampDisagree2.png') },
      'unsafe-crossing': { image: expert('NoCurbRampDisagree4.png') },
      'ramp-required-unsure': { image: expert('NoCurbRampUnsure3.png') },
    },
    'obstacle': {
      'wrong-type': { image: expert('ObstacleDisagree3.png') },
      'not-pedestrian-path': { image: expert('ObstacleDisagree1.png') },
      'ample-space': { image: expert('ObstacleDisagree2.png') },
      'space-to-avoid-unsure': { image: expert('ObstacleUnsure3.png') },
    },
    'surface-problem': {
      'wrong-type': { image: expert('SurfaceProblemDisagree1.png') },
      'not-pedestrian-path': { image: example('SurfaceProblemCounterExample3.png') },
      'normal-tiles': { textKey: mst('surface-problem', 2), image: example('SurfaceProblemCounterExample4.png') },
      'too-minor-unsure': { image: expert('SurfaceProblemUnsure3.png') },
    },
    'no-sidewalk': {
      'wrong-type': { image: expert('NoSidewalkDisagree3.png') },
      'sidewalk-here': { textKey: mst('no-sidewalk', 3), image: example('NoSidewalkCounterExample1.png') },
      'traffic-median': { textKey: mst('no-sidewalk', 2), image: example('NoSidewalkCounterExample3.png') },
      'sidewalk-needed-unsure': { image: expert('NoSidewalkUnsure3.png') },
    },
    'crosswalk': {
      'no-visible-crosswalk': { textKey: mst('crosswalk', 2), image: example('CrosswalkCounterExample1.png') },
      'stop-line': { textKey: mst('crosswalk', 3), image: example('CrosswalkCounterExample2.png') },
      'speed-bump': { textKey: mst('crosswalk', 4), image: example('CrosswalkCounterExample3.png') },
    },
    'signal': {
      'vehicle-signal-only': { textKey: mst('signal', 4), image: example('SignalCounterExample3.png') },
      'sign-no-light': { textKey: mst('signal', 2), image: example('SignalCounterExample1.png') },
      'pole-no-signal': { textKey: mst('signal', 3), image: example('SignalCounterExample2.png') },
    },
  };

  /**
   * The reason buttons per label type, in the shape the menus render: `no-button-N` / `unsure-button-N` by menu
   * position, each carrying the reason's id so the pick is stored as an id and not only as its text (#5475). Built
   * from the catalog the backend stamps on the page, so Validate offers exactly what the label card and Gallery do.
   * The first disagree reason is "wrong label type"; on Expert Validate it opens the label type picker instead of
   * being saved as a comment (#5409), which `wrongType` marks. Tooltips get their key number appended below.
   * @type {Record<string, Record<string, ReasonButton>>}
   */
  const reasonButtonInfo = {};
  for (const labelType of validationReasons.labelTypes()) {
    const kebab = util.camelToKebab(labelType);
    const buttons = {};
    for (const [vote, prefix] of [['Disagree', 'no-button-'], ['Unsure', 'unsure-button-']]) {
      validationReasons.forLabel(labelType, vote).forEach((reason, i) => {
        const extras = tooltipExtras[kebab]?.[reason.id] ?? tooltipExtras.common[reason.id] ?? {};
        const tooltipText = extras.textKey ? i18next.t(extras.textKey) : reason.tooltip;
        buttons[`${prefix}${i + 1}`] = {
          reasonId: reason.id,
          buttonText: reason.text,
          tooltipText: tooltipText ?? reason.text,
          ...(extras.image ? { tooltipImage: extras.image } : {}),
          ...(reason.id === 'wrong-type' ? { wrongType: true } : {}),
        };
      });
    }
    reasonButtonInfo[kebab] = buttons;
  }
  // Append button numbers to tooltipText.
  for (const labelType in reasonButtonInfo) {
    for (const buttonId in reasonButtonInfo[labelType]) {
      const buttonInfo = reasonButtonInfo[labelType][buttonId];
      // Extract the number from the button ID (e.g., "no-button-1" -> "1").
      const buttonNumber = buttonId.split('-').pop();
      buttonInfo.tooltipText += ` (${buttonNumber})`;
    }
  }
  return Object.freeze(reasonButtonInfo);
}
