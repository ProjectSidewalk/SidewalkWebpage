/**
 * The Imagery page's pipeline section: is the nightly freshness machinery running, and what did it do each night
 * (#4908).
 *
 * Reads `/adminapi/imageryFreshness`, which carries the three jobs' roster state plus the counts each run recorded.
 * Nights with no recorded run are absent from the payload and zero-filled here, so a gap in the series reads as "the
 * job did not run" rather than as a hole in the chart.
 */
class ImageryPipelinePanel {
  /** Job names, from ScheduledJobs; the poll is the one whose silence hides everything else. */
  static #POLL_JOB = 'check-imagery-age-actor';
  static #SYNC_JOB = 'imagery-freshness-sync';

  #pipelineUrl;
  #days;
  #onLoaded;
  #loading = false;
  #pending = null;

  /**
   * @param {{pipelineUrl: string, days: number, onLoaded?: function(object): void}} opts - Endpoint, initial window,
   *   and a callback handed the report so the page can fill its own KPIs from the same fetch.
   */
  constructor(opts) {
    this.#pipelineUrl = opts.pipelineUrl;
    this.#days = opts.days;
    this.#onLoaded = opts.onLoaded || (() => {});
  }

  /** Wires the window selector and loads the first report. */
  async init() {
    const select = document.getElementById('imagery-range');
    if (select) {
      select.value = String(this.#days);
      select.addEventListener('change', () => {
        this.#days = Number(select.value);
        this.#load();
      });
    }
    await this.#load();
  }

  /**
   * Fetches and renders one window.
   *
   * An in-flight request is queued rather than dropped, so the charts always end up showing the window the selector
   * says they do even if a reader flips through the options quickly.
   */
  async #load() {
    if (this.#loading) {
      this.#pending = this.#days;
      return;
    }
    this.#loading = true;
    try {
      const resp = await fetch(`${this.#pipelineUrl}?days=${this.#days}`, { headers: { Accept: 'application/json' } });
      if (!resp.ok) throw new Error(`Pipeline request failed: ${resp.status}`);
      const report = await resp.json();
      this.#render(report);
      this.#onLoaded(report);
    } catch (e) {
      console.error('Imagery pipeline section failed to load:', e);
      this.#setStatus(`Could not load the pipeline history. ${e.message}`, true);
    } finally {
      this.#loading = false;
      if (this.#pending !== null && this.#pending !== this.#days) {
        this.#days = this.#pending;
        this.#pending = null;
        await this.#load();
      } else {
        this.#pending = null;
      }
    }
  }

