/** Tests for onLinkClick, a link click listener that also hears middle clicks. */

import { loadModules } from './loader.js';

const { onLinkClick } = await loadModules('frontend/js/common/onLinkClick.js');

describe('onLinkClick', () => {
  let link;
  let handler;

  beforeEach(() => {
    link = document.createElement('a');
    handler = vi.fn();
    onLinkClick(link, handler);
  });

  test('runs on a click', () => {
    link.dispatchEvent(new MouseEvent('click', { cancelable: true }));
    expect(handler).toHaveBeenCalledOnce();
  });

  test('runs on a middle click, which opens a new tab without a click event', () => {
    link.dispatchEvent(new MouseEvent('auxclick', { button: 1 }));
    expect(handler).toHaveBeenCalledOnce();
  });

  test('ignores a right click, which only opens the context menu', () => {
    link.dispatchEvent(new MouseEvent('auxclick', { button: 2 }));
    expect(handler).not.toHaveBeenCalled();
  });
});
