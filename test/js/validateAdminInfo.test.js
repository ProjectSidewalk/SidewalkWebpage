/** Tests for the Admin Info popover on /expertValidate: who placed the label, its id, and its past votes (#5840). */

import { loadModules, mockModule, useUtil } from './loader.js';

const placePopover = vi.fn();
useUtil({ placePopover });
mockModule('i18next', () => ({ default: { t: (key) => key } }));

const { AdminInfo } = await loadModules('frontend/js/validate/status/AdminInfo.js');

// The popover's template and holder, as validate.scala.html serves them.
const MARKUP = `
  <template id="admin-info-template">
    <div id="admin-info-content">
      <h1>Admin Info</h1>
      <h2>Labeler</h2>
      <p id="curr-label-username"></p>
      <h2>Label ID</h2>
      <p id="curr-label-id"></p>
      <h2 id="curr-label-prev-validations">Previous Validations</h2>
    </div>
  </template>
  <div id="admin-info-section" style="display: none">
    <button type="button" id="admin-info-button" popovertarget="admin-info-popover">Admin info</button>
    <div id="admin-info-popover" popover></div>
  </div>`;

/** @returns {{adminInfo: AdminInfo, popover: HTMLElement, button: HTMLElement, holder: HTMLElement}} */
function build() {
  document.body.innerHTML = MARKUP;
  const ui = {
    template: document.getElementById('admin-info-template'),
    popover: document.getElementById('admin-info-popover'),
    button: document.getElementById('admin-info-button'),
    holder: document.getElementById('admin-info-section'),
  };
  return { adminInfo: new AdminInfo(ui), ...ui };
}

/** @returns {object} A Label stand-in answering the two property getters AdminInfo reads. */
function label(username, labelId, previousValidations) {
  return {
    getAdminProperty: (key) => ({ username, previousValidations })[key],
    getAuditProperty: (key) => ({ labelId })[key],
  };
}

const prevLines = (popover) => [...popover.querySelectorAll('.prev-val')].map((p) => p.textContent);

beforeEach(() => placePopover.mockClear());

describe('AdminInfo', () => {
  test('shows the Admin Info button once built', () => {
    const { holder } = build();
    expect(holder.style.display).toBe('block');
  });

  test('names the labeler as a link to their admin page, and shows the label id', () => {
    const { adminInfo, popover } = build();
    adminInfo.updateAdminInfo(label('ada lovelace', 42, []));
    const link = popover.querySelector('#curr-label-username a');
    expect(link.textContent).toBe('ada lovelace');
    expect(link.getAttribute('href')).toBe('/admin/user/ada%20lovelace');
    expect(link.target).toBe('_blank');
    expect(popover.querySelector('#curr-label-id').textContent).toBe('42');
  });

  test('puts a username in as text, so markup in one is never run', () => {
    const { adminInfo, popover } = build();
    adminInfo.updateAdminInfo(label('<img src=x onerror=alert(1)>', 1, []));
    expect(popover.querySelector('img')).toBeNull();
    expect(popover.querySelector('#curr-label-username').textContent).toBe('<img src=x onerror=alert(1)>');
  });

  test('says None when nobody has validated the label', () => {
    const { adminInfo, popover } = build();
    adminInfo.updateAdminInfo(label('ada', 1, []));
    expect(prevLines(popover)).toEqual(['None']);
  });

  test('lists each past vote with the validator linked', () => {
    const { adminInfo, popover } = build();
    adminInfo.updateAdminInfo(label('ada', 1, [
      { username: 'bo', validation: 'Agree' },
      { username: 'cyd', validation: 'Disagree' },
    ]));
    // The vote shows as its translation key, since i18next is faked to echo keys.
    expect(prevLines(popover)).toEqual(['bo: common:agree', 'cyd: common:disagree']);
    expect([...popover.querySelectorAll('.prev-val a')].map((a) => a.getAttribute('href')))
      .toEqual(['/admin/user/bo', '/admin/user/cyd']);
  });

  test('replaces the previous label’s info rather than adding to it', () => {
    const { adminInfo, popover } = build();
    adminInfo.updateAdminInfo(label('ada', 1, [{ username: 'bo', validation: 'Agree' }]));
    adminInfo.updateAdminInfo(label('cyd', 2, []));
    expect(popover.querySelectorAll('#admin-info-content')).toHaveLength(1);
    expect(popover.querySelector('#curr-label-id').textContent).toBe('2');
    expect(prevLines(popover)).toEqual(['None']);
  });

  test('parks the popover under the button as it opens, not as it closes', () => {
    const { popover, button } = build();
    popover.dispatchEvent(Object.assign(new Event('beforetoggle'), { newState: 'closed' }));
    expect(placePopover).not.toHaveBeenCalled();
    popover.dispatchEvent(Object.assign(new Event('beforetoggle'), { newState: 'open' }));
    expect(placePopover).toHaveBeenCalledWith(popover, button);
  });

  test('leaves a closed popover where it is when the label changes', () => {
    const { adminInfo } = build();
    adminInfo.updateAdminInfo(label('ada', 1, []));
    expect(placePopover).not.toHaveBeenCalled();
  });

  describe('in a browser with the popover API', () => {
    // jsdom lacks the API, so the test supplies the bit AdminInfo checks for and answers whether it is open.
    let open;
    beforeEach(() => {
      open = false;
      Object.defineProperty(HTMLElement.prototype, 'popover', { configurable: true, value: '' });
    });
    afterEach(() => { delete HTMLElement.prototype.popover; });

    test('re-parks an open popover when its content changes size', () => {
      const { adminInfo, popover, button } = build();
      popover.matches = (selector) => selector === ':popover-open' && open;
      open = true;
      adminInfo.updateAdminInfo(label('ada', 1, []));
      expect(placePopover).toHaveBeenCalledWith(popover, button);
    });

    test('does not re-park a closed one', () => {
      const { adminInfo, popover } = build();
      popover.matches = (selector) => selector === ':popover-open' && open;
      adminInfo.updateAdminInfo(label('ada', 1, []));
      expect(placePopover).not.toHaveBeenCalled();
    });
  });
});
