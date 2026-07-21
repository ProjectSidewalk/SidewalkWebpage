/**
 * About page dynamic content (#4631).
 *
 * Hydrates the team roster, related publications, and grant list from the Makeability Lab API so those sections never
 * rot: the ML site's admin backend is the single source of truth for who is on the project, what we've published, and
 * who funds us. Every section keeps its server-rendered fallback if a request fails — hydration only ever adds.
 * (Deployment stats hydration lives separately in js/common/aggregateStats.js.)
 */
class AboutPage {
  static #ML_API_BASE = 'https://makeabilitylab.cs.washington.edu/api/v1';
  static #CACHE_PREFIX = 'psAboutMlApi:';
  static #CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour: fresh enough for roster/pub edits, avoids hammering the ML server.
  static #FETCH_TIMEOUT_MS = 10000;
  static #MAX_PAGES = 20; // Pagination follow cap; a runaway `next` chain should never loop forever.
  static #INITIAL_PUB_COUNT = 8;
  static #FALLBACK_PHOTO = '/assets/images/logos/ProjectSidewalkLogo_NoText_100x100.png';

  // Display order for project leads, mirroring the ML site (makeabilitylabwebsite website/models/project.py).
  static #LEAD_ROLE_ORDER = ['PI', 'Co-PI', 'Student Lead', 'Postdoc Lead', 'Research Scientist Lead'];
  static #LEAD_ROLE_LABELS = { 'PI': 'Principal Investigator', 'Co-PI': 'Co-Principal Investigator' };

  /**
   * Kicks off all hydrators concurrently and wires up click logging. Each hydrator catches its own errors so one
   * failed request can't blank another section.
   */
  init() {
    this.#initClickLogging();
    this.#renderTeam().catch((e) => console.warn('About page: team hydration failed.', e));
    this.#renderPubs().catch((e) => console.warn('About page: publications hydration failed.', e));
    this.#renderGrants().catch((e) => console.warn('About page: grants hydration failed.', e));
  }

