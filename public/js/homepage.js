let autoAdvanceLaptop = true;

/**
 * @param {Element} elem - The element to check.
 * @returns {boolean} True if the whole element is inside the window's visible area.
 */
function isScrolledIntoView(elem) {
  const rect = elem.getBoundingClientRect();
  return rect.top >= 0 && rect.bottom <= window.innerHeight;
}

window.addEventListener('scroll', numbersInView, { passive: true });

function numbersInView() {
  if (isScrolledIntoView(document.getElementById('percentage'))) {
    if (percentageAnim && labelsAnim) {
      percentageAnim.start();
      labelsAnim.start();
      distanceAnim.start();
      validationsAnim.start();
    }
  }
}

/**
 * Plays a video, swallowing the AbortError that fires when a pause() interrupts a still-pending play() — benign
 * here, where lazyPlay (scroll) and switchToVideo (tab clicks + auto-advance) legitimately race each other.
 * @param {HTMLVideoElement} video - The video to play.
 */
function safePlay(video) {
  video.play().catch(() => {});
}

/**
 * @param {string} id - The ID of one of the how-it-works videos.
 * @returns {HTMLVideoElement}
 */
function getVideo(id) {
  return /** @type {HTMLVideoElement} */ (document.getElementById(id));
}

// The clickable tab for each how-it-works video, in video order.
const TAB_BOX_IDS = ['firstnumbox', 'secondnumbox', 'thirdnumbox'];

/**
 * Shows and plays one how-it-works video, highlights its tab, and hides/pauses the others.
 * @param {number} vidnum - Which video to show, 1-3.
 */
function switchToVideo(vidnum) {
  for (let i = 1; i <= TAB_BOX_IDS.length; i++) {
    const isActive = i === vidnum;
    const video = getVideo(`vid${i}`);
    video.classList.toggle('ps-hidden', !isActive);

    for (const id of [`word${i}`, TAB_BOX_IDS[i - 1], `number${i}`]) {
      const el = document.getElementById(id);
      el.classList.add('tab-word');
      el.classList.toggle('activetab', isActive);
    }

    if (isActive) {
      video.currentTime = 0;
      safePlay(video);
    } else {
      video.pause();
    }
  }

  // Reset auto-advance counter.
  numTicks = 0;
}

let vidBanner;
let bannerVid;
let instructVideoContainer;
let instructVideos;

const DEFAULT_VIDEO = 1;
const TICK_SIZE = 500;
const requiredTicks = [18, 22, 17];
let curVideo = 1;
let numTicks = 0;

// Advances to next instruction video if the videos are in the user's viewport and enough "ticks" have gone by.
function autoAdvanceLaptopVideos() {
  if (!autoAdvanceLaptop) return;

  numTicks++;

  if (numTicks >= requiredTicks[curVideo - 1] && isElementVerticallyVisible(instructVideoContainer)) {
    numTicks = 0;
    curVideo++;

    if (curVideo > requiredTicks.length) {
      curVideo = DEFAULT_VIDEO;
    }

    switchToVideo(curVideo);
  }
}

