/**
 * The "Places" switch in a report map's corner (#5900): a `ReportMapToggle` worded as the AccessScore tool words its
 * own, so the two read as one control.
 */

import i18next from 'i18next';
import { ReportMapToggle } from './ReportMapToggle.js';

export class ReportPlacesToggle extends ReportMapToggle {
  /**
   * @param {object} options
   * @param {boolean} [options.checked=true] - Whether the places start shown.
   * @param {(shown: boolean) => void} options.onChange - Called with the new state when the reader flips it.
   */
  constructor({ checked = true, onChange }) {
    super({ name: 'places', text: i18next.t('accessscore:places'), checked, onChange });
  }
}
