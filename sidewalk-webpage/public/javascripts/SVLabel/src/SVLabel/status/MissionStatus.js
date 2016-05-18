function MissionStatus () {
    var self = { className: "MissionStatus" };

    // These are messages that are shown under the "Current Mission" in the status pane. The object's keys correspond to
    // the "label"s of missions (e.g., "initial-mission"). Substitute __PLACEHOLDER__ depending on each mission.
    var missionMessages = {
        "initial-mission": "Walk for 1000ft and find all the sidewalk accessibility attributes",
        "distance-mission": "Walk for __PLACEHOLDER__ and find all the sidewalk accessibility attributes",
        "area-coverage-mission": "Make the __PLACEHOLDER__ of this neighborhood more accessible"
    };
    
    return self;
}
