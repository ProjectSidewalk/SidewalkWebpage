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

            alertHandler.showAlert('Please provide severity ratings for each label by pressing keys <kbd>'+1+'</kbd> through <kbd>'+5+'</kbd>.', 'reminderMessage', true);
            self['ratingCount']=0;

        }//not in tutorial screen

        //Remember to rate the passableness for each area you label!
    }

    self.ratingClicked = ratingClicked;
    return self;
}