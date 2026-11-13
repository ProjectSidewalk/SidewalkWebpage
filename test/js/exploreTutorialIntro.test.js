/**
 * The four-step intro before the hands-on tutorial (frontend/js/explore/onboarding/TutorialIntro.js, #5840): stepping
 * through to Start Mission or skipping, which clip plays and the pause control over it, the Impact step's numbers
 * from /v3/api/aggregateStats, and what each action logs.
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker } from './fakes.js';
import { routeFetch, flush } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: {
  language: 'en',
  t: (key, opts) => {
    const vars = Object.entries(opts ?? {}).map(([name, value]) => `${name}=${value}`);
    return vars.length ? `${key}[${vars.join(',')}]` : key;
  },
} }));

const STEPS = ['explore', 'label', 'validate', 'impact'];

const PAGE = `
  <div id="tutorial-intro">
    <p id="tutorial-intro-route-note" hidden></p>
    ${STEPS.map((step, i) => `
      <video class="tutorial-intro__illustration-img${i === 0 ? ' is-active' : ''}" data-poster="${step}.webp"></video>
    `).join('')}
    <button type="button" id="tutorial-intro-motion-toggle" aria-pressed="false"></button>
    ${STEPS.map((step, i) => `<div class="tutorial-intro__step${i === 0 ? ' is-active' : ''}" data-step="${i}"></div>`)
      .join('')}
    <p id="tutorial-intro-impact-desc"></p>
    <button type="button" id="tutorial-intro-next-btn"></button>
    <a id="tutorial-intro-skip" href="/explore"></a>
  </div>`;

let TutorialIntro;
let tracker;
let onStart;
let onSkip;
let play;

const byId = (id) => document.getElementById(id);
const next = () => byId('tutorial-intro-next-btn');
const toggle = () => byId('tutorial-intro-motion-toggle');
const clips = () => [...document.querySelectorAll('.tutorial-intro__illustration-img')];
const activeStep = () => document.querySelector('.tutorial-intro__step.is-active').dataset.step;
const activeClip = () => clips().findIndex((el) => el.classList.contains('is-active'));

/**
 * Builds the intro.
 * @param {object} [options]
 * @param {boolean} [options.routeWaiting] - Whether a route is waiting past the tutorial.
 * @param {boolean} [options.reducedMotion] - Whether the visitor asked for reduced motion.
 * @returns {TutorialIntro} The intro, not yet shown.
 */
function intro({ routeWaiting = false, reducedMotion = false } = {}) {
  vi.stubGlobal('matchMedia', (query) => ({ matches: reducedMotion && query.includes('reduce') }));
  return new TutorialIntro(routeWaiting, tracker, { onStart, onSkip });
}

beforeEach(async () => {
  document.body.innerHTML = PAGE;
  tracker = fakeTracker();
  onStart = vi.fn();
  onSkip = vi.fn();
  play = vi.fn(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () { return play(this); });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  routeFetch({ '/v3/api/aggregateStats': { total_labels: 1234567, num_cities: 42 } });
  ({ TutorialIntro } = await loadModules('frontend/js/explore/onboarding/TutorialIntro.js'));
});

