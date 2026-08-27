/**
 * Shell behaviors for the redesigned admin dashboard (#4272): builds the right-hand "On this page" table of
 * contents from the page's headings, highlights the active section on scroll (scroll-spy), smooth-scrolls anchor
 * clicks past the fixed navbar, and adds the left nav's mobile disclosure (sidebarDisclosure.js).
 *
 * This is a clean ES6 reimplementation of the equivalent api-docs.js logic, operating on the same .api-* markup so
 * the look and behavior match. It self-initializes on DOMContentLoaded.
 */
class AdminShell {
  /** Height of the fixed top navbar, in px; headings are offset by this so they aren't hidden when scrolled to. */
  static #NAVBAR_OFFSET = 58;

  #content;
  #tocList;
  #headings = [];
  #tocLinks = [];
  #scrollSpyAttached = false;

  init() {
    this.#content = document.querySelector('.api-content');
    this.#tocList = document.querySelector('.api-toc ul');
    if (!this.#content) return;

    this.#buildTableOfContents();
    this.#setupScrollSpy();
    this.#setupSmoothScrolling();
    initSidebarDisclosure();
    this.#localizeDeployTimes();
  }

  /**
   * Re-renders the deployment-info strip's <time> elements (server-rendered as UTC ISO strings) for the viewer.
   * Elements marked data-format="date" show day precision and stay in UTC — a release date is a fact about the
   * release, and rendering it viewer-local could shift it a day and disagree with the release's own tag date. The
   * rest get date + time in the viewer's locale and timezone.
   */
  #localizeDeployTimes() {
    document.querySelectorAll('.deploy-strip time[datetime]').forEach((el) => {
      const date = new Date(el.getAttribute('datetime'));
      if (Number.isNaN(date.getTime())) return;
      const dateOpts = { year: 'numeric', month: 'short', day: 'numeric' };
      el.textContent = el.dataset.format === 'date'
        ? date.toLocaleDateString(undefined, { ...dateOpts, timeZone: 'UTC' })
        : date.toLocaleString(undefined, { ...dateOpts, hour: 'numeric', minute: '2-digit' });
    });
  }

