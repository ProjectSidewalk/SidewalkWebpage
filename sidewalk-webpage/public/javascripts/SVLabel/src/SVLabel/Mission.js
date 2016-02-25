function Mission() {
    var self = { className: "Mission" };
    var missions = {
        "initial-mission": {
            id: "initial-mission",
            label: "InitialMission",
            levels: null
        },
        "area-coverage": {
            id: "area-coverage",
            label: "AreaCoverage",
            levels: [5, 10, 25, 50, 100]
        }
    };
    var tasks = [];

    /** Get a mission */
    function getMission (id) { return id in missions ? missions[id] : null; }

    /** Get an array of mission ids */
    function getMissionIds () { return Object.keys(missions); }

    self.getMission = getMission;
    self.getMissionIds = getMissionIds;
    return self;
}