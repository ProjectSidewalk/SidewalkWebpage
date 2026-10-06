/**
 * Which of Validate's window-shaped layouts is showing (#5580). The queries are the breakpoints of the CSS blocks
 * that draw those layouts (the narrow and short blocks in svv-immersive.css), so both must change together, or JS and
 * CSS disagree about which layout is on screen.
 *
 * Its own module rather than statics on Main, so the modals that branch on the layout don't import Main, which
 * imports them.
 *
 * @example
 * if (ValidateLayout.isNarrow()) panoViewer.setPov(labelPov); // A portrait frame centres the label.
 */
export class ValidateLayout {
  // Phone portrait: the width main.css already drops the test-server banner at. A tablet matches neither query and
  // keeps the wide layout, with touch controls from (pointer: coarse) alone.
  static NARROW_QUERY = '(width <= 600px)';
  // Phone landscape (844×390): too short for the narrow layout's stacked dock.
  static SHORT_QUERY = '(height <= 500px)';

  /** @returns {boolean} Whether the window is phone-portrait narrow. Live: re-read per call. */
  static isNarrow() {
    return window.matchMedia(ValidateLayout.NARROW_QUERY).matches;
  }

  /** @returns {boolean} Whether the window is phone-landscape short. Live: re-read per call. */
  static isShort() {
    return window.matchMedia(ValidateLayout.SHORT_QUERY).matches;
  }

  /**
   * Whether the window is too small in either direction for the boxed layout: a phone in either orientation, or a
   * desktop window dragged that small. Validate is immersive there, with controls at their authored size.
   * @returns {boolean} Live: re-read per call.
   */
  static isCompact() {
    return ValidateLayout.isNarrow() || ValidateLayout.isShort();
  }
}
