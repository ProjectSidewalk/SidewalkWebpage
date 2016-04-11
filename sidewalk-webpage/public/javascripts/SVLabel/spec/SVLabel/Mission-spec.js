// describe("Tests for the Mission module.", function () {
//     describe("The Mission constructor", function(){
//         it("should XXX", function() {
//             // Todo
//         });
//     });
//
// });

describe("Test for the MissionContainer module.", function () {
    // Jasmine-ajax. http://jasmine.github.io/2.0/ajax.html
    var svl = svl || {};
    svl.missionContainer = new MissionContainer($);
    svl.missionFactory = MissionFactory();

    beforeEach(function () {
        svl.missionContainer.refresh();
    });

    describe("add method", function(){
        it("should be able to add a new mission to the container", function() {
            var m1 = svl.missionFactory.create(1, 1, "test1", 1, null, null, false);
            var m2 = svl.missionFactory.create(1, 2, "test1", 2, null, null, false);
            svl.missionContainer.add(1, m1);
            svl.missionContainer.add(1, m2);
            var missions = svl.missionContainer.getMissionsByRegionId(1);
            expect(missions.length).toBe(2);
        });

        it("should check duplicate", function () {
            var m1 = svl.missionFactory.create(1, 1, "test1", 1, null, null, false);
            var m2 = svl.missionFactory.create(1, 1, "test1", 1, null, null, false);
            svl.missionContainer.add(1, m1);
            svl.missionContainer.add(1, m2);
            var missions = svl.missionContainer.getMissionsByRegionId(1);
            expect(missions.length).toBe(1);
        });
    });
});