/**
 * An indicator that displays the speed limit of the current position's nearest road.
 *
 * @param {StreetViewPanorama} panorama Panorama object
 * @param {function} coords Function that returns current longitude and latitude coordinates
 * @returns {SpeedLimit} SpeedLimit object with updateSpeedLimit function, container, speedLimit object with number and sub (units, e.g. 'mph'),
 * speedLimitVisible boolean
 */
function SpeedLimit(panorama, coords) {
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

        let closestRoad = null;
        let minDistance = Infinity;

        // Go through all the roads and find the closest one, keeping line segments in mind.
        // Typical point comparison won't always work so it's better to compare to the segment itself.
        for (const road of roads) {
            for (let i = 0; i < road.geometry.length - 1; i++) {
                const point1 = road.geometry[i];
                const point2 = road.geometry[i + 1];

                const closestPoint = closestPointOnSegment(
                    lat, lon,
                    point1.lat, point1.lon,
                    point2.lat, point2.lon
                );

                const distance = calculateDistance(lat, lon, closestPoint.lat, closestPoint.lon);

                if (distance < minDistance) {
                    minDistance = distance;
                    closestRoad = road;
                }
            }
        }

        return closestRoad;
    }

    function closestPointOnSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;

        if (dx === 0 && dy === 0) {
            return { lat: x1, lon: y1 };
        }

        const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);

        if (t < 0) {
            return { lat: x1, lon: y1 };
        }
        if (t > 1) {
            return { lat: x2, lon: y2 };
        }

        return {
            lat: x1 + t * dx,
            lon: y1 + t * dy
        };
    }

    function calculateDistance(lat1, lon1, lat2, lon2) {
        // Earth's radius in kilometers.
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    async function positionChange() {
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
                self.container.setAttribute("data-design-style", "us")
            } else {
                self.container.setAttribute("data-design-style", "world")
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
