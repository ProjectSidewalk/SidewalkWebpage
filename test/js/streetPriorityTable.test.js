/**
 * Tests for the Imagery page's sortable work-list table (#4908).
 *
 * One class drives both of the page's tables, so its behavior is the behavior of the region ranking *and* the street
 * queue. The cases that matter are the ones where a rendered value and the value behind it disagree — a count shown
 * with a colored swatch, a priority shown to three decimals, a date shown as "never" — because that is where a table
 * starts sorting on the string it printed instead of the number it holds. The rest pin the interactions the map
 * brushing depends on, and the keyboard path, which nothing else exercises.
 *
 * Runs under jsdom (jest.config.js). StreetPriorityTable is a bare top-level class in a concatenated bundle, so it is
 * eval'd into global scope rather than required.
 */

const fs = require('fs');
const path = require('path');

const JS_DIR = path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard');

/** Loads AdminShell (the table escapes through it) and returns the table class. */
function loadTable() {
  const shell = fs.readFileSync(path.join(JS_DIR, 'AdminShell.js'), 'utf8');
  const table = fs.readFileSync(path.join(JS_DIR, 'StreetPriorityTable.js'), 'utf8');
  return (0, eval)(`${shell}\nglobalThis.AdminShell = AdminShell;\n${table}\nStreetPriorityTable;`);
}

const StreetPriorityTable = loadTable();

const REGIONS = [
  { region_id: 1, region_name: 'Ballard', reaudit: 12, mean_priority: 0.4 },
  { region_id: 2, region_name: 'Downtown', reaudit: 3, mean_priority: 0.9 },
  { region_id: 3, region_name: 'Capitol Hill', reaudit: 40, mean_priority: 0.1 },
];

/** Columns matching the page's region table: a text column, a plain numeric one, and a formatted one. */
const COLUMNS = [
  { key: 'region_name', label: 'Region', numeric: false },
  { key: 'mean_priority', label: 'Mean priority', format: (r) => r.mean_priority.toFixed(3) },
  { key: 'reaudit', label: 'Needs re-audit', format: (r) => `<span class="swatch"></span>${r.reaudit}` },
];

/** Builds a table into a fresh DOM. */
function build(opts = {}) {
  document.body.innerHTML = '<table id="work"></table><input id="work-search" type="search">';
  const table = new StreetPriorityTable('work', {
    rowKey: 'region_id',
    columns: COLUMNS,
    sortKey: 'mean_priority',
    searchId: 'work-search',
    searchFields: ['region_name'],
    ...opts,
  });
  table.render(opts.rows || REGIONS);
  return table;
}

/** The first cell of each rendered row, in render order. */
const renderedNames = () => [...document.querySelectorAll('#work tbody tr')].map((tr) => tr.cells[0].textContent);

/** The current header cell for a column key. Sorting replaces the thead, so it must be re-queried each time. */
const header = (key) => document.querySelector(`#work th[data-key="${key}"]`);

/** Clicks a header by its label. */
const clickHeader = (label) => {
  const th = [...document.querySelectorAll('#work th')].find((el) => el.textContent.startsWith(label));
  th.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return th;
};

describe('StreetPriorityTable rendering', () => {
  test('renders one row per record, keyed by the configured row id', () => {
    build();
    const rows = [...document.querySelectorAll('#work tbody tr')];
    expect(rows).toHaveLength(3);
    expect(rows.map((tr) => tr.dataset.rowId).sort()).toEqual(['1', '2', '3']);
  });

  test('opens on the configured sort key, most-first', () => {
    build();
    expect(renderedNames()).toEqual(['Downtown', 'Ballard', 'Capitol Hill']);
  });

  test('marks the sorted column for assistive technology', () => {
    build();
    const sorted = [...document.querySelectorAll('#work th')].find((th) => th.dataset.key === 'mean_priority');
    expect(sorted.getAttribute('aria-sort')).toBe('descending');
    const others = [...document.querySelectorAll('#work th')].filter((th) => th.dataset.key !== 'mean_priority');
    others.forEach((th) => expect(th.getAttribute('aria-sort')).toBe('none'));
  });

  test('says so when a filter leaves nothing, rather than showing an empty table body', () => {
    build({ rows: [] });
    expect(document.querySelector('#work tbody').textContent).toContain('Nothing to show');
    expect(document.querySelectorAll('#work tbody tr[data-row-id]')).toHaveLength(0);
  });

  test('renders a value with no declared format as an escaped cell, and an absent one as an em dash', () => {
    build({
      columns: [{ key: 'region_name', label: 'Region', numeric: false }, { key: 'note', label: 'Note' }],
      rows: [{ region_id: 1, region_name: '<b>Ballard</b>', note: null }],
    });
    const cells = document.querySelector('#work tbody tr').cells;
    expect(cells[0].querySelector('b')).toBeNull();
    expect(cells[0].textContent).toBe('<b>Ballard</b>');
    expect(cells[1].textContent).toBe('—');
  });

  test('does not em-dash a zero, which is a real count', () => {
    build({
      columns: [{ key: 'region_name', label: 'Region', numeric: false }, { key: 'reaudit', label: 'Re-audit' }],
      rows: [{ region_id: 1, region_name: 'Ballard', reaudit: 0 }],
    });
    expect(document.querySelector('#work tbody tr').cells[1].textContent).toBe('0');
  });
});

