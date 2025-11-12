function OnboardingModel () {
}

OnboardingModel.prototype.triggerStartOnboarding = function() {
    this.trigger("Onboarding:startOnboarding");
};

_.extend(OnboardingModel.prototype, Backbone.Events);
