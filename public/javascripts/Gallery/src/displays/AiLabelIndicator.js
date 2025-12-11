/**
 * Creates a reusable AI label indicator element with a tooltip.
 *
 * @param {Array<String>} extraClasses Additional CSS classes to apply.
 * @param {String} tooltipPlacement Placement direction for the tooltip.
 * @returns {HTMLElement} Configured AI indicator element.
 */
const aiTooltipTemplate = [
    '<div class="tooltip ai-tooltip" role="tooltip">',
    '<div class="tooltip-arrow"></div>',
    '<div class="tooltip-inner"></div>',
    '</div>'
].join('');

function AiLabelIndicator(extraClasses = [], tooltipPlacement = 'top') {
    const icon = document.createElement('img');
    icon.src = 'assets/images/icons/ai-icon-small.png';
    icon.alt = 'AI indicator';
    icon.classList.add('ai-icon');
    extraClasses.forEach(cls => icon.classList.add(cls));

    const tooltipText = i18next.t('common:ai-generated-label-tooltip');
    icon.setAttribute('data-toggle', 'tooltip');
    icon.setAttribute('data-placement', tooltipPlacement);
    icon.setAttribute('title', tooltipText);

    $(icon)
        .tooltip({
            template: aiTooltipTemplate,
            container: 'body'
        })
        .tooltip('hide');

    icon.addEventListener('mouseenter', () => $(icon).tooltip('show'));
    icon.addEventListener('mouseleave', () => $(icon).tooltip('hide'));
    
    return icon;
}

// Delegate hover handling for dynamically inserted indicators (covers cards + expanded view).
$(document).on('mouseenter', '.ai-icon, .ai-icon-marker, .ai-icon-marker-card, .ai-icon-marker-expanded', function () {
    $(this).tooltip('show');
});
$(document).on('mouseleave', '.ai-icon, .ai-icon-marker, .ai-icon-marker-card, .ai-icon-marker-expanded', function () {
    $(this).tooltip('hide');
});
