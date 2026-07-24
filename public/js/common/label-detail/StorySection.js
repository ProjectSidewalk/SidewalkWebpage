/**
 * StorySection — the lived-experience stories disclosure on the label-detail card (#4054).
 *
 * Lazily fetches GET /label/:labelId/stories when a label is shown (Gallery's host never calls the label-metadata
 * endpoint, so stories can't ride that payload), then renders the summary (count badge + share CTA) and the story
 * list: text, byline (anonymous or username), photo thumbnails that open the enlarge dialog, the author's
 * own-story delete + dashboard-link controls, and the hidden-by-moderators chip on the author's quarantined story.
 * With zero stories the whole section stays hidden and the share CTA is a compact pill in the card's footer row
 * instead. Scoped to the host root; owns the StoryComposer and the enlarge lightbox from the same partial.
 */
class StorySection {
  #els = {};
  #composer;
  #labelId = null;
  #maxTextLength = null;
  #isAccessProblem = null; // From the /stories payload (LabelTypeEnum-sourced); flips the composer's phrasing.
  #fetchToken = 0; // Guards against a stale response landing after a newer label was opened.

  /**
   * @param {HTMLElement} root - The host element containing the labelDetail markup.
   * @param {Object} opts
   * @param {string} [opts.currUsername] - The viewer's username, for the composer's show-username option.
   */
  constructor(root, opts) {
    const q = (sel) => root.querySelector(sel);
    this.#els = {
      section: q('.label-detail__stories'),
      details: q('.label-detail__stories-details'),
      summary: q('.label-detail__stories-summary'),
      count: q('.label-detail__stories-count'),
      shareBtn: q('.label-detail__stories-summary .label-detail__story-share'),
      footerShareBtn: q('.label-detail__story-share--footer'),
      list: q('.label-detail__stories-list'),
      status: q('.label-detail__story-status'),
      lightbox: q('.story-lightbox'),
      lightboxImg: q('.story-lightbox__img'),
      lightboxCaption: q('.story-lightbox__caption'),
      lightboxClose: q('.story-lightbox__close'),
    };

