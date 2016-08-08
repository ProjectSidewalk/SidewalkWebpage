describe("MissionFactory module.", function () {
    var missionModel;
    var missionFactory;
    beforeEach(function () {
        missionModel = _.clone(Backbone.Events);
        missionModel.addAMission = function (mission) { };
        missionFactory = new MissionFactory(missionModel);
    });

    describe("in response to events", function () {
        beforeEach(function () {
            var missionParameters = {
                regionId: 1,
                missionId: 1,
                label: "test",
                level: 1,
                distance: 10,
                distanceFt: 10,
                distanceMi: 10,
                coverage: 0.1,
                isCompleted: false
            };

            spyOn(missionFactory, 'create');
            missionModel.trigger("MissionFactory:create", missionParameters);
        });

        it("`MisionFactory:create` event should trigger the `create` method", function () {
            expect(missionFactory.create).toHaveBeenCalled();
        });
    });
});