  /**
     * Builds the TOC from the section headings (h2/h3.api-heading with ids) inside the main content area. Scoped to
     * .api-heading so headings inside closed <dialog>s (e.g. the dashboard's create-team dialog) stay out — a hidden
     * heading has offsetTop 0, which would also wedge the scroll-spy on its TOC entry forever.
     */
  #buildTableOfContents() {
    if (!this.#tocList) return;
    this.#tocList.replaceChildren();
    this.#tocLinks = [];
    this.#headings = Array.from(this.#content.querySelectorAll('h2.api-heading[id], h3.api-heading[id]'))
      .filter((heading) => !heading.closest('[hidden]'));

    const toc = document.querySelector('.api-toc');
    if (this.#headings.length === 0) {
      if (toc) toc.style.display = 'none';
      return;
    }
    if (toc) toc.style.removeProperty('display');

    const frag = document.createDocumentFragment();
    for (const heading of this.#headings) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#${heading.id}`;
      a.textContent = heading.textContent.replace(/#$/, '').trim();
      a.classList.add(`toc-level-${heading.tagName === 'H2' ? 1 : 2}`);
      li.appendChild(a);
      frag.appendChild(li);
      this.#tocLinks.push(a);
      this.#bindSmoothScroll(a);
    }
    this.#tocList.appendChild(frag);
  }

  /**
   * Rebuilds the TOC from the headings currently visible on the page.
   *
   * A section that loads asynchronously starts hidden, so it is absent from the TOC built at load. It calls this once
   * it renders (or decides not to). Without it a hidden section leaves a TOC entry that scrolls nowhere — and, since
   * a hidden heading reports offsetTop 0, one that wedges the scroll-spy on itself.
   */
  refreshTableOfContents() {
    this.#buildTableOfContents();
    // A page whose only headings arrive asynchronously had nothing to spy on at load, so the listener was skipped.
    this.#setupScrollSpy();
  }

  /**
   * Highlights the TOC entry for whichever heading is currently at the top of the viewport.
   *
   * The listener reads #headings and #tocLinks on each tick rather than closing over them, so it keeps working across
   * a refreshTableOfContents(); attaching a second one would just duplicate the work.
   */
  #setupScrollSpy() {
    if (this.#scrollSpyAttached || this.#headings.length === 0) return;
    this.#scrollSpyAttached = true;

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const scrollPos = window.scrollY + AdminShell.#NAVBAR_OFFSET + 20;
        let activeIndex = 0;
        for (let i = 0; i < this.#headings.length; i++) {
          if (this.#headings[i].offsetTop <= scrollPos) activeIndex = i;
        }
        this.#tocLinks.forEach((link, i) => link.classList.toggle('active', i === activeIndex));
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /**
   * Smooth-scrolls clicks on in-page anchors, accounting for the fixed navbar. TOC links are bound as they are
   * created, so a rebuilt TOC picks this up without re-binding anchors that already have it.
   */
  #setupSmoothScrolling() {
    document.querySelectorAll('.api-content a.permalink[href^="#"]')
      .forEach((anchor) => this.#bindSmoothScroll(anchor));
  }

  /** @param {HTMLAnchorElement} anchor - An in-page anchor whose href is a fragment. */
  #bindSmoothScroll(anchor) {
    anchor.addEventListener('click', (e) => {
      const id = anchor.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      const top = target.offsetTop - AdminShell.#NAVBAR_OFFSET;
      // Jump instantly for users who prefer reduced motion (WCAG 2.3.3).
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
      history.replaceState(null, '', `#${id}`);
    });
  }

  // ---- Shared formatting helpers ------------------------------------------------------------------------------
  //
  // AdminShell loads on every dashboard page, so one copy of each of these lives here rather than being re-derived
  // per page. Two pages that format the same seconds or the same timestamp differently is a bug the reader has to
  // notice for themselves.

  /** True for null or undefined (JSON omits absent Option fields, so they arrive as undefined). */
  static nil(value) {
    return value === null || value === undefined;
  }

  /**
   * Escapes a value for safe insertion as HTML text.
   *
   * @param {*} value - Anything; null and undefined render as the empty string.
   * @returns {string} The value with HTML metacharacters replaced by entities.
   */
  static esc(value) {
    if (AdminShell.nil(value)) return '';
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * @param {number|string} n - A number, or anything Number() can read.
   * @returns {string} Thousands-separated integer.
   */
  static num(n) {
    return Number(n).toLocaleString('en-US');
  }

  /**
   * @param {number} seconds - A duration; negatives are clamped to zero.
   * @returns {string} Short human duration ("3m 20s", "2h 5m", "4d 3h"), or an em dash when absent.
   */
  static dur(seconds) {
    if (AdminShell.nil(seconds)) return '—';
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }

  /**
   * How long ago a timestamp was, falling back to a plain date once "N days ago" stops being the useful reading.
   *
   * @param {string|number|Date} ts - Anything the Date constructor accepts.
   * @param {Object} [opts]
   * @param {string} [opts.invalid] - What to return for an unparseable timestamp; defaults to echoing the input.
   * @param {boolean} [opts.withYear=true] - Include the year in the date fallback.
   * @returns {string} A relative time ("just now", "12m ago", "3h ago", "5d ago") or a formatted date.
   */
  static relativeTime(ts, opts = {}) {
    const date = new Date(ts);
    if (isNaN(date)) return AdminShell.nil(opts.invalid) ? String(ts) : opts.invalid;
    const secs = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    const dateOpts = { month: 'short', day: 'numeric' };
    if (opts.withYear !== false) dateOpts.year = 'numeric';
    return date.toLocaleDateString(undefined, dateOpts);
  }

  /**
   * Renders the dashboard's standard table markup. Each header is either a plain string (a text column,
   * left-aligned) or a `[label, true]` pair marking a numeric column, whose header is right-aligned to sit over its
   * `.ac-num` cells.
   *
   * @param {Array<string|[string, boolean]>} headers - Column headers.
   * @param {string} bodyHtml - Pre-rendered `<tr>` rows.
   * @returns {string} The table's HTML, wrapped in its horizontal-scroll container.
   */
  static tableHtml(headers, bodyHtml) {
    const head = headers.map((h) => {
      const [label, num] = Array.isArray(h) ? h : [h, false];
      // Default `.ac-table thead th` is right-aligned; a text column opts into left via `ac-th-text`.
      return `<th${num ? '' : ' class="ac-th-text"'}>${label}</th>`;
    }).join('');
    return `
      <div class="ac-table-wrap">
        <table class="ps-table ps-table--compact ac-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </div>`;
  }

  // ---- Nightly-job row formatters -----------------------------------------------------------------------------
  //
  // Two panels report the same `nightly_jobs` entries -- the Health dashboard over the whole roster, the Imagery page
  // over the three jobs of one pipeline. They read the same fields and must reach the same verdict, so the formatting
  // lives here rather than once per panel.

  /**
   * A job's last-run state as a toned badge, with overdue outranking whatever that last run reported.
   *
   * @param {Object} job - One `nightly_jobs` entry.
   * @returns {string} The badge's HTML.
   */
  static jobStatusBadge(job) {
    const tones = { never_run: 'bad', abandoned: 'bad', failed: 'bad', running: 'ok', succeeded: 'good' };
    const labels = { never_run: 'never run', abandoned: 'abandoned', failed: 'failed', running: 'running',
      succeeded: 'ok' };
    // An unknown status defaults to `warn`, not `good`: a status the server grew and this page hasn't learned yet
    // would otherwise render as a clean bill of health, which is the one direction a health panel must never drift.
    const known = tones[job.last_status] || 'warn';
    const tone = job.overdue ? (known === 'bad' ? 'bad' : 'warn') : known;
    const label = job.overdue && job.last_status === 'succeeded'
      ? 'overdue'
      : (labels[job.last_status] || job.last_status);
    return `<span class="ac-badge ac-badge--${tone}">${AdminShell.esc(label)}</span>`;
  }

  /**
   * When the schedule last fired this job, plus the last hand-triggered run when there is one.
   *
   * The two are kept apart rather than merged into a single "last run": a run someone kicked off by hand proves the
   * code works, not that anything is still firing it, so it is reported beside the schedule's record instead of in
   * place of it.
   *
   * @param {Object} job - One `nightly_jobs` entry.
   * @returns {string} HTML: the scheduled run's age, with a muted manual-run note appended when one exists.
   */
  static jobLastRun(job) {
    const scheduled = job.last_started_at ? AdminShell.relativeTime(job.last_started_at) : 'never';
    if (!job.last_manual_run_at) return AdminShell.esc(scheduled);
    const manual = `manual ${AdminShell.relativeTime(job.last_manual_run_at)}: ${job.last_manual_status}`;
    return `${AdminShell.esc(scheduled)}<span class="ac-muted"> · ${AdminShell.esc(manual)}</span>`;
  }

  /**
   * A run's own counts, flattened to `key: value` pairs. Every job reports a different shape, so this renders whatever
   * it stored rather than naming fields a panel would have to be taught one by one.
   *
   * @param {Object} job - One `nightly_jobs` entry.
   * @returns {string} Plain text (the caller escapes it): the error when the run failed, else its counts.
   */
  static jobDetails(job) {
    if (job.last_error) return job.last_error;
    const details = job.last_details;
    if (!details || typeof details !== 'object') return '—';
    const parts = Object.entries(details)
      .filter(([, value]) => !AdminShell.nil(value))
      .map(([key, value]) => {
        const shown = typeof value === 'number' ? AdminShell.num(value) : value;
        return `${key.replace(/_/g, ' ')}: ${shown}`;
      });
    return parts.length > 0 ? parts.join(', ') : '—';
  }

  /**
   * Sets an element's text content by id, doing nothing when the element isn't on this page.
   *
   * @param {string} id - Element id.
   * @param {string} text - Text to set; escaping is the DOM's job here, not the caller's.
   */
  static setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /**
   * Sets an element's inner HTML by id, doing nothing when the element isn't on this page.
   *
   * @param {string} id - Element id.
   * @param {string} html - Markup whose interpolated values the caller has already escaped.
   */
  static setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Kept on window so an async section can ask for a TOC rebuild once it knows whether it renders.
  window.adminShell = new AdminShell();
  window.adminShell.init();
});
