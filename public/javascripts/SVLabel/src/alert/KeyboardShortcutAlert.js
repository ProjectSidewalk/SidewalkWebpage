function KeyboardShortcutAlert(alertHandler) {
    var self = {
        'clickCount': {}
    };
    var MINIMUM_CLICKS_BEFORE_ALERT = 10;
    // Stuck is clicked far less often than the mode buttons, so nudge after fewer clicks.
    var MINIMUM_STUCK_CLICKS_BEFORE_ALERT = 5;

    function modeSwitchButtonClicked(labelType) {
        if(labelType === 'Walk')
            return;

        if (labelType in self['clickCount'])
            self['clickCount'][labelType]++;
        else
            self['clickCount'][labelType] = 1;

        if (self['clickCount'][labelType] >= MINIMUM_CLICKS_BEFORE_ALERT &&
            (svl.isOnboarding() === false)) {
            var labelDescription = util.misc.getLabelDescriptions(labelType);
            if ('keyChar' in labelDescription) {
                var shortcut = labelDescription['keyChar'];
                var translationKey = `popup.label-shortcuts-${ util.camelToKebab(labelType) }`;
                alertHandler.showAlert(i18next.t(translationKey, { key: shortcut }), labelType, true);
                self['clickCount'][labelType] = 0;
            }
        }
    }

    /**
     * Nudges the user toward the spacebar shortcut after they've clicked the Stuck button several times. The spacebar
     * first tries a routed linked-pano step and only falls back to the Stuck button's route-aware moveForward() when
     * no such link exists (see Keyboard._advanceForwardAlongRoute).
     */
    function stuckButtonClicked() {
        if ('Stuck' in self['clickCount'])
            self['clickCount']['Stuck']++;
        else
            self['clickCount']['Stuck'] = 1;

        if (self['clickCount']['Stuck'] >= MINIMUM_STUCK_CLICKS_BEFORE_ALERT && (svl.isOnboarding() === false)) {
            alertHandler.showAlert(i18next.t('popup.move-forward-shortcut'), 'MoveForwardShortcut', true);
            self['clickCount']['Stuck'] = 0;
        }
    }

    self.modeSwitchButtonClicked = modeSwitchButtonClicked;
    self.stuckButtonClicked = stuckButtonClicked;
    return self;
}
