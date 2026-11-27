/**
 * Entry point for the city reports page (#6041). The header, panel and table are server-rendered; this adds what can't
 * be: the bars and swatches through the page's colors, the map, the lens and filter controls, the table's sorting, one
 * selection shared by the map, table and panel, and the log of what readers do.
 */

import i18next from 'i18next';
import { util } from '../common/utilities.js';
import '../common/utilitiesSidewalk.js';
import { ScoreRamp } from '../common/scoreRamp.js';
import { CityReportState } from '../report/CityReportState.js';
import { CityReportTable } from '../report/CityReportTable.js';
import { CityReportMap } from '../report/CityReportMap.js';
import { renderPanel } from '../report/cityReportPanel.js';
import { wireSidebarDisclosure } from '../common/sidebarDisclosure.js';
import '../../css/components/page-shell.css';
import '../../css/components/filter-sidebar.css';
import '../../css/components/tool-header.css';
import '../../css/components/tool-sidebar.css';
import '../../css/pages/reports.css';

/** How each lens and filter is named in the log. */
const LENS_EVENTS = { score: 'Score', explored: 'Explored', problem: 'Problem' };
const FILTER_EVENTS = { all: 'All', scored: 'Scored', unscored: 'Unscored' };

/**
 * Sizes and colors every bar and swatch under `root` from its data attributes, so the colors are the label types' and
 * the score ramp's own rather than anything the server wrote.
 * @param {ParentNode} root - Where to look.
 */
function paint(root) {
  for (const element of root.querySelectorAll('[data-share]')) {
    const bar = /** @type {HTMLElement} */ (element);
    const share = Math.max(0, Math.min(1, Number(bar.dataset.share)));
    // The floor mark is placed along its bar; everything else is a bar that fills to its share.
    if (bar.classList.contains('reports-explored__floor')) bar.style.left = `${share * 100}%`;
    else bar.style.width = `${share * 100}%`;
    if (bar.dataset.labelType) bar.style.background = util.misc.getLabelColors(bar.dataset.labelType);
  }
  for (const element of root.querySelectorAll('.reports-swatch[data-score]')) {
    /** @type {HTMLElement} */ (element).style.background = ScoreRamp.at(Number(/** @type {HTMLElement} */ (element)
      .dataset.score));
  }
  for (const element of root.querySelectorAll('.reports-legend__swatch[data-label-type]')) {
    const swatch = /** @type {HTMLElement} */ (element);
    swatch.style.background = util.misc.getLabelColors(swatch.dataset.labelType);
  }
}

/** Fills each legend's color ramp from the same tokens the map reads. */
function paintLegends() {
  const score = /** @type {?HTMLElement} */ (document.querySelector('[data-ramp="score"]'));
  if (score) score.style.background = ScoreRamp.cssGradient();
  const explored = /** @type {?HTMLElement} */ (document.querySelector('[data-ramp="explored"]'));
  if (explored) {
    const css = getComputedStyle(document.documentElement);
    const low = css.getPropertyValue('--color-explored-ramp-low').trim();
    const high = css.getPropertyValue('--color-explored-ramp-high').trim();
    explored.style.background = `linear-gradient(to right, ${low}, ${high})`;
  }
}

/** How a restated date alone reads: the server's long date (`FormatStyle.LONG`). */
const LONG_DATE = Object.freeze({ dateStyle: 'long' });

/**
 * Restates each server-printed UTC time in the reader's own time zone and language: `data-local-time` as a date and
 * time, `data-local-date` as a date alone. Both are restated, or a reader east of UTC could see a page generated a day
 * before the figures on it were counted.
 * @param {ParentNode} root - Where to look.
 */
function localizeTimes(root) {
  for (const element of root.querySelectorAll('time[data-local-time], time[data-local-date]')) {
    const time = /** @type {HTMLTimeElement} */ (element);
    const date = new Date(time.dateTime);
    if (Number.isNaN(date.getTime())) continue;
    time.textContent = time.hasAttribute('data-local-date')
      ? date.toLocaleDateString(i18next.language, LONG_DATE)
      : date.toLocaleString(i18next.language, util.SHORT_DATE_TIME);
  }
}

/**
 * Keeps the table's scroller a tab stop only while it has something to scroll: on a phone the table becomes cards and
 * a stop there would scroll nothing. While it is one, it is a group named by the table's heading, so focusing it says
 * what it is; otherwise it is a plain box, so a screen reader doesn't announce a group it can't stop on.
 * @param {HTMLElement} scroller - The table's scroll container.
 */
