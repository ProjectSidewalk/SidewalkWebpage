/**
 * NOTE This is now used only for the mission start screens on mobile!
 *
 * Briefs a mobile validator before a mission: what they're about to validate, and what the label type looks like when
 * it's right and when it isn't, as a swipeable carousel of the same examples the desktop tools teach from
 * (MissionStartTutorial.slidesFor).
 */
class ModalMission {
  #uiModalMission;
  #currentSlideIdx = 0;

  /**
   * @param {object} uiModalMission Mission modal UI elements.
   */
  constructor(uiModalMission) {
    this.#uiModalMission = uiModalMission;
  }

  #handleButtonClick = () => {
    const mission = svv.missionContainer.getCurrentMission();

    // Check added so that if a user begins a mission, leaves partway through, and then resumes the mission later,
    // another MissionStart will not be triggered
    if (mission.getProperty('labelsProgress') < 1) {
      svv.tracker.push(
        'MissionStart',
        {
          missionId: mission.getProperty('missionId'),
          missionType: mission.getProperty('missionType'),
          labelTypeId: mission.getProperty('labelTypeId'),
          labelsValidated: mission.getProperty('labelsValidated'),
        },
      );
    }
    // Update zoom availability on desktop.
    if (svv.zoomControl) {
      svv.zoomControl.updateZoomAvailability();
    }
    this.hide();
  };

  /**
   * Hides the new/continuing mission screen.
   */
  hide() {
    if (svv.keyboard) {
      svv.keyboard.enableKeyboard();
    }
    this.#uiModalMission.background.css('visibility', 'hidden');
    this.#uiModalMission.holder.css('visibility', 'hidden');
    this.#uiModalMission.foreground.css('visibility', 'hidden');
  }

  /**
   * Builds the carousel of examples that teaches the mission's label type.
   *
   * The slides come from MissionStartTutorial, so a phone validator is taught from exactly the same examples, in the
   * same order, as someone on a laptop — the desktop steps through them behind arrows, this one swipes.
   *
   * @param {string} labelType The mission's label type, e.g. 'NoCurbRamp'.
   * @returns {string} The carousel's HTML.
   */
  static #buildExamples(labelType) {
    const slides = MissionStartTutorial.slidesFor('validate', labelType);
    const figures = slides.map((slide, i) => {
      const correct = slide.isExampleCorrect;
      const verdict = correct
        ? i18next.t('common:mission-start-tutorial.example-type-label-correct')
        : i18next.t('validate:mission-start-tutorial.example-type-label-incorrect');
      // What the example is worth on the buttons below — the point of showing it. The desktop tutorial puts the same
      // sentence on the example's own label chip.
      const verdictAction = correct
        ? i18next.t('validate:mission-start-tutorial.label-on-image-description-correct')
        : i18next.t('validate:mission-start-tutorial.label-on-image-description-incorrect');
      // Only the first example is worth downloading up front; the rest are megabyte screenshots a swipe away.
      const loading = i === 0 ? '' : ' loading="lazy"';
      return `
        <figure class="mv-example mv-example--${correct ? 'correct' : 'incorrect'}">
          <div class="mv-example__photo">
            <img src="${slide.imageURL}" alt=""${loading} decoding="async">
            <span class="mv-example__verdict">
              <svg class="mv-example__verdict-icon" viewBox="0 0 24 24" aria-hidden="true">
                <use xlink:href="#smile-${correct ? 'positive' : 'negative'}"></use>
              </svg>
              ${verdict}
            </span>
          </div>
          <figcaption class="mv-example__caption">
            <span class="mv-example__title">${slide.slideTitle}</span>
            <span class="mv-example__text">${slide.slideDescription}</span>
            <span class="mv-example__action">${verdictAction}</span>
          </figcaption>
        </figure>`;
    }).join('');

    // Decorative: the strip itself is the scrollable region a screen reader announces, so the dots repeat nothing.
    const dots = slides
      .map((slide, i) => `<span class="mv-dot${i === 0 ? ' mv-dot--current' : ''}"></span>`)
      .join('');

    return `
      <div class="mv-examples">${figures}</div>
      <div class="mv-dots" aria-hidden="true">${dots}</div>`;
  }

  /**
   * Keeps the dots in step with the swiped-to example, and logs each example the validator actually reaches.
   */
  #watchCarousel() {
    const strip = this.#uiModalMission.instruction[0].querySelector('.mv-examples');
    if (!strip) return;
    const dots = strip.parentElement.querySelectorAll('.mv-dot');
    strip.addEventListener('scroll', () => {
      const idx = Math.round(strip.scrollLeft / strip.clientWidth);
      if (idx === this.#currentSlideIdx || !dots[idx]) return;
      this.#currentSlideIdx = idx;
      dots.forEach((dot, i) => dot.classList.toggle('mv-dot--current', i === idx));
      svv.tracker.push('MSTSlide_Swipe', { currentSlideIdx: idx });
    }, { passive: true });
  }

  /**
   * Shows the mission screen for the mission that is about to be validated.
   *
   * A resumed mission gets the same briefing as a new one: the examples are as worth a look on the way back in, and
   * the count in the title is the mission's, not a progress figure.
   *
   * @param {Mission} mission Mission object for the new mission.
   */
  setMissionMessage(mission) {
    const labelType = svv.labelTypes[mission.getProperty('labelTypeId')];
    const title = i18next.t('validate:mission-start-tutorial.mst-instruction-2', {
      nLabels: mission.getProperty('labelsValidated'),
      labelType: svv.labelTypeNames[mission.getProperty('labelTypeId')],
    });
    this.show(title, ModalMission.#buildExamples(labelType), labelType);
  }

  /**
   * @param {string} title What this mission is, e.g. "Validate 10 Curb Ramp Labels".
   * @param {string} [instruction] Body HTML — the examples carousel.
   * @param {string} [labelType] The mission's label type, whose marker icon heads the screen.
   */
  show(title, instruction, labelType) {
    // ModalNoNewMission paints these same elements, and what it puts there is a dead end with its own button and
    // handler. Page load reaches the mission-start message after the first label has rendered, which is one of the
    // points that dead end can be hit, so this would otherwise bury it under an "Ok" that just closes (#4810).
    if (svv.modalNoNewMission?.isShowing()) return;

    // Disable keyboard on mobile.
    if (svv.keyboard) {
      svv.keyboard.disableKeyboard();
    }
    if (instruction) {
      this.#uiModalMission.instruction.html(instruction);
      this.#currentSlideIdx = 0;
      this.#watchCarousel();
    }
    const icon = labelType ? `<img src="${util.misc.getIconImagePaths(labelType).iconImagePath}" alt="">` : '';
    this.#uiModalMission.eyebrow.html(`${icon}${i18next.t('validate:mission-start-tutorial.mst-instruction-1')}`);

    this.#uiModalMission.background.css('visibility', 'visible');
    this.#uiModalMission.missionTitle.html(title);
    this.#uiModalMission.holder.css('visibility', 'visible');
    this.#uiModalMission.foreground.css('visibility', 'visible');
    this.#uiModalMission.closeButton.html(i18next.t('common:mission-start-tutorial.start-mission'));
    this.#uiModalMission.closeButton.off('click').on('click', this.#handleButtonClick);
  }
}
