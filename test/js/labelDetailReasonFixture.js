/**
 * The label detail card's fixture for the reason pop-up suite (labelDetailReasonPopover.test.js, #5475): the card
 * markup as views/common/labelDetail.scala.html renders it for a non-admin host, reduced to the elements
 * #cacheElements() dereferences plus the comment row and its Reasons button, and the label payload shape
 * `/label/id/:id` serves.
 */

/**
 * Builds the card markup as views/common/labelDetail.scala.html renders it for a non-admin host, reduced to the
 * elements #cacheElements() dereferences (several of them unguarded) plus the comment row these tests drive.
 *
 * @returns {HTMLElement} The card root, mounted in the document.
 */
export function buildCard() {
  document.body.innerHTML = `
      <div id="card" class="label-detail">
        <header class="label-detail__header">
          <h2 class="label-detail__title"></h2>
          <span class="label-detail__own-badge" role="img" hidden></span>
        </header>

        <div class="label-detail__pano-wrap">
          <div class="label-detail__pano"></div>
          <button type="button" class="label-detail__hide-label"></button>
          <div class="label-detail__pano-overlay" role="group">
            <button type="button" class="label-detail__pano-overlay-button label-detail__pano-overlay-button--agree" data-action="validate" data-result="Agree" aria-pressed="false">Agree</button>
            <button type="button" class="label-detail__pano-overlay-button label-detail__pano-overlay-button--disagree" data-action="validate" data-result="Disagree" aria-pressed="false">Disagree</button>
            <button type="button" class="label-detail__pano-overlay-button label-detail__pano-overlay-button--unsure" data-action="validate" data-result="Unsure" aria-pressed="false">Unsure</button>
          </div>
          <span class="label-detail__pan-hint" hidden></span>
        </div>

        <div class="label-detail__meta-row">
          <div class="label-detail__meta-cell">
            <span><span class="label-detail__labeled-word">Labeled</span>:</span>
            <span class="label-detail__timestamp label-detail__meta-value"></span>
          </div>
          <div class="label-detail__meta-cell">
            <span class="label-detail__image-capture-date label-detail__meta-value"></span>
          </div>
          <span class="label-detail__meta-divider label-detail__meta-divider--address" aria-hidden="true" hidden></span>
          <div class="label-detail__meta-cell label-detail__meta-cell--address" hidden>
            <a class="label-detail__address label-detail__meta-value"></a>
          </div>
          <button type="button" class="label-detail__meta-cell label-detail__meta-cell--details">
            <span class="label-detail__info-button-host"></span>
          </button>
        </div>

        <div class="label-detail__columns">
          <section class="label-detail__col label-detail__col--validations">
            <div class="label-detail__vote-display">
              <button type="button" class="label-detail__vote label-detail__vote--agree" aria-pressed="false">
                <span class="label-detail__vote-top">
                  <img alt="" class="label-detail__vote-icon">
                  <span class="label-detail__vote-count">0</span>
                </span>
              </button>
              <button type="button" class="label-detail__vote label-detail__vote--disagree" aria-pressed="false">
                <span class="label-detail__vote-top">
                  <img alt="" class="label-detail__vote-icon">
                  <span class="label-detail__vote-count">0</span>
                </span>
              </button>
              <button type="button" class="label-detail__vote label-detail__vote--unsure" aria-pressed="false">
                <span class="label-detail__vote-top">
                  <img alt="" class="label-detail__vote-icon">
                  <span class="label-detail__vote-count">0</span>
                </span>
              </button>
            </div>
          </section>

          <section class="label-detail__col label-detail__col--severity">
            <div class="label-detail__col-header">
              <h3 class="label-detail__col-title label-detail__severity-title">Severity</h3>
              <span class="label-detail__edit-status" role="status" aria-live="polite"></span>
            </div>
            <div class="label-detail__severity-faces" role="group" aria-label="Severity">
              <button type="button" class="severity-button severity-button--static" data-severity="1" aria-disabled="true" aria-pressed="false" tabindex="-1">
                <img alt="" class="severity-button__icon">
                <span class="severity-button__label">Low</span>
              </button>
              <button type="button" class="severity-button severity-button--static" data-severity="2" aria-disabled="true" aria-pressed="false" tabindex="-1">
                <img alt="" class="severity-button__icon">
                <span class="severity-button__label">Medium</span>
              </button>
              <button type="button" class="severity-button severity-button--static" data-severity="3" aria-disabled="true" aria-pressed="false" tabindex="-1">
                <img alt="" class="severity-button__icon">
                <span class="severity-button__label">High</span>
              </button>
            </div>
          </section>

          <section class="label-detail__col label-detail__col--tags">
            <div class="label-detail__col-header">
              <h3 class="label-detail__col-title label-detail__tags-title">Tags</h3>
              <button type="button" class="label-detail__tags-edit" hidden aria-expanded="false">Edit</button>
              <span class="label-detail__edit-status" role="status" aria-live="polite"></span>
            </div>
            <div class="label-detail__tags"></div>
          </section>
        </div>

        <div class="label-detail__desc-comments">
          <section class="label-detail__description-section">
            <div class="label-detail__description"></div>
          </section>
          <section class="label-detail__comments-section">
            <h3 class="label-detail__col-title label-detail__comments-title" tabindex="-1">
              <span class="label-detail__comments-count" hidden></span>
            </h3>
            <div class="label-detail__comment-row">
              <button type="button" class="label-detail__reasons-reopen" aria-haspopup="dialog" hidden>Reasons</button>
              <label class="sr-only" for="label-detail-comment-input">Why?</label>
              <input type="text" id="label-detail-comment-input" class="label-detail__comment-input">
              <button type="button" class="label-detail__comment-submit" data-action="submit-comment">Comment</button>
              <button type="button" class="button button--small button--secondary label-detail__comment-cancel" data-action="cancel-comment-edit" hidden>Cancel</button>
            </div>
            <span class="label-detail__comment-confirmation" role="status" aria-live="polite" hidden></span>
            <div class="label-detail__validator-comments"></div>
          </section>
        </div>

        <section class="label-detail__stories" hidden></section>
        <span class="label-detail__story-status sr-only" role="status" aria-live="polite"></span>

        <div class="label-detail__footer">
          <a class="label-detail__explore-link" hidden></a>
          <a class="label-detail__labelmap-link" hidden></a>
        </div>
      </div>`;
  return document.getElementById('card');
}