function focusableWhileScrolling(scroller) {
  const labelledBy = scroller.getAttribute('aria-labelledby');
  const update = () => {
    if (scroller.scrollWidth > scroller.clientWidth) {
      scroller.setAttribute('tabindex', '0');
      scroller.setAttribute('role', 'group');
      if (labelledBy) scroller.setAttribute('aria-labelledby', labelledBy);
    } else {
      scroller.removeAttribute('tabindex');
      scroller.removeAttribute('role');
      scroller.removeAttribute('aria-labelledby');
    }
  };
  update();
  // The table too: it can outgrow a scroller whose own box doesn't change (late fonts, a sort arrow).
  const observer = new ResizeObserver(update);
  observer.observe(scroller);
  if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
}

/** How much of the window's height the pinned map and panel may take; past it they scroll away with the page. */
const MAX_STICKY_SHARE = 0.55;

/**
 * Sizes the panel to the tallest neighborhood's profile, so a preview never resizes it (and with it the band and the
 * page under it), and the panel never needs to scroll. Each profile is drawn once into a hidden copy at the panel's
 * width. Then pins the band only when that height leaves the table most of the window.
 * @param {HTMLElement} shell - The page, which carries `is-stickable`.
 * @param {HTMLElement} panel - The `#reports-panel` section.
 * @param {import('../report/cityReportPanel.js').CityReportRow[]} rows - Every neighborhood.
 * @param {Parameters<typeof renderPanel>[2]} data - What the page knows of the city.
 */
function fitPanel(shell, panel, rows, data) {
  const probe = /** @type {HTMLElement} */ (panel.cloneNode(false));
  probe.removeAttribute('id');
  probe.removeAttribute('data-previewing');
  probe.setAttribute('aria-hidden', 'true');
  probe.inert = true;
  Object.assign(probe.style, {
    position: 'absolute', visibility: 'hidden', left: '-10000px', top: '0',
    width: `${panel.getBoundingClientRect().width}px`, minHeight: '0',
  });
  panel.after(probe);
  let tallest = 0;
  for (const row of rows) {
    renderPanel(probe, row, data);
    // Its copy of the name's id would clash with the panel's.
    probe.querySelector('[id]')?.removeAttribute('id');
    tallest = Math.max(tallest, probe.getBoundingClientRect().height);
  }
  probe.remove();
  panel.style.minHeight = `${Math.ceil(tallest)}px`;
  const mapHeight = shell.querySelector('.reports-map')?.getBoundingClientRect().height ?? 0;
  const bandHeight = Math.max(tallest, mapHeight);
  shell.classList.toggle('is-stickable', bandHeight <= window.innerHeight * MAX_STICKY_SHARE);
}

/**
 * Presses one button of a segmented control.
 * @param {NodeListOf<HTMLButtonElement>} buttons - The control's buttons.
 * @param {(button: HTMLButtonElement) => boolean} pressed - Which one is pressed.
 */
function press(buttons, pressed) {
  for (const button of buttons) button.setAttribute('aria-pressed', String(pressed(button)));
}

