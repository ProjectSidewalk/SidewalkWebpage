/**
 * Creates the reusable AI indicator icon with an optional "AI can make mistakes" tooltip.
 *
 * Validate's marker badge is a .ai-icon-marker too, but never shows the tooltip: main.css gives it
 * pointer-events: none, since there the label card carries the disclaimer (#5359).
 *
 * @param {Array<string>} extraClasses - Additional CSS classes to apply.
 * @param {object} [options]
 * @param {boolean} [options.tooltip] - Attach the tooltip; off where the surroundings already say it (#5359).
 * @returns {HTMLElement} Configured AI indicator element.
 */
function aiLabelIndicator(extraClasses = [], { tooltip = true } = {}) {
  const icon = document.createElement('img');
  icon.src = util.assetPath('images/icons/ai-icon-black-filled-white-circle.png');
  icon.alt = 'AI indicator';
  icon.classList.add('ai-icon-marker');
  extraClasses.forEach((cls) => icon.classList.add(cls));
  if (tooltip) icon.setAttribute('data-ps-tooltip', i18next.t('common:ai-generated-label-tooltip'));
  return icon;
}
