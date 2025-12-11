/**
 * Creates the reusable AI indicator icon with tooltip text for Admin popups.
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
    container: 'body',
    trigger: 'hover'
};
const aiHoverSelectors = '.ai-icon-marker, .admin-ai-icon-marker, .label-view-ai-icon';

/**
 * Ensures the given AI icon has a tooltip instance with the shared options.
 * @param {HTMLElement} icon
 * @returns {JQuery} tooltip-enabled icon
 */
function ensureAiTooltip(icon) {
    if (icon.dataset && icon.dataset.disableTooltip === 'true') return $(icon);

    const $icon = $(icon);
    // Backfill title in case this element was rendered without one.
    if (!$icon.attr('title') && !$icon.attr('data-original-title')) {
        $icon.attr('title', i18next.t('common:ai-generated-label-tooltip'));
    }

    const tooltipInstance = $icon.data('bs.tooltip');
    if (!tooltipInstance) {
        return $icon.tooltip(aiTooltipOptions).tooltip('hide');
    }

    // If the tooltip was initialized elsewhere without the shared options, re-init it.
    const hasBodyContainer = tooltipInstance.options && tooltipInstance.options.container === 'body';
    const hasAiTemplate = tooltipInstance.options && tooltipInstance.options.template === aiTooltipTemplate;
    if (!hasBodyContainer || !hasAiTemplate) {
        $icon.tooltip('destroy');
        return $icon.tooltip(aiTooltipOptions).tooltip('hide');
    }
    return $icon;
}

function AiLabelIndicator(extraClasses = [], tooltipPlacement = 'top', enableTooltip = true) {
    const icon = document.createElement('img');
    icon.src = 'assets/images/icons/ai-icon-small.png';
    icon.alt = 'AI indicator';
    icon.classList.add('ai-icon-marker');
    extraClasses.forEach(cls => icon.classList.add(cls));

    const tooltipText = i18next.t('common:ai-generated-label-tooltip');

    if (enableTooltip) {
        icon.setAttribute('data-toggle', 'tooltip');
        icon.setAttribute('data-placement', tooltipPlacement);
        icon.setAttribute('title', tooltipText);

        ensureAiTooltip(icon);

        icon.addEventListener('mouseenter', () => ensureAiTooltip(icon).tooltip('show'));
        icon.addEventListener('mouseleave', () => ensureAiTooltip(icon).tooltip('hide'));
    } else {
        icon.dataset.disableTooltip = 'true';
    }

    return icon;
}

function initializeExistingAiTooltips() {
    document.querySelectorAll(aiHoverSelectors).forEach(el => ensureAiTooltip(el));
}

// Delegate hover handling for dynamically inserted indicators (e.g., inside Google overlays).
$(document).on('mouseenter', aiHoverSelectors, function () {
    ensureAiTooltip(this).tooltip('show');
});
$(document).on('mouseleave', aiHoverSelectors, function () {
    ensureAiTooltip(this).tooltip('hide');
});

// Initialize any AI icons already in the DOM on load (covers server-rendered cases).
$(initializeExistingAiTooltips);
