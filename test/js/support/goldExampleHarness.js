/**
 * Shared setup for the training-example suites (#1445, #5840): an i18next stand-in over the real English common.json,
 * so the reason menus and the admin list show the same reason text the pages do, and a reason the locale files lack
 * reads as missing, just as it would on the page.
 */

import fs from 'fs';
import path from 'path';
import { mockModule, REPO_ROOT } from '../loader.js';

const EN_COMMON = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'public/locales/en/common.json'), 'utf8'));

/**
 * @param {string} key - An i18next key, e.g. `common:validation-reason.driveway.text`.
 * @returns {string|undefined} What the English common.json holds there; only `common:` keys are known.
 */
function lookup(key) {
  const [ns, rest] = key.split(':');
  if (ns !== 'common') return undefined;
  return rest.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), EN_COMMON);
}

mockModule('i18next', () => ({
  default: {
    t: (key) => lookup(key) ?? key,
    exists: (key) => typeof lookup(key) === 'string',
  },
}));

/**
 * @param {string} id - A canned reason id, e.g. 'driveway'.
 * @returns {string} Its English text, as a menu or the admin list shows it.
 */
export const reasonText = (id) => lookup(`common:validation-reason.${id}.text`);
