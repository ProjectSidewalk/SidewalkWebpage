describe("ModalExample module", function () {
    var modalExample;
    var modalModel;
    var uiModalExample;
    var $modalExampleFixture;

    beforeEach(function () {
        $modalExampleFixture = $('<div id="overlay-message-holder" class="Window_StreetView"></div>');


        modalExample = new ModalExample(modalModel, uiModalExample);
    });
});