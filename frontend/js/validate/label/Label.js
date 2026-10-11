/**
 * Represents a validation label.
 */

import { util } from '../../common/utilities.js';
import { buildBackupImageData } from '../../common/utilitiesSidewalk.js';
import '../../common/pano-viewer/panoUtilities.js';
/** @typedef {import('../Main.js').ValidateConfig} ValidateConfig */
/** @typedef {import('../../common/pano-viewer/PanoViewer.js').PanoViewer} PanoViewer */

export class Label {
  /** @type {ValidateConfig} */
  #config;

  // Original properties of the label collected through the audit interface. These properties are initialized from
  // metadata from the backend. These properties help place the label on the validation interface and
  // should not be changed.
  #auditProperties = {
    lat: undefined,
    lng: undefined,
    cameraLat: undefined,
    cameraLng: undefined,
    canvasX: undefined,
    canvasY: undefined,
    canvasWidth: undefined,
    canvasHeight: undefined,
    panoSource: undefined,
    panoId: undefined,
    labelTimestamp: undefined,
    heading: undefined,
    labelId: undefined,
    labelType: undefined,
    pitch: undefined,
    zoom: undefined,
    severity: undefined,
    description: undefined,
    streetEdgeId: undefined,
    regionId: undefined,
    tags: undefined,
    aiTags: undefined,
    aiTagsNotPresent: undefined,
    isMobile: undefined,
    aiGenerated: false,
    expired: false,
    backupImage: null,
  };

  // These properties are set through validating labels. In this object, canvas properties and
  // heading/pitch/zoom are from the perspective of the user that is validating the labels.
  #properties = {
    canvasX: undefined,
    canvasY: undefined,
    endTimestamp: undefined,
    heading: undefined,
    pitch: undefined,
    startTimestamp: undefined,
    validationResult: undefined,
    oldLabelType: undefined,
    newLabelType: undefined,
    oldSeverity: undefined,
    newSeverity: undefined,
    oldTags: undefined,
    newTags: undefined,
    agreeComment: '',
    disagreeOption: undefined,
    disagreeReasonTextBox: '',
    unsureOption: undefined,
    unsureReasonTextBox: '',
    comment: undefined,
    zoom: undefined,
    isMobile: undefined,
  };

  #adminProperties = {
    username: null,
    previousValidations: null,
  };

  /**
   * @param {Record<string, any>} params - Label metadata from the backend.
   * @param {ValidateConfig} config - The tags each type offers, and the frame a validation is measured in.
   */
  constructor(params, config) {
    this.#config = config;
    this.#init(params);
  }

  /**
   * Initializes a label from metadata (if parameters are passed in).
   * @param {Record<string, any>} params - Label metadata from the backend.
   */
  #init(params) {
    if (params) {
      if ('lat' in params) this.setAuditProperty('lat', params.lat);
      if ('lng' in params) this.setAuditProperty('lng', params.lng);
      if ('camera_lat' in params) this.setAuditProperty('cameraLat', params.camera_lat);
      if ('camera_lng' in params) this.setAuditProperty('cameraLng', params.camera_lng);
      if ('canvas_x' in params) this.setAuditProperty('canvasX', params.canvas_x);
      if ('canvas_y' in params) this.setAuditProperty('canvasY', params.canvas_y);
      if ('canvas_width' in params) this.setAuditProperty('canvasWidth', params.canvas_width);
      if ('canvas_height' in params) this.setAuditProperty('canvasHeight', params.canvas_height);
      if ('pano_source' in params) this.setAuditProperty('panoSource', params.pano_source);
      if ('pano_id' in params) this.setAuditProperty('panoId', params.pano_id);
      if ('label_timestamp' in params) this.setAuditProperty('labelTimestamp', new Date(params.label_timestamp));
      if ('heading' in params) this.setAuditProperty('heading', params.heading);
      if ('label_id' in params) this.setAuditProperty('labelId', params.label_id);
      if ('label_type' in params) {
        this.setAuditProperty('labelType', params.label_type);
        this.setProperty('oldLabelType', params.label_type);
        this.setProperty('newLabelType', params.label_type);
      }
      if ('pitch' in params) this.setAuditProperty('pitch', params.pitch);
      if ('zoom' in params) this.setAuditProperty('zoom', params.zoom);
      if ('severity' in params) {
        this.setAuditProperty('severity', params.severity);
        this.setProperty('oldSeverity', params.severity);
        this.setProperty('newSeverity', params.severity);
      }
      if ('description' in params) this.setAuditProperty('description', params.description);
      if ('street_edge_id' in params) this.setAuditProperty('streetEdgeId', params.street_edge_id);
      if ('max_speed' in params) this.setAuditProperty('maxSpeed', params.max_speed);
      if ('region_id' in params) this.setAuditProperty('regionId', params.region_id);
      if ('tags' in params) {
        this.setAuditProperty('tags', params.tags);
        this.setProperty('oldTags', params.tags);
        this.setProperty('newTags', [...params.tags]); // Copy tags to newTags.
      }
      if ('ai_tags' in params) this.setAuditProperty('aiTags', params.ai_tags);
      if ('ai_tags_not_present' in params) this.setAuditProperty('aiTagsNotPresent', params.ai_tags_not_present);
      if ('ai_generated' in params) this.setAuditProperty('aiGenerated', params.ai_generated);
      // The nightly imagery sweep's verdict: true means the provider has dropped this pano, so the backup is the
      // imagery to show and asking the provider first is a wasted round trip (#5561).
      if ('expired' in params) this.setAuditProperty('expired', params.expired === true);
      this.setAuditProperty('backupImage', buildBackupImageData(params));
      // Properties only used on the Admin version of Validate.
      if ('admin_data' in params && params.admin_data !== null) {
        if ('username' in params.admin_data) this.#adminProperties.username = params.admin_data.username;
        if ('previous_validations' in params.admin_data) {
          this.#adminProperties.previousValidations = [];
          for (const prevVal of params.admin_data.previous_validations) {
            this.#adminProperties.previousValidations.push(prevVal);
          }
        }
      }
      this.setAuditProperty('isMobile', util.isMobile());
    }
  }

  /**
   * Gets the marker icon for this label's type — the same scalable SVG every other surface draws (#4726). It used to
   * be a per-type AdminTool_*.png, with a second, larger _Mobile.png set to compensate for the raster's fixed size;
   * an SVG is sized by PanoMarker.setSize() on both, so the mobile set is gone.
   * @returns {string} Path of the icon under /assets.
   */
  getIconUrl() {
    return util.misc.getIconImagePaths(this.getProperty('newLabelType')).iconImagePath;
  }

  /**
   * The label type's canvas colour, used for the dashed ring that marks the marker while the label is hidden.
   * @returns {string} A CSS colour.
   */
  getIconColor() {
    return util.misc.getLabelColors(this.getProperty('newLabelType'));
  }

  /**
   * Records the type an expert says this label should be and re-bases the editable severity and tags on it, by the
   * same rules the server applies: a rating survives only on the same scale, a tag only if the new type offers it.
   * @param {string} labelType - The type to change to; the label's own type restores the original rating and tags.
   */
  setNewLabelType(labelType) {
    const oldType = this.getProperty('oldLabelType');
    this.setProperty('newLabelType', labelType);
    if (labelType === oldType) {
      this.setProperty('newSeverity', this.getProperty('oldSeverity'));
      this.setProperty('newTags', [...(this.getProperty('oldTags') ?? [])]);
      return;
    }
    const sameScale = util.misc.labelTypeHasSeverity(labelType)
      && util.misc.getRatingScale(labelType) === util.misc.getRatingScale(oldType);
    this.setProperty('newSeverity', sameScale ? this.getProperty('oldSeverity') : null);
    const offered = new Set((this.#config.tagsByLabelType[labelType] ?? []).map((t) => t.tag_name));
    this.setProperty('newTags', (this.getProperty('oldTags') ?? []).filter((t) => offered.has(t)));
  }

  /**
   * Returns a specific originalProperty of this label.
   * @param {string} key - Name of property.
   * @returns {*} Value associated with this key.
   */
  getAuditProperty(key) {
    return key in this.#auditProperties ? this.#auditProperties[key] : null;
  }

  /**
   * Returns a specific adminProperty of this label.
   * @param {string} key - Name of property.
   * @returns {*|null} Value associated with this key.
   */
  getAdminProperty(key) {
    return key in this.#adminProperties ? this.#adminProperties[key] : null;
  }

  /**
   * Calculate heading/pitch for drawing this Label on the pano from the POV of the user when placing the label.
   *
   * The stored canvas_x/canvas_y are projected through the frame they were placed in (#5085), which the label carries
   * as canvas_width/canvas_height; the boxed 720x480 frame is the fallback for a payload that predates the columns.
   *
   * @param {string} [fallbackViewerType] - The page's viewer type, for a payload that doesn't name the label's own.
   * @returns {{heading: number, pitch: number, zoom: number}}
   */
  getOriginalPov(fallbackViewerType) {
    const origPov = {
      heading: this.getAuditProperty('heading'),
      pitch: this.getAuditProperty('pitch'),
      zoom: this.getAuditProperty('zoom'),
    };
    const frameWidth = this.getAuditProperty('canvasWidth') ?? util.EXPLORE_CANVAS_WIDTH;
    const frameHeight = this.getAuditProperty('canvasHeight') ?? util.EXPLORE_CANVAS_HEIGHT;
    // The imagery the click was made on decides the fov it was projected with (#5083): the label's own source,
    // with the page's viewer as the fallback for a payload that predates the field.
    const viewerType = this.getAuditProperty('panoSource') ?? fallbackViewerType;
    return util.pano.canvasCoordToCenteredPov(origPov, this.getAuditProperty('canvasX'),
      this.getAuditProperty('canvasY'), frameWidth, frameHeight,
      util.pano.renderedHFov(origPov.zoom, frameWidth / frameHeight, viewerType));
  }

  /**
   * Returns the entire properties object for this label.
   * @returns {object} Object for properties.
   */
  getProperties() {
    return this.#properties;
  }

  /**
   * Gets a specific validation property of this label.
   * @param {string} key - Name of property.
   * @returns {*} Value associated with this key.
   */
  getProperty(key) {
    return key in this.#properties ? this.#properties[key] : null;
  }

  /**
   * Sets the value of a single property in properties.
   * @param {string} key - Name of property.
   * @param {*} value - Value to set property to.
   */
  setProperty(key, value) {
    this.#properties[key] = value;
    return this;
  }

  setAuditProperty(key, value) {
    this.#auditProperties[key] = value;
    return this;
  }

  /**
   * The validator's comment on this label, in the shape the server stores it, or null when there is none.
   * @param {number} missionId - The mission the validation belongs to.
   * @returns {?Record<string, any>}
   */
  commentData(missionId) {
    const comment = this.getProperty('comment');
    if (!comment) return null;
    return {
      comment,
      label_id: this.getAuditProperty('labelId'),
      pano_id: this.getAuditProperty('panoId'),
      heading: this.getProperty('heading'),
      lat: this.getAuditProperty('lat'),
      lng: this.getAuditProperty('lng'),
      pitch: this.getProperty('pitch'),
      mission_id: missionId,
      zoom: this.getProperty('zoom'),
    };
  }

  /**
   * Records a verdict on this label along with where the validator was looking when they cast it. Counting it toward
   * the mission and queuing it for submission is LabelContainer's (validateCurrentLabel).
   *
   * @param {string} validationResult - Must be one of the following: {Agree, Disagree, Unsure}.
   * @param {string} comment - An optional comment submitted with the validation.
   * @param {PanoViewer} panoViewer - The viewer showing the label, whose POV is where the validator is looking.
   */
  validate(validationResult, comment, panoViewer) {
    // This is the POV if the label were in the center of the viewport.
    const centeredPov = this.getOriginalPov(panoViewer.getViewerType());

    // This is the POV of the viewport center - this is where the user is looking.
    const userPov = panoViewer.getPov();

    // Calculates the center xy coordinates of the Label on the current viewport, whose aspect is whatever the screen
    // gave it (a phone in landscape is inside GSV's clamp at zoom 3, #5083).
    const canvasWidth = this.#config.canvasWidth();
    const canvasHeight = this.#config.canvasHeight();
    const pixelCoordinates = util.pano.centeredPovToCanvasCoord(
      centeredPov, userPov, canvasWidth, canvasHeight, this.#config.labelRadius * util.uiScale(),
      util.pano.renderedHFov(userPov.zoom, canvasWidth / canvasHeight, panoViewer.getViewerType()));

    this.setProperty('endTimestamp', new Date());
    this.setProperty('canvasX', pixelCoordinates ? Math.round(pixelCoordinates.x) : null);
    this.setProperty('canvasY', pixelCoordinates ? Math.round(pixelCoordinates.y) : null);
    this.setProperty('heading', userPov.heading);
    this.setProperty('pitch', userPov.pitch);
    this.setProperty('zoom', userPov.zoom);
    this.setProperty('isMobile', util.isMobile());
    this.setProperty('comment', comment);
    if (['Agree', 'Disagree', 'Unsure'].includes(validationResult)) {
      this.setProperty('validationResult', validationResult);
    }
  }
}
