/**
 * Tests for Validate's Label (frontend/js/validate/label/Label.js): how it reads the label metadata the backend
 * sends (LabelFormats.validationLabelMetadataToJson), including Expert Validate's admin data, and how an expert's
 * type change re-bases a label that was filed with no tags. The other suites build labels from a few fields only,
 * so this is where the full payload is read (#5840).
 */

import { loadModules, useUtil } from './loader.js';

/** The page facts a label reads: the tags each type offers, and the frame a validation is measured in. */
const CONFIG = {
  tagsByLabelType: { Obstacle: [{ tag_name: 'pole' }], SurfaceProblem: [{ tag_name: 'cracks' }] },
  canvasWidth: () => 720,
  canvasHeight: () => 480,
  labelRadius: 10,
};

/**
 * One label as validationLabelMetadataToJson writes it, every field present.
 * @param {Record<string, any>} [overrides] - Fields to replace.
 * @returns {Record<string, any>} The payload.
 */
function payload(overrides = {}) {
  return {
    label_id: 42, label_type: 'Obstacle', pano_id: 'pano-1', image_capture_date: '2024-05',
    label_timestamp: '2026-03-01T12:00:00Z', lat: 47.61, lng: -122.33, camera_lat: 47.6101, camera_lng: -122.3301,
    heading: 90, pitch: -5, zoom: 1, canvas_x: 300, canvas_y: 200, canvas_width: 720, canvas_height: 480,
    severity: 2, description: 'pole in the way', street_edge_id: 7, street_side: 'left', max_speed: '25 mph',
    region_id: 3, correct: null, agree_count: 0, disagree_count: 0, unsure_count: 0, user_validation: null,
    ai_validation: null, tags: ['pole'], ai_tags: ['pole'], ai_tags_not_present: ['narrow'], ai_generated: true,
    expired: false, comments: [], from_current_user: false, backup_image_url: null, pano_source: 'gsv',
    pano_data: null, gold_reason: null, gold_crop_url: null, admin_data: null,
    ...overrides,
  };
}

describe('Validate Label', () => {
  let Label;

  beforeEach(async () => {
    useUtil({ isMobile: () => false });
    ({ Label } = await loadModules('frontend/js/validate/label/Label.js'));
  });

  test('a label from the backend carries every field the tool reads off it', () => {
    const label = new Label(payload(), CONFIG);

    expect(label.getAuditProperty('cameraLat')).toBe(47.6101);
    expect(label.getAuditProperty('cameraLng')).toBe(-122.3301);
    expect(label.getAuditProperty('canvasWidth')).toBe(720);
    expect(label.getAuditProperty('canvasHeight')).toBe(480);
    expect(label.getAuditProperty('labelTimestamp')).toEqual(new Date('2026-03-01T12:00:00Z'));
    expect(label.getAuditProperty('description')).toBe('pole in the way');
    expect(label.getAuditProperty('streetEdgeId')).toBe(7);
    expect(label.getAuditProperty('maxSpeed')).toBe('25 mph');
    expect(label.getAuditProperty('regionId')).toBe(3);
    expect(label.getAuditProperty('aiTags')).toEqual(['pole']);
    expect(label.getAuditProperty('aiTagsNotPresent')).toEqual(['narrow']);
    expect(label.getAuditProperty('aiGenerated')).toBe(true);
    expect(label.getAuditProperty('isMobile')).toBe(false);
  });

  test('the editable tags are a copy, so an edit never changes what the labeler filed', () => {
    const label = new Label(payload(), CONFIG);

    label.getProperty('newTags').push('added');

    expect(label.getProperty('oldTags')).toEqual(['pole']);
    expect(label.getAuditProperty('tags')).toEqual(['pole']);
  });

  test('on Expert Validate the label names its labeler and the verdicts already cast on it', () => {
    const previous = [{ username: 'ann', validation: 'Agree' }, { username: 'bo', validation: 'Disagree' }];
    const label = new Label(payload({ admin_data: { username: 'labeler1', previous_validations: previous } }), CONFIG);

    expect(label.getAdminProperty('username')).toBe('labeler1');
    expect(label.getAdminProperty('previousValidations')).toEqual(previous);
  });

  test('on regular Validate, where the backend sends no admin data, the admin fields stay empty', () => {
    const label = new Label(payload(), CONFIG);

    expect(label.getAdminProperty('username')).toBeNull();
    expect(label.getAdminProperty('previousValidations')).toBeNull();
  });

  test('a verdict records where the validator was looking, and the verdict itself', () => {
    const label = new Label(payload(), CONFIG);
    const viewer = { getViewerType: () => 'gsv', getPov: () => ({ heading: 95, pitch: -3, zoom: 2 }) };

    label.validate('Unsure', 'hard to tell', viewer);

    expect(label.getProperties()).toMatchObject({
      validationResult: 'Unsure', comment: 'hard to tell', heading: 95, pitch: -3, zoom: 2, isMobile: false,
    });
    expect(label.getProperty('endTimestamp')).toBeInstanceOf(Date);
  });

  describe('a label sent without a tags field', () => {
    test('changing its type leaves it with no tags rather than failing', () => {
      const noTags = payload();
      delete noTags.tags;
      const label = new Label(noTags, CONFIG);

      label.setNewLabelType('SurfaceProblem');
      expect(label.getProperty('newTags')).toEqual([]);

      label.setNewLabelType('Obstacle');
      expect(label.getProperty('newTags')).toEqual([]);
    });
  });
});