  #render(report) {
    const jobs = report.jobs || [];
    this.#renderBanner(report, jobs);
    this.#renderJobs(jobs);
    this.#renderCharts(report);
  }

  /**
   * One line saying whether the re-audit signal is currently being produced at all.
   *
   * Ordered worst-first, and a poll that ran but polled nothing is called out separately from one that did not run:
   * both leave the flags frozen, but only the first is a scheduling problem.
   */
  #renderBanner(report, jobs) {
    const poll = jobs.find((job) => job.job_name === ImageryPipelinePanel.#POLL_JOB);
    const sync = jobs.find((job) => job.job_name === ImageryPipelinePanel.#SYNC_JOB);
    const reason = poll?.last_details?.not_polled_reason;
    const recentPolled = (report.run_days || []).reduce((sum, day) => sum + (day.streets_polled || 0), 0);

    let tone = 'good';
    let message;
    if (!poll || poll.last_status === 'never_run') {
      tone = 'bad';
      message = 'The imagery-age poll has never run here, so no street can be flagged for a re-audit.';
    } else if (reason) {
      tone = 'bad';
      message = `The poll is running but not polling: ${reason}`;
    } else if (poll.overdue) {
      tone = 'bad';
      message = `The poll has not succeeded on schedule in over ${report.overdue_after_hours} hours — `
        + 'until it does, no new street can be flagged for a re-audit.';
    } else if (poll.last_status === 'failed') {
      tone = 'warn';
      message = `The most recent poll failed: ${poll.last_error || 'see the server log'}`;
    } else if (sync && (sync.overdue || sync.last_status === 'failed')) {
      // The poll can be healthy while the sync that turns its dates into flags is not, and the symptom is the same
      // from the outside: nothing new gets flagged.
      tone = 'warn';
      message = 'The poll is running, but the flag sync that turns its capture dates into re-audits is not — '
        + `${sync.last_error || 'it has not succeeded on schedule'}.`;
    } else if (recentPolled === 0) {
      tone = 'warn';
      message = `The poll has run but refreshed no streets in the last ${report.days} days — every street it `
        + 'selected answered inconclusively.';
    } else {
      const flagged = (report.run_days || []).reduce((sum, day) => sum + (day.audits_flagged || 0), 0);
      message = `Polled ${recentPolled.toLocaleString()} streets in the last ${report.days} days and flagged `
        + `${flagged.toLocaleString()} audit${flagged === 1 ? '' : 's'} for a re-audit.`;
    }
    const label = tone === 'good' ? 'Running' : 'Needs attention';
    this.#setHtml('imagery-pipeline-status',
      `<span class="ac-badge ac-badge--${tone}">${label}</span> ${ImageryPipelinePanel.#esc(message)}`);
  }

  /** The three jobs' last-run state, in the order they run each night. */
  #renderJobs(jobs) {
    // The roster is a compile-time constant, so an empty list means the read failed and was recovered — a blind
    // panel, not a healthy one.
    if (jobs.length === 0) {
      this.#setHtml('imagery-jobs',
        '<p class="coverage-status error"><span class="ac-badge ac-badge--bad">!</span> '
        + 'Could not read the job history — this panel is blind, not clear.</p>');
      return;
    }
    const rows = jobs.map((job) => `
      <tr>
        <td>${ImageryPipelinePanel.#esc(job.label)}</td>
        <td class="ac-muted">${ImageryPipelinePanel.#esc(job.scheduled_at)}</td>
        <td>${ImageryPipelinePanel.#statusBadge(job)}</td>
        <td>${ImageryPipelinePanel.#esc(ImageryPipelinePanel.#lastRun(job))}</td>
        <td class="ac-muted">${ImageryPipelinePanel.#esc(ImageryPipelinePanel.#details(job))}</td>
      </tr>`).join('');
    this.#setHtml('imagery-jobs', `
      <div class="ac-table-wrap">
        <table class="ac-table">
          <thead>
            <tr>
              <th class="ac-th-text">Job</th>
              <th class="ac-th-text">Scheduled</th>
              <th class="ac-th-text">Status</th>
              <th class="ac-th-text">Last run</th>
              <th class="ac-th-text">Result</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`);
  }

  /** The two per-night bar charts, over a zero-filled day axis so a night with no run is visibly empty. */
  #renderCharts(report) {
    const days = ImageryPipelinePanel.#dayAxis(report.since, report.days);
    const byDay = new Map((report.run_days || []).map((day) => [day.day, day]));
    const valuesOf = (field) => days.map((day) => byDay.get(day)?.[field] || 0);
    const labels = days.map((day) => day.slice(5)); // MM-DD; the year is in the window label.

    MiniLineChart.renderInto(document.getElementById('imagery-poll-chart'), labels, [
      { name: 'Polled', key: 'polled', values: valuesOf('streets_polled') },
      { name: 'Skipped', key: 'skipped', values: valuesOf('streets_skipped') },
    ], {
      kind: 'bar',
      ariaLabel: 'Streets polled and skipped per night',
      valueFormat: (v) => `${Math.round(v).toLocaleString()} street${Math.round(v) === 1 ? '' : 's'}`,
      maxXLabels: 8,
    });

    MiniLineChart.renderInto(document.getElementById('imagery-flag-chart'), labels, [
      { name: 'Flagged', key: 'flagged', values: valuesOf('audits_flagged') },
      { name: 'Unflagged', key: 'unflagged', values: valuesOf('audits_unflagged') },
    ], {
      kind: 'bar',
      ariaLabel: 'Audits flagged and unflagged for re-audit per night',
      valueFormat: (v) => `${Math.round(v).toLocaleString()} audit${Math.round(v) === 1 ? '' : 's'}`,
      maxXLabels: 8,
    });
  }

  /**
   * Every date in the window as YYYY-MM-DD, so nights the pipeline never reported still occupy a slot.
   *
   * @param {string} since - ISO timestamp the window starts at.
   * @param {number} days - Window length.
   * @returns {string[]} Dates, oldest first.
   */
  static #dayAxis(since, days) {
    const start = new Date(since);
    return Array.from({ length: days + 1 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return day.toISOString().slice(0, 10);
    });
  }

  /** A job's last-run state as a toned badge, with overdue outranking whatever that last run reported. */
  static #statusBadge(job) {
    const tones = { never_run: 'bad', abandoned: 'bad', failed: 'bad', running: 'ok', succeeded: 'good' };
    const labels = { never_run: 'never run', abandoned: 'abandoned', failed: 'failed', running: 'running',
      succeeded: 'ok' };
    const tone = job.overdue ? (tones[job.last_status] === 'bad' ? 'bad' : 'warn') : (tones[job.last_status] || 'good');
    const label = job.overdue && job.last_status === 'succeeded'
      ? 'overdue'
      : (labels[job.last_status]
        || job.last_status);
    return `<span class="ac-badge ac-badge--${tone}">${ImageryPipelinePanel.#esc(label)}</span>`;
  }

  /** "4h ago" / "3d ago", or never. A hand-run last run says so: it proves the code works, not the schedule. */
  static #lastRun(job) {
    if (job.hours_since_last_run === null || job.hours_since_last_run === undefined) return 'never';
    const hours = job.hours_since_last_run;
    const when = hours < 1 ? 'under an hour ago' : hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
    return job.last_triggered_by === 'manual' ? `${when} (manual)` : when;
  }

  /** A run's own counts, flattened to `key: value` pairs, or its error when it failed. */
  static #details(job) {
    if (job.last_error) return job.last_error;
    const details = job.last_details;
    if (!details || typeof details !== 'object') return '—';
    const parts = Object.entries(details)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => {
        const shown = typeof value === 'number' ? value.toLocaleString() : value;
        return `${key.replace(/_/g, ' ')}: ${shown}`;
      });
    return parts.length > 0 ? parts.join(', ') : '—';
  }

  #setStatus(message, isError) {
    const status = document.getElementById('imagery-pipeline-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', !!isError);
  }

  #setHtml(id, html) {
    const element = document.getElementById(id);
    if (element) element.innerHTML = html;
  }

  /** Escapes text for interpolation into rendered HTML. */
  static #esc(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
}
