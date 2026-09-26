// How many ticks each how-it-works video plays before auto-advancing, in video order (roughly each video's length).
const HOW_IT_WORKS_TICKS = [18, 22, 17];
const TICK_SIZE = 500;

/**
 * One how-it-works video, plus its tab and the tab's parts that get highlighted while it's showing.
 * @typedef {object} HowItWorksStep
 * @property {HTMLVideoElement} video
 * @property {HTMLElement} tab
 * @property {HTMLElement[]} highlighted
 */

/** @type {HowItWorksStep[]} */
let howItWorksSteps = [];
let curStep = 0;
let numTicks = 0;
let autoAdvance = true;
let howItWorksVisible = false;

/**
 * Plays a video, swallowing the AbortError that fires when a pause() interrupts a still-pending play() — benign
 * here, where scrolling out of view and switching tabs legitimately race each other.
 * @param {HTMLVideoElement} video - The video to play.
 */
function safePlay(video) {
  video.play().catch(() => {});
}

/**
 * @param {string} id - The ID of a video element.
 * @returns {HTMLVideoElement}
 */
function getVideo(id) {
  return /** @type {HTMLVideoElement} */ (document.getElementById(id));
}

/**
 * Shows one how-it-works video from the start and highlights its tab; the others are hidden and paused.
 * @param {number} index - Which step to show, 0-based.
 */
function showHowItWorksStep(index) {
  howItWorksSteps.forEach((step, i) => {
    const isActive = i === index;
    step.video.classList.toggle('ps-hidden', !isActive);
    for (const el of step.highlighted) el.classList.toggle('activetab', isActive);
    if (!isActive) step.video.pause();
  });

  const video = howItWorksSteps[index].video;
  video.currentTime = 0;
  if (howItWorksVisible) safePlay(video);

  curStep = index;
  numTicks = 0;
}

// Advances to the next video once the current one has had its time, but only while the section is on screen.
function autoAdvanceHowItWorks() {
  if (!autoAdvance || !howItWorksVisible) return;
  numTicks++;
  if (numTicks >= HOW_IT_WORKS_TICKS[curStep]) {
    showHowItWorksStep((curStep + 1) % howItWorksSteps.length);
  }
}

/**
 * Calls onChange(true) when any part of the element scrolls into view and onChange(false) when it fully leaves.
 * @param {Element} el - The element to watch.
 * @param {(visible: boolean) => void} onChange
 */
function watchVisibility(el, onChange) {
  new IntersectionObserver((entries) => onChange(entries[entries.length - 1].isIntersecting)).observe(el);
}

window.appManager.ready(() => {
  howItWorksSteps = HOW_IT_WORKS_TICKS.map((_, i) => {
    const tab = document.getElementById(['firstnumbox', 'secondnumbox', 'thirdnumbox'][i]);
    return {
      video: getVideo(`vid${i + 1}`),
      tab,
      highlighted: [tab, document.getElementById(`word${i + 1}`), document.getElementById(`number${i + 1}`)],
    };
  });

  // Triggered upon clicking tabs in "How you can help" section.
  // Logs "Click_module=HowYouCanHelp_tab=<tabNumber>" in WebpageActivityTable
  howItWorksSteps.forEach((step, i) => {
    /**
     * Switches to this tab's video on a click, or on Enter/Space since the tab is a div with role="button".
     * @param {MouseEvent|KeyboardEvent} e
     */
    const onActivate = (e) => {
      if (e instanceof KeyboardEvent) {
        if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
        e.preventDefault(); // Otherwise Space also scrolls the page.
      }
      showHowItWorksStep(i);
      autoAdvance = false;
      window.logWebpageActivity(`Click_module=HowYouCanHelp_tab=${i + 1}`);
    };
    step.tab.addEventListener('click', onActivate);
    step.tab.addEventListener('keydown', onActivate);
  });

  // Triggered when a logo or credit link in the Community Partners section is clicked (#4516).
  // Logs "Click_module=Partner_source=<slugged partner name, e.g. "makeability-lab">".
  document.getElementById('partners-container').addEventListener('click', (e) => {
    const link = /** @type {HTMLElement} */ (e.target).closest('a[data-partner-source]');
    if (link) window.logWebpageActivity(`Click_module=Partner_source=${link.dataset.partnerSource || 'unknown'}`);
  });

  // Triggered when 'Start Exploring' in video container is clicked.
  // Logs "Click_module=StartExploring_location=Index"
  document.getElementById('landing-cta-button').addEventListener('click', () => {
    window.logWebpageActivity('Click_module=StartExploring_location=Index');
  });

  // Triggered when 'Click here to learn about deploying PS in your city' is clicked.
  // Logs "Click_module=NewCity_location=Index"
  document.getElementById('new-deployment-link').addEventListener('click', () => {
    window.logWebpageActivity('Click_module=NewCity_location=Index');
  });

  // Triggered when the mapathon link (only shown when the city has one configured) is clicked.
  // Logs "Click_module=mapathonLink"
  document.getElementById('mapathonLink')?.addEventListener('click', () => {
    window.logWebpageActivity('Click_module=mapathonLink');
  });

  // Toggle the tall-navbar class on scroll so the navbar shrinks once the user starts scrolling.
  const header = document.getElementById('header');
  const updateHeaderHeight = () => {
    if (window.scrollY > 20) {
      header.classList.remove('header--tall');
    } else {
      header.classList.add('header--tall');
    }
  };
  updateHeaderHeight();
  window.addEventListener('scroll', updateHeaderHeight, { passive: true });

  // Count up the city's stats the first time they're fully on screen.
  new IntersectionObserver((entries, observer) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    for (const anim of [percentageAnim, labelsAnim, distanceAnim, validationsAnim]) anim.start();
  }, { threshold: 1 }).observe(document.getElementById('percentage'));

  // Only play the videos while they're on screen.
  const bannerVid = getVideo('bgvid');
  watchVisibility(document.getElementById('vidbanner'), (visible) => {
    if (visible) safePlay(bannerVid);
    else bannerVid.pause();
  });
  watchVisibility(document.getElementById('instructionvideo'), (visible) => {
    howItWorksVisible = visible;
    const video = howItWorksSteps[curStep].video;
    if (visible) safePlay(video);
    else video.pause();
  });

  showHowItWorksStep(0);
  setInterval(autoAdvanceHowItWorks, TICK_SIZE);

  warmHiddenInstructionVideos();
});

/**
 * Downloads the two initially-hidden how-it-works videos once the page is loaded and idle (#4486).
 */
function warmHiddenInstructionVideos() {
  if (util.saveDataEnabled()) return;
  util.afterLoadIdle(() => {
    for (const video of [getVideo('vid2'), getVideo('vid3')]) {
      // Only warm a video nothing has touched: load() aborts playback and resets currentTime, and by now a tab click
      // or auto-advance may already be playing it, which would leave the visitor on a frozen frame.
      if (!video || !video.paused || video.currentTime > 0) continue;
      video.preload = 'auto';
      // Changing the attribute doesn't re-run resource selection on its own; load() does.
      video.load();
    }
  });
}
