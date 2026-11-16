/**
 * Tests for aiLabelIndicator (frontend/js/common/aiLabelIndicator.js), the AI badge Gallery cards, the label detail
 * pano and Validate's markers wear on an AI-placed label, with the "AI can make mistakes" tooltip wherever the
 * surroundings don't already say so (#5359, #5840).
 */

import { loadModules, mockModule } from './loader.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

const { aiLabelIndicator } = await loadModules('frontend/js/common/aiLabelIndicator.js');

describe('aiLabelIndicator', () => {
  test('is the AI icon with the host\'s classes and the mistakes tooltip', () => {
    const icon = aiLabelIndicator(['ai-icon', 'ai-icon-marker-card']);

    expect(icon.tagName).toBe('IMG');
    expect(icon.getAttribute('src')).toContain('images/icons/ai-icon-black-filled-white-circle');
    expect([...icon.classList]).toEqual(['ai-icon-marker', 'ai-icon', 'ai-icon-marker-card']);
    expect(icon.getAttribute('data-ps-tooltip')).toBe('common:ai-generated-label-tooltip');
  });

  test('leaves the tooltip off where the page already explains it (Validate\'s marker)', () => {
    expect(aiLabelIndicator(['ai-icon-marker-validate'], { tooltip: false }).hasAttribute('data-ps-tooltip'))
      .toBe(false);
  });
});
