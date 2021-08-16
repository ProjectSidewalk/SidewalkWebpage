function OnboardingModel () {
}

OnboardingModel.prototype.triggerStartOnboarding = function (parameters) {
    this.trigger("Onboarding:startOnboarding");
};

_.extend(OnboardingModel.prototype, Backbone.Events);
