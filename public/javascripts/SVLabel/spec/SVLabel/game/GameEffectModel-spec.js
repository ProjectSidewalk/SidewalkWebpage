describe("GameEffectModel module.", function () {
    var model;

    beforeEach(function () {
        model = new GameEffectModel();
    });

    describe("`play` method", function() {
        beforeEach(function () {
            spyOn(model, 'trigger');
            model.play({audioType: "yay"});
        });

        it("to have been called", function() {
            expect(model.trigger).toHaveBeenCalledWith("play", {audioType: "yay"})
        });
    });
});
