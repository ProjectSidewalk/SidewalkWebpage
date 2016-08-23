describe("OverlayMessageBox module", function () {
    var overlayMessageBox;
    var modalModel;
    var uiOverlayMessageBox;
    var $overlayMessageBoxFixture;

    beforeEach(function () {
        $overlayMessageBoxFixture = $('<div id="overlay-message-holder" class="Window_StreetView"></div>');
        $overlayMessageBoxFixture.append("<span id='overlay-message-box'>" +
                                            "<span id='overlay-message'>Walk</span>" +
                                            "<span id='overlay-message-help-link' class='underline bold'></span>" +
                                            "</span>");
        uiOverlayMessageBox = {};
        uiOverlayMessageBox.holder = $overlayMessageBoxFixture;
        uiOverlayMessageBox.box = $overlayMessageBoxFixture.find("#overlay-message-box");
        uiOverlayMessageBox.message = $overlayMessageBoxFixture.find("#overlay-message");

        modalModel = _.clone(Backbone.Events);
        modalModel.showModalExample = function (labelType) {
            this.trigger("ModalExmaple:show");
        };

        overlayMessageBox = new OverlayMessageBox(modalModel, uiOverlayMessageBox);
    });

    describe("`setHelpLink` method", function () {
        var $helpLink;

        beforeEach(function () {
            $helpLink = $overlayMessageBoxFixture.find("#overlay-message-help-link");
        });

        it("should add a link to `span#overlay-message-help-link`", function () {
            overlayMessageBox.setHelpLink("CurbRamp");
            expect($helpLink.html()).toBe('<span val="CurbRamp">Explain this!</span>');

            overlayMessageBox.setHelpLink("Test");
            expect($helpLink.html()).toBe('');
        });

        it("should remove a link when an invalid label type is passed", function () {
            overlayMessageBox.setHelpLink("CurbRamp");
            overlayMessageBox.setHelpLink("Test");
            expect($helpLink.html()).toBe('');
        });
    });

    describe("clicking the help link", function () {
        var $helpLink;

        beforeEach(function () {
            $helpLink = $overlayMessageBoxFixture.find("#overlay-message-help-link");
            spyOn(modalModel, 'showModalExample');
        });

        it("should call `ModalExample.showModalExample` method", function () {
            overlayMessageBox.setHelpLink("CurbRamp");
            $helpLink.trigger("click");
            expect(modalModel.showModalExample).toHaveBeenCalledWith("CurbRamp");
        });

        it("should not call `ModalExample.showModalExample` method with invalid label type", function () {
            overlayMessageBox.setHelpLink("");
            $helpLink.trigger("click");
            expect(modalModel.showModalExample).not.toHaveBeenCalled();

            overlayMessageBox.setHelpLink("Test");
            $helpLink.trigger("click");
            expect(modalModel.showModalExample).not.toHaveBeenCalled();

        });
    });
});