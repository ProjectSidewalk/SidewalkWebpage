/**
 * Signals that an imagery provider searched a location successfully and reported no usable panorama there.
 *
 * The distinction this type draws is load-bearing (#4918). A provider that answers "nothing here" is telling us a
 * fact about the world; an SDK, network, quota, or maps-library failure tells us only that we never got to ask.
 * Only the first may be written down against a street, because recording a street as imagery-less marks it audited
 * and drops it out of the assignment rotation — so a mistake there costs coverage that nobody ever looked at.
 * Anything not explicitly classified stays a plain Error, which callers must treat as "imagery unknown".
 */
class NoImageryError extends Error {
  /**
   * @param {string} message - Human-readable detail, e.g. which location came back empty.
   * @param {object} [options] - Standard Error options; `cause` carries the provider's own error when there is one.
   */
  constructor(message, options) {
    super(message, options);
    this.name = 'NoImageryError';
  }

  /**
   * Whether a collection of failures is, as a whole, evidence that a street has no imagery.
   *
   * An empty list is not evidence of anything (nothing was ever tried), and a single non-imagery failure
   * disqualifies the whole set: if one candidate point failed because the provider was unreachable, the points it
   * would have covered remain unknown rather than empty.
   *
   * @param {Array<Error>} errors - Failures collected while trying a street's candidate seed points.
   * @returns {boolean} True only when there was at least one failure and every one of them was a NoImageryError.
   */
  static allNoImagery(errors) {
    return errors.length > 0 && errors.every((err) => err instanceof NoImageryError);
  }
}