  /**
   * Escapes a string for safe interpolation into an HTML template literal.
   *
   * @param {string} text - Untrusted text (API-sourced names/titles may contain quotes or angle brackets).
   * @returns {string} HTML-escaped text; empty string for null/undefined.
   */
  #esc(text) {
    return String(text ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  /**
   * Fetches JSON with a timeout, memoized in sessionStorage so reloads within the TTL skip the network entirely.
   *
   * @param {string} url - Absolute URL to fetch.
   * @returns {Promise<object>} Parsed JSON response.
   */
  async #fetchJson(url) {
    const cacheKey = AboutPage.#CACHE_PREFIX + url;
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey));
      if (cached && Date.now() - cached.t < AboutPage.#CACHE_TTL_MS) return cached.d;
    } catch { /* Malformed cache entry: fall through to the network. */ }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(AboutPage.#FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const data = await response.json();

    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), d: data }));
    } catch { /* Storage full/disabled: caching is best-effort. */ }
    return data;
  }

  /**
   * Fetches every page of a paginated ML API listing by following `next` links.
   *
   * @param {string} url - First page URL.
   * @returns {Promise<object[]>} Concatenated `results` arrays from all pages.
   */
  async #fetchAllPages(url) {
    const results = [];
    let next = url;
    for (let page = 0; next && page < AboutPage.#MAX_PAGES; page++) {
      const data = await this.#fetchJson(next);
      results.push(...data.results);
      next = data.next;
    }
    return results;
  }

  /**
   * Renders the current-team photo grid and the past-leadership list, then unhides the container.
   */
  async #renderTeam() {
    const container = document.getElementById('about-team-live');
    if (!container) return;

    const people = await this.#fetchAllPages(`${AboutPage.#ML_API_BASE}/projects/sidewalk/people/?format=json`);
    const leadRank = (p) => {
      const rank = AboutPage.#LEAD_ROLE_ORDER.indexOf(p.lead_project_role);
      return rank === -1 ? AboutPage.#LEAD_ROLE_ORDER.length : rank;
    };

    const current = people
      .filter((p) => p.is_active)
      .sort((a, b) => leadRank(a) - leadRank(b) || a.start_date.localeCompare(b.start_date));
    const pastLeads = people
      .filter((p) => !p.is_active && p.lead_project_role)
      .sort((a, b) => leadRank(a) - leadRank(b) || a.start_date.localeCompare(b.start_date));
    if (current.length === 0) return;

    // The project-people payload has no title/affiliation, so pull each active member's profile for their current
    // title (e.g. "Professor", "Research Scientist"). Best-effort: a miss falls back to their project role.
    const titles = new Map();
    const profiles = await Promise.allSettled(
      current.map((p) => this.#fetchJson(`${AboutPage.#ML_API_BASE}/people/${p.person.url_name}/?format=json`)),
    );
    profiles.forEach((result, i) => {
      if (result.status === 'fulfilled') titles.set(current[i].person.url_name, result.value.current_title);
    });

    const roleText = (p) => {
      const lead = AboutPage.#LEAD_ROLE_LABELS[p.lead_project_role] ?? p.lead_project_role;
      const title = titles.get(p.person.url_name) || p.role;
      return [lead, title].filter(Boolean).join(' · ');
    };
    document.getElementById('about-team-current').innerHTML = current.map((p) => `
      <li class="about-team-member">
        <a href="${this.#esc(p.person.url)}">
          <img class="about-team-photo" src="${this.#esc(p.person.thumbnail || AboutPage.#FALLBACK_PHOTO)}" alt="">
          <span class="about-team-name">${this.#esc(p.person.name)}</span>
        </a>
        <span class="about-team-role">${this.#esc(roleText(p))}</span>
      </li>`).join('');

    const years = (p) => `${p.start_date.slice(0, 4)}–${p.end_date ? p.end_date.slice(0, 4) : ''}`;
    document.getElementById('about-team-past').innerHTML = pastLeads.map((p) => `
      <li>
        <a href="${this.#esc(p.person.url)}">${this.#esc(p.person.name)}</a>
        <span class="about-team-role">${this.#esc(p.lead_project_role)}, ${this.#esc(years(p))}</span>
      </li>`).join('');

    // The localized message carries a {0} placeholder for the count of everyone not shown above.
    const contributorsEl = document.getElementById('about-team-contributors');
    const otherCount = people.length - current.length - pastLeads.length;
    if (otherCount > 0) {
      contributorsEl.innerHTML = contributorsEl.innerHTML.replace('{0}', String(otherCount));
    } else {
      contributorsEl.remove();
    }
    container.hidden = false;
  }

  /**
   * Renders publication rows (most recent first). The most recent few plus all award winners are visible up front;
   * the rest stay hidden behind a localized "Show all N publications" button.
   */
  async #renderPubs() {
    const list = document.getElementById('about-pubs-list');
    if (!list) return;

    const pubs = await this.#fetchAllPages(`${AboutPage.#ML_API_BASE}/projects/sidewalk/publications/?format=json`);
    pubs.sort((a, b) => b.date.localeCompare(a.date));
    if (pubs.length === 0) return;

    list.innerHTML = pubs.map((pub, i) => {
      const initiallyVisible = i < AboutPage.#INITIAL_PUB_COUNT || pub.award;
      const titleUrl = pub.pdf_url || pub.official_url || pub.arxiv_url || pub.forum_url;
      // Some forum names already end in the year ("Proceedings of CHI 2025"); don't repeat it.
      const hasYear = String(pub.forum_name).includes(String(pub.year));
      const venue = hasYear ? pub.forum_name : `${pub.forum_name} ${pub.year}`;
      const links = [
        pub.pdf_url ? `<a href="${this.#esc(pub.pdf_url)}">PDF</a>` : '',
        pub.arxiv_url ? `<a href="${this.#esc(pub.arxiv_url)}">arXiv</a>` : '',
        pub.official_url ? `<a href="${this.#esc(pub.official_url)}">DOI</a>` : '',
        pub.code_repo_url ? `<a href="${this.#esc(pub.code_repo_url)}">Code</a>` : '',
      ].filter(Boolean).join(' ');
      return `
        <article class="about-pub"${initiallyVisible ? '' : ' hidden'}>
          <img class="about-pub-thumb" loading="lazy" src="${this.#esc(pub.thumbnail)}" alt="">
          <div>
            <h3>${titleUrl ? `<a href="${this.#esc(titleUrl)}">${this.#esc(pub.title)}</a>` : this.#esc(pub.title)}</h3>
            <p class="about-pub-authors">${pub.authors.map((a) => this.#esc(a.name)).join(', ')}</p>
            <p class="about-pub-venue">${this.#esc(venue)}${pub.award
              ? ` · <span class="about-pub-award">🏆 ${this.#esc(pub.award)}</span>`
              : ''}</p>
            <p class="about-pub-links">${links}</p>
          </div>
        </article>`;
    }).join('');

    const showAllButton = document.getElementById('about-pubs-show-all');
    if (list.querySelector('[hidden]')) {
      showAllButton.textContent = showAllButton.dataset.labelTemplate.replace('{0}', String(pubs.length));
      showAllButton.hidden = false;
      showAllButton.addEventListener('click', () => {
        list.querySelectorAll('[hidden]').forEach((el) => {
          el.hidden = false;
        });
        showAllButton.hidden = true;
      });
    }
  }

  /**
   * Renders the grant list (most recent first) and unhides it. The static funding paragraph stays as context.
   */
  async #renderGrants() {
    const list = document.getElementById('about-funding-grants');
    if (!list) return;

    const grants = await this.#fetchAllPages(`${AboutPage.#ML_API_BASE}/projects/sidewalk/grants/?format=json`);
    grants.sort((a, b) => b.start_date.localeCompare(a.start_date));
    if (grants.length === 0) return;

    list.innerHTML = grants.map((grant) => {
      const title = this.#esc(grant.title);
      const grantId = grant.grant_id ? ` (#${this.#esc(grant.grant_id)})` : '';
      return `
        <li>
          ${grant.grant_url ? `<a href="${this.#esc(grant.grant_url)}">${title}</a>` : title}
          — ${this.#esc(grant.sponsor.name)}${grantId}
        </li>`;
    }).join('');
    list.hidden = false;
  }

  /**
   * Logs clicks on CTAs and on hydrated outbound links to WebpageActivity, following the footer's
   * "Click_module=..." convention (see docs/logged-events.md).
   */
  #initClickLogging() {
    const log = (target) => {
      if (typeof window.logWebpageActivity === 'function') {
        window.logWebpageActivity(`Click_module=AboutPage_target=${target}`);
      }
    };
    const staticTargets = [
      ['about-hero-explore-link', 'hero_explore'],
      ['about-hero-data-link', 'hero_data'],
      ['about-cta-explore-link', 'cta_explore'],
      ['about-cta-city-link', 'cta_city'],
      ['about-funder-nsf-link', 'funder_nsf'],
      ['about-funder-google-link', 'funder_google'],
      ['about-funder-sloan-link', 'funder_sloan'],
      ['about-funder-pactrans-link', 'funder_pactrans'],
      ['about-funder-create-link', 'funder_create'],
    ];
    staticTargets.forEach(([id, target]) => {
      document.getElementById(id)?.addEventListener('click', () => log(target));
    });

    // Hydrated sections use delegation since their links don't exist yet at init time.
    const delegatedTargets = [
      ['about-team-live', 'team_member'],
      ['about-pubs-list', 'publication'],
      ['about-funding-grants', 'grant'],
    ];
    delegatedTargets.forEach(([id, target]) => {
      document.getElementById(id)?.addEventListener('click', (e) => {
        if (e.target.closest('a')) log(target);
      });
    });
  }
}

window.appManager.ready(() => {
  new AboutPage().init();
});
