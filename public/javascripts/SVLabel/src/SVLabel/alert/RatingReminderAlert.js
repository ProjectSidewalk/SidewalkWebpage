function RatingReminderAlert(alertHandler) {
    var self = {
        'ratingCount': {}
    };
    var MINIMUM_NO_RATING_BEFORE_ALERT = 4; //consecutive

    function ratingClicked(severity) {
        if (severity == null) {
            if (self['ratingCount'] > 0) {
                self['ratingCount']++;
            } else {
                self['ratingCount'] = 1;
            }
        }//check if user picked a severity
        else {
            self['ratingCount'] = 0;
        }//reset counter if user labels once
        if (self['ratingCount'] >= MINIMUM_NO_RATING_BEFORE_ALERT
            && (svl.onboarding == null || !svl.onboarding.isOnboarding())) {

            alertHandler.showAlert(i18next.t('popup.severity-shortcuts'), 'reminderMessage', true);
            self['ratingCount'] = 0;

        }//not in tutorial screen

        //Remember to rate the passableness for each area you label!
    }

    self.ratingClicked = ratingClicked;
    return self;
}