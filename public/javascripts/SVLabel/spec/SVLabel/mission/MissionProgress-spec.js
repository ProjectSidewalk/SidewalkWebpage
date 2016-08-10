describe("MissionProgress module", function () {
    var missionProgress;
    var svl;
    var gameEffectModel;
    var missionModel;
    var modalModel;
    var neighborhoodModel;
    var missionContainer;
    var neighborhoodContainer;
    var taskContainer;

    beforeEach(function () {
        svl = {};
        gameEffectModel = _.clone(Backbone.Events);
        missionModel  = _.clone(Backbone.Events);
        modalModel = _.clone(Backbone.Events);
        neighborhoodModel = _.clone(Backbone.Events);
        missionContainer = {};
        neighborhoodContainer = {};
        taskContainer = {};

        missionProgress = new MissionProgress(svl, gameEffectModel, missionModel, modalModel, neighborhoodModel,
            missionContainer, neighborhoodContainer, taskContainer);
    });

    describe("`_checkMissionComplete` method", function () {
       it("should ")
    });

    describe("`_updateTheCurrentMission` method", function () {
        it("should fail gracefully when next mission is not avaialble");

    });

    describe("in response to events", function () {
        beforeEach(function () {

        });

        it("should take care of the case ")
    });
});
