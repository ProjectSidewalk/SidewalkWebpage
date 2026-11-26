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
import '../../css/components/tool-header.css';
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

/**
 * Restates each server-printed UTC time in the reader's own time zone and language.
 * @param {ParentNode} root - Where to look.
 */
function localizeTimes(root) {
  for (const element of root.querySelectorAll('time[data-local-time]')) {
    const time = /** @type {HTMLTimeElement} */ (element);
    const date = new Date(time.dateTime);
    if (!Number.isNaN(date.getTime())) time.textContent = date.toLocaleString(i18next.language, util.SHORT_DATE_TIME);
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
  new ResizeObserver(update).observe(scroller);
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
  const page = document.getElementById('reports-page');
  const data = JSON.parse(document.getElementById('reports-data').textContent);
  const rowsById = new Map(data.rows.map((row) => [row.id, row]));
  const log = (event) => window.logWebpageActivity(`Report_City_${event}`);

  paint(page);
  paintLegends();
  localizeTimes(page);
  const scroller = document.getElementById('reports-table-scroll');
  if (scroller) focusableWhileScrolling(scroller);

  // Scored rows lowest first, unscored after: the server's order is the Score sort, ascending.
  const sort = data.scoresReady ? { column: 'score', dir: /** @type {'asc'} */ ('asc') } : null;
  const state = new CityReportState(data.rows, { selected: data.selected, sort });
  new CityReportTable(/** @type {HTMLTableElement} */ (document.getElementById('reports-table')), data.rows, state);

  const lensButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (page.querySelectorAll('button[data-lens]'));
  const filterButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (page.querySelectorAll('button[data-filter]'));
  // The state rejects anything but its own lenses and filters, so the server's markup can't set a third.
  for (const button of lensButtons) {
    button.addEventListener('click', () => state.setLens(/** @type {any} */ (button.dataset.lens)));
  }
  for (const button of filterButtons) {
    button.addEventListener('click', () => state.setFilter(/** @type {any} */ (button.dataset.filter)));
  }
  document.getElementById('reports-controls').hidden = false;

  const panel = document.getElementById('reports-panel');
  const panelStatus = document.getElementById('reports-panel-status');
  state.subscribe((current, change) => {
    switch (change.type) {
      case 'select': {
        // A selection of a hidden row resets the filter, so the buttons follow it too.
        press(filterButtons, (b) => b.dataset.filter === current.filter);
        const row = rowsById.get(current.selected);
        if (panel) {
          renderPanel(panel, row, data);
          paint(panel);
        }
        if (panelStatus) panelStatus.textContent = `${row.name}: ${row.text.why}`;
        log(`Select_Region=${current.selected}_From=${change.from}`);
        break;
      }
      case 'lens':
        press(lensButtons, (b) => b.dataset.lens === current.lens);
        for (const element of page.querySelectorAll('.reports-legend')) {
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
  page.addEventListener('click', (e) => {
    const link = /** @type {?HTMLElement} */ (/** @type {Element} */ (e.target).closest('[data-city-event]'));
    if (!link) return;
    const region = /** @type {?HTMLElement} */ (link.closest('[data-region-id]'));
    log(region ? `${link.dataset.cityEvent}_Region=${region.dataset.regionId}` : link.dataset.cityEvent);
  });

  // The page works without its map, so a failed polygon fetch leaves the table and panel as they are.
  const container = document.getElementById('reports-map');
  util.fetchJson('/regions')
    .then((regions) => new CityReportMap(container, { basemap: data.basemap, regions, rows: data.rows, state }))
    .catch((error) => console.error('The city reports map could not load its neighborhoods', error));
});