    this.#composer = new StoryComposer(q('.story-composer'), {
      currUsername: opts.currUsername,
      onSubmitted: (edited) => {
        this.#announce(i18next.t(edited ? 'labelmap:story.updated' : 'labelmap:story.submitted'));
        this.#els.details.open = true;
        this.refresh();
      },
    });

    // The CTA lives inside the <summary>; stop the click from also toggling the disclosure.
    this.#els.shareBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.#composer.open(this.#labelId, this.#maxTextLength);
    });
    this.#els.footerShareBtn.addEventListener('click', () => {
      this.#composer.open(this.#labelId, this.#maxTextLength);
    });
    // Expand logging lives on click rather than the toggle event so the auto-expand in #render isn't counted.
    this.#els.summary.addEventListener('click', () => {
      if (!this.#els.details.open) {
        window.logWebpageActivity?.(`Click_module=StorySectionExpand_labelId=${this.#labelId}`);
      }
    });
    this.#els.lightboxClose.addEventListener('click', () => this.#els.lightbox.close());
  }

  /**
   * Points the section at a new label: collapses the disclosure, clears the list, and fetches its stories.
   * @param {number} labelId
   */
  setLabel(labelId) {
    this.#labelId = labelId;
    this.#isAccessProblem = null;
    this.#els.list.replaceChildren();
    this.#els.count.hidden = true;
    // Empty posture until the fetch lands (most labels have no stories): section hidden, footer CTA up. This is
    // also the fetch-failure fallback, so sharing stays reachable even when the story list can't load.
    this.#els.section.hidden = true;
    this.#els.details.open = false;
    this.#els.footerShareBtn.hidden = false;
    this.#els.shareBtn.hidden = false;
    this.refresh();
    this.#maybeResumeDraft(labelId);
  }

  /**
   * After a sign-in bounce started from the composer (#4054), the return URL carries ?resumeStory=<labelId>. When
   * it matches the label now shown, reopen the composer (which restores the stashed draft) and strip the marker so
   * a reload doesn't reopen it. On surfaces where this label's card isn't shown on return, the draft still restores
   * whenever the composer is next opened for it — this is only the auto-reopen nicety.
   * @param {number} labelId
   */
  #maybeResumeDraft(labelId) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('resumeStory') !== String(labelId)) return;
    params.delete('resumeStory');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
    this.#composer.open(labelId, this.#maxTextLength);
  }

  /** Re-fetches and re-renders the current label's stories. */
  async refresh() {
    if (this.#labelId === null) return;
    const token = ++this.#fetchToken;
    try {
      const res = await fetch(`/label/${this.#labelId}/stories`);
      if (!res.ok) return;
      const data = await res.json();
      if (token !== this.#fetchToken) return;
      this.#maxTextLength = data.max_text_length;
      this.#isAccessProblem = data.is_access_problem;
      // Positive access features (curb ramps, signals, ...) get "story about a feature" phrasing instead of "has a
      // problem affected you". Applied on every fetch so paging between label types re-picks the right copy — and
      // reaches the composer even if it was opened before this response landed (the sign-in resume path).
      this.#composer.setCopyVariant(this.#isAccessProblem);
      this.#render(data.stories);
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * @param {Array<Object>} stories - StoryForView payloads, newest first.
   */
  #render(stories) {
    const els = this.#els;

    // With zero stories the section stays hidden entirely and the footer CTA carries the invitation; once any
    // story exists the section takes the space to show it off (per review on #4593).
    const empty = stories.length === 0;
    els.section.hidden = empty;
    els.footerShareBtn.hidden = !empty;
    els.count.textContent = String(stories.length);
    els.count.hidden = empty;
    // Stories are the payoff, so the disclosure starts open whenever there are any (the list is height-capped,
    // so the card stays bounded); collapsing is still available via the summary.
    els.details.open = !empty;
    // One story per user per label (server-enforced): once yours exists, edit-in-place is the change path.
    els.shareBtn.hidden = stories.some((s) => s.is_own);

    els.list.replaceChildren();
    for (const story of stories) {
      els.list.appendChild(this.#buildStoryRow(story));
    }
  }

  /**
   * @param {Object} story - A StoryForView payload.
   * @returns {HTMLElement}
   */
  #buildStoryRow(story) {
    const row = document.createElement('div');
    row.className = 'label-detail__story';
    if (story.hidden) row.classList.add('label-detail__story--hidden');

    if (story.media) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'label-detail__story-photo-btn';
      const enlarge = i18next.t('labelmap:story.enlarge-photo');
      btn.setAttribute('aria-label', story.media.alt_text ? `${enlarge}: ${story.media.alt_text}` : enlarge);
      const img = document.createElement('img');
      img.className = 'label-detail__story-thumb';
      img.loading = 'lazy';
      img.src = story.media.url;
      img.alt = story.media.alt_text || '';
      btn.appendChild(img);
      btn.addEventListener('click', () => this.#openLightbox(story.media));
      row.appendChild(btn);
    }

    const body = document.createElement('div');
    body.className = 'label-detail__story-body';

    const text = document.createElement('p');
    text.className = 'label-detail__story-text';
    text.textContent = story.text; // textContent escapes — no HTML injection.
    body.appendChild(text);

    const byline = document.createElement('div');
    byline.className = 'label-detail__story-byline';
    const who = document.createElement('span');
    who.className = 'label-detail__story-who';
    who.textContent = story.display_name || i18next.t('labelmap:story.anonymous');
    byline.appendChild(who);
    byline.appendChild(document.createTextNode(` · ${moment(new Date(story.created_at)).format('ll')}`));

    if (story.is_own) {
      const chip = document.createElement('span');
      chip.className = 'label-detail__story-chip label-detail__story-chip--own';
      chip.textContent = i18next.t('labelmap:story.your-story-chip');
      byline.appendChild(chip);

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'label-detail__story-edit';
      edit.textContent = i18next.t('labelmap:story.edit');
      edit.addEventListener('click', () => this.#composer.openForEdit(story, this.#maxTextLength));
      byline.appendChild(edit);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'label-detail__story-delete';
      del.textContent = i18next.t('labelmap:story.delete');
      del.addEventListener('click', () => this.#deleteStory(story.story_id));
      byline.appendChild(del);

      const dashLink = document.createElement('a');
      dashLink.className = 'label-detail__story-dashboard-link';
      dashLink.href = '/dashboard#ud-stories-section';
      dashLink.textContent = i18next.t('labelmap:story.see-all-stories');
      dashLink.addEventListener('click', () => {
        window.logWebpageActivity?.(`Click_module=StoryDashboardLink_labelId=${this.#labelId}`);
      });
      byline.appendChild(dashLink);
    }
    if (story.hidden) {
      const chip = document.createElement('span');
      chip.className = 'label-detail__story-chip label-detail__story-chip--hidden';
      chip.textContent = i18next.t('labelmap:story.hidden-chip');
      byline.appendChild(chip);
    }

    body.appendChild(byline);
    row.appendChild(body);
    return row;
  }

  /**
   * The author's retraction from the card: a confirmed, permanent delete (row + photo bytes on the server).
   * @param {number} storyId
   */
  async #deleteStory(storyId) {
    const confirmed = await ConfirmDialog.confirm({
      message: i18next.t('labelmap:story.delete-confirm'),
      confirmText: i18next.t('labelmap:story.delete'),
      cancelText: i18next.t('labelmap:story.cancel'),
      danger: true,
      confirmIconSrc: '/assets/images/icons/delete-white-material.svg',
    });
    if (!confirmed) return;
    window.logWebpageActivity?.(`Click_module=StoryDeleteClient_storyId=${storyId}`);
    try {
      const res = await fetch(`/userapi/stories/${storyId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.#announce(i18next.t('labelmap:story.deleted'));
      this.refresh();
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * @param {Object} media - The story's media payload; alt text doubles as the visible caption.
   */
  #openLightbox(media) {
    window.logWebpageActivity?.(`Click_module=StoryPhotoEnlarge_storyMediaId=${media.story_media_id}`);
    const els = this.#els;
    els.lightboxImg.src = media.url;
    els.lightboxImg.alt = media.alt_text || '';
    els.lightboxCaption.textContent = media.alt_text || i18next.t('labelmap:story.no-photo-description');
    els.lightbox.showModal();
  }

  /** @param {string} message - Announced via the section's aria-live region. */
  #announce(message) {
    this.#els.status.textContent = message;
    setTimeout(() => {
      this.#els.status.textContent = '';
    }, 4000);
  }
}
