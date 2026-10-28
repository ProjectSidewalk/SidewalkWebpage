/**
 * Tests for frontend/js/common/copyToClipboard.js, the one way a copy button confirms itself (#5830): at the button,
 * in its label or (for an icon-only button) its tooltip, and out loud for a screen reader.
 */

import { loadModules, mockModule } from './loader.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

describe('copyToClipboard', () => {
  let copyToClipboard;
  let writeText;

  beforeEach(async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    ({ copyToClipboard } = await loadModules('frontend/js/common/copyToClipboard.js'));
  });

  afterEach(() => vi.useRealTimers());

  /** @returns {HTMLButtonElement} A button built from `html`, attached to the page. */
  const button = (html) => {
    document.body.insertAdjacentHTML('beforeend', html);
    return /** @type {HTMLButtonElement} */ (document.body.lastElementChild);
  };

  /** @returns {string} What the hidden live region has been given to read out. */
  const announced = () => {
    vi.runOnlyPendingTimers(); // The region is filled on the next frame.
    return document.querySelector('.ps-copy-status')?.textContent;
  };

  test('a text button says "Copied!" in place of its label, then goes back', async () => {
    const btn = button('<button>Copy link</button>');

    expect(await copyToClipboard(btn, 'https://example.org')).toBe(true);

    expect(writeText).toHaveBeenCalledWith('https://example.org');
    expect(btn.textContent).toBe('common:copy.copied');
    expect(btn.classList.contains('is-copied')).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(btn.textContent).toBe('Copy link');
    expect(btn.classList.contains('is-copied')).toBe(false);
  });

  test('swaps only the label element when given one, leaving the icon beside it', async () => {
    const btn = button('<button><svg></svg><span class="label">Copy link</span></button>');
    const label = btn.querySelector('.label');

    await copyToClipboard(btn, 'x', { labelEl: label });

    expect(label.textContent).toBe('common:copy.copied');
    expect(btn.querySelector('svg')).not.toBeNull();
  });

  test('an icon-only button says it in its tooltip and asks for the card straight away', async () => {
    const btn = button('<button data-ps-tooltip="Copy to clipboard" aria-label="Copy to clipboard"><img></button>');
    const asked = vi.fn();
    btn.addEventListener('ps-tooltip:show', asked);

    await copyToClipboard(btn, 'x');

    expect(btn.getAttribute('data-ps-tooltip')).toBe('common:copy.copied');
    expect(asked).toHaveBeenCalled();
    expect(btn.querySelector('img')).not.toBeNull();
    vi.advanceTimersByTime(1500);
    expect(btn.getAttribute('data-ps-tooltip')).toBe('Copy to clipboard');
  });

  test('a second click during the confirmation still goes back to the real label', async () => {
    const btn = button('<button>Copy</button>');

    await copyToClipboard(btn, 'x');
    vi.advanceTimersByTime(1000);
    await copyToClipboard(btn, 'x');
    vi.advanceTimersByTime(1000);
    expect(btn.textContent).toBe('common:copy.copied'); // The second click restarted the clock.
    vi.advanceTimersByTime(500);

    expect(btn.textContent).toBe('Copy');
  });

  test('a failed copy says so, at the button and out loud', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const btn = button('<button>Copy</button>');

    expect(await copyToClipboard(btn, 'x')).toBe(false);

    expect(btn.textContent).toBe('common:copy.failed');
    expect(btn.classList.contains('is-copy-failed')).toBe(true);
    expect(announced()).toBe('common:copy.failed');
  });

  test('announces from inside an open modal dialog, where a region on <body> would be hidden', async () => {
    document.body.innerHTML = '<dialog open><button>Copy</button></dialog>';
    const dialog = document.querySelector('dialog');

    await copyToClipboard(dialog.querySelector('button'), 'x');

    expect(announced()).toBe('common:copy.copied');
    expect(dialog.querySelector(':scope > .ps-copy-status[role="status"]')).not.toBeNull();
  });
});
