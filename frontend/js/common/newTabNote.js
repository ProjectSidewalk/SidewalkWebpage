import i18next from 'i18next';

/**
 * The screen-reader note for a link that opens a new tab, a change of context its visible text doesn't announce
 * (WCAG 3.2.5, G201). Append it inside the link. Unselectable, so copying the link's text doesn't pick it up.
 *
 * @returns {HTMLSpanElement} The visually hidden note.
 */
export function newTabNote() {
  const note = document.createElement('span');
  note.className = 'sr-only new-tab-note';
  note.textContent = ` ${i18next.t('common:opens-new-tab')}`;
  return note;
}
