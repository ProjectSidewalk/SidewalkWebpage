function Toolbar ($) {
    var self = {};

    function _init() {
        svl.ui.bottomToolbar.onboardingLink.on("click", _handleOnboardingLinkClick);    
    }
    
    function _handleOnboardingLinkClick (e) {
        svl.onboarding = Onboarding($);
    }

    _init();
    return self;
}