describe("ModalExample module", function () {
    var modalExample;
    var modalModel;
    var uiModalExample;
    var $modalExampleFixture;

    beforeEach(function () {
        $modalExampleFixture = prepareFixture();

        uiModalExample = {};
        uiModalExample.background = $modalExampleFixture.find(".modal-background");
        uiModalExample.close = $modalExampleFixture.find(".modal-example-close-buttons");
        uiModalExample.curbRamp = $modalExampleFixture.find("#modal-curb-ramp-example");
        uiModalExample.noCurbRamp = $modalExampleFixture.find("#modal-no-curb-ramp-example");
        uiModalExample.obstacle = $modalExampleFixture.find("#modal-obstacle-example");
        uiModalExample.surfaceProblem = $modalExampleFixture.find("#modal-surface-problem-example");

        modalModel = _.clone(Backbone.Events);
        modalModel.showModalExample = function (labelType) {
            this.trigger("ModalExample:show", labelType);
        };

        modalExample = new ModalExample(modalModel, uiModalExample);
    });

    describe("In response to the `ModalExample:show` event", function () {
        beforeEach(function () {
            spyOn(modalExample, 'show');
        });

        it("should call a `show` method", function () {
            modalModel.showModalExample("CurbRamp");
            expect(modalExample.show).toHaveBeenCalledWith("CurbRamp");
        });
    });


    function prepareFixture () {
        return $('<div id="modal-curb-ramp-example" class="hidden"> \
            <div class="modal-background"></div> \
            <div class="modal-foreground" id="modal-curb-ramp-foreground"> \
            <div class="row"> \
            <div class="col-md-12"> \
            <p class="text-center bold">Curb Ramp</p> \
        </div> \
        <div class="modal-close-button-holder"> \
            <button type="button" class="close modal-example-close-buttons" aria-label="Close"><span aria-hidden="true">&times;</span></button> \
        </div> \
        </div> \
        <div class="row"> \
            <div class="col-md-6"> \
            <img src="" class="img-responsive" alt="Two good curb ramps" /> \
            <p class="bold">Quality 1: Good</p> \
        <p>Clean curb ramps that are aligned with crosswalks.</p> \
        </div> \
        <div class="col-md-6"> \
            <img src="" class="img-responsive" alt="Water has accumulated in the curb ramp" /> \
            <p class="bold">Rating 4: Very hard to pass</p> \
        <p>Water has accumulated in this curb ramp due to poor drainage. It is hard for manual wheelchair users to use this curb ramp.</p> \
        </div> \
        </div> \
        </div> \
        </div> \
        <div id="modal-no-curb-ramp-example" class="hidden"> \
            <div class="modal-background"></div> \
            <div class="modal-foreground" id="modal-no-curb-ramp-foreground"> \
            <div class="row"> \
            <div class="col-md-12"> \
            <p class="text-center bold">No Curb Ramp</p> \
        </div> \
        <div class="modal-close-button-holder"> \
            <button type="button" class="close modal-example-close-buttons" aria-label="Close"><span aria-hidden="true">&times;</span></button> \
        </div> \
        </div> \
        <div class="row"> \
            <div class="col-md-6"> \
            <img src="" class="img-responsive" alt="Curb ramp is not aligned to the crosswalk" /> \
            <p class="bold">Severity 2-3: Hard to pass</p> \
        <p>There is no curb ramp at the end of the crosswalk. Wheelchair users are forced to used the curb ramp that is not aligned with the crosswalk.</p> \
        </div> \
        <div class="col-md-6"> \
            <img src="" class="img-responsive" alt="No curb ramp at the end of the crosswalk" /> \
            <p class="bold">Severity 5: Not passable</p> \
        <p>No curb ramp at the end of the crosswalk. Wheelchair users cannot get on or off the sidewalk and cross the street here.</p> \
        </div> \
        </div> \
        </div> \
        </div> \
        <div id="modal-obstacle-example" class="hidden"> \
            <div class="modal-background"></div> \
            <div class="modal-foreground" id="modal-obstacle-foreground"> \
            <div class="row"> \
            <div class="col-md-12"> \
            <p class="text-center bold">Obstacle</p> \
            </div> \
            <div class="modal-close-button-holder"> \
            <button type="button" class="close modal-example-close-buttons" aria-label="Close"><span aria-hidden="true">&times;</span></button> \
        </div> \
        </div> \
        <div class="row"> \
            <div class="col-md-6"> \
            <img src="" class="img-responsive" alt="Overgrown bush is partly blocking the path." /> \
            <p class="bold">Severity 2-3: Hard to pass</p> \
        <p>The plant is obstructing the path, making it hard for wheelchair users to use this sidewalk.</p> \
        </div> \
        <div class="col-md-6"> \
            <img src="" class="img-responsive" alt="A tree is completely blocking the path." /> \
            <p class="bold">Severity 5: Not passable</p> \
        <p>The tree is completely blocking the path, making it not passable for wheelchair users.</p> \
        </div> \
        </div> \
        </div> \
        </div> \
        <div id="modal-surface-problem-example" class="hidden"> \
            <div class="modal-background"></div> \
            <div class="modal-foreground" id="modal-surface-problem-foreground"> \
            <div class="row"> \
            <div class="col-md-12"> \
            <p class="text-center bold">Surface Problem</p> \
        </div> \
        <div class="modal-close-button-holder"> \
            <button type="button" class="close modal-example-close-buttons" aria-label="Close"><span aria-hidden="true">&times;</span></button> \
        </div> \
        </div> \
        <div class="row"> \
            <div class="col-md-6"> \
            <img src="" class="img-responsive" alt="Cobblestone sidewalks and crosswalks." /> \
            <p class="bold">Severity 2-4: Hard to pass</p> \
        <p>Wheelchair users have difficulty traveling on cobblestone sidewalks and crosswalks.</p> \
        </div> \
        <div class="col-md-6"> \
            <img src="" class="img-responsive" alt="A tree is completely blocking the path." /> \
            <p class="bold">Severity 5: Not passable</p> \
        <p>Wheelchair users cannot pass severely degraded sidewalk surfaces (<i>e.g.,</i> due to vegetation).</p> \
        </div> \
        </div> \
        </div> \
        </div>')
    }
});