function KeyboardShortcutAlert(alertHandler) {
    var self = {
        'clickCount': {}
    };
    var MINIMUM_CLICKS_BEFORE_ALERT = 10;

    function modeSwitchButtonClicked(labelType) {
        if(labelType === 'Walk')
            return;

        if (labelType in self['clickCount'])
            self['clickCount'][labelType]++;
        else
            self['clickCount'][labelType] = 1;

        if (self['clickCount'][labelType] >= MINIMUM_CLICKS_BEFORE_ALERT &&
            (svl.onboarding == null || svl.onboarding.isOnboarding() === false)) {
            var labelDescription = util.misc.getLabelDescriptions(labelType);
            if ('keyChar' in labelDescription) {
                var shortcut = labelDescription['keyChar'];
                var translationKey = `popup.label-shortcuts-${ util.camelToKebab(labelType) }`;
                alertHandler.showAlert(i18next.t(translationKey, { key: shortcut }), labelType, true);
                self['clickCount'][labelType] = 0;
            }
        }
    }

    self.modeSwitchButtonClicked = modeSwitchButtonClicked;
    return self;
}