window.appManager.ready(() => {
  // Triggered upon clicking tabs in "How you can help" section.
  // Logs "Click_module=HowYouCanHelp_tab=<tabNumber>" in WebpageActivityTable
  TAB_BOX_IDS.forEach((id, i) => {
    const onActivate = (e) => {
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      switchToVideo(i + 1);
      autoAdvanceLaptop = false;
      window.logWebpageActivity(`Click_module=HowYouCanHelp_tab=${i + 1}`);
    };
    const tab = document.getElementById(id);
    tab.addEventListener('click', onActivate);
    tab.addEventListener('keydown', onActivate);
  });

  // Triggered when a logo or credit link in the Community Partners section is clicked (#4516).
  // Logs "Click_module=Partner_source=<slugged partner name, e.g. "makeability-lab">".
  document.getElementById('partners-container').addEventListener('click', (e) => {
    const link = /** @type {Element} */ (e.target).closest('a');
    if (!link) return;
    window.logWebpageActivity(`Click_module=Partner_source=${link.dataset.partnerSource || 'unknown'}`);
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

  // Triggered when the city or mapathon links are clicked.
  // If a city link is clicked logs "Click_module=OtherCityLink_City=cityName".
  // If a mapathon link is clicked logs "Click_module=mapathonLink".
  for (const link of document.querySelectorAll('.other-city-link')) {
    link.addEventListener('click', () => {
      const cityName = link.id;
      if (cityName === 'mapathonLink') {
        window.logWebpageActivity('Click_module=mapathonLink');
      } else {
        window.logWebpageActivity(`Click_module=OtherCityLink_City=${cityName}`);
      }
    });
  }

  // Setup video lazyPlay.
  window.addEventListener('scroll', onScroll, { passive: true });

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

  vidBanner = document.getElementById('vidbanner');
  bannerVid = getVideo('bgvid');

  instructVideoContainer = document.getElementById('instructionvideo');
  instructVideos = [getVideo('vid1'), getVideo('vid2'), getVideo('vid3')];

  // Auto advance instruction videos.
  switchToVideo(DEFAULT_VIDEO);
  setInterval(autoAdvanceLaptopVideos, TICK_SIZE);

  warmHiddenInstructionVideos();
});

/**
 * Downloads the two initially-hidden how-it-works videos once the page is loaded and idle (#4486).
 */
function warmHiddenInstructionVideos() {
  if (util.saveDataEnabled()) return;
  util.afterLoadIdle(() => {
    for (const video of [getVideo('vid2'), getVideo('vid3')]) {
      // Only warm a video nothing has touched. load() aborts playback and resets currentTime, and by the time this
      // runs either of these may be playing: lazyPlay starts every video in the section on scroll, hidden ones
      // included, and auto-advance switches to vid2 about 9s in. Restarting isn't automatic either — lazyPlay still
      // believes it's playing — so the visitor would be left watching a frozen frame.
      if (!video || !video.paused || video.currentTime > 0) continue;
      video.preload = 'auto';
      // Changing the attribute doesn't re-run resource selection on its own; load() does.
      video.load();
    }
  });
}

const pausedVideos = {};

/**
 * Returns a function that invokes fn at most once per `wait` ms, firing on the leading edge.
 * @param {Function} fn - Function to throttle.
 * @param {number} wait - Minimum ms between invocations.
 */
function throttle(fn, wait) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= wait) {
      lastCall = now;
      fn.apply(this, args);
    }
  };
}

/**
 * Returns a function that delays invoking fn until `wait` ms have passed since the last call.
 * @param {Function} fn - Function to debounce.
 * @param {number} wait - Ms of inactivity required before fn fires.
 */
function debounce(fn, wait) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

// Wrappers around lazyPlayVideos().
const lazyPlayVideosThrottled = throttle(lazyPlayVideos, 300);
const lazyPlayVideosDebounced = debounce(lazyPlayVideos, 600);

// Triggered when the user scrolls.
function onScroll() {
  lazyPlayVideosThrottled(); // While scrolling, run the check every 300ms.
  lazyPlayVideosDebounced(); // After scrolling, make sure we run the check.
}

// lazyPlays our main videos.
function lazyPlayVideos() {
  lazyPlay(vidBanner, bannerVid);

  for (let i = 0; i < instructVideos.length; i++) {
    lazyPlay(instructVideoContainer, instructVideos[i]);
  }
}

// Pauses a video if a certain element is outside of the viewport, plays the video otherwise.
function lazyPlay(el, video) {
  if (isElementVerticallyVisible(el)) {
    if (!isVideoPlaying(video)) {
      pausedVideos[video.id] = false;
      safePlay(video);
    }
  } else if (isVideoPlaying(video)) {
    pausedVideos[video.id] = true;
    video.pause();
  }
}

// Returns true if the given video is playing.
function isVideoPlaying(video) {
  return !pausedVideos[video.id];
}

// Returns true if the given element is in the vertical viewport.
function isElementVerticallyVisible(el) {
  const rect = el.getBoundingClientRect();
  const windowHeight = (window.innerHeight || document.documentElement.clientHeight);

  return (rect.top <= windowHeight) && ((rect.top + rect.height) >= 0);
}
