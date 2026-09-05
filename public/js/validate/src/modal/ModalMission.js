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
          labelType: mission.getProperty('labelType'),
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
      // Each photo has an empty callout frame drawn into it, with a dotted line running to it from the label being
      // taught. Its position comes in the frame the desktop tutorial displays the photo at, so scale it to a share of
      // whatever width the phone gives the photo.
      const frame = MissionStartTutorial.EXAMPLE_PHOTO;
      const left = (parseFloat(slide.labelOnImage.position.left) / frame.width) * 100;
      const top = (parseFloat(slide.labelOnImage.position.top) / frame.height) * 100;
      // The callout's sentence is wrapped in its own span so the centering flex box sees a single item: handed
      // "Mark <b>Agree</b>" as-is it makes two, and the space between them disappears.
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
            <span class="mv-example__callout" style="left: ${left.toFixed(2)}%; top: ${top.toFixed(2)}%;">
              <span>${verdictAction}</span>
            </span>
          </div>
          <figcaption class="mv-example__caption">
            <span class="mv-example__title">${slide.slideTitle}</span>
            <span class="mv-example__text">${slide.slideDescription}</span>
          </figcaption>
        </figure>`;
    }).join('');

    // Decorative: the strip itself is the scrollable region a screen reader announces, so the dots repeat nothing.
    const dots = slides
      .map((slide, i) => `<span class="mv-dot${i === 0 ? ' mv-dot--current' : ''}"></span>`)
      .join('');

    // The later examples are reachable only by scrolling the strip, so it has to be focusable: a keyboard or switch
    // user can then land on it and use the arrow keys, which is the only way past the first example without a
    // finger. A named group is what tells them what they have landed on.
    const stripLabel = i18next.t('validate:mission-start-tutorial.examples-label');
    return `
      <div class="mv-examples" tabindex="0" role="group" aria-label="${stripLabel}">${figures}</div>
      <div class="mv-dots" aria-hidden="true">${dots}</div>`;
  }

  /** Below this the title wraps instead of shrinking further, which is past the point of being readable. */
  static #TITLE_FLOOR_PX = 16;

  /**
   * Shrinks the mission title until it fits on one line, down to a floor — a title reads as one thought that way, and
   * the label types (and their translations) are too different in length for one size to fit them all. Past the floor
   * it wraps rather than shrink into the unreadable.
   *
   * A title that already fits is left entirely alone: the size it keeps is the heading token's, so retuning that
   * token moves this heading with every other one instead of leaving it behind at a number copied into here.
   *
   * @param {HTMLElement} title The title element, already holding the text to fit.
   */
  static #fitToOneLine(title) {
    // Cleared first so the starting size read below is the stylesheet's, not whatever the last title was shrunk to.
    title.style.fontSize = '';
    title.style.whiteSpace = 'nowrap';
    const startingSize = parseFloat(getComputedStyle(title).fontSize);
    const floor = ModalMission.#TITLE_FLOOR_PX;
    for (let size = startingSize; size > floor; size--) {
      if (title.scrollWidth <= title.clientWidth) return;
      title.style.fontSize = `${size - 1}px`;
    }
    if (title.scrollWidth > title.clientWidth) title.style.whiteSpace = '';
  }

  /**
   * Fits the title now, and again once the face it is set in has actually arrived.
   *
   * On a cold cache the first fit measures the fallback face, which is usually the narrower of the two, so a size
   * chosen against it leaves the real text overflowing a box whose overflow is hidden — and nothing would re-run the
   * fit until the next mission. Asking for the face resolves immediately once it is in hand, so every mission after
   * the first costs a microtask.
   *
   * @param {HTMLElement} title The title element, already holding the text to fit.
   */
  static #fitTitleWhenReady(title) {
    ModalMission.#fitToOneLine(title);
    if (!document.fonts) return;
    const { fontWeight, fontSize, fontFamily } = getComputedStyle(title);
    document.fonts.load(`${fontWeight} ${fontSize} ${fontFamily}`, title.textContent)
      .then(() => {
        // A dead end can take this screen over while the face is in flight, and it wants the heading's own size.
        if (!svv.modalNoNewMission?.isShowing()) ModalMission.#fitToOneLine(title);
      })
      .catch(() => { /* A face the browser won't parse is not worth failing the briefing over. */ });
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
    const labelType = mission.getProperty('labelType');
    const title = i18next.t('validate:mission-start-tutorial.mst-instruction-2', {
      nLabels: mission.getProperty('labelsValidated'),
      labelType: svv.labelTypeNames[labelType],
    });
    // Desktop reaches here too — MissionContainer starts every mission the same way — but shows this screen only to
    // announce a dead end (ModalNoNewMission). Building the briefing there would cost a tutorial photo fetched per
    // mission for markup nobody sees.
    this.show(title, util.isMobile() ? ModalMission.#buildExamples(labelType) : '', labelType);
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
    // Only the phone screen is tight enough to need it, and only it is visible: desktop's copy of this modal is
    // display:none, so a fit measured there would size the title against a box of zero width.
    if (util.isMobile()) ModalMission.#fitTitleWhenReady(this.#uiModalMission.missionTitle[0]);
    this.#uiModalMission.holder.css('visibility', 'visible');
    this.#uiModalMission.foreground.css('visibility', 'visible');
    // Hiding this screen only makes it invisible, which preserves how far it was scrolled — and briefings routinely
    // run past a phone screen, so without this the next mission's opens partway down.
    this.#uiModalMission.foreground.scrollTop(0);
    this.#uiModalMission.closeButton.html(i18next.t('common:mission-start-tutorial.start-mission'));
    this.#uiModalMission.closeButton.off('click').on('click', this.#handleButtonClick);
  }
}
