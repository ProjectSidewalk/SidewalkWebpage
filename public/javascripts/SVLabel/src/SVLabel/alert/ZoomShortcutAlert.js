function ZoomShortcutAlert(alertHandler) {
    var self = {
        'zoomCount': {}
    };
    var MINIMUM_ZOOM_CLICKS_BEFORE_ALERT = 5;

    function zoomClicked() {
      if (self['zoomCount'] > 0) {
          self['zoomCount']++;
      } else {
          self['zoomCount'] = 1;
      }

        if (self['zoomCount'] >= MINIMUM_ZOOM_CLICKS_BEFORE_ALERT &&
            (svl.onboarding == null || svl.onboarding.isOnboarding() == false)) {
                alertHandler.showAlert(i18next.t('popup.zoom-shortcuts'), 'zoomMessage', true);
                self['zoomCount'] = 0;
        }
    }

    self.zoomClicked = zoomClicked;
    return self;
}
