describe("PopUpMessage module", function () {
    var popUpMessage;
    var uiPopUpMessage;
    var $popUpMessageFixture;

    var form;
    var storage;
    var taskContainer;
    var tracker;
    var user;
    var onboardingModel;


    beforeEach(function () {
        onboardingModel = _.clone(Backbone.Events);
        $popUpMessageFixture = preparePopUpMessageFixture();
        uiPopUpMessage = {};
        uiPopUpMessage.holder = $popUpMessageFixture;
        uiPopUpMessage.foreground = $popUpMessageFixture.find("#pop-up-message-foreground");
        uiPopUpMessage.background = $popUpMessageFixture.find("#pop-up-message-background");
        uiPopUpMessage.title = $popUpMessageFixture.find("#pop-up-message-title");
        uiPopUpMessage.content = $popUpMessageFixture.find("#pop-up-message-content");
        uiPopUpMessage.buttonHolder = $popUpMessageFixture.find("#pop-up-message-button-holder");

        form = new FormMock();
        storage = new StorageMock();
        taskContainer = new TaskContainerMock();
        tracker = new TrackerMock();
        user = new UserMock();

        popUpMessage = new PopUpMessage(form, storage, taskContainer, tracker, user,
            onboardingModel, uiPopUpMessage);
    });

    describe("In response to the `Onboarding:startOnboarding` event", function () {
        it("should call the `hide` method", function () {
            spyOn(popUpMessage, 'hide');
            onboardingModel.trigger("Onboarding:startOnboarding");
            expect(popUpMessage.hide).toHaveBeenCalled();
        });
    });

    function preparePopUpMessageFixture() {
        return $('<div id="pop-up-message-holder" class="hidden"> \
                    <div id="pop-up-message-background"></div> \
                    <div id="pop-up-message-foreground"> \
                        <h2 id="pop-up-message-title" class="bold">Title</h2> \
                        <p id="pop-up-message-content">Content</p> \
                        <div id="pop-up-message-button-holder"></div> \
                    </div> \
                  </div>')
    }

    function FormMock () {}
    function StorageMock () {}
    function TaskContainerMock () {}
    function TrackerMock () {}
    function UserMock () {}

});