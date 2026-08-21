/**
 * The Imagery page's pipeline section: is the nightly freshness machinery running, and what did it do each night
 * (#4908).
 *
 * Reads `/adminapi/imageryFreshness`, which carries the three jobs' roster state plus the counts each run recorded.
 * Nights with no recorded run are absent from the payload and zero-filled here, so a gap in the series reads as "the
 * job did not run" rather than as a hole in the chart.
 */
class ImageryPipelinePanel {
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
    // The window this pass is fetching, held apart from `#days` because the selector moves `#days` on while the
    // request is in flight -- comparing the queued window against `#days` at the end would always find them equal and
    // leave the charts a window behind what the selector says.
    const requested = this.#days;
    try {
      const resp = await fetch(`${this.#pipelineUrl}?days=${requested}`, { headers: { Accept: 'application/json' } });
      if (!resp.ok) throw new Error(`Pipeline request failed: ${resp.status}`);
      const report = await resp.json();
      this.#render(report);
      this.#onLoaded(report);
    } catch (e) {
      console.error('Imagery pipeline section failed to load:', e);
      this.#setStatus(`Could not load the pipeline history. ${e.message}`, true);
    } finally {
      this.#loading = false;
      const queued = this.#pending;
      this.#pending = null;
      if (queued !== null && queued !== requested) await this.#load();
    }
  }

  #render(report) {
    const jobs = report.jobs || [];
    this.#renderBanner(report, jobs);
    this.#renderJobs(jobs);
    this.#renderFailures(report);
    this.#renderCharts(report);
  }

  /**
   * Failed runs across the window, which the jobs table above cannot show: it reports each job's *last* run, so a
   * pipeline that fails every other night reads as healthy there whenever the latest run happened to succeed.
   */
  #renderFailures(report) {
    const nights = (report.run_days || []).filter((day) => day.poll_failures > 0 || day.sync_failures > 0);
    if (nights.length === 0) {
      AdminShell.setHtml('imagery-failure-note',
        `No run of either job failed in the last ${report.days} days.`);
      return;
    }
    const dates = nights.map((night) => night.day).join(', ');
    AdminShell.setHtml('imagery-failure-note',
      `${nights.length} of the last ${report.days} nights recorded a failed run (${AdminShell.esc(dates)}). `
      + 'A failed night polls nothing, so its bars below are empty.');
  }

  /**
   * One line saying whether the re-audit signal is currently being produced at all.
   *
   * Ordered worst-first, and a poll that ran but polled nothing is called out separately from one that did not run:
   * both leave the flags frozen, but only the first is a scheduling problem.
   */
  #renderBanner(report, jobs) {
    // The report names which of its jobs plays which role, so a job rename can't silently blank this
    // banner -- the one line that says whether the re-audit signal is being produced at all.
    const poll = jobs.find((job) => job.job_name === report.poll_job);
    const sync = jobs.find((job) => job.job_name === report.sync_job);
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
    AdminShell.setHtml('imagery-pipeline-status',
      `<span class="ac-badge ac-badge--${tone}">${label}</span> ${AdminShell.esc(message)}`);
  }

  /** The three jobs' last-run state, in the order they run each night. */
  #renderJobs(jobs) {
    // The roster is a compile-time constant, so an empty list means the read failed and was recovered — a blind
    // panel, not a healthy one.
    if (jobs.length === 0) {
      AdminShell.setHtml('imagery-jobs',
        '<p class="coverage-status error"><span class="ac-badge ac-badge--bad">!</span> '
        + 'Could not read the job history — this panel is blind, not clear.</p>');
      return;
    }
    const rows = jobs.map((job) => `
      <tr>
        <td>${AdminShell.esc(job.label)}</td>
        <td class="ac-muted">${AdminShell.esc(job.scheduled_at)}</td>
        <td>${AdminShell.jobStatusBadge(job)}</td>
        <td>${AdminShell.jobLastRun(job)}</td>
        <td class="ac-muted">${AdminShell.esc(AdminShell.jobDetails(job))}</td>
      </tr>`).join('');
    AdminShell.setHtml('imagery-jobs',
      AdminShell.tableHtml(['Job', 'Scheduled', 'Status', 'Last run', 'Result'], rows));
  }

  /** The two per-night bar charts, over a zero-filled day axis so a night with no run is visibly empty. */
  #renderCharts(report) {
    const days = ImageryPipelinePanel.#dayAxis(report.since, report.days);
    const byDay = new Map((report.run_days || []).map((day) => [day.day, day]));
    const valuesOf = (field) => days.map((day) => byDay.get(day)?.[field] || 0);
    const labels = days.map((day) => day.slice(5)); // MM-DD; the year is in the window label.

    // Without the batch size drawn in, a night's bar height is unreadable: 120 polled is either most of the batch or
    // a fraction of it, and only the target says which.
    const batchSize = report.poll_batch_size;
    MiniLineChart.renderInto(document.getElementById('imagery-poll-chart'), labels, [
      { name: 'Polled', key: 'polled', values: valuesOf('streets_polled') },
      { name: 'Skipped', key: 'skipped', values: valuesOf('streets_skipped') },
    ], {
      kind: 'bar',
      ariaLabel: `Streets polled and skipped per night, against a nightly batch size of ${batchSize}`,
      valueFormat: (v) => `${Math.round(v).toLocaleString()} street${Math.round(v) === 1 ? '' : 's'}`,
      maxXLabels: 8,
      refLine: Number.isFinite(batchSize) && batchSize > 0
        ? { value: batchSize, key: 'batch', label: `batch size ${batchSize.toLocaleString()}` }
        : undefined,
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

  #setStatus(message, isError) {
    const status = document.getElementById('imagery-pipeline-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', !!isError);
  }
}
