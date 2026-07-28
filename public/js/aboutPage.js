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
  // The CHI 2019 paper is the one we ask people to cite; identified by DOI so an id or title edit can't break it.
  static #CITATION_DOI = '10.1145/3290605.3300292';
  static #FALLBACK_PHOTO = '/assets/images/logos/ProjectSidewalkLogo_NoText_100x100.png';

  // Inline formatting a citation can legitimately carry: emphasis for the venue, a link to the paper. See
  // #sanitizeCitation for why the allowlist is this narrow.
  static #CITATION_TAGS = new Set(['A', 'B', 'EM', 'I', 'STRONG', 'SPAN', 'BR', 'SUB', 'SUP']);

  // Every ML API `position_title` that means "student", at any level. Designers, coordinators, research staff, and
  // faculty hold the other titles: they count as contributors but not toward the student figure.
  static #STUDENT_TITLES = ['High School Student', 'Undergrad', 'MS Student', 'PhD Student'];

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
   * Reduces a citation string to the inline formatting a citation actually needs, dropping every other element and
   * every attribute but an http(s) `href`.
   *
   * `citation_html` is the one ML API string this page injects as markup rather than escaping — it carries the `<i>`
   * and `<a>` that make a citation readable, and formatting it here instead would duplicate the lab's own citation
   * renderer and drift from it. That injection crosses a trust boundary into a separate application with its own
   * admin UI, though, and `innerHTML` runs `<img onerror>` and `<svg onload>` even though it ignores `<script>`. So
   * the markup is parsed inert (DOMParser never loads resources or runs handlers) and rebuilt from an allowlist:
   * anything unrecognized is unwrapped to its text, so a mangled citation still reads correctly.
   *
   * @param {string} html - Citation markup from the ML API.
   * @returns {string} Markup containing only allowlisted tags, with only `href` surviving on links.
   */
  #sanitizeCitation(html) {
    const body = new DOMParser().parseFromString(String(html ?? ''), 'text/html').body;
    const clean = (node) => {
      // Depth-first so a node's children are already clean by the time unwrapping hoists them into its place.
      for (const child of [...node.children]) clean(child);
      if (!AboutPage.#CITATION_TAGS.has(node.tagName)) {
        node.replaceWith(...node.childNodes);
        return;
      }
      for (const attr of [...node.attributes]) {
        const isSafeHref = node.tagName === 'A' && attr.name === 'href' && /^https?:\/\//i.test(attr.value.trim());
        if (!isSafeHref) node.removeAttribute(attr.name);
      }
    };
    for (const child of [...body.children]) clean(child);
    return body.innerHTML;
  }

  /**
   * Fetches JSON with a timeout, memoized in localStorage so repeat visits within the TTL skip the network entirely.
   *
   * localStorage rather than sessionStorage because the TTL already bounds staleness: a per-tab cache would re-fetch
   * every section — a paginated listing each for the roster, the publications, and the grants — every time someone
   * opens /about in a new tab.
   *
   * @param {string} url - Absolute URL to fetch.
   * @returns {Promise<object>} Parsed JSON response.
   */
  async #fetchJson(url) {
    const cacheKey = AboutPage.#CACHE_PREFIX + url;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached && Date.now() - cached.t < AboutPage.#CACHE_TTL_MS) return cached.d;
    } catch { /* Malformed cache entry: fall through to the network. */ }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(AboutPage.#FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const data = await response.json();

    const entry = JSON.stringify({ t: Date.now(), d: data });
    try {
      localStorage.setItem(cacheKey, entry);
    } catch {
      // The quota is shared with the rest of the site, so reclaim our own expired entries and try once more rather
      // than letting one full moment permanently disable caching for this browser.
      this.#pruneCache();
      try {
        localStorage.setItem(cacheKey, entry);
      } catch { /* Still no room, or storage disabled entirely: caching is best-effort. */ }
    }
    return data;
  }

  /**
   * Drops this page's expired cache entries. Each entry is keyed by its full URL, so a member leaving the roster or an
   * endpoint being renamed strands one, and nothing else would ever reclaim it.
   */
  #pruneCache() {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(AboutPage.#CACHE_PREFIX)) continue;
      try {
        const entry = JSON.parse(localStorage.getItem(key));
        if (!entry || Date.now() - entry.t >= AboutPage.#CACHE_TTL_MS) localStorage.removeItem(key);
      } catch {
        localStorage.removeItem(key);
      }
    }
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
   * Merges multi-stint duplicate rows from the project-people listing into one entry per person.
   *
   * A person who left and came back has one row per stint; without merging they would be listed twice. The merged
   * entry spans the earliest start to the latest end (null end = ongoing wins), and keeps any active/lead markers.
   *
   * @param {object[]} rows - Raw rows from the ML API project-people listing.
   * @returns {object[]} One merged row per unique person.
   */
  #mergeStints(rows) {
    const byPerson = new Map();
    const latestStintStart = new Map();
    for (const row of rows) {
      const merged = byPerson.get(row.person.url_name);
      if (!merged) {
        byPerson.set(row.person.url_name, { ...row });
        latestStintStart.set(row.person.url_name, row.start_date);
        continue;
      }
      merged.is_active ||= row.is_active;
      merged.lead_project_role ||= row.lead_project_role;
      // A returning contributor's position advances between stints (high schooler who came back as an undergrad), so
      // the most recent stint is the one that describes them.
      if (row.start_date >= latestStintStart.get(row.person.url_name)) {
        latestStintStart.set(row.person.url_name, row.start_date);
        merged.position_title = row.position_title;
        merged.position_school = row.position_school;
        merged.position_school_abbreviated = row.position_school_abbreviated;
      }
      if (row.start_date < merged.start_date) merged.start_date = row.start_date;
      merged.end_date = merged.end_date && row.end_date
        ? (row.end_date > merged.end_date ? row.end_date : merged.end_date)
        : null;
    }
    return [...byPerson.values()];
  }

  /**
   * Restates the contributor blurb's two figures — everyone who has contributed, and how many of them were students —
   * from the live roster, so the claim keeps pace with the roll call underneath it instead of drifting from numbers
   * someone typed once.
   *
   * @param {object[]} people - Merged project-people rows, one per person.
   */
  #renderContributorCount(people) {
    const intro = document.getElementById('about-team-contributors-intro');
    const template = intro?.dataset.labelTemplate;
    if (!template) return;

    // Round the headline down to a ten strictly below the true count, so "more than N" reads as true at every roster
    // size — 143 contributors is "more than 140", and an exact 140 is still "more than 130" rather than a claim of
    // being more than itself. The student figure is an exact subset count, so it stands as it is.
    const total = Math.floor((people.length - 1) / 10) * 10;
    const students = people.filter((p) => AboutPage.#STUDENT_TITLES.includes(p.position_title)).length;
    // No students at all means a truncated payload or renamed position labels, not a decade of non-student
    // contributors, so leave the whole server-rendered sentence alone rather than publishing a wrong figure.
    if (total < 10 || students < 1) return;
    intro.textContent = template
      .replace('{0}', total.toLocaleString())
      .replace('{1}', students.toLocaleString());
  }

  /**
   * Renders the current-team photo grid, the past-leadership cards, and the all-contributors name columns, then
   * unhides the container.
   */
  async #renderTeam() {
    const container = document.getElementById('about-team-live');
    if (!container) return;

    const rows = await this.#fetchAllPages(`${AboutPage.#ML_API_BASE}/projects/sidewalk/people/?format=json`);
    const people = this.#mergeStints(rows);
    this.#renderContributorCount(people);
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

    const roleText = (p) => {
      const lead = AboutPage.#LEAD_ROLE_LABELS[p.lead_project_role] ?? p.lead_project_role ?? '';
      // The project row's `position_title` tracks the stint's window, so an active member's reads as what they are
      // today. The row's free-text `role` is the ML admin's internal notes rather than display copy — the ML site's
      // own project page doesn't render it either — so this page ignores it.
      const detail = p.position_title || '';
      // A lead label that already spells out the detail ("Research Scientist Lead" over "Research Scientist")
      // would otherwise render the same words twice.
      return lead.includes(detail) ? lead : [lead, detail].filter(Boolean).join(' · ');
    };
    const affiliation = (p) => p.position_school || '';
    // The team sits seven sections down the page, so deferring the headshots keeps ~a dozen image requests off the
    // initial load entirely.
    const photoTag = (p) => {
      const src = this.#esc(p.person.thumbnail || AboutPage.#FALLBACK_PHOTO);
      return `<img class="about-team-photo" loading="lazy" src="${src}" alt="">`;
    };
    document.getElementById('about-team-current').innerHTML = current.map((p) => {
      const org = affiliation(p);
      return `
        <li class="about-team-member">
          <a href="${this.#esc(p.person.url)}">
            ${photoTag(p)}
            <span class="about-team-name">${this.#esc(p.person.name)}</span>
          </a>
          <span class="about-team-role">${this.#esc(roleText(p))}</span>
          ${org ? `<span class="about-team-affiliation">${this.#esc(org)}</span>` : ''}
        </li>`;
    }).join('');

    // Past-lead cards pair the API-driven photo/name/role with a hand-curated, localized blurb server-rendered into
    // the #about-team-past-blurbs template (keyed by url_name). The blurb is our own trusted markup, so no escaping.
    // An en dash only when there's a closing year to dash to: a lead marked inactive with the stint left open in the
    // ML admin would otherwise render a trailing "2012–".
    const years = (p) => (p.end_date
      ? `${p.start_date.slice(0, 4)}–${p.end_date.slice(0, 4)}`
      : p.start_date.slice(0, 4));
    // A <template>'s children live in its .content fragment, not in the document tree, so they're only reachable by
    // querying the fragment — a document-level selector for them silently matches nothing.
    const blurbs = document.getElementById('about-team-past-blurbs')?.content;
    const blurbFor = (p) =>
      blurbs?.querySelector(`[data-person="${CSS.escape(p.person.url_name)}"]`)?.innerHTML ?? '';
    document.getElementById('about-team-past').innerHTML = pastLeads.map((p) => {
      const blurb = blurbFor(p);
      return `
        <li class="about-team-member">
          <a href="${this.#esc(p.person.url)}">
            ${photoTag(p)}
            <span class="about-team-name">${this.#esc(p.person.name)}</span>
          </a>
          <span class="about-team-role">${this.#esc(p.lead_project_role)}, ${this.#esc(years(p))}</span>
          ${blurb ? `<span class="about-team-blurb">${blurb}</span>` : ''}
        </li>`;
    }).join('');

    const shown = new Set([...current, ...pastLeads].map((p) => p.person.url_name));
    const others = people
      .filter((p) => !shown.has(p.person.url_name))
      .sort((a, b) => a.person.name.localeCompare(b.person.name));
    // Contributors are annotated with the title and school they held while on the project ("Undergrad, UMD"), which
    // is what makes the roll call legible as the experiential-learning record it is. The project row's position fields
    // are scoped to the stint's window, so a 2015 undergrad reads as an undergrad rather than as whatever they do now.
    document.getElementById('about-team-all').innerHTML = others.map((p) => {
      const credential = [p.position_title, p.position_school_abbreviated || p.position_school]
        .filter(Boolean).join(', ');
      return `
        <li>
          <a href="${this.#esc(p.person.url)}">${this.#esc(p.person.name)}</a>${credential
            ? `, <span class="about-team-credential">${this.#esc(credential)}</span>`
            : ''}
        </li>`;
    }).join('');
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
        ['PDF', pub.pdf_url, 'file-text'],
        ['arXiv', pub.arxiv_url, 'external-link'],
        ['DOI', pub.official_url, 'link'],
        ['Code', pub.code_repo_url, 'code'],
      ].filter(([, url]) => url).map(([label, url, icon]) => `
              <a class="about-pub-link" href="${this.#esc(url)}">
                <img class="about-pub-link-icon" src="/assets/images/icons/${icon}-feather.svg" alt=""
                     aria-hidden="true">
                ${label}
              </a>`).join('');
      // The thumbnail is a second route to the same destination as the title, so it stays out of the tab order and
      // hidden from assistive tech rather than repeating the link. A publication without one leaves the cell empty:
      // an <img src=""> resolves against the page URL and re-requests the whole document.
      const thumb = pub.thumbnail
        ? `<img class="about-pub-thumb" loading="lazy" src="${this.#esc(pub.thumbnail)}" alt="">`
        : '';
      return `
        <article class="about-pub"${initiallyVisible ? '' : ' hidden'}>
          ${thumb && titleUrl
            ? `<a href="${this.#esc(titleUrl)}" tabindex="-1" aria-hidden="true">${thumb}</a>`
            : thumb}
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

    await this.#renderCitation(pubs);
  }

  /**
   * Fills the "how to cite" block with the canonical paper's formatted citation and BibTeX, and wires the copy
   * buttons. Leaves the block hidden if the paper isn't in the list or its detail request fails — the intro
   * paragraph already links the paper, so there is nothing missing without it.
   *
   * @param {object[]} pubs - The project's publications, as returned by the ML API list endpoint.
   */
  async #renderCitation(pubs) {
    const block = document.getElementById('about-cite');
    if (!block) return;

    // Identify the paper by DOI rather than id or title: the id is an ML-database detail and the title could be
    // edited, while the DOI is the paper's permanent identifier (and is the one the intro copy already cites).
    const paper = pubs.find((pub) => String(pub.official_url).includes(AboutPage.#CITATION_DOI));
    if (!paper) return;

    const detail = await this.#fetchJson(`${AboutPage.#ML_API_BASE}/publications/${paper.id}/?format=json`);
    if (!detail.citation_html || !detail.bibtex) return;

    document.getElementById('about-cite-plain').innerHTML = this.#sanitizeCitation(detail.citation_html);
    document.getElementById('about-cite-bibtex').textContent = detail.bibtex;

    block.querySelectorAll('.about-cite-copy').forEach((button) => {
      const original = button.textContent;
      button.addEventListener('click', async () => {
        const text = document.getElementById(button.dataset.copyTarget).textContent;
        try {
          await navigator.clipboard.writeText(text);
          button.textContent = button.dataset.copiedLabel;
          setTimeout(() => {
            button.textContent = original;
          }, 2000);
        } catch (e) {
          console.warn('About page: copy to clipboard failed.', e);
        }
      });
    });
    block.hidden = false;
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
      // The ML admin sometimes stores the literal string 'None' (a leaked Python None) as a grant id; treat as absent.
      const hasId = grant.grant_id && grant.grant_id !== 'None';
      const grantId = hasId ? ` (#${this.#esc(grant.grant_id)})` : '';
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
      ['about-step-explore-link', 'step_explore'],
      ['about-step-validate-link', 'step_validate'],
      ['about-step-data-link', 'step_data'],
      ['about-cta-explore-link', 'cta_explore'],
      ['about-cta-city-link', 'cta_city'],
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