describe('TutorialIntro', () => {
  it('opens on the first step with focus on Next, and logs the start', () => {
    intro().show();

    expect(byId('tutorial-intro').classList).toContain('is-visible');
    expect(activeStep()).toBe('0');
    expect(activeClip()).toBe(0);
    expect(next().textContent).toBe('audit:tutorial-intro.next');
    expect(document.activeElement).toBe(next());
    expect(tracker.push).toHaveBeenCalledWith('TutorialIntro_Start');
    expect(byId('tutorial-intro-route-note').hidden).toBe(true);
  });

  it('says the route is still waiting when the labeler came for one', () => {
    intro({ routeWaiting: true }).show();
    expect(byId('tutorial-intro-route-note').hidden).toBe(false);
  });

  it('steps through to Start Mission, logging each step, then hands over to the tutorial', () => {
    intro().show();

    next().click();
    next().click();
    expect(activeStep()).toBe('2');
    expect(activeClip()).toBe(2);
    expect(next().textContent).toBe('audit:tutorial-intro.next');
    next().click();
    expect(activeStep()).toBe('3');
    expect(next().textContent).toBe('audit:tutorial-intro.start-mission');
    expect(tracker.push.mock.calls.filter(([name]) => name === 'TutorialIntro_Next').map(([, data]) => data.step))
      .toEqual([1, 2, 3]);
    expect(onStart).not.toHaveBeenCalled();

    next().click();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(tracker.push).toHaveBeenCalledWith('TutorialIntro_StartMission');
    expect(byId('tutorial-intro').classList).not.toContain('is-visible');
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it('skips the tutorial from the link without leaving the page', () => {
    intro().show();
    const click = new MouseEvent('click', { cancelable: true });

    byId('tutorial-intro-skip').dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
    expect(tracker.push).toHaveBeenCalledWith('TutorialIntro_Skip');
  });

  it('plays the showing step\'s clip without its still, and the next step\'s after Next', () => {
    intro().show();
    expect(play).toHaveBeenCalledWith(clips()[0]);
    expect(clips()[0].hasAttribute('poster')).toBe(false);
    expect(toggle().getAttribute('aria-pressed')).toBe('false');

    next().click();
    expect(play).toHaveBeenLastCalledWith(clips()[1]);
  });

  it('pauses the clip on its still from the control, and plays it again, logging each', () => {
    intro().show();

    toggle().click();
    expect(clips()[0].getAttribute('poster')).toBe('explore.webp');
    expect(toggle().classList).toContain('is-paused');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(tracker.push).toHaveBeenCalledWith('TutorialIntro_PauseAnimation');

    // A step change doesn't restart motion the visitor turned off.
    next().click();
    expect(play).toHaveBeenCalledTimes(1);
    expect(clips()[1].getAttribute('poster')).toBe('label.webp');

    toggle().click();
    expect(play).toHaveBeenLastCalledWith(clips()[1]);
    expect(clips()[1].hasAttribute('poster')).toBe(false);
    expect(tracker.push).toHaveBeenCalledWith('TutorialIntro_PlayAnimation');
  });

  it('starts paused on the still for a visitor who asked for reduced motion', () => {
    intro({ reducedMotion: true }).show();

    expect(play).not.toHaveBeenCalled();
    expect(clips()[0].getAttribute('poster')).toBe('explore.webp');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the still when the browser refuses to play the clip', async () => {
    play = () => Promise.reject(new Error('NotAllowedError'));
    intro().show();
    await flush();

    expect(clips()[0].getAttribute('poster')).toBe('explore.webp');
  });

  it('fills the Impact step with the compact totals once they arrive, fetching them only once', async () => {
    const i = intro();
    i.show();
    expect(byId('tutorial-intro-impact-desc').textContent).toBe('audit:tutorial-intro.impact.tagline');

    await flush();
    expect(byId('tutorial-intro-impact-desc').textContent).toBe([
      'audit:tutorial-intro.impact.stat-labels[total=1.2M]',
      'audit:tutorial-intro.impact.stat-cities[cities=42]',
      'audit:tutorial-intro.impact.tagline',
    ].join('\n\n'));

    i.show();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps just the tagline when the totals never come', async () => {
    routeFetch({ '/v3/api/aggregateStats': { status: 500 } });
    intro().show();
    await flush();

    expect(byId('tutorial-intro-impact-desc').textContent).toBe('audit:tutorial-intro.impact.tagline');
  });

  it('copes without the optional route note and Impact copy on the page', async () => {
    byId('tutorial-intro-route-note').remove();
    byId('tutorial-intro-impact-desc').remove();

    expect(() => intro({ routeWaiting: true }).show()).not.toThrow();
    await flush();
  });
});