/** A deferred promise, so a test decides when this label's imagery resolves. */
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * Label metadata in the shape `/label/id/:id` serves, with a vote already cast so the comment box has a reason to
 * be open in the first place.
 *
 * @param {Object} [overrides] - Fields to change.
 * @returns {Object}
 */
export function meta(overrides = {}) {
  return {
    label_id: 42,
    label_type: 'Obstacle',
    severity: 2,
    tags: [],
    can_edit: false,
    from_current_user: false,
    description: '',
    pano_id: 'pano-1',
    lat: 47.61,
    lng: -122.33,
    camera_lat: 47.615,
    camera_lng: -122.335,
    heading: 250.5,
    pitch: -12,
    zoom: 2,
    canvas_x: 100,
    canvas_y: 200,
    canvas_width: 720,
    canvas_height: 480,
    street_edge_id: 7,
    region_id: 3,
    timestamp: '2026-08-01T12:00:00Z',
    image_capture_date: '2025-06-01',
    num_agree: 0,
    num_disagree: 1,
    num_unsure: 0,
    user_validation: 'Disagree',
    ai_validation: null,
    comments: [],
    ...overrides,
  };
}

/** A comment entry as the non-admin `/label/id/:id` payload carries it. */
export const comment = (text, mine, extra = {}) => (
  { comment: text, mine, time_created: '2026-08-20T10:00:00Z', commenter: 0, validation: 'Disagree', ...extra }
);
