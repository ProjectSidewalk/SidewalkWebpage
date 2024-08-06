/**
 * Displays the speed limit of the current position's nearest road.
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
        // Filter to only be roads/"highways" just in case.
        const roads = data.elements.filter(el => el.type === "way" && el.tags && el.tags.highway);

        let closestRoad = null;
        let minDistance = Infinity;

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
        // Earth's radius in KM.
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
        const { lat, lng } = coords()
        const overpassResp = await fetch(`https://overpass-api.de/api/interpreter?data=%5Bout%3Ajson%5D%3B%0A%28%0A%20%20way%5B%22highway%22%5D%28around%3A20.0%2C%20${lat}%2C%20${lng}%29%3B%0A%29%3B%0Aout%20geom%3B`)
        const overpassRespJson = await overpassResp.json()
        const closestRoad = findClosestRoad(overpassRespJson, lat, lng);
        if (closestRoad.tags["maxspeed"]) {
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
