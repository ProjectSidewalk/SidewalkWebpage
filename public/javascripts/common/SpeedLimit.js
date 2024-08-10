/**
 * An indicator that displays the speed limit of the current position's nearest road.
 *
 * @param {StreetViewPanorama} panorama Panorama object
 * @param {function} coords Function that returns current longitude and latitude coordinates
 * @param {function} isOnboarding Function that returns a boolean on whether the current mission is the tutorial/onboarding task
 * @returns {SpeedLimit} SpeedLimit object with updateSpeedLimit function, container, speedLimit object with number and sub (units, e.g. 'mph'),
 * speedLimitVisible boolean
 */
function SpeedLimit(panorama, coords, isOnboarding) {
    let self = this;

    function _init() {
        self.container = document.getElementById("speed-limit-sign");
        self.speedLimit = {
            number: "",
            sub: ""
        };
        self.speedLimitVisible = false
        updateSpeedLimit();

        // Listen for position changes.
        panorama.addListener('position_changed', positionChange);
    }

    function updateSpeedLimit() {
        self.container.querySelector("#speed-limit").innerText = self.speedLimit.number;
        self.container.querySelector("#speed-limit-sub").innerText = self.speedLimit.sub;
        self.container.style.display = self.speedLimitVisible ? "flex" : "none";
    }

    function findClosestRoad(data, lat, lon) {
        // Filter to only be roads, and not foot paths/walk ways.
        const roadHighwayTypes = [
            "motorway",
            "trunk",
            "primary",
            "secondary",
            "tertiary",
            "unclassified",
            "residential",
            "motorway_link",
            "trunk_link",
            "primary_link",
            "secondary_link",
            "tertiary_link",
            "living_street",
            "road"
        ]
        const roads = data.elements.filter(el => el.type === "way" && el.tags && el.tags.highway && roadHighwayTypes.includes(el.tags.highway));

        const point = turf.point([lat, lon])
        let closestRoad = null;
        let minDistance = Infinity;

        // Go through all the roads and find the closest one, keeping line segments in mind.
        // Typical point comparison won't always work so it's better to compare to the segment itself.
        for (const road of roads) {
            const lineString = turf.lineString(road.geometry.map(p => [p.lon, p.lat]));
            const distance = turf.pointToLineDistance(point, lineString);

            if (distance < minDistance) {
                minDistance = distance;
                closestRoad = road;
            }
        }

        return closestRoad;
    }

    async function positionChange() {
        // If user is in the onboarding/tutorial mission, we can skip getting the speed limit and hide the sign altogether
        if (isOnboarding()) {
            self.speedLimitVisible = false
            updateSpeedLimit()
            return
        }

        // Get the current position.
        const { lat, lng } = coords()

        // Get nearby roads and their respective information from the overpass API.
        const overpassQuery = `
        [out:json];
        (
        way["highway"](around:10.0, ${lat}, ${lng});
        );
        out geom;
        is_in(${lat}, ${lng})->.a;
        rel(pivot.a)["ISO3166-1"];
        convert country
            ::id = id(),
            code = t["ISO3166-1"];
        out tags;
        `
        const overpassResp = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`)
        const overpassRespJson = await overpassResp.json()

        // Get the country code of the current location, and set the speed limit indicator design based on that.
        const countryElements = overpassRespJson.elements.filter((el) => el.type === "country")
        if (countryElements.length > 0) {
            const countryCode = countryElements[0].tags.code
            if (countryCode === "US" || countryCode === "CA") {
                self.container.setAttribute("data-design-style", "us-canada")
            } else {
                self.container.setAttribute("data-design-style", "non-us-canada")
            }
        }

        // Out of the nearby roads, find the closest one.
        const closestRoad = findClosestRoad(overpassRespJson, lat, lng);

        if (closestRoad !== null && closestRoad.tags["maxspeed"]) {
            const splitMaxspeed = closestRoad.tags["maxspeed"].split(" ")
            const number = splitMaxspeed.shift()
            const sub = splitMaxspeed.join(" ")
            self.speedLimit = {
                number,
                sub
            };
            self.speedLimitVisible = true
        } else {
            self.speedLimitVisible = false
        }
        updateSpeedLimit()
    }

    _init();

    self.updateSpeedLimit = updateSpeedLimit;

    return self;
}