describe('StreetPriorityTable sorting', () => {
  test('sorts on the underlying value, not the string the column printed', () => {
    build();
    clickHeader('Needs re-audit');
    // The cell renders a swatch span in front of the number, so a sort over rendered text would order 12, 3, 40 as
    // "12", "3", "40" — the exact failure a formatted count invites.
    expect(renderedNames()).toEqual(['Capitol Hill', 'Ballard', 'Downtown']);
  });

  test('starts a numeric column descending and a text column ascending', () => {
    build();
    clickHeader('Needs re-audit');
    expect(renderedNames()[0]).toBe('Capitol Hill');
    clickHeader('Region');
    expect(renderedNames()).toEqual(['Ballard', 'Capitol Hill', 'Downtown']);
  });

  test('reverses when the same column is clicked again', () => {
    build();
    clickHeader('Region');
    expect(renderedNames()[0]).toBe('Ballard');
    clickHeader('Region');
    expect(renderedNames()).toEqual(['Downtown', 'Capitol Hill', 'Ballard']);
  });

  test('keeps sorting after the header has been replaced once', () => {
    build();
    clickHeader('Region');
    // Sorting rewrites the thead element, so a listener bound to the old thead is discarded — this is the case that
    // catches a listener moved off the table onto its header row.
    clickHeader('Needs re-audit');
    expect(renderedNames()).toEqual(['Capitol Hill', 'Ballard', 'Downtown']);
  });

  test('honors a column\'s own sort value when the rendered form cannot be compared', () => {
    build({
      columns: [
        { key: 'region_name', label: 'Region', numeric: false },
        { key: 'last_audit', label: 'Last audited', format: (r) => r.last_audit || 'never',
          sortValue: (r) => (r.last_audit ? Date.parse(r.last_audit) : 0) },
      ],
      sortKey: 'last_audit',
      rows: [
        { region_id: 1, region_name: 'Ballard', last_audit: '2024-01-05' },
        { region_id: 2, region_name: 'Downtown', last_audit: null },
        { region_id: 3, region_name: 'Capitol Hill', last_audit: '2026-02-01' },
      ],
    });
    expect(renderedNames()).toEqual(['Capitol Hill', 'Ballard', 'Downtown']);
  });

  test('updates aria-sort as the sort moves, so it never labels the wrong column', () => {
    build();
    clickHeader('Region');
    const byKey = Object.fromEntries([...document.querySelectorAll('#work th')]
      .map((th) => [th.dataset.key, th.getAttribute('aria-sort')]));
    expect(byKey.region_name).toBe('ascending');
    expect(byKey.mean_priority).toBe('none');
  });

  test('sorts from the keyboard, since the headers advertise themselves as buttons', () => {
    build();
    header('region_name').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(renderedNames()).toEqual(['Ballard', 'Capitol Hill', 'Downtown']);
    header('region_name').dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(renderedNames()).toEqual(['Downtown', 'Capitol Hill', 'Ballard']);
  });

  test('keeps focus on the header a keyboard user just sorted', () => {
    build();
    header('region_name').focus();
    header('region_name').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // Sorting replaces the thead, so without restoring focus the user is dropped to the top of the document and
    // cannot reverse the sort without tabbing all the way back (WCAG 2.4.3).
    expect(document.activeElement.dataset.key).toBe('region_name');
  });

  test('leaves focus alone when the sort came from a click', () => {
    build();
    document.getElementById('work-search').focus();
    clickHeader('Region');
    expect(document.activeElement.id).toBe('work-search');
  });

  test('ignores keys that are not the activation keys', () => {
    build();
    header('region_name').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(renderedNames()).toEqual(['Downtown', 'Ballard', 'Capitol Hill']);
  });

  test('every header is reachable and labeled as an interactive control', () => {
    build();
    [...document.querySelectorAll('#work th')].forEach((th) => {
      expect(th.getAttribute('role')).toBe('button');
      expect(th.getAttribute('tabindex')).toBe('0');
      expect(th.getAttribute('scope')).toBe('col');
    });
  });
});

