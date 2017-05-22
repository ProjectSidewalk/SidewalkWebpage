function RatingReminderAlert(alertHandler) {
    var self = {
        'ratingCount': {}
    };
    var MINIMUM_NO_RATING_BEFORE_ALERT = 4;

    function ratingClicked(severity) {
        if (severity == null){
            if (self['ratingCount'] > 0){
                self['ratingCount']++;
            }else{
                self['ratingCount']=1;
            }
        }//check if user picked a severity
        if (self['ratingCount'] >= MINIMUM_NO_RATING_BEFORE_ALERT
            && (svl.onboarding == null || svl.onboarding.isOnboarding() == false)){

            alertHandler.showAlert('Please remember to rate the area severity by clicking or pressing keyboard numbers (1,2,3,4,5)!', 'reminderMessage', true);
            self['ratingCount']=0;

        }//not in tutorial screen

        //Remember to rate the passableness for each area you label!
    }

    self.ratingClicked = ratingClicked;
    return self;
}