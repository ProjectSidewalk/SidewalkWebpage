/**
 * Pre-tutorial intro shown before the Explore onboarding tutorial begins.
 *
 * A four-step, full-page walkthrough (Explore -> Label -> Validate -> Impact) before the hands-on tutorial.
 *
 * The step copy lives in i18next (audit:tutorial-intro.*); the per-step illustration and icon markup live in the
 * Explore Twirl view. This class tracks which step is active, drives that step's illustration clip, and swaps the
 * "Next"/"Start Mission" label.
 */
class TutorialIntro {
  #tracker;
  #onStart;
  #onSkip;
  #stepIndex = 0;
  #stepCount;
  #ui;
  #impactStats = null; // { totalLabels, numCities } once /v3/api/aggregateStats resolves; null until then.
  #impactFetchStarted = false;
  // Starts out off for a visitor who has asked for reduced motion; after that it follows the pause control, so moving
  // to the next step never restarts motion someone turned off.
  #motionPaused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * @param {object} tracker - Interaction logger (svl.tracker).
   * @param {object} callbacks - Callbacks fired when the user leaves the intro.
   * @param {Function} callbacks.onStart - Invoked when the user finishes the intro and starts the tutorial.
   * @param {Function} callbacks.onSkip - Invoked when the user skips the tutorial from the intro.
   */
  constructor(tracker, { onStart, onSkip }) {
    this.#tracker = tracker;
    this.#onStart = onStart;
    this.#onSkip = onSkip;

    this.#ui = {
      root: document.getElementById('tutorial-intro'),
      steps: [...document.querySelectorAll('.tutorial-intro__step')],
      illustrations: [...document.querySelectorAll('.tutorial-intro__illustration-img')],
      nextButton: document.getElementById('tutorial-intro-next-btn'),
      skipLink: document.getElementById('tutorial-intro-skip'),
      motionToggle: document.getElementById('tutorial-intro-motion-toggle'),
      impactDesc: document.getElementById('tutorial-intro-impact-desc'),
      routeNote: document.getElementById('tutorial-intro-route-note'),
    };
    this.#stepCount = this.#ui.steps.length;

    this.#ui.nextButton.addEventListener('click', () => this.#handleNext());
    this.#ui.skipLink.addEventListener('click', (e) => {
      e.preventDefault();
      this.#tracker.push('TutorialIntro_Skip');
      this.#stopIllustrations();
      this.#onSkip();
    });
    this.#ui.motionToggle.addEventListener('click', () => {
      this.#motionPaused = !this.#motionPaused;
      this.#tracker.push(this.#motionPaused ? 'TutorialIntro_PauseAnimation' : 'TutorialIntro_PlayAnimation');
      this.#applyMotionState();
    });
  }

  /** Show the intro at the first step and move keyboard focus to the primary action. */
  show() {
    this.#tracker.push('TutorialIntro_Start');
    // A user who clicked through to a specific route lands here instead, so say the route is still waiting —
    // otherwise the tutorial looks like it replaced what they asked for.
    if (this.#ui.routeNote && new URLSearchParams(window.location.search).has('routeId')) {
      this.#ui.routeNote.hidden = false;
    }
    // Kick off the Impact-stats fetch now (fire-and-forget): the Impact step is last, so the server-cached numbers are
    // essentially always back before the user clicks that far, and we never block the intro on the request.
    this.#fetchImpactStats();
    this.#stepIndex = 0;
    this.#render();
    this.#ui.root.classList.add('is-visible');
    this.#ui.nextButton.focus();
  }

  /**
   * Fetches the cross-city label/city totals from the aggregate-stats endpoint and then fills in the Impact step.
   */
  #fetchImpactStats() {
    if (this.#impactFetchStarted) return;
    this.#impactFetchStarted = true;

    fetch('/v3/api/aggregateStats', { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data) => {
        this.#impactStats = { totalLabels: data.total_labels, numCities: data.num_cities };
        this.#renderImpactDescription();
      })
      .catch(() => {
        // Leave #impactStats null: the Impact step keeps just its tagline.
      });
  }

  /** Advance to the next step, or start the tutorial when the last step's "Start Mission" is clicked. */
  #handleNext() {
    if (this.#stepIndex < this.#stepCount - 1) {
      this.#stepIndex += 1;
      this.#tracker.push('TutorialIntro_Next', { step: this.#stepIndex });
      this.#render();
    } else {
      this.#tracker.push('TutorialIntro_StartMission');
      this.#ui.root.classList.remove('is-visible');
      this.#stopIllustrations();
      this.#onStart();
    }
  }

  /** Reflect the current step: show its illustration/copy and set the primary button's label. */
  #render() {
    const isLastStep = this.#stepIndex === this.#stepCount - 1;
    this.#ui.steps.forEach((el, i) => el.classList.toggle('is-active', i === this.#stepIndex));
    this.#stopIllustrations();
    this.#ui.illustrations.forEach((el, i) => el.classList.toggle('is-active', i === this.#stepIndex));
    this.#applyMotionState();
    this.#ui.nextButton.textContent = isLastStep
      ? i18next.t('audit:tutorial-intro.start-mission')
      : i18next.t('audit:tutorial-intro.next');
    this.#renderImpactDescription();
  }

  /** Pause every clip, so the step being left behind stops decoding while it sits hidden. */
  #stopIllustrations() {
    this.#ui.illustrations.forEach((el) => el.pause());
  }

  /**
   * Applies the current motion setting to the step that's showing and to the pause control's state.
   *
   * With motion on, the clip plays and loops. With motion off it stays paused on its still — the clip's last frame,
   * which is the one carrying the step's payoff (the "Label it!" callout, the finished streetscape) — and, since the
   * clips are `preload="none"`, nothing about the step is downloaded at all.
   */
  #applyMotionState() {
    const active = this.#ui.illustrations[this.#stepIndex];
    this.#ui.motionToggle.classList.toggle('is-paused', this.#motionPaused);
    this.#ui.motionToggle.setAttribute('aria-pressed', String(this.#motionPaused));

    if (this.#motionPaused) {
      active.pause();
      active.poster = active.dataset.poster;
      return;
    }
    // Drop the still before playing: it's the clip's last frame, so leaving it up would flash the end of the animation
    // over the opening frames while the clip loads.
    active.removeAttribute('poster');
    active.play().catch(() => {
      // Rejected when the browser refuses to play; the still stands in for the animation in that case.
      active.poster = active.dataset.poster;
    });
  }

  /**
   * Composes the Impact step's copy from whatever stats are available: the two stat lines are included only once the
   * aggregate-stats fetch has resolved, and the tagline always closes it out.
   */
  #renderImpactDescription() {
    if (!this.#ui.impactDesc) return;

    const lines = [];
    if (this.#impactStats) {
      const lang = i18next.language;
      const totalText = new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 })
        .format(this.#impactStats.totalLabels);
      const citiesText = new Intl.NumberFormat(lang).format(this.#impactStats.numCities);
      lines.push(i18next.t('audit:tutorial-intro.impact.stat-labels', { total: totalText }));
      lines.push(i18next.t('audit:tutorial-intro.impact.stat-cities', { cities: citiesText }));
    }
    lines.push(i18next.t('audit:tutorial-intro.impact.tagline'));
    this.#ui.impactDesc.textContent = lines.join('\n\n');
  }
}
