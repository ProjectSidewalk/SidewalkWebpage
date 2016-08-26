describe("HandAnimation module", function () {
    var handAnimation;
    var uiOnboarding;
    var $uiOnboardingFixture;

    beforeEach (function () {
        $uiOnboardingFixture = prepareFixture();
        uiOnboarding = {};
        uiOnboarding.holder = $uiOnboardingFixture;
        uiOnboarding.messageHolder = $uiOnboardingFixture.find("#onboarding-message-holder");
        uiOnboarding.background = $uiOnboardingFixture.find("#onboarding-background");
        uiOnboarding.foreground = $uiOnboardingFixture.find("#onboarding-foreground");
        uiOnboarding.canvas = $uiOnboardingFixture.find("#onboarding-canvas");
        uiOnboarding.handGestureHolder = $uiOnboardingFixture.find("#hand-gesture-holder");

        handAnimation = new HandAnimation("/", uiOnboarding);
    });

    describe("`initializeHandAnimation` method", function () {
        it("should not duplicate `.kineticjs-content`", function () {
            handAnimation.initializeHandAnimation();
            handAnimation.initializeHandAnimation();

            expect($uiOnboardingFixture.find(".kineticjs-content").length).toBe(1);
        });
    });

    function prepareFixture() {
        return $('  <div id="onboarding-holder" class="Window_StreetView"> \
                        <canvas id="onboarding-canvas"  class="Window_StreetView" width="720px" height="480px" style="cursor: default, move;"></canvas> \
                        <div id="hand-gesture-holder"></div> \
                        <div id="onboarding-background"></div> \
                        <div id="onboarding-message-holder" class="white-background"> \
                            <p></p> \
                        </div> \
                        <div style="display:none;"> \
                            <img src="" id="double-click-icon" width="200" alt="Double click icon"/> \
                        </div> \
                    </div>');

    }
});