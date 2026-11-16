/**
 * Tests for the click logging on the two page footers (frontend/js/common/footerLogging.js). The activity strings are
 * read by the admin analytics and listed in docs/logged-events.md, so their shape per footer column is pinned here,
 * along with the tool pages that render no footer at all (#5840).
 */

import { loadModules } from './loader.js';

/** The two footers as main.scala.html renders them, cut down to a link or two per column. */
const FOOTERS = `
  <footer>
    <div id="footer-container">
      <div class="footer-link">
        <span class="footer-header">PROJECT SIDEWALK</span>
        <a href="/about" id="sidewalk-about-link">About</a>
      </div>
      <div class="footer-link">
        <span class="footer-header">DEVELOPER</span>
        <a href="/api" id="developer-api-link">API</a>
      </div>
      <div class="footer-link">
        <span class="footer-header">CONNECT</span>
        <a href="https://github.com/ProjectSidewalk/SidewalkWebpage" id="connect-github-link"><svg></svg>Github</a>
      </div>
    </div>
    <div id="info-footer">
      <p><span id="funding-title">Funding</span></p>
      <a href="https://www.nsf.gov/" id="nsf-link"><img src="/assets/images/nsf.png" alt="NSF"></a>
    </div>
  </footer>`;

let initFooterLogging;

beforeEach(async () => {
  window.history.replaceState(null, '', '/labelingGuide');
  window.logWebpageActivity = vi.fn();
  window.appManager = { ready: (callback) => callback() };
  ({ initFooterLogging } = await loadModules('frontend/js/common/footerLogging.js'));
});

/** @param {string} selector - What to click, inside one of the footers. */
const click = (selector) => document.querySelector(selector).dispatchEvent(new MouseEvent('click', { bubbles: true }));

describe('footer click logging', () => {
  beforeEach(() => {
    document.body.innerHTML = FOOTERS;
    initFooterLogging();
  });

  it.each([
    ['#sidewalk-about-link', 'Click_module=Footer_section=sidewalk_target=about_route=/labelingGuide'],
    ['#developer-api-link', 'Click_module=Footer_section=developer_target=api_route=/labelingGuide'],
    ['#connect-github-link svg', 'Click_module=Footer_section=connect_platform=github_route=/labelingGuide'],
    ['#nsf-link img', 'Click_module=InfoFooter_target=nsf_route=/labelingGuide'],
  ])('logs a click on %s as the link it is in', (selector, logged) => {
    click(selector);

    expect(window.logWebpageActivity).toHaveBeenCalledExactlyOnceWith(logged);
  });

  it('logs nothing for a click in a footer that misses every link', () => {
    click('#footer-container .footer-header');
    click('#funding-title');

    expect(window.logWebpageActivity).not.toHaveBeenCalled();
  });
});

describe('a tool page with no footer', () => {
  it('sets up without complaint', () => {
    document.body.innerHTML = '<div id="wrap"></div>';

    expect(() => initFooterLogging()).not.toThrow();
  });
});