describe('StreetPriorityTable search', () => {
  test('filters on the configured fields, case-insensitively', () => {
    build();
    const search = document.getElementById('work-search');
    search.value = 'BAL';
    search.dispatchEvent(new window.Event('input'));
    expect(renderedNames()).toEqual(['Ballard']);
  });

  test('reports no match rather than an empty body', () => {
    build();
    const search = document.getElementById('work-search');
    search.value = 'nowhere';
    search.dispatchEvent(new window.Event('input'));
    expect(document.querySelector('#work tbody').textContent).toContain('Nothing to show');
  });

  test('keeps the active sort while filtering', () => {
    build();
    clickHeader('Region');
    const search = document.getElementById('work-search');
    search.value = 'a';
    search.dispatchEvent(new window.Event('input'));
    expect(renderedNames()).toEqual(['Ballard', 'Capitol Hill']);
  });

  test('does not search fields it was not given', () => {
    build();
    const search = document.getElementById('work-search');
    search.value = '0.9';
    search.dispatchEvent(new window.Event('input'));
    expect(document.querySelector('#work tbody').textContent).toContain('Nothing to show');
  });
});

describe('StreetPriorityTable row interactions', () => {
  let hooks;

  const rowFor = (name) => [...document.querySelectorAll('#work tbody tr')]
    .find((tr) => tr.cells[0].textContent === name);

  beforeEach(() => {
    hooks = { onRowClick: jest.fn(), onRowHover: jest.fn(), onRowHoverEnd: jest.fn() };
    build(hooks);
  });

  test('pins the clicked row\'s id', () => {
    rowFor('Ballard').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(hooks.onRowClick).toHaveBeenCalledWith(1);
  });

  test('lets a link inside a row navigate instead of pinning', () => {
    build({ ...hooks,
      columns: [{ key: 'region_name', label: 'Region', numeric: false,
        format: (r) => `<a href="/explore">${r.region_name}</a>` }] });
    document.querySelector('#work tbody a').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(hooks.onRowClick).not.toHaveBeenCalled();
  });

  test('brushes on hover and stops when the pointer leaves the body', () => {
    rowFor('Ballard').dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    expect(hooks.onRowHover).toHaveBeenCalledWith(1);
    document.querySelector('#work tbody').dispatchEvent(new window.Event('pointerleave'));
    expect(hooks.onRowHoverEnd).toHaveBeenCalled();
  });

  test('does not re-brush while the pointer moves within one row', () => {
    const row = rowFor('Ballard');
    row.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    row.cells[1].dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    expect(hooks.onRowHover).toHaveBeenCalledTimes(1);
  });

  test('reports leaving a row for the gap between rows, so the brush does not stick', () => {
    rowFor('Ballard').dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    document.querySelector('#work tbody').dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    expect(hooks.onRowHoverEnd).toHaveBeenCalled();
  });
});

describe('StreetPriorityTable highlighting', () => {
  const highlighted = () => [...document.querySelectorAll('#work tbody tr.highlighted')]
    .map((tr) => tr.cells[0].textContent);

  test('highlights exactly the given ids and drops the rest', () => {
    const table = build();
    table.highlightRows([1, 3]);
    expect(highlighted().sort()).toEqual(['Ballard', 'Capitol Hill']);
    table.highlightRows([2]);
    expect(highlighted()).toEqual(['Downtown']);
  });

  test('accepts ids as strings, which is what a map feature property hands over', () => {
    const table = build();
    table.highlightRows(['2']);
    expect(highlighted()).toEqual(['Downtown']);
  });

  test('clearHighlight leaves no row marked', () => {
    const table = build();
    table.highlightRows([1, 2, 3]);
    table.clearHighlight();
    expect(highlighted()).toEqual([]);
  });

  test('does nothing when the table is not on the page', () => {
    const table = build();
    document.body.innerHTML = '';
    expect(() => table.highlightRows([1])).not.toThrow();
    expect(() => table.clearHighlight()).not.toThrow();
  });
});
