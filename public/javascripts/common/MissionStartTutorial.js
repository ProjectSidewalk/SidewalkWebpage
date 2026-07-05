/**
 * A full-screen carousel for the mission start tutorial.
 */
class MissionStartTutorial {
  static #EXAMPLE_TYPES = {
    CORRECT: 'correct',
    INCORRECT: 'incorrect',
  };

  static #MISSION_TYPES = {
    VALIDATE: 'validate',
    EXPLORE: 'audit',
  };

  // Map of exampleType to ID of the smiley icon to be used.
  static #SMILEYS = {
    [MissionStartTutorial.#EXAMPLE_TYPES.CORRECT]: '#smile-positive',
    [MissionStartTutorial.#EXAMPLE_TYPES.INCORRECT]: '#smile-negative',
  };

  #missionType;
  #labelType;
  #data;
  #svvOrsvl;
  #language;

  #currentSlideIdx = 0;
  #nSlides = 0;
  #labelTypeModule = {};

  // Messages prefix, essentially missionType but declared as a field to accommodate future changes. Selects the
  // 'audit' or 'validate' message namespace for mission screens.
  #messagesPrefix;

  /**
   * @param {string} missionType Mission type ('validate' or 'audit').
   * @param {string} labelType One of the seven label types for which the tutorial is initialized.
   * @param {object} data Mission data: `nLabels` (VALIDATE) or `neighborhood` (EXPLORE).
   * @param {object} svvOrsvl SVValidate or SVLabel object that logs interactions and acts on tutorial close.
   * @param {string} [language] Language code that tweaks spacing for verbose translations.
   */
  constructor(missionType, labelType, data, svvOrsvl, language = 'en') {
    this.#missionType = missionType;
    this.#labelType = labelType;
    this.#data = data;
    this.#svvOrsvl = svvOrsvl;
    this.#language = language;
    this.#messagesPrefix = missionType;

    this.#initModule(missionType);
    this.#initUI();
    this.#attachEventHandlers();
  }

  /**
   * Initializes the variables needed for this module by selecting the descriptor for the current label type.
   *
   * Each descriptor provides structure for a slide-based tutorial framework:
   *     - missionInstruction1: Text to be shown at the very top, above the slides area.
   *     - missionInstruction2: Text to be shown below missionInstruction1, above the slides area.
   *     - slides: An array of 'slides'.
   *
   * Each 'slide' contains the following:
   *     - isExampleCorrect: boolean, indicating whether the example type is correct or incorrect.
   *     - slideTitle: string, title for the slide.
   *     - slideSubtitle: string, subtitle for the slide.
   *     - slideDescription: string, long form text description for the slide.
   *     - imageURL: string, URL to the image to be shown.
   *     - labelOnImage: object, containing the following:
   *         - position: object, containing 'top' and 'left' attributes (wrt image elem) for the on-image label.
   *
   * @param {string} missionType Mission type ('validate' or 'audit').
   */
  #initModule(missionType) {
    const validateMSTDescriptor = {
      CurbRamp: {
        missionInstruction1: i18next.t('validate:mission-start-tutorial.mst-instruction-1'),
        missionInstruction2: i18next.t('validate:mission-start-tutorial.mst-instruction-2',
          { nLabels: this.#data.nLabels, labelType: i18next.t('common:curb-ramp') }),
        slides: [
          {
            isExampleCorrect: true,
            slideTitle: i18next.t('common:mission-start-tutorial.curb-ramp.slide-1.title',
              { labelType: i18next.t('common:curb-ramp') }),
            slideSubtitle: '',
            slideDescription: i18next.t('common:mission-start-tutorial.curb-ramp.slide-1.description'),
            imageURL: 'assets/images/tutorials/curbramp-correct-1.png',
            labelOnImage: {
              position: {
                left: '237px',
                top: '222px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.curb-ramp.slide-2.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.curb-ramp.slide-2.description'),
            imageURL: 'assets/images/tutorials/curbramp-incorrect-1.png',
            labelOnImage: {
              position: {
                left: '329px',
                top: '334px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.curb-ramp.slide-3.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.curb-ramp.slide-3.description'),
            imageURL: 'assets/images/tutorials/curbramp-incorrect-2.png',
            labelOnImage: {
              position: {
                left: '295px',
                top: '333px',
              },
            },
          },
        ],
      },
      NoCurbRamp: {
        missionInstruction1: i18next.t('validate:mission-start-tutorial.mst-instruction-1'),
        missionInstruction2: i18next.t('validate:mission-start-tutorial.mst-instruction-2',
          { nLabels: this.#data.nLabels, labelType: i18next.t('common:no-curb-ramp') }),
        slides: [
          {
            isExampleCorrect: true,
            slideTitle: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-1.title',
              { labelType: i18next.t('common:no-curb-ramp') }),
            slideSubtitle: '',
            slideDescription: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-1.description'),
            imageURL: 'assets/images/tutorials/no-curbramp-correct-1.png',
            labelOnImage: {
              position: {
                left: '392px',
                top: '157px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-2.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-2.description'),
            imageURL: 'assets/images/tutorials/no-curbramp-incorrect-1.png',
            labelOnImage: {
              position: {
                left: '324px',
                top: '250px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-3.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-3.description'),
            imageURL: 'assets/images/tutorials/no-curbramp-incorrect-2.png',
            labelOnImage: {
              position: {
                left: '396px',
                top: '320px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-4.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-4.description'),
            imageURL: 'assets/images/tutorials/no-curbramp-incorrect-3.png',
            labelOnImage: {
              position: {
                left: '325px',
                top: '302px',
              },
            },
          },
        ],
      },
      Obstacle: {
        missionInstruction1: i18next.t('validate:mission-start-tutorial.mst-instruction-1'),
        missionInstruction2: i18next.t('validate:mission-start-tutorial.mst-instruction-2',
          { nLabels: this.#data.nLabels, labelType: i18next.t('common:obstacle') }),
        slides: [
          {
            isExampleCorrect: true,
            slideTitle: i18next.t('common:mission-start-tutorial.obstacle.slide-1.title',
              { labelType: i18next.t('common:obstacle') }),
            slideSubtitle: '',
            slideDescription: i18next.t('common:mission-start-tutorial.obstacle.slide-1.description'),
            imageURL: 'assets/images/tutorials/obstacle-correct-1.png',
            labelOnImage: {
              position: {
                left: '268px',
                top: '301px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.obstacle.slide-2.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.obstacle.slide-2.description'),
            imageURL: 'assets/images/tutorials/obstacle-incorrect-1.png',
            labelOnImage: {
              position: {
                left: '396px',
                top: '286px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.obstacle.slide-3.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.obstacle.slide-3.description'),
            imageURL: 'assets/images/tutorials/obstacle-incorrect-2.png',
            labelOnImage: {
              position: {
                left: '76px',
                top: '112px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.obstacle.slide-4.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.obstacle.slide-4.description'),
            imageURL: 'assets/images/tutorials/obstacle-incorrect-3.png',
            labelOnImage: {
              position: {
                left: '414px',
                top: '187px',
              },
            },
          },
        ],
      },
      SurfaceProblem: {
        missionInstruction1: i18next.t('validate:mission-start-tutorial.mst-instruction-1'),
        missionInstruction2: i18next.t('validate:mission-start-tutorial.mst-instruction-2',
          { nLabels: this.#data.nLabels, labelType: i18next.t('common:surface-problem') }),
        slides: [
          {
            isExampleCorrect: true,
            slideTitle: i18next.t('common:mission-start-tutorial.surface-problem.slide-1.title',
              { labelType: i18next.t('common:surface-problem') }),
            slideSubtitle: '',
            slideDescription: i18next.t('common:mission-start-tutorial.surface-problem.slide-1.description'),
            imageURL: 'assets/images/tutorials/surface-problem-correct-1.png',
            labelOnImage: {
              position: {
                left: '291px',
                top: '45px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.surface-problem.slide-2.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.surface-problem.slide-2.description'),
            imageURL: 'assets/images/tutorials/surface-problem-incorrect-1.png',
            labelOnImage: {
              position: {
                left: '397px',
                top: '190px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.surface-problem.slide-3.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.surface-problem.slide-3.description'),
            imageURL: 'assets/images/tutorials/surface-problem-incorrect-2.png',
            labelOnImage: {
              position: {
                left: '333px',
                top: '219px',
              },
            },
          },
        ],
      },
      NoSidewalk: {
        missionInstruction1: i18next.t('validate:mission-start-tutorial.mst-instruction-1'),
        missionInstruction2: i18next.t('validate:mission-start-tutorial.mst-instruction-2',
          { nLabels: this.#data.nLabels, labelType: i18next.t('common:no-sidewalk') }),
        slides: [
          {
            isExampleCorrect: true,
            slideTitle: i18next.t('common:mission-start-tutorial.no-sidewalk.slide-1.title',
              { labelType: i18next.t('common:no-sidewalk') }),
            slideSubtitle: '',
            slideDescription: i18next.t('common:mission-start-tutorial.no-sidewalk.slide-1.description'),
            imageURL: 'assets/images/tutorials/no-sidewalk-correct-1.png',
            labelOnImage: {
              position: {
                left: '290px',
                top: '132px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.no-sidewalk.slide-2.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.no-sidewalk.slide-2.description'),
            imageURL: 'assets/images/tutorials/no-sidewalk-incorrect-1.png',
            labelOnImage: {
              position: {
                left: '352px',
                top: '312px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.no-sidewalk.slide-3.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.no-sidewalk.slide-3.description'),
            imageURL: 'assets/images/tutorials/no-sidewalk-incorrect-2.png',
            labelOnImage: {
              position: {
                left: '183px',
                top: '298px',
              },
            },
          },
        ],
      },
      Crosswalk: {
        missionInstruction1: i18next.t('validate:mission-start-tutorial.mst-instruction-1'),
        missionInstruction2: i18next.t('validate:mission-start-tutorial.mst-instruction-2',
          { nLabels: this.#data.nLabels, labelType: i18next.t('common:crosswalk') }),
        slides: [
          {
            isExampleCorrect: true,
            slideTitle: i18next.t('common:mission-start-tutorial.crosswalk.slide-1.title',
              { labelType: i18next.t('common:crosswalk') }),
            slideSubtitle: '',
            slideDescription: i18next.t('common:mission-start-tutorial.crosswalk.slide-1.description'),
            imageURL: 'assets/images/tutorials/crosswalk-correct-1.png',
            labelOnImage: {
              position: {
                left: '175px',
                top: '159px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.crosswalk.slide-2.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.crosswalk.slide-2.description'),
            imageURL: 'assets/images/tutorials/crosswalk-incorrect-1.png',
            labelOnImage: {
              position: {
                left: '353px',
                top: '241px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.crosswalk.slide-3.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.crosswalk.slide-3.description'),
            imageURL: 'assets/images/tutorials/crosswalk-incorrect-2.png',
            labelOnImage: {
              position: {
                left: '247px',
                top: '301px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.crosswalk.slide-4.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.crosswalk.slide-4.description'),
            imageURL: 'assets/images/tutorials/crosswalk-incorrect-3.png',
            labelOnImage: {
              position: {
                left: '267px',
                top: '102px',
              },
            },
          },
        ],
      },
      Signal: {
        missionInstruction1: i18next.t('validate:mission-start-tutorial.mst-instruction-1'),
        missionInstruction2: i18next.t('validate:mission-start-tutorial.mst-instruction-2',
          { nLabels: this.#data.nLabels, labelType: i18next.t('common:signal') }),
        slides: [
          {
            isExampleCorrect: true,
            slideTitle: i18next.t('common:mission-start-tutorial.signal.slide-1.title',
              { labelType: i18next.t('common:signal') }),
            slideSubtitle: '',
            slideDescription: i18next.t('common:mission-start-tutorial.signal.slide-1.description'),
            imageURL: 'assets/images/tutorials/signal-correct-1.png',
            labelOnImage: {
              position: {
                left: '170px',
                top: '325px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.signal.slide-2.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.signal.slide-2.description'),
            imageURL: 'assets/images/tutorials/signal-incorrect-1.png',
            labelOnImage: {
              position: {
                left: '376px',
                top: '86px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.signal.slide-3.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.signal.slide-3.description'),
            imageURL: 'assets/images/tutorials/signal-incorrect-2.png',
            labelOnImage: {
              position: {
                left: '389px',
                top: '203px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.signal.slide-4.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.signal.slide-4.description'),
            imageURL: 'assets/images/tutorials/signal-incorrect-3.png',
            labelOnImage: {
              position: {
                left: '358px',
                top: '332px',
              },
            },
          },
        ],
      },
    };

    // Descriptor for explore mission screens
    const exploreMSTDescriptor = {
      CurbRamp: {
        missionInstruction1: i18next.t('audit:mission-start-tutorial.mst-instruction-1'),
        missionInstruction2: i18next.t('audit:mission-start-tutorial.mst-instruction-2',
          { neighborhood: this.#data.neighborhood }),
        slides: [
          {
            isExampleCorrect: true,
            slideTitle: i18next.t('common:mission-start-tutorial.curb-ramp.slide-1.title',
              { labelType: i18next.t('common:curb-ramp') }),
            slideSubtitle: '',
            slideDescription: i18next.t('common:mission-start-tutorial.curb-ramp.slide-1.description'),
            imageURL: 'assets/images/tutorials/curbramp-correct-1.png',
            labelOnImage: {
              position: {
                left: '237px',
                top: '222px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.curb-ramp.slide-2.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.curb-ramp.slide-2.description'),
            imageURL: 'assets/images/tutorials/explore-curbramp-incorrect-1.png',
            labelOnImage: {
              position: {
                left: '329px',
                top: '334px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.curb-ramp.slide-3.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.curb-ramp.slide-3.description'),
            imageURL: 'assets/images/tutorials/explore-curbramp-incorrect-2.png',
            labelOnImage: {
              position: {
                left: '295px',
                top: '333px',
              },
            },
          },
        ],
      },
      NoCurbRamp: {
        missionInstruction1: i18next.t('audit:mission-start-tutorial.mst-instruction-1'),
        missionInstruction2: i18next.t('audit:mission-start-tutorial.mst-instruction-2',
          { neighborhood: this.#data.neighborhood }),
        slides: [
          {
            isExampleCorrect: true,
            slideTitle: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-1.title',
              { labelType: i18next.t('common:no-curb-ramp') }),
            slideSubtitle: '',
            slideDescription: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-1.description'),
            imageURL: 'assets/images/tutorials/no-curbramp-correct-1.png',
            labelOnImage: {
              position: {
                left: '392px',
                top: '157px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-2.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-2.description'),
            imageURL: 'assets/images/tutorials/explore-no-curbramp-incorrect-1.png',
            labelOnImage: {
              position: {
                left: '324px',
                top: '250px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-3.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-3.description'),
            imageURL: 'assets/images/tutorials/explore-no-curbramp-incorrect-2.png',
            labelOnImage: {
              position: {
                left: '396px',
                top: '320px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-4.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.no-curb-ramp.slide-4.description'),
            imageURL: 'assets/images/tutorials/explore-no-curbramp-incorrect-3.png',
            labelOnImage: {
              position: {
                left: '325px',
                top: '302px',
              },
            },
          },
        ],
      },
      Obstacle: {
        missionInstruction1: i18next.t('audit:mission-start-tutorial.mst-instruction-1'),
        missionInstruction2: i18next.t('audit:mission-start-tutorial.mst-instruction-2',
          { neighborhood: this.#data.neighborhood }),
        slides: [
          {
            isExampleCorrect: true,
            slideTitle: i18next.t('common:mission-start-tutorial.obstacle.slide-1.title',
              { labelType: i18next.t('common:obstacle') }),
            slideSubtitle: '',
            slideDescription: i18next.t('common:mission-start-tutorial.obstacle.slide-1.description'),
            imageURL: 'assets/images/tutorials/obstacle-correct-1.png',
            labelOnImage: {
              position: {
                left: '268px',
                top: '301px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.obstacle.slide-2.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.obstacle.slide-2.description'),
            imageURL: 'assets/images/tutorials/explore-obstacle-incorrect-1.png',
            labelOnImage: {
              position: {
                left: '396px',
                top: '286px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.obstacle.slide-3.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.obstacle.slide-3.description'),
            imageURL: 'assets/images/tutorials/explore-obstacle-incorrect-2.png',
            labelOnImage: {
              position: {
                left: '76px',
                top: '112px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.obstacle.slide-4.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.obstacle.slide-4.description'),
            imageURL: 'assets/images/tutorials/explore-obstacle-incorrect-3.png',
            labelOnImage: {
              position: {
                left: '414px',
                top: '187px',
              },
            },
          },
        ],
      },
      SurfaceProblem: {
        missionInstruction1: i18next.t('audit:mission-start-tutorial.mst-instruction-1'),
        missionInstruction2: i18next.t('audit:mission-start-tutorial.mst-instruction-2',
          { neighborhood: this.#data.neighborhood }),
        slides: [
          {
            isExampleCorrect: true,
            slideTitle: i18next.t('common:mission-start-tutorial.surface-problem.slide-1.title',
              { labelType: i18next.t('common:surface-problem') }),
            slideSubtitle: '',
            slideDescription: i18next.t('common:mission-start-tutorial.surface-problem.slide-1.description'),
            imageURL: 'assets/images/tutorials/surface-problem-correct-1.png',
            labelOnImage: {
              position: {
                left: '291px',
                top: '45px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.surface-problem.slide-2.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.surface-problem.slide-2.description'),
            imageURL: 'assets/images/tutorials/explore-surface-problem-incorrect-1.png',
            labelOnImage: {
              position: {
                left: '397px',
                top: '190px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.surface-problem.slide-3.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.surface-problem.slide-3.description'),
            imageURL: 'assets/images/tutorials/explore-surface-problem-incorrect-2.png',
            labelOnImage: {
              position: {
                left: '333px',
                top: '219px',
              },
            },
          },
        ],
      },
      NoSidewalk: {
        missionInstruction1: i18next.t('audit:mission-start-tutorial.mst-instruction-1'),
        missionInstruction2: i18next.t('audit:mission-start-tutorial.mst-instruction-2',
          { neighborhood: this.#data.neighborhood }),
        slides: [
          {
            isExampleCorrect: true,
            slideTitle: i18next.t('common:mission-start-tutorial.no-sidewalk.slide-1.title',
              { labelType: i18next.t('common:no-sidewalk') }),
            slideSubtitle: '',
            slideDescription: i18next.t('common:mission-start-tutorial.no-sidewalk.slide-1.description'),
            imageURL: 'assets/images/tutorials/no-sidewalk-correct-1.png',
            labelOnImage: {
              position: {
                left: '290px',
                top: '132px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.no-sidewalk.slide-2.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.no-sidewalk.slide-2.description'),
            imageURL: 'assets/images/tutorials/explore-no-sidewalk-incorrect-1.png',
            labelOnImage: {
              position: {
                left: '352px',
                top: '312px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.no-sidewalk.slide-3.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.no-sidewalk.slide-3.description'),
            imageURL: 'assets/images/tutorials/explore-no-sidewalk-incorrect-2.png',
            labelOnImage: {
              position: {
                left: '183px',
                top: '298px',
              },
            },
          },
        ],
      },
      Crosswalk: {
        missionInstruction1: i18next.t('audit:mission-start-tutorial.mst-instruction-1'),
        missionInstruction2: i18next.t('audit:mission-start-tutorial.mst-instruction-2',
          { neighborhood: this.#data.neighborhood }),
        slides: [
          {
            isExampleCorrect: true,
            slideTitle: i18next.t('common:mission-start-tutorial.crosswalk.slide-1.title',
              { labelType: i18next.t('common:crosswalk') }),
            slideSubtitle: '',
            slideDescription: i18next.t('common:mission-start-tutorial.crosswalk.slide-1.description'),
            imageURL: 'assets/images/tutorials/crosswalk-correct-1.png',
            labelOnImage: {
              position: {
                left: '175px',
                top: '159px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.crosswalk.slide-2.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.crosswalk.slide-2.description'),
            imageURL: 'assets/images/tutorials/explore-crosswalk-incorrect-1.png',
            labelOnImage: {
              position: {
                left: '353px',
                top: '241px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.crosswalk.slide-3.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.crosswalk.slide-3.description'),
            imageURL: 'assets/images/tutorials/explore-crosswalk-incorrect-2.png',
            labelOnImage: {
              position: {
                left: '247px',
                top: '301px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.crosswalk.slide-4.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.crosswalk.slide-4.description'),
            imageURL: 'assets/images/tutorials/explore-crosswalk-incorrect-3.png',
            labelOnImage: {
              position: {
                left: '267px',
                top: '102px',
              },
            },
          },
        ],
      },
      Signal: {
        missionInstruction1: i18next.t('audit:mission-start-tutorial.mst-instruction-1'),
        missionInstruction2: i18next.t('audit:mission-start-tutorial.mst-instruction-2',
          { neighborhood: this.#data.neighborhood }),
        slides: [
          {
            isExampleCorrect: true,
            slideTitle: i18next.t('common:mission-start-tutorial.signal.slide-1.title',
              { labelType: i18next.t('common:signal') }),
            slideSubtitle: '',
            slideDescription: i18next.t('common:mission-start-tutorial.signal.slide-1.description'),
            imageURL: 'assets/images/tutorials/signal-correct-1.png',
            labelOnImage: {
              position: {
                left: '170px',
                top: '325px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.signal.slide-2.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.signal.slide-2.description'),
            imageURL: 'assets/images/tutorials/explore-signal-incorrect-1.png',
            labelOnImage: {
              position: {
                left: '376px',
                top: '86px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.signal.slide-3.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.signal.slide-3.description'),
            imageURL: 'assets/images/tutorials/explore-signal-incorrect-2.png',
            labelOnImage: {
              position: {
                left: '389px',
                top: '203px',
              },
            },
          },
          {
            isExampleCorrect: false,
            slideTitle: i18next.t('common:mission-start-tutorial.signal.slide-4.title'),
            slideSubtitle: i18next.t('common:mission-start-tutorial.label-type-subtitle'),
            slideDescription: i18next.t('common:mission-start-tutorial.signal.slide-4.description'),
            imageURL: 'assets/images/tutorials/explore-signal-incorrect-3.png',
            labelOnImage: {
              position: {
                left: '358px',
                top: '332px',
              },
            },
          },
        ],
      },
    };

    if (missionType === MissionStartTutorial.#MISSION_TYPES.VALIDATE) {
      this.#labelTypeModule = validateMSTDescriptor[this.#labelType];
      this.#nSlides = this.#labelTypeModule.slides.length;
    } else if (missionType === MissionStartTutorial.#MISSION_TYPES.EXPLORE) {
      this.#labelTypeModule = exploreMSTDescriptor[this.#labelType];
      this.#nSlides = this.#labelTypeModule.slides.length;
    }
  }

  /**
   * Initializes the UI for the mission screens, renders top-level messages, and renders the first slide.
   */
  #initUI() {
    const renderLocationIndicators = () => {
      // We should clear existing indicators before rendering.
      // Explore mission screens allow re-rendering of the slides for different labels.
      $('.mst-carousel-location-indicator:not(.template)').remove();

      const $missionCarouselIndicatorArea = $('.mst-carousel-location-indicator-area');
      for (let i = 0; i < this.#nSlides; i++) {
        const $indicator = $('.mst-carousel-location-indicator.template').clone().removeClass('template');
        $indicator.attr('data-idx', i);
        $missionCarouselIndicatorArea.append($indicator);
      }
    };

    $('.mst-instruction-1').html(this.#labelTypeModule.missionInstruction1); // Explore mission screens have HTML in strings.
    $('.mst-instruction-2').html(this.#labelTypeModule.missionInstruction2);

    $('.mission-start-tutorial-done-btn').text(i18next.t('common:mission-start-tutorial.start-mission'));

    // Show the tab bar to allow selection of different labels in explore mission screens.
    // And set up other UI.
    if (this.#missionType === MissionStartTutorial.#MISSION_TYPES.EXPLORE) {
      $('.explore-mission-start-tab.label[data-label-type="CurbRamp"]').find('.explore-mission-start-tab-text').html(i18next.t('common:curb-ramp'));
      $('.explore-mission-start-tab.label[data-label-type="NoCurbRamp"]').find('.explore-mission-start-tab-text').html(i18next.t('common:no-curb-ramp'));
      $('.explore-mission-start-tab.label[data-label-type="Obstacle"]').find('.explore-mission-start-tab-text').html(i18next.t('common:obstacle'));
      $('.explore-mission-start-tab.label[data-label-type="SurfaceProblem"]').find('.explore-mission-start-tab-text').html(i18next.t('common:surface-problem'));
      $('.explore-mission-start-tab.label[data-label-type="NoSidewalk"]').find('.explore-mission-start-tab-text').html(i18next.t('common:no-sidewalk'));
      $('.explore-mission-start-tab.label[data-label-type="Crosswalk"]').find('.explore-mission-start-tab-text').html(i18next.t('common:crosswalk'));
      $('.explore-mission-start-tab.label[data-label-type="Signal"]').find('.explore-mission-start-tab-text').html(i18next.t('common:signal'));

      $('.explore-mission-start-tab-bar').show();

      $('.explore-mission-start-tab.label').removeClass('active');
      $(`.explore-mission-start-tab.label[data-label-type="${this.#labelType}"]`).addClass('active');
    }

    renderLocationIndicators();
    this.#renderSlide(this.#currentSlideIdx);

    $('.mission-start-tutorial-overlay').css('display', 'flex');
  }

  /**
   * Renders the slide for the given idx. Includes setting title, subtitle, description, image, and on-image label.
   * - Updates the current slide indicator.
   * - Disables/enables the next/previous buttons based on the idx of the rendered slide.
   * @param {number} idx Index of the slide to be rendered.
   */
  #renderSlide(idx) {
    const $mstSlide = $('.mst-slide');
    const $labelTypeSubtitle = $('.label-type-subtitle');
    const $mstSlideImage = $('.msts-image');
    const $labelOnImage = $('.label-on-image');
    const $mstDoneButton = $('.mission-start-tutorial-done-btn');
    const $labelOnImageDescription = $('.label-on-image-description');

    /**
     * Renders the 'on-image label' and positions it.
     * @param {object} position Position of the on-image label as top and left attributes in px.
     * @param {string} iconID ID of the SVG icon to be shown on the label.
     * @param {string} labelOnImageTitle Title to be shown on the label.
     * @param {string} labelOnImageDescription Description to be shown on the label.
     */
    const renderLabelOnImage = (position, iconID, labelOnImageTitle, labelOnImageDescription) => {
      $labelOnImage.css({
        top: `calc(${position.top} * var(--ui-scale))`,
        left: `calc(${position.left} * var(--ui-scale))`,
      });
      $('.label-on-image-type-title', $labelOnImage).html(labelOnImageTitle);
      $('.label-on-image-description', $labelOnImage).html(labelOnImageDescription);

      $('.label-on-image-type-icon').find('use').attr('xlink:href', iconID);

      $labelOnImage.show();
    };

    // Change spacing for the descriptions for different languages based on how verbose they are.
    if (this.#language === 'de') {
      $labelOnImageDescription[0].style.transform = `translateY(${-16}%)`;
    } else if (this.#language === 'nl') {
      $labelOnImage[0].style.maxWidth = 'calc(230px * var(--ui-scale))';
    }

    // Reset the UI first.
    $('.mst-carousel-location-indicator').removeClass('current-location');
    $mstSlide.removeClass(MissionStartTutorial.#EXAMPLE_TYPES.CORRECT).removeClass(MissionStartTutorial.#EXAMPLE_TYPES.INCORRECT);
    $mstSlideImage.attr('src', '');
    $labelTypeSubtitle.text('');
    $('.previous-slide-button, .next-slide-button').removeClass('disabled');
    $labelOnImage.hide();
    $mstDoneButton.removeClass('focus');

    const slide = this.#labelTypeModule.slides[idx];

    if (slide.isExampleCorrect) {
      $mstSlide.addClass('correct');
    } else {
      $mstSlide.addClass('incorrect');
    }

    // The icon is the same on the left panel and the labelOnImage.
    let iconID = '';
    let exampleTypeLabel = '';
    let labelOnImageTitle = '';
    let labelOnImageDescription = '';
    if (slide.isExampleCorrect) {
      iconID = MissionStartTutorial.#SMILEYS[MissionStartTutorial.#EXAMPLE_TYPES.CORRECT];
      exampleTypeLabel = i18next.t('common:mission-start-tutorial.example-type-label-correct');

      labelOnImageTitle = i18next.t('common:mission-start-tutorial.label-on-image-title-correct');
      labelOnImageDescription = i18next.t(`${this.#messagesPrefix}:mission-start-tutorial.label-on-image-description-correct`);
    } else {
      iconID = MissionStartTutorial.#SMILEYS[MissionStartTutorial.#EXAMPLE_TYPES.INCORRECT];
      exampleTypeLabel = i18next.t(`${this.#messagesPrefix}:mission-start-tutorial.example-type-label-incorrect`);

      labelOnImageTitle = i18next.t(`${this.#messagesPrefix}:mission-start-tutorial.label-on-image-title-incorrect`);
      labelOnImageDescription = i18next.t(`${this.#messagesPrefix}:mission-start-tutorial.label-on-image-description-incorrect`);
    }

    // Now that the variables have been initiated, let's set them for the UI.
    $('.example-type-label').text(exampleTypeLabel);
    $('.example-type-icon').find('use').attr('xlink:href', iconID);

    // Note: we should set this as HTML as some strings may contain HTML tags.
    $('.label-type-title').html(slide.slideTitle);
    $('.label-type-description').html(slide.slideDescription);

    if (slide.slideSubtitle) {  // Not all slides may contain a subtitle.
      $labelTypeSubtitle.html(slide.slideSubtitle);
    }

    $mstSlideImage.attr('src', slide.imageURL);

    $(`.mst-carousel-location-indicator[data-idx=${idx}]`).addClass('current-location');

    if (slide.labelOnImage) { // Just a defensive check.
      renderLabelOnImage(slide.labelOnImage.position, iconID, labelOnImageTitle, labelOnImageDescription);
    }

    // Disable the previous/next buttons based on the current slide idx
    if (idx === 0) {
      $('.previous-slide-button').addClass('disabled');
    } else if (idx === this.#nSlides - 1) {
      // We want users to explore other label types after they finish one in 'Explore Mission Screens'.
      // So we don't want to draw attention to the start button.
      if (this.#missionType === MissionStartTutorial.#MISSION_TYPES.VALIDATE) {
        $mstDoneButton.addClass('focus');
      }

      $('.next-slide-button').addClass('disabled');
    }
  }

  /**
   * Attaches the event handlers required for the mission screen labelTypeModule.
   * Note: we need to remove existing handlers first as this function may be called multiple times (explore mission screens).
   */
  #attachEventHandlers() {
    // Hides the mission start tutorial, initializes the relevant svvOrsvl variables, and logs the interaction.
    const hideMST = () => {
      if (this.#svvOrsvl.zoomControl && this.#svvOrsvl.zoomControl.updateZoomAvailability) this.#svvOrsvl.zoomControl.updateZoomAvailability();
      if (this.#svvOrsvl.keyboard && this.#svvOrsvl.keyboard.enableKeyboard) this.#svvOrsvl.keyboard.enableKeyboard();

      $('.mission-start-tutorial-overlay').fadeOut(100);
      $('.explore-mission-start-tab-bar').fadeOut(100);

      this.#svvOrsvl.tracker.push('MSTDoneButton_Click', { currentSlideIdx: this.#currentSlideIdx }, null);

      // Log 'MissionStart' on Explore missions.
      if (this.#missionType === MissionStartTutorial.#MISSION_TYPES.EXPLORE) {
        const mission = this.#svvOrsvl.missionContainer.getCurrentMission();
        // Check added so that if a user begins a mission, leaves partway through, and then resumes the mission
        // later, another MissionStart will not be triggered.
        if (mission.getProperty('distanceProgress') < 0.0001) {
          this.#svvOrsvl.tracker.push(
            'MissionStart',
            {
              missionId: mission.getProperty('missionId'),
              missionType: mission.getProperty('missionType'),
              distanceMeters: Math.round(mission.getDistance('meters')),
              regionId: mission.getProperty('regionId'),
            },
          );
        }
      }
    };

    $('.previous-slide-button').off().click(() => {
      this.#currentSlideIdx = Math.max(this.#currentSlideIdx - 1, 0);
      this.#renderSlide(this.#currentSlideIdx);
      this.#svvOrsvl.tracker.push('PreviousSlideButton_Click', { currentSlideIdx: this.#currentSlideIdx }, null);
    });

    $('.next-slide-button').off().click(() => {
      this.#currentSlideIdx = Math.min(this.#currentSlideIdx + 1, this.#nSlides - 1);
      this.#renderSlide(this.#currentSlideIdx);
      this.#svvOrsvl.tracker.push('NextSlideButton_Click', { currentSlideIdx: this.#currentSlideIdx }, null);
    });

    // Event handler to allow selecting between different label types
    $('.explore-mission-start-tab.label').off().click((e) => {
      const labelType = $(e.currentTarget).attr('data-label-type');
      new MissionStartTutorial('audit', labelType, { neighborhood: this.#data.neighborhood }, svl);
    });

    $('.mission-start-tutorial-done-btn').off().click(hideMST);
  }
}
