function RatingReminderAlert(alertHandler) {
    var self = {
        'ratingCount': {}
    };
    var MINIMUM_NO_RATING_BEFORE_ALERT = 2;

    function ratingClicked(severity) {
        if (severity == null){
            if (self['ratingCount'] > 0){
                self['ratingCount']++;
            }else{
                self['ratingCount']=1;
            }
        }//check if user picked a severity
        if (self['ratingCount'] > MINIMUM_NO_RATING_BEFORE_ALERT
            && (svl.onboarding == null || svl.onboarding.isOnboarding() == false)){
            alertHandler.showAlert('Remember to rate the passableness for each area you label!', 'reminderMessage', true);
            self['ratingCount']=0;
        }//not in tutorial screen

        //Remember to rate the passableness for each area you label!
    }

    self.ratingClicked = ratingClicked;
    return self;
}