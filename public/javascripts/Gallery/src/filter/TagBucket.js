/**
 * A Tag Bucket to store Tags.
 */
class TagBucket {
  // List of Tags.
  #bucket = [];

  /**
     * Add Tag.
     *
     * @param {*} tag Tag to add.
     */
  push(tag) {
    this.#bucket.push(tag);
  }

  /**
     * Render all Tags.
     *
     * @param {*} uiTagHolder UI element to render Tags in.
     */
  render(uiTagHolder) {
    this.#bucket.forEach((tag) => tag.render(uiTagHolder));
  }

  /**
     * Unapply all tags.
     */
  unapplyTags() {
    this.#bucket.forEach((tag) => tag.unapply());
  }

  /**
     * Return list of Tags.
     */
  getTags() {
    return this.#bucket;
  }

  /**
     * Return number of Tags.
     */
  getSize() {
    return this.#bucket.length;
  }

  /**
     * Return list of applied Tags.
     */
  getAppliedTags() {
    return this.#bucket.filter((tag) => tag.getStatus().applied);
  }
}