window.appManager.ready(() => {
  const shell = document.getElementById('reports-shell');
  const data = JSON.parse(document.getElementById('reports-data').textContent);
  const rowsById = new Map(data.rows.map((row) => [row.id, row]));
  const log = (event) => window.logWebpageActivity(`Report_City_${event}`);

  paint(shell);
  paintLegends();
  localizeTimes(shell);

  const sidebar = document.getElementById('reports-sidebar');
  const toggle = /** @type {HTMLButtonElement} */ (document.getElementById('reports-sidebar-toggle'));
  wireSidebarDisclosure(toggle, sidebar, {
    controlled: document.getElementById('reports-sidebar-body'),
    onToggle: (open) => log(`SidebarToggle_Open=${open}`),
  });
  toggle.hidden = false;
  // Only now may the body fold on a phone: without the button there'd be no way to open it.
  sidebar.classList.add('is-foldable');
  const scroller = document.getElementById('reports-table-scroll');
  if (scroller) focusableWhileScrolling(scroller);
  const panel = document.getElementById('reports-panel');
  const panelStatus = document.getElementById('reports-panel-status');
  if (panel) {
    // Again whenever the panel's width or the window's height changes, a frame later so a drag measures once.
    let frame = 0;
    let lastWidth = -1;
    const refit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        lastWidth = panel.getBoundingClientRect().width;
        fitPanel(shell, panel, data.rows, data);
      });
    };
    new ResizeObserver(() => {
      if (panel.getBoundingClientRect().width !== lastWidth) refit();
    }).observe(panel);
    window.addEventListener('resize', refit);
  }
  // The pinned map and panel's height, so a row's focused control scrolls clear of them.
  const top = shell.querySelector('.reports-top');
  if (top) {
    new ResizeObserver(() => shell.style.setProperty('--reports-top-height', `${top.getBoundingClientRect().height}px`))
      .observe(top);
  }

  // Scored rows lowest first, unscored after: the server's order is the Score sort, ascending.
  // With no scored row the server orders by Explored, so the page claims no sort.
  const scoreOrder = data.scoresReady && data.rows.some((row) => row.scored);
  const sort = scoreOrder ? { column: 'score', dir: /** @type {'asc'} */ ('asc') } : null;
  const state = new CityReportState(data.rows, { selected: data.selected, sort });
  new CityReportTable(/** @type {HTMLTableElement} */ (document.getElementById('reports-table')), data.rows, state);

  const lensButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (shell.querySelectorAll('button[data-lens]'));
  const filterButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (shell.querySelectorAll('button[data-filter]'));
  // The state rejects anything but its own lenses and filters, so the server's markup can't set a third.
  for (const button of lensButtons) {
    button.addEventListener('click', () => state.setLens(/** @type {any} */ (button.dataset.lens)));
  }
  const table = /** @type {HTMLTableElement} */ (document.getElementById('reports-table'));
  for (const button of filterButtons) {
    button.addEventListener('click', () => {
      state.setFilter(/** @type {any} */ (button.dataset.filter));
      // A selection the filter hides would leave the panel describing a row the table doesn't show.
      if (state.selected !== null && !state.inFilter(state.selected)) {
        const first = /** @type {?HTMLElement} */ (table.querySelector('tbody tr[data-region-id]:not([hidden])'));
        if (first) state.select(Number(first.dataset.regionId), 'Filter');
      }
    });
  }
  document.getElementById('reports-lens-section').hidden = false;
  document.getElementById('reports-filter-section').hidden = false;
  document.getElementById('reports-sort-label').hidden = false;

  /**
   * Draws a neighborhood in the panel, marked as a preview when it isn't the selected one.
   * @param {number} id - The neighborhood.
   */
  const showInPanel = (id) => {
    if (!panel) return;
    if (panel.dataset.regionId !== String(id)) {
      renderPanel(panel, rowsById.get(id), data);
      paint(panel);
    }
    panel.toggleAttribute('data-previewing', id !== state.selected);
  };

  state.subscribe((current, change) => {
    switch (change.type) {
      case 'select': {
        // A selection of a hidden row resets the filter, so the buttons follow it too.
        press(filterButtons, (b) => b.dataset.filter === current.filter);
        const row = rowsById.get(current.selected);
        showInPanel(current.selected);
        if (panelStatus) panelStatus.textContent = `${row.name}: ${row.text.why}`;
        log(`Select_Region=${current.selected}_From=${change.from}`);
        break;
      }
      case 'hover':
        // Only the map previews: down the table, every row the pointer crossed would redraw the panel. A preview
        // neither announces nor logs; only a selection does.
        if (change.from === 'Map') showInPanel(current.hovered ?? current.selected);
        break;
      case 'lens':
        press(lensButtons, (b) => b.dataset.lens === current.lens);
        for (const element of shell.querySelectorAll('.reports-legend')) {
          const legend = /** @type {HTMLElement} */ (element);
          legend.hidden = legend.dataset.lens !== current.lens;
        }
        log(`Lens_${LENS_EVENTS[current.lens]}`);
        break;
      case 'filter':
        press(filterButtons, (b) => b.dataset.filter === current.filter);
        log(`Filter_${FILTER_EVENTS[current.filter]}`);
        break;
      case 'sort':
        log(`Sort_Column=${current.sort.column}_Dir=${current.sort.dir}`);
        break;
      default:
        break;
    }
  });

  // The table and the panel carry the same links; either way a click names its neighborhood.
  shell.addEventListener('click', (e) => {
    const link = /** @type {?HTMLElement} */ (/** @type {Element} */ (e.target).closest('[data-city-event]'));
    if (!link) return;
    const region = /** @type {?HTMLElement} */ (link.closest('[data-region-id]'));
    log(region ? `${link.dataset.cityEvent}_Region=${region.dataset.regionId}` : link.dataset.cityEvent);
  });

  // The page works without its map, so a failed polygon fetch leaves the table and panel as they are.
  const container = document.getElementById('reports-map');
  util.fetchJson('/regions')
    .then((regions) => new CityReportMap(container, {
      basemap: data.basemap, regions, rows: data.rows, state,
    }))
    .catch((error) => console.error('The city reports map could not load its neighborhoods', error));
});
