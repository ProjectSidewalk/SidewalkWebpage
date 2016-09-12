function OnboardingModel () {

}

OnboardingModel.prototype.triggerStartOnboarding = function (parameters) {
    this.trigger("Onboarding:startOnboarding");
};

_.extend(ModalModel.prototype, Backbone.Events);
