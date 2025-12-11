/**
 * Creates the reusable AI indicator icon with tooltip text.
 *
 * @param {Array<String>} extraClasses Additional CSS classes to apply.
 * @param {String} tooltipPlacement Bootstrap tooltip placement.
 * @returns {HTMLElement} Configured AI indicator element.
 */
const aiTooltipTemplate = [
    '<div class="tooltip ai-tooltip" role="tooltip">',
    '<div class="tooltip-arrow"></div>',
    '<div class="tooltip-inner"></div>',
    '</div>'
].join('');
const aiTooltipOptions = {
    template: aiTooltipTemplate,
    container: 'body'
};

/**
 * Ensures the provided icon has a tooltip initialized with shared options.
 * @param {HTMLElement} icon
 * @returns {JQuery} tooltip-enabled icon
 */
function ensureAiTooltip(icon) {
    const $icon = $(icon);
    if (!$icon.attr('title') && !$icon.attr('data-original-title')) {
        $icon.attr('title', i18next.t('common:ai-generated-label-tooltip'));
    }

    const tooltipInstance = $icon.data('bs.tooltip');
    if (!tooltipInstance) {
        return $icon.tooltip(aiTooltipOptions).tooltip('hide');
    }

    const hasBodyContainer = tooltipInstance.options && tooltipInstance.options.container === 'body';
    const hasAiTemplate = tooltipInstance.options && tooltipInstance.options.template === aiTooltipTemplate;
    if (!hasBodyContainer || !hasAiTemplate) {
        $icon.tooltip('destroy');
        return $icon.tooltip(aiTooltipOptions).tooltip('hide');
    }
    return $icon;
}

function AiLabelIndicator(extraClasses = [], tooltipPlacement = 'top') {
    const icon = document.createElement('img');
    icon.src = 'assets/images/icons/ai-icon-small.png';
    icon.alt = 'AI indicator';
    icon.classList.add('ai-icon-marker');
    extraClasses.forEach(cls => icon.classList.add(cls));

    const tooltipText = i18next.t('common:ai-generated-label-tooltip');
    icon.setAttribute('data-toggle', 'tooltip');
    icon.setAttribute('data-placement', tooltipPlacement);
    icon.setAttribute('title', tooltipText);

    ensureAiTooltip(icon);

    icon.addEventListener('mouseenter', () => ensureAiTooltip(icon).tooltip('show'));
    icon.addEventListener('mouseleave', () => ensureAiTooltip(icon).tooltip('hide'));

    return icon;
}

// Delegate hover handling for dynamically inserted indicators (validate panoramas).
$(document).on('mouseenter', '.ai-icon-marker, .ai-icon-marker-validate', function () {
    ensureAiTooltip(this).tooltip('show');
});
$(document).on('mouseleave', '.ai-icon-marker, .ai-icon-marker-validate', function () {
    ensureAiTooltip(this).tooltip('hide');
});
