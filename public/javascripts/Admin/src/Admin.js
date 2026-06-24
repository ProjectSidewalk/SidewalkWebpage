// ============================================================
// Section 1: Module-level helper functions
// ============================================================

/**
 * Returns true if the given role name is considered a researcher-level role.
 *
 * @param {string} roleName - The role name to check.
 * @returns {boolean} True if the role is Researcher, Administrator, or Owner.
 */
function isResearcherRole(roleName) {
    return ['Researcher', 'Administrator', 'Owner'].indexOf(roleName) > 0;
}

/**
 * Computes summary statistics (mean, median, std, min, max) for a numeric property across an array of objects.
 *
 * @param {Array<Object>} data - Array of data objects.
 * @param {string} col - The property name to compute stats for.
 * @param {Object} [options] - Optional configuration.
 * @param {boolean} [options.excludeResearchers=false] - If true, exclude rows whose role is a researcher role.
 * @returns {{mean: number, median: number, std: number, min: number, max: number}} Summary statistics.
 */
function getSummaryStats(data, col, options) {
    options = options || {};
    const excludeResearchers = options.excludeResearchers || false;

    let sum = 0;
    const filteredData = [];
    for (let j = 0; j < data.length; j++) {
        if (!excludeResearchers || !isResearcherRole(data[j].role)) {
            sum += data[j][col];
            filteredData.push(data[j]);
        }
    }

    const mean = sum / filteredData.length;
    const i = filteredData.length / 2;
    filteredData.sort((a, b) => (a[col] > b[col]) ? 1 : ((b[col] > a[col]) ? -1 : 0));

    let median = 0;
    let min = 0;
    let max = 0;

    if (filteredData.length > 0) {
        median = (filteredData.length / 2) % 1 === 0
            ? (filteredData[i - 1][col] + filteredData[i][col]) / 2
            : filteredData[Math.floor(i)][col];
        min = filteredData[0][col];
        max = filteredData[filteredData.length - 1][col];
    }

    let std = 0;
    for (let k = 0; k < filteredData.length; k++) {
        std += Math.pow(filteredData[k][col] - mean, 2);
    }
    std /= filteredData.length;
    std = Math.sqrt(std);

    return { mean, median, std, min, max };
}

/**
 * Builds a Vega-Lite v5 layered histogram spec (bar + rule lines for mean and median).
 *
 * @param {Array<Object>} data - Array of data objects.
 * @param {number} mean - The mean value for the summary stat rule line.
 * @param {number} median - The median value for the summary stat rule line.
 * @param {Object} [options] - Optional configuration.
 * @param {string} [options.xAxisTitle] - X-axis label.
 * @param {string} [options.yAxisTitle] - Y-axis label.
 * @param {number} [options.height=300] - Chart height in pixels.
 * @param {number} [options.width=600] - Chart width in pixels.
 * @param {string} [options.col="count"] - Field name to bin on the x-axis.
 * @param {Array<number>} [options.xDomain] - [min, max] for the x-axis scale.
 * @param {number} [options.binStep=1] - Bin step size.
 * @param {number} [options.legendOffset=0] - Legend offset.
 * @param {boolean} [options.excludeResearchers=false] - If true, filter out researcher roles.
 * @returns {Object} A Vega-Lite v5 spec object.
 */
function getVegaLiteHistogram(data, mean, median, options) {
    options = options || {};
    const xAxisTitle = options.xAxisTitle || "TODO, fill in x-axis title";
    const yAxisTitle = options.yAxisTitle || "Counts";
    const height = options.height || 300;
    const width = options.width || 600;
    const col = options.col || "count";
    const xDomain = options.xDomain || [0, data[data.length - 1][col]];
    const binStep = options.binStep || 1;
    const legendOffset = options.legendOffset || 0;
    const excludeResearchers = options.excludeResearchers || false;

    const nonResearcherRoles = ['Registered', 'Anonymous', 'Turker'];
    const transformList = excludeResearchers
        ? [{ "filter": { "field": "role", "oneOf": nonResearcherRoles } }]
        : [];

    return {
        "height": height,
        "width": width,
        "data": { "values": data },
        "transform": transformList,
        "layer": [
            {
                "mark": { "type": "bar", "tooltip": true },
                "encoding": {
                    "x": {
                        "field": col,
                        "type": "quantitative",
                        "axis": { "title": xAxisTitle, "labelAngle": 0, "tickCount": 8 },
                        "bin": { "step": binStep }
                    },
                    "y": {
                        "aggregate": "count",
                        "field": "*",
                        "type": "quantitative",
                        "axis": { "title": yAxisTitle }
                    }
                }
            },
            {
                // Rule lines marking summary statistics (mean and median).
                "data": {
                    "values": [
                        { "stat": "mean", "value": mean },
                        { "stat": "median", "value": median }
                    ]
                },
                "mark": "rule",
                "encoding": {
                    "x": {
                        "field": "value",
                        "type": "quantitative",
                        "axis": { "labels": false, "ticks": false, "title": "", "grid": false },
                        "scale": { "domain": xDomain }
                    },
                    "color": {
                        "field": "stat",
                        "type": "nominal",
                        "scale": { "range": ["pink", "orange"] },
                        "legend": {
                            "title": "Summary Stats",
                            "values": ["mean: " + mean.toFixed(2), "median: " + median.toFixed(2)],
                            "offset": legendOffset
                        }
                    },
                    "size": { "value": 2 }
                }
            }
        ],
        "resolve": { "x": { "scale": "independent" } },
        "config": { "axis": { "titleFontSize": 16 } }
    };
}

/**
 * Formats a distance in miles (or km if metric) with the appropriate unit abbreviation.
 *
 * @param {number} distance - Distance in miles.
 * @returns {string} Formatted distance string with unit.
 */
function formatDistance(distance) {
    const distanceMetricAbbrev = i18next.t('common:unit-distance-abbreviation');
    let distanceInCorrectUnits = distance;
    if (i18next.t('common:measurement-system') === "metric") {
        distanceInCorrectUnits = util.math.milesToKms(distance);
    }
    return `${distanceInCorrectUnits.toFixed(1)} ${distanceMetricAbbrev}`;
}

/**
 * Formats a percentage value as a rounded integer string with a "%" suffix.
 * Returns '-' if the value is NaN.
 *
 * @param {number} percent - The percentage value (0-100).
 * @returns {string} Formatted percent string or '-'.
 */
function formatPercent(percent) {
    return isNaN(percent) ? '-' : `${Math.round(percent)}%`;
}

/**
 * Calculates the percentage of a value relative to a total.
 *
 * @param {number} value - The partial value.
 * @param {number} total - The total value.
 * @returns {number} The percentage (0-100).
 */
function calculatePercent(value, total) {
    return (value / total) * 100;
}

/**
 * Formats a count with its percentage of a total in parentheses.
 *
 * @param {number} count - The count to format.
 * @param {number} total - The total used to compute the percentage.
 * @returns {string} Formatted string like "42 (35%)".
 */
function formatCountWithPercent(count, total) {
    const percent = calculatePercent(count, total);
    return `${count} (${formatPercent(percent)})`;
}

/**
 * Formats a distance with its percentage of a total in parentheses.
 *
 * @param {number} distance - The distance in miles (or km if metric).
 * @param {number} total - The total distance used to compute the percentage.
 * @returns {string} Formatted string like "3.2 mi (18%)".
 */
function formatDistanceWithPercent(distance, total) {
    const percent = calculatePercent(distance, total);
    return `${formatDistance(distance)} (${formatPercent(percent)})`;
}


// ============================================================
// Section 2: Admin action functions
// ============================================================

/**
 * Clears the Play framework cache via the admin API and updates the UI on success.
 */
function clearPlayCache() {
    $.ajax({
        url: '/adminapi/clearPlayCache',
        method: 'PUT',
        success: function() {
            clearPlayCacheSuccess.innerHTML = i18next.t("admin-clear-play-cache");
        }
    });
}

/**
 * Handles a role-change dropdown click: reads the userId from the sibling button's id, sends a PUT
 * to /adminapi/setRole, and updates the button label on success.
 *
 * @param {Event} e - The click event from the role dropdown anchor.
 */
function changeRole(e) {
    const userId = $(e.target).parent() // <li>
        .parent()                        // <ul>
        .siblings('button')
        .attr('id')
        .substring("userRoleDropdown".length); // userId is stored in id of dropdown
    const newRole = e.target.innerText;
    const data = {
        'user_id': userId,
        'role_id': newRole
    };
    $.ajax({
        async: true,
        contentType: 'application/json; charset=utf-8',
        url: '/adminapi/setRole',
        method: 'PUT',
        data: JSON.stringify(data),
        dataType: 'json',
        success: function(result) {
            const button = $(`#userRoleDropdown${result.user_id}`);
            const buttonContents = button.html();
            button.html(buttonContents.replace(/Registered|Turker|Researcher|Administrator|Anonymous/g, result.role));
        },
        error: function(result) {
            console.error(result);
        }
    });
}

/**
 * Handles a team-change dropdown click: reads the userId from the sibling button's id and teamId from
 * the anchor's data attribute, sends a PUT to /userapi/setUserTeam, and updates the button label on success.
 *
 * @param {Event} e - The click event from the team dropdown anchor.
 */
function changeTeam(e) {
    const userId = $(e.target).parent() // <li>
        .parent()                        // <ul>
        .siblings('button')
        .attr('id')
        .substring("userTeamDropdown".length); // userId is stored in id of dropdown
    const teamId = parseInt(e.target.getAttribute('data-team-id'));
    const teamName = e.target.innerText;

    $.ajax({
        async: true,
        url: `/userapi/setUserTeam?userId=${userId}&teamId=${teamId}`,
        method: 'PUT',
        success: function(result) {
            const button = document.getElementById(`userTeamDropdown${result.user_id}`);
            button.childNodes[0].nodeValue = ` ${teamName} `;
        },
        error: function(result) {
            console.error(result);
        }
    });
}

/**
 * Handles a team-status dropdown click: reads the teamId from the sibling button's id, sends a PUT
 * to /adminapi/updateTeamStatus/:teamId, and updates the button label on success.
 *
 * @param {Event} e - The click event from the status dropdown anchor.
 */
function changeTeamStatus(e) {
    const teamId = $(e.target).parent() // <li>
        .parent()                        // <ul>
        .siblings('button')
        .attr('id')
        .substring("statusDropdown".length); // teamId is stored in id of dropdown
    const newStatus = e.target.innerText === 'Open';
    const data = { 'open': newStatus };

    $.ajax({
        async: true,
        contentType: 'application/json; charset=utf-8',
        url: `/adminapi/updateTeamStatus/${teamId}`,
        method: 'PUT',
        data: JSON.stringify(data),
        dataType: 'json',
        success: function(result) {
            const button = document.getElementById(`statusDropdown${result.team_id}`);
            button.childNodes[0].nodeValue = ` ${newStatus ? 'Open' : 'Closed'} `;
        },
        error: function(xhr, status, error) {
            console.error('Error updating team status:', error);
        }
    });
}

/**
 * Handles a team-visibility dropdown click: reads the teamId from the sibling button's id, sends a PUT
 * to /adminapi/updateTeamVisibility/:teamId, and updates the button label on success.
 *
 * @param {Event} e - The click event from the visibility dropdown anchor.
 */
function changeTeamVisibility(e) {
    const teamId = $(e.target).parent() // <li>
        .parent()                        // <ul>
        .siblings('button')
        .attr('id')
        .substring("visibilityDropdown".length); // teamId is stored in id of dropdown
    const newVisibility = e.target.innerText === 'Visible';
    const data = { 'visible': newVisibility };

    $.ajax({
        async: true,
        contentType: 'application/json; charset=utf-8',
        url: `/adminapi/updateTeamVisibility/${teamId}`,
        method: 'PUT',
        data: JSON.stringify(data),
        dataType: 'json',
        success: function(result) {
            const button = document.getElementById(`visibilityDropdown${result.team_id}`);
            button.childNodes[0].nodeValue = ` ${newVisibility ? 'Visible' : 'Hidden'} `;
        },
        error: function(xhr, status, error) {
            console.error('Error updating team visibility:', error);
        }
    });
}


// ============================================================
// Section 3: Data loading functions
// ============================================================

/**
 * Fetches coverage data from /adminapi/getCoverageData and populates all street count and distance
 * cells in the Overview street edge tables.
 *
 * IDs populated:
 *   #street-count-audited-all, #street-count-audited-high-quality, #street-count-total
 *   #street-count-audited-{registered|anonymous|turker|researcher}-{all|high-quality}
 *   #explored-street-count-{all-time|today|week}
 *   #street-distance-audited-all, #street-distance-audited-high-quality, #street-distance-total
 *   #street-distance-{registered|anonymous|turker|researcher}-{all|high-quality}
 *   #audited-distance-{all-time|today|week}
 *
 * @returns {Promise<void>}
 */
function loadStreetEdgeData() {
    return new Promise((resolve, reject) => {
        $.getJSON("/adminapi/getCoverageData", function(data) {
            const totalAuditedStreets = data.street_counts.total;
            const totalAuditedDistance = data.street_distance.total;

            // Audited street counts (all users).
            $("#street-count-audited-all").text(formatCountWithPercent(data.street_counts.audited.any_quality.all_users, totalAuditedStreets));
            $("#street-count-audited-high-quality").text(formatCountWithPercent(data.street_counts.audited.high_quality.all_users, totalAuditedStreets));
            $("#street-count-total").text(totalAuditedStreets);

            // Audited street counts by role.
            $("#street-count-audited-registered-all").text(formatCountWithPercent(data.street_counts.audited.any_quality.registered, totalAuditedStreets));
            $("#street-count-audited-registered-high-quality").text(formatCountWithPercent(data.street_counts.audited.high_quality.registered, totalAuditedStreets));
            $("#street-count-audited-anonymous-all").text(formatCountWithPercent(data.street_counts.audited.any_quality.anonymous, totalAuditedStreets));
            $("#street-count-audited-anonymous-high-quality").text(formatCountWithPercent(data.street_counts.audited.high_quality.anonymous, totalAuditedStreets));
            $("#street-count-audited-turker-all").text(formatCountWithPercent(data.street_counts.audited.any_quality.turker, totalAuditedStreets));
            $("#street-count-audited-turker-high-quality").text(formatCountWithPercent(data.street_counts.audited.high_quality.turker, totalAuditedStreets));
            $("#street-count-audited-researcher-all").text(formatCountWithPercent(data.street_counts.audited.any_quality.researcher, totalAuditedStreets));
            $("#street-count-audited-researcher-high-quality").text(formatCountWithPercent(data.street_counts.audited.high_quality.researcher, totalAuditedStreets));

            // Explored street counts for the Overview activities table.
            $("#explored-street-count-all-time").text(data.street_counts.audited.with_overlap.all_time);
            $("#explored-street-count-today").text(data.street_counts.audited.with_overlap.today);
            $("#explored-street-count-week").text(data.street_counts.audited.with_overlap.week);

            // Audited street distances (all users).
            $("#street-distance-audited-all").text(formatDistanceWithPercent(data.street_distance.audited.any_quality.all_users, totalAuditedDistance));
            $("#street-distance-audited-high-quality").text(formatDistanceWithPercent(data.street_distance.audited.high_quality.all_users, totalAuditedDistance));
            $("#street-distance-total").text(formatDistance(totalAuditedDistance));

            // Audited street distances by role.
            $("#street-distance-registered-all").text(formatDistanceWithPercent(data.street_distance.audited.any_quality.registered, totalAuditedDistance));
            $("#street-distance-registered-high-quality").text(formatDistanceWithPercent(data.street_distance.audited.high_quality.registered, totalAuditedDistance));
            $("#street-distance-anonymous-all").text(formatDistanceWithPercent(data.street_distance.audited.any_quality.anonymous, totalAuditedDistance));
            $("#street-distance-anonymous-high-quality").text(formatDistanceWithPercent(data.street_distance.audited.high_quality.anonymous, totalAuditedDistance));
            $("#street-distance-turker-all").text(formatDistanceWithPercent(data.street_distance.audited.any_quality.turker, totalAuditedDistance));
            $("#street-distance-turker-high-quality").text(formatDistanceWithPercent(data.street_distance.audited.high_quality.turker, totalAuditedDistance));
            $("#street-distance-researcher-all").text(formatDistanceWithPercent(data.street_distance.audited.any_quality.researcher, totalAuditedDistance));
            $("#street-distance-researcher-high-quality").text(formatDistanceWithPercent(data.street_distance.audited.high_quality.researcher, totalAuditedDistance));

            // Audited distance fields in the Overview activities table.
            $("#audited-distance-all-time").text(formatDistance(data.street_distance.audited.with_overlap.all_time));
            $("#audited-distance-today").text(formatDistance(data.street_distance.audited.with_overlap.today));
            $("#audited-distance-week").text(formatDistance(data.street_distance.audited.with_overlap.week));

            resolve();
        }).fail(error => {
            console.error("Failed to load street edge data", error);
            reject(error);
        });
    });
}

/**
 * Fetches user contribution counts from /adminapi/getNumUsersContributed and populates cells with
 * IDs following the pattern: user-count-{tool}-{role}-{timeInterval}-{taskConstraint}-{quality}.
 *
 * @returns {Promise<void>}
 */
function loadUserCountData() {
    return new Promise((resolve, reject) => {
        $.getJSON("/adminapi/getNumUsersContributed", function(data) {
            for (const userCount of data) {
                const taskCompleted = userCount.task_completed_only ? 'task_completed' : 'no_task_constraint';
                const highQuality = userCount.high_quality_only ? 'high_quality' : 'any_quality';
                $(`#user-count-${userCount.tool_used}-${userCount.role}-${userCount.time_interval}-${taskCompleted}-${highQuality}`)
                    .text(userCount.count);
            }
            resolve();
        }).fail(error => {
            console.error("Failed to load user count data", error);
            reject(error);
        });
    });
}

/**
 * Fetches contribution time stats from /adminapi/getContributionTimeStats and populates cells
 * with IDs following the pattern: time-{stat}-{timeInterval}.
 *
 * @returns {Promise<void>}
 */
function loadContributionTimeData() {
    return new Promise((resolve, reject) => {
        $.getJSON("/adminapi/getContributionTimeStats", function(data) {
            for (const timeStat of data) {
                const time = timeStat.time ? timeStat.time.toFixed(2) : 'NA';
                const unit = timeStat.time ? (timeStat.stat === 'explore_per_100m' ? ' min' : ' hr') : '';
                $(`#time-${timeStat.stat}-${timeStat.time_interval}`).text(time + unit);
            }
            resolve();
        }).fail(error => {
            console.error("Failed to load contribution time data", error);
            reject(error);
        });
    });
}

/**
 * Fetches label count stats from /adminapi/getLabelCountStats and populates cells with IDs
 * following the pattern: label-count-{labelType}-{timeInterval}.
 *
 * @returns {Promise<void>}
 */
function loadLabelCountData() {
    return new Promise((resolve, reject) => {
        $.getJSON("/adminapi/getLabelCountStats", function(data) {
            for (const labelCount of data) {
                $(`#label-count-${labelCount.label_type}-${labelCount.time_interval}`).text(labelCount.count);
            }
            resolve();
        }).fail(error => {
            console.error("Failed to load label count data", error);
            reject(error);
        });
    });
}

/**
 * Fetches validation count stats from /adminapi/getValidationCountStats and populates two sets of UI elements:
 *   - Overview activities table: #val-count-{result}-{timeInterval} for result in [All, Agree, Disagree, Unsure]
 *   - Analytics validations-by-type table: #val-count-{labelType}-{result}-{validator}
 *
 * jQuery silently ignores missing IDs, so this function safely fills both pages even if only one is present.
 *
 * @returns {Promise<void>}
 */
function loadValidationCountData() {
    return new Promise((resolve, reject) => {
        $.getJSON("/adminapi/getValidationCountStats", function(data) {
            // Overview tab: fill validation summary by time interval.
            for (const timeInterval of ['all_time', 'today', 'week']) {
                const currData = data.filter(
                    x => x.label_type === 'All' && x.validator === 'Both' && x.time_interval === timeInterval
                );
                const totalCount = currData.find(x => x.result === 'All').count;
                $(`#val-count-All-${timeInterval}`).text(totalCount);
                for (const valResult of ['Agree', 'Disagree', 'Unsure']) {
                    const resultCount = currData.find(x => x.result === valResult).count;
                    $(`#val-count-${valResult}-${timeInterval}`).text(formatCountWithPercent(resultCount, totalCount));
                }
            }

            // Analytics tab: fill validations per label type by validator.
            for (const labelType of ['All'].concat(util.misc.PRIMARY_LABEL_TYPES)) {
                for (const validator of ['Human', 'AI', 'Both']) {
                    const currData = data.filter(
                        x => x.time_interval === 'all_time' && x.validator === validator && x.label_type === labelType
                    );
                    const totalCount = currData.find(x => x.result === 'All').count;
                    $(`#val-count-${labelType}-All-${validator}`).text(totalCount);
                    for (const valResult of ['Agree', 'Disagree', 'Unsure']) {
                        const resultCount = currData.find(x => x.result === valResult).count;
                        const percentage = calculatePercent(resultCount, totalCount);
                        $(`#val-count-${labelType}-${valResult}-${validator}`).text(formatPercent(percentage));
                    }
                }
            }

            resolve();
        }).fail(error => {
            console.error("Failed to load validation count data", error);
            reject(error);
        });
    });
}

/**
 * Fetches recent comments from /adminapi/getRecentComments and adds rows to the #comments-table DataTable.
 *
 * @returns {Promise<void>}
 */
function loadComments() {
    return new Promise((resolve, reject) => {
        $.getJSON("/adminapi/getRecentComments", function(data) {
            const commentsTable = $('#comments-table').DataTable();
            commentsTable.rows.add(data.map(c => [
                `<a href='/admin/user/${c.username}'>${c.username}</a>`,
                // Timestamp span used for sorting; sort config defined in admin/index.scala.html.
                `<span class="timestamp" data-timestamp="${c.timestamp}">${new Date(c.timestamp)}</span>`,
                `<a class="show-comment-location" href="#" data-heading="${c.heading}" data-pitch="${c.pitch}" data-zoom="${c.zoom}" data-label-id="${c.label_id}">${c.pano_id}</a>`,
                c.comment_type,
                c.comment,
                c.label_id
            ])).order([1, 'desc']).draw();
            resolve();
        }).fail(error => {
            console.error("Failed to load comments", error);
            reject(error);
        });
    });
}

/**
 * Fetches recent label metadata from /adminapi/getRecentLabelMetadata and adds rows to the #label-table DataTable.
 *
 * @returns {Promise<void>}
 */
function loadLabels() {
    return new Promise((resolve, reject) => {
        $.getJSON("/adminapi/getRecentLabelMetadata", function(data) {
            const labelTable = $('#label-table').DataTable();
            labelTable.rows.add(data.map(l => [
                `<a href='/admin/user/${l.username}'>${l.username}</a>`,
                // Timestamp span used for sorting; sort config defined in admin/index.scala.html.
                `<span class="timestamp" data-timestamp="${l.timestamp}">${new Date(l.timestamp)}</span>`,
                l.label_type,
                l.severity,
                l.tags.join(', '),
                l.description,
                l.validations.agree,
                l.validations.disagree,
                l.validations.unsure,
                `<a class="labelView" data-label-id="${l.label_id}" href="#">View</a>`
            ])).order([1, 'desc']).draw();
            resolve();
        }).fail(error => {
            console.error("Failed to load labels", error);
            reject(error);
        });
    });
}

/**
 * Fetches user stats from /adminapi/getUserStats, adds rows to the #user-table DataTable, and attaches
 * change-role and change-team dropdown handlers. The DataTable is initialized in the template <script> block.
 *
 * @returns {Promise<void>}
 */
function loadUserStats() {
    return new Promise((resolve, reject) => {
        $.getJSON("/adminapi/getUserStats", function(data) {
            const usersTable = $('#user-table').DataTable();

            usersTable.rows.add(data.user_stats.map(u => {
                // Owner role cannot be changed; all other roles get a dropdown.
                const roleDropdown = u.role !== "Owner" ? `
                    <div class="dropdown role-dropdown">
                        <button class="btn btn-default dropdown-toggle" type="button" id="userRoleDropdown${u.userId}" data-toggle="dropdown">
                            ${u.role}
                            <span class="caret"></span>
                        </button>
                        <ul class="dropdown-menu" role="menu" aria-labelledby="userRoleDropdown${u.userId}">
                            <li><a href="#!" class="change-role">Registered</a></li>
                            <li><a href="#!" class="change-role">Turker</a></li>
                            <li><a href="#!" class="change-role">Researcher</a></li>
                            <li><a href="#!" class="change-role">Administrator</a></li>
                            <li><a href="#!" class="change-role">Anonymous</a></li>
                        </ul>
                    </div>
                ` : u.role;

                const teamDropdown = `
                    <div class="dropdown team-dropdown">
                        <button class="btn btn-default dropdown-toggle" type="button" id="userTeamDropdown${u.userId}" data-toggle="dropdown">
                            ${u.team || "None"}
                            <span class="caret"></span>
                        </button>
                        <ul class="dropdown-menu" role="menu" aria-labelledby="userTeamDropdown${u.userId}">
                            ${data.teams.map(team => `
                                <li><a href="#!" class="change-team" data-team-id="${team.teamId}">${team.name}</a></li>
                            `).join('')}
                            <li><a href="#!" class="change-team" data-team-id="-1">None</a></li>
                        </ul>
                    </div>`;

                const signUpTime = u.signUpTime ? new Date(u.signUpTime) : "";
                const lastSignInTime = u.lastSignInTime ? new Date(u.lastSignInTime) : "";

                return [
                    `<a href='/admin/user/${u.username}'>${u.username}</a>`,
                    u.userId,
                    u.email,
                    roleDropdown,
                    teamDropdown,
                    u.highQuality,
                    u.labels,
                    u.ownValidated,
                    (u.ownValidatedAgreedPct * 100).toFixed(0) + '%',
                    u.othersValidated,
                    (u.othersValidatedAgreedPct * 100).toFixed(0) + '%',
                    `<span class="timestamp">${signUpTime}</span>`,
                    `<span class="timestamp">${lastSignInTime}</span>`,
                    u.signInCount
                ];
            })).order([6, 'desc']).draw();

            usersTable.on('click', '.role-dropdown a', changeRole);
            usersTable.on('click', '.team-dropdown a', changeTeam);

            resolve();
        }).fail(error => {
            console.error("Failed to load user stats", error);
            reject(error);
        });
    });
}

/**
 * Fetches teams from /userapi/getTeams, adds rows to the #teams-table DataTable, and attaches
 * change-status and change-visibility dropdown handlers. The DataTable is initialized in the template.
 *
 * @returns {Promise<void>}
 */
function loadTeams() {
    return new Promise((resolve, reject) => {
        $.getJSON("/userapi/getTeams", function(data) {
            const teamsTable = $('#teams-table').DataTable();

            teamsTable.rows.add(data.map(t => {
                const statusDropdown = `
                    <div class="dropdown status-dropdown">
                        <button class="btn btn-default dropdown-toggle" type="button" id="statusDropdown${t.teamId}" data-toggle="dropdown">
                            ${t.open ? 'Open' : 'Closed'}
                            <span class="caret"></span>
                        </button>
                        <ul class="dropdown-menu" role="menu" aria-labelledby="statusDropdown${t.teamId}">
                            <li><a href="#!" class="change-status" data-team-id="${t.teamId}" data-status="true">Open</a></li>
                            <li><a href="#!" class="change-status" data-team-id="${t.teamId}" data-status="false">Closed</a></li>
                        </ul>
                    </div>`;
                const visibilityDropdown = `
                    <div class="dropdown visibility-dropdown">
                        <button class="btn btn-default dropdown-toggle" type="button" id="visibilityDropdown${t.teamId}" data-toggle="dropdown">
                            ${t.visible ? 'Visible' : 'Hidden'}
                            <span class="caret"></span>
                        </button>
                        <ul class="dropdown-menu" role="menu" aria-labelledby="visibilityDropdown${t.teamId}">
                            <li><a href="#!" class="change-visibility" data-team-id="${t.teamId}" data-visibility="true">Visible</a></li>
                            <li><a href="#!" class="change-visibility" data-team-id="${t.teamId}" data-visibility="false">Hidden</a></li>
                        </ul>
                    </div>`;

                return [t.name, t.description, statusDropdown, visibilityDropdown];
            })).order([0, 'asc']).draw();

            teamsTable.on('click', '.status-dropdown a', changeTeamStatus);
            teamsTable.on('click', '.visibility-dropdown a', changeTeamVisibility);

            resolve();
        }).fail(error => {
            console.error("Failed to load teams", error);
            reject(error);
        });
    });
}


// ============================================================
// Section 4: TOC initialization
// ============================================================

/**
 * Reads all h2[id] and h3[id] headings inside #admin-content, populates #admin-toc-list with anchor
 * links, removes the hidden attribute from #admin-toc, and sets up an IntersectionObserver to keep
 * the active link highlighted as the user scrolls.
 */
function _initAdminToc() {
    const tocList = document.getElementById('admin-toc-list');
    const toc = document.getElementById('admin-toc');
    if (!tocList || !toc) return;

    const headings = document.querySelectorAll('#admin-content h2[id], #admin-content h3[id]');
    if (headings.length === 0) return;

    headings.forEach(heading => {
        const li = document.createElement('li');
        li.className = heading.tagName === 'H3' ? 'toc-h3' : 'toc-h2';
        const a = document.createElement('a');
        a.href = `#${heading.id}`;
        a.textContent = heading.textContent;
        li.appendChild(a);
        tocList.appendChild(li);
    });

    toc.removeAttribute('hidden');

    // Highlight the TOC link corresponding to the heading currently in view.
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                tocList.querySelectorAll('a').forEach(a => a.classList.remove('active'));
                const activeLink = tocList.querySelector(`a[href="#${entry.target.id}"]`);
                if (activeLink) activeLink.classList.add('active');
            }
        });
    }, { rootMargin: '0px 0px -70% 0px', threshold: 0 });

    headings.forEach(h => observer.observe(h));
}


// ============================================================
// Section 5: Per-page init functions
// ============================================================

/**
 * Initializes the Overview admin page: creates LabelPopup and AdminCommentPopup, kicks off all data
 * loading in parallel, wires up comment/label popup click handlers, and reveals #admin-layout when done.
 *
 * @param {string} mapboxApiKey - Mapbox API key passed from the Twirl template.
 * @param {string} viewerType - Street-view viewer type (e.g., "google", "mapillary").
 * @param {string} viewerAccessToken - Access token for the street-view viewer.
 * @param {string} currentUsername - The currently logged-in admin username.
 */
async function initOverview(mapboxApiKey, viewerType, viewerAccessToken, currentUsername) {
    const labelPopup = await LabelPopup(true, viewerType, viewerAccessToken, currentUsername);
    const adminCommentPopup = await AdminCommentPopup(true, viewerType, viewerAccessToken);

    Promise.all([
        loadStreetEdgeData(),
        loadUserCountData(),
        loadContributionTimeData(),
        loadLabelCountData(),
        loadValidationCountData(),
        loadComments()
    ]).then(() => {
        $('#admin-layout').css('visibility', 'visible');
    }).catch(error => {
        console.error("Error loading Overview data:", error);
    });

    $('#label-table').on('click', '.labelView', async function(e) {
        e.preventDefault();
        await labelPopup.showLabel($(this).data('labelId'), 'AdminContributionsTab');
    });

    $('#comments-table').on('click', '.show-comment-location', async function(e) {
        e.preventDefault();
        const pov = {
            heading: parseFloat($(this).data('heading')),
            pitch: parseFloat($(this).data('pitch')),
            zoom: Number($(this).data('zoom'))
        };
        const labelId = parseInt($(this).data('labelId'));
        await adminCommentPopup.showCommentGSV(this.innerHTML, pov, labelId);
    });
}

/**
 * Initializes the Map admin page: creates LabelPopup, then instantiates CreatePSMap with
 * MapSidebarFilter, and reveals #admin-layout.
 *
 * @param {string} mapboxApiKey - Mapbox API key.
 * @param {string} viewerType - Street-view viewer type.
 * @param {string} viewerAccessToken - Access token for the viewer.
 * @param {string} currentUsername - The currently logged-in admin username.
 */
async function initMap(mapboxApiKey, viewerType, viewerAccessToken, currentUsername) {
    const labelPopup = await LabelPopup(true, viewerType, viewerAccessToken, currentUsername);

    const mapTabMapParams = {
        mapName: 'admin-labelmap-choropleth',
        mapStyle: 'mapbox://styles/mapbox/light-v11?optimize=true',
        mapboxApiKey: mapboxApiKey,
        mapboxLogoLocation: 'bottom-right',
        neighborhoodsURL: '/neighborhoods',
        completionRatesURL: '/adminapi/neighborhoodCompletionRate',
        streetsURL: '/contribution/streets/all?filterLowQuality=true',
        labelsURL: '/labels/all',
        neighborhoodFillMode: 'singleColor',
        neighborhoodFillColor: '#808080',
        neighborhoodFillOpacity: 0.1,
        neighborhoodTooltip: 'none',
        differentiateUnauditedStreets: true,
        interactiveStreets: true,
        navigationControlPosition: 'top-right',
        uiSource: 'AdminMapTab',
        popupLabelViewer: labelPopup,
        logClicks: false,
        highQualityFilter: true
    };

    CreatePSMap($, mapTabMapParams).then(m => {
        const map = m[0];
        const mapData = m[4];
        new MapSidebarFilter(map, mapData, { highQualityFilter: true });
        $('#admin-layout').css('visibility', 'visible');
    });
}

/**
 * Initializes the Analytics admin page: creates the choropleth map, runs all chart-data fetches,
 * calls loadValidationCountData to fill the by-type table, reveals #admin-layout, and initializes
 * the table-of-contents sidebar.
 *
 * @param {string} mapboxApiKey - Mapbox API key.
 */
function initAnalytics(mapboxApiKey) {
    const opt = { "actions": false };

    const analyticsTabMapParams = {
        mapName: 'admin-landing-choropleth',
        mapStyle: 'mapbox://styles/mapbox/light-v11?optimize=true',
        mapboxApiKey: mapboxApiKey,
        mapboxLogoLocation: 'bottom-right',
        scrollWheelZoom: false,
        neighborhoodsURL: '/neighborhoods',
        completionRatesURL: '/adminapi/neighborhoodCompletionRate',
        neighborhoodFillMode: 'completionRate',
        neighborhoodTooltip: 'completionRate',
        logClicks: false
    };

    CreatePSMap($, analyticsTabMapParams);

    // City coverage over time (brushable area chart).
    $.getJSON("/adminapi/completionRateByDate", function(data) {
        const chart = {
            "data": { "values": data, "format": { "type": "json" } },
            "config": { "axis": { "titleFontSize": 16 } },
            "vconcat": [
                {
                    "height": 300,
                    "width": 875,
                    "mark": { "type": "area", "tooltip": true },
                    "encoding": {
                        "x": {
                            "field": "date",
                            "type": "temporal",
                            // Brush param controls the visible x-domain in the upper chart.
                            "scale": { "domain": { "param": "brush" } },
                            "axis": { "title": "Date", "labelAngle": 0 }
                        },
                        "y": {
                            "field": "completion",
                            "type": "quantitative",
                            "scale": { "domain": [0, 100] },
                            "axis": { "title": "City Coverage (%)" }
                        }
                    }
                },
                {
                    "height": 60,
                    "width": 875,
                    "mark": { "type": "area", "tooltip": true },
                    // Vega-Lite v5 uses "params" (not "selection") for interactive brushes.
                    "params": [{ "name": "brush", "select": { "type": "interval", "encodings": ["x"] } }],
                    "encoding": {
                        "x": {
                            "field": "date",
                            "type": "temporal",
                            "axis": { "title": "Date", "labelAngle": 0 }
                        },
                        "y": {
                            "field": "completion",
                            "type": "quantitative",
                            "scale": { "domain": [0, 100] },
                            "axis": { "title": "City Coverage (%)", "tickCount": 3, "grid": true }
                        }
                    }
                }
            ]
        };
        vegaEmbed("#completion-progress-chart", chart, opt);
    });

    // Tag usage histograms.
    $.getJSON('/adminapi/labelTags', function(tagCountData) {
        const subPlotHeight = 175;
        const subPlotWidth = 250;

        for (const item of tagCountData) {
            if (item.tag.length > 15) item.tag = item.tag.slice(0, 15) + "...";
        }

        const chart1 = {
            "hconcat": [
                {
                    "height": subPlotHeight, "width": subPlotWidth,
                    "data": { "values": tagCountData.filter(l => l.label_type === "CurbRamp") },
                    "mark": { "type": "bar", "tooltip": true },
                    "encoding": {
                        "x": { "field": "tag", "type": "ordinal", "sort": { "field": "count", "op": "sum", "order": "descending" },
                            "axis": { "title": "Curb Ramp Tags", "labelAngle": -48, "labelPadding": 20 } },
                        "y": { "field": "count", "type": "quantitative", "axis": { "title": "# of tags" } }
                    }
                },
                {
                    "height": subPlotHeight, "width": subPlotWidth,
                    "data": { "values": tagCountData.filter(l => l.label_type === "NoCurbRamp") },
                    "mark": { "type": "bar", "tooltip": true },
                    "encoding": {
                        "x": { "field": "tag", "type": "ordinal", "sort": { "field": "count", "op": "sum", "order": "descending" },
                            "axis": { "title": "No Curb Ramps Tags", "labelAngle": -48, "labelPadding": 20 } },
                        "y": { "field": "count", "type": "quantitative", "sort": "descending", "axis": { "title": "" } }
                    }
                },
                {
                    "height": subPlotHeight, "width": subPlotWidth,
                    "data": { "values": tagCountData.filter(l => l.label_type === "Obstacle") },
                    "mark": { "type": "bar", "tooltip": true },
                    "encoding": {
                        "x": { "field": "tag", "type": "ordinal", "sort": { "field": "count", "op": "sum", "order": "descending" },
                            "axis": { "title": "Obstacles Tags", "labelAngle": -48, "labelPadding": 20 } },
                        "y": { "field": "count", "type": "quantitative", "axis": { "title": "" } }
                    }
                }
            ]
        };

        const chart2 = {
            "hconcat": [
                {
                    "height": subPlotHeight, "width": subPlotWidth,
                    "data": { "values": tagCountData.filter(l => l.label_type === "SurfaceProblem") },
                    "mark": { "type": "bar", "tooltip": true },
                    "encoding": {
                        "x": { "field": "tag", "type": "ordinal", "sort": { "field": "count", "op": "sum", "order": "descending" },
                            "axis": { "title": "Surface Problems Tags", "labelAngle": -48, "labelPadding": 20 } },
                        "y": { "field": "count", "type": "quantitative", "sort": "descending", "axis": { "title": "# of tags" } }
                    }
                },
                {
                    "height": subPlotHeight, "width": subPlotWidth,
                    "data": { "values": tagCountData.filter(l => l.label_type === "NoSidewalk") },
                    "mark": { "type": "bar", "tooltip": true },
                    "encoding": {
                        "x": { "field": "tag", "type": "ordinal", "sort": { "field": "count", "op": "sum", "order": "descending" },
                            "axis": { "title": "No Sidewalk Tags", "labelAngle": -48, "labelPadding": 20 } },
                        "y": { "field": "count", "type": "quantitative", "axis": { "title": "" } }
                    }
                },
                {
                    "height": subPlotHeight, "width": subPlotWidth,
                    "data": { "values": tagCountData.filter(l => l.label_type === "Crosswalk") },
                    "mark": { "type": "bar", "tooltip": true },
                    "encoding": {
                        "x": { "field": "tag", "type": "ordinal", "sort": { "field": "count", "op": "sum", "order": "descending" },
                            "axis": { "title": "Marked Crosswalks Tags", "labelAngle": -48, "labelPadding": 20 } },
                        "y": { "field": "count", "type": "quantitative", "sort": "descending", "axis": { "title": "" } }
                    }
                }
            ]
        };

        vegaEmbed("#tag-usage-histograms", chart1, opt);
        vegaEmbed("#tag-usage-histograms2", chart2, opt);
    });

    // Severity histograms by label type.
    $.getJSON('/adminapi/labels/all', function(data) {
        for (let i = 0; i < data.features.length; i++) {
            data.features[i].label_type = data.features[i].properties.label_type;
            data.features[i].severity = data.features[i].properties.severity;
        }
        const curbRamps = data.features.filter(l => l.properties.label_type === "CurbRamp");
        const noCurbRamps = data.features.filter(l => l.properties.label_type === "NoCurbRamp");
        const obstacles = data.features.filter(l => l.properties.label_type === "Obstacle");
        const surfaceProblems = data.features.filter(l => l.properties.label_type === "SurfaceProblem");
        const crosswalks = data.features.filter(l => l.properties.label_type === "Crosswalk");

        const curbRampStats = getSummaryStats(curbRamps, "severity");
        $("#curb-ramp-mean").html(curbRampStats.mean.toFixed(2));
        $("#curb-ramp-std").html(curbRampStats.std.toFixed(2));

        const noCurbRampStats = getSummaryStats(noCurbRamps, "severity");
        $("#missing-ramp-mean").html(noCurbRampStats.mean.toFixed(2));
        $("#missing-ramp-std").html(noCurbRampStats.std.toFixed(2));

        const obstacleStats = getSummaryStats(obstacles, "severity");
        $("#obstacle-mean").html(obstacleStats.mean.toFixed(2));
        $("#obstacle-std").html(obstacleStats.std.toFixed(2));

        const surfaceProblemStats = getSummaryStats(surfaceProblems, "severity");
        $("#surface-mean").html(surfaceProblemStats.mean.toFixed(2));
        $("#surface-std").html(surfaceProblemStats.std.toFixed(2));

        const crosswalkStats = getSummaryStats(crosswalks, "severity");
        $("#crosswalk-mean").html(crosswalkStats.mean.toFixed(2));
        $("#crosswalk-std").html(crosswalkStats.std.toFixed(2));

        const allDataStats = getSummaryStats(data.features, "severity");
        $("#labels-mean").html(allDataStats.mean.toFixed(2));
        $("#labels-std").html(allDataStats.std.toFixed(2));

        const subPlotHeight = 155;
        const subPlotWidth = 220;

        const chart = {
            "hconcat": [
                {
                    "height": subPlotHeight, "width": subPlotWidth, "data": { "values": curbRamps },
                    "mark": { "type": "bar", "tooltip": true },
                    "encoding": {
                        "x": { "field": "severity", "type": "ordinal", "axis": { "title": "Curb Ramp Severity", "labelAngle": 0 } },
                        "y": { "aggregate": "count", "type": "quantitative", "axis": { "title": "# of labels" } }
                    }
                },
                {
                    "height": subPlotHeight, "width": subPlotWidth, "data": { "values": noCurbRamps },
                    "mark": { "type": "bar", "tooltip": true },
                    "encoding": {
                        "x": { "field": "severity", "type": "ordinal", "axis": { "title": "Missing Curb Ramp Severity", "labelAngle": 0 } },
                        "y": { "aggregate": "count", "type": "quantitative", "axis": { "title": "" } }
                    }
                },
                {
                    "height": subPlotHeight, "width": subPlotWidth, "data": { "values": obstacles },
                    "mark": { "type": "bar", "tooltip": true },
                    "encoding": {
                        "x": { "field": "severity", "type": "ordinal", "axis": { "title": "Obstacle Severity", "labelAngle": 0 } },
                        "y": { "aggregate": "count", "type": "quantitative", "axis": { "title": "" } }
                    }
                }
            ],
            "config": { "axis": { "titleFontSize": 10 } }
        };

        const chart2 = {
            "hconcat": [
                {
                    "height": subPlotHeight, "width": subPlotWidth, "data": { "values": surfaceProblems },
                    "mark": { "type": "bar", "tooltip": true },
                    "encoding": {
                        "x": { "field": "severity", "type": "ordinal", "axis": { "title": "Surface Problem Severity", "labelAngle": 0 } },
                        "y": { "aggregate": "count", "type": "quantitative", "axis": { "title": "# of labels" } }
                    }
                },
                {
                    "height": subPlotHeight, "width": subPlotWidth, "data": { "values": crosswalks },
                    "mark": { "type": "bar", "tooltip": true },
                    "encoding": {
                        "x": { "field": "severity", "type": "ordinal", "axis": { "title": "Marked Crosswalk Severity", "labelAngle": 0 } },
                        "y": { "aggregate": "count", "type": "quantitative", "axis": { "title": "" } }
                    }
                }
            ],
            "config": { "axis": { "titleFontSize": 10 } }
        };

        vegaEmbed("#severity-histograms", chart, opt);
        vegaEmbed("#severity-histograms2", chart2, opt);
    });

    // Neighborhood completion rate charts.
    $.getJSON('/adminapi/neighborhoodCompletionRate', function(data) {
        const chartHeight = 150 + (data.length * 30);

        for (let j = 0; j < data.length; j++) {
            data[j].rate *= 100.0; // Convert from proportion to percent.
        }
        const stats = getSummaryStats(data, "rate");
        $("#neighborhood-std").html(stats.std.toFixed(2) + "%");

        const coverageRateChartSortedByCompletion = {
            "width": 700, "height": chartHeight,
            "data": { "values": data, "format": { "type": "json" } },
            "mark": { "type": "bar", "tooltip": true },
            "encoding": {
                "x": { "field": "rate", "type": "quantitative", "axis": { "title": "Neighborhood Completion (%)" } },
                "y": { "field": "name", "type": "nominal",
                    "axis": { "title": "Neighborhood", "labelAngle": -45 },
                    "sort": { "field": "rate", "op": "max", "order": "ascending" } }
            },
            "config": { "axis": { "titleFontSize": 16, "labelFontSize": 13 } }
        };

        const coverageRateChartSortedAlphabetically = {
            "width": 700, "height": chartHeight,
            "data": { "values": data, "format": { "type": "json" } },
            "mark": { "type": "bar", "tooltip": true },
            "encoding": {
                "x": { "field": "rate", "type": "quantitative", "axis": { "title": "Neighborhood Completion (%)" } },
                "y": { "field": "name", "type": "nominal",
                    "axis": { "title": "Neighborhood", "labelAngle": -45 },
                    "sort": { "field": "name", "op": "max", "order": "descending" } }
            },
            "config": { "axis": { "titleFontSize": 16, "labelFontSize": 13 } }
        };

        vegaEmbed("#neighborhood-completion-rate", coverageRateChartSortedByCompletion, opt);

        document.getElementById("neighborhood-completion-sort-button").addEventListener("click", () => {
            vegaEmbed("#neighborhood-completion-rate", coverageRateChartSortedByCompletion, opt);
        });
        document.getElementById("neighborhood-alphabetical-sort-button").addEventListener("click", () => {
            vegaEmbed("#neighborhood-completion-rate", coverageRateChartSortedAlphabetically, opt);
        });

        const histOpts = {
            col: "rate", xAxisTitle: "Neighborhood Completion (%)", xDomain: [0, 100], width: 400, height: 250, binStep: 10
        };
        vegaEmbed("#neighborhood-completed-distance", getVegaLiteHistogram(data, stats.mean, stats.median, histOpts), opt);
    });

    // Validation agreement accuracy histogram.
    $.getJSON('/adminapi/validationCounts', function(data) {
        const filteredData = data.filter(x => x.count >= 50 && x.role !== 'AI');
        const pcts = filteredData.map(x => ({ count: (x.agreed / x.count) * 100 }));
        const stats = getSummaryStats(pcts, "count");
        $("#validation-agreed-std").html(stats.std.toFixed(2) + " %");

        const histOpts = { xAxisTitle: "User Accuracy (%)", xDomain: [0, 100], binStep: 5 };
        vegaEmbed("#validation-agreed", getVegaLiteHistogram(pcts, stats.mean, stats.median, histOpts), opt);
    });

    // Daily audit count: time-series bar + histogram.
    $.getJSON("/contribution/auditCounts/all", function(data) {
        const stats = getSummaryStats(data, "count");
        $("#audit-std").html(stats.std.toFixed(2) + " Street Audits");

        const histOpts = { xAxisTitle: "# Street Audits per Day", xDomain: [0, stats.max], width: 250, binStep: 50, legendOffset: -80 };
        const hist = getVegaLiteHistogram(data, stats.mean, stats.median, histOpts);

        const chart = {
            "data": { "values": data },
            "hconcat": [
                {
                    "height": 300, "width": 550,
                    "layer": [
                        {
                            "mark": { "type": "bar", "tooltip": true },
                            "encoding": {
                                "x": { "field": "date", "type": "temporal", "axis": { "title": "Date", "labelAngle": 0 } },
                                "y": { "field": "count", "type": "quantitative", "axis": { "title": "# Street Audits per Day" } }
                            }
                        },
                        {
                            "data": { "values": [{ "stat": "mean", "value": stats.mean }, { "stat": "median", "value": stats.median }] },
                            "mark": "rule",
                            "encoding": {
                                "y": { "field": "value", "type": "quantitative",
                                    "axis": { "labels": false, "ticks": false, "title": "" },
                                    "scale": { "domain": [0, stats.max] } },
                                "color": { "field": "stat", "type": "nominal",
                                    "scale": { "range": ["pink", "orange"] }, "legend": false },
                                "size": { "value": 1 }
                            }
                        }
                    ],
                    "resolve": { "y": { "scale": "independent" } }
                },
                hist
            ],
            "config": { "axis": { "titleFontSize": 16 } }
        };
        vegaEmbed("#audit-count-chart", chart, opt);
    });

    // Daily label count: time-series bar + histogram.
    $.getJSON("/userapi/labelCounts/all", function(data) {
        const stats = getSummaryStats(data, "count");
        $("#label-std").html(stats.std.toFixed(2) + " Labels");

        const histOpts = { xAxisTitle: "# Labels per Day", xDomain: [0, stats.max], width: 250, binStep: 200, legendOffset: -80 };
        const hist = getVegaLiteHistogram(data, stats.mean, stats.median, histOpts);

        const chart = {
            "data": { "values": data },
            "hconcat": [
                {
                    "height": 300, "width": 550,
                    "layer": [
                        {
                            "mark": { "type": "bar", "tooltip": true },
                            "encoding": {
                                "x": { "field": "date", "type": "temporal", "axis": { "title": "Date", "labelAngle": 0 } },
                                "y": { "field": "count", "type": "quantitative", "axis": { "title": "# Labels per Day" } }
                            }
                        },
                        {
                            "data": { "values": [{ "stat": "mean", "value": stats.mean }, { "stat": "median", "value": stats.median }] },
                            "mark": "rule",
                            "encoding": {
                                "y": { "field": "value", "type": "quantitative",
                                    "axis": { "labels": false, "ticks": false, "title": "" },
                                    "scale": { "domain": [0, stats.max] } },
                                "color": { "field": "stat", "type": "nominal",
                                    "scale": { "range": ["pink", "orange"] }, "legend": false },
                                "size": { "value": 2 }
                            }
                        }
                    ],
                    "resolve": { "y": { "scale": "independent" } }
                },
                hist
            ],
            "config": { "axis": { "titleFontSize": 16 } }
        };
        vegaEmbed("#label-count-chart", chart, opt);
    });

    // Daily validation count: time-series bar + histogram.
    $.getJSON("/userapi/validationCounts/all", function(data) {
        const stats = getSummaryStats(data, "count");
        $("#validation-std").html(stats.std.toFixed(2) + " Validations");

        const histOpts = { xAxisTitle: "# Validations per Day", xDomain: [0, stats.max], width: 250, binStep: 200, legendOffset: -80 };
        const hist = getVegaLiteHistogram(data, stats.mean, stats.median, histOpts);

        const chart = {
            "data": { "values": data },
            "hconcat": [
                {
                    "height": 300, "width": 550,
                    "layer": [
                        {
                            "mark": { "type": "bar", "tooltip": true },
                            "encoding": {
                                "x": { "field": "date", "type": "temporal", "axis": { "title": "Date", "labelAngle": 0 } },
                                "y": { "field": "count", "type": "quantitative", "axis": { "title": "# Validations per Day" } }
                            }
                        },
                        {
                            "data": { "values": [{ "stat": "mean", "value": stats.mean }, { "stat": "median", "value": stats.median }] },
                            "mark": "rule",
                            "encoding": {
                                "y": { "field": "value", "type": "quantitative",
                                    "axis": { "labels": false, "ticks": false, "title": "" },
                                    "scale": { "domain": [0, stats.max] } },
                                "color": { "field": "stat", "type": "nominal",
                                    "scale": { "range": ["pink", "orange"] }, "legend": false },
                                "size": { "value": 2 }
                            }
                        }
                    ],
                    "resolve": { "y": { "scale": "independent" } }
                },
                hist
            ],
            "config": { "axis": { "titleFontSize": 16 } }
        };
        vegaEmbed("#validation-count-chart", chart, opt);
    });

    // Mission count per user histograms with researcher toggle.
    $.getJSON("/adminapi/userMissionCounts", function(data) {
        const allData = data.filter(u => u.role !== 'AI');
        const regData = allData.filter(u => u.role === 'Registered' || isResearcherRole(u.role));
        const anonData = allData.filter(u => u.role === 'Anonymous');
        const turkerData = allData.filter(u => u.role === 'Turker');

        const allStats = getSummaryStats(allData, "count");
        const allFilteredStats = getSummaryStats(allData, "count", { excludeResearchers: true });
        const regStats = getSummaryStats(regData, "count");
        const regFilteredStats = getSummaryStats(regData, "count", { excludeResearchers: true });
        const turkerStats = getSummaryStats(turkerData, "count");
        const anonStats = getSummaryStats(anonData, "count");

        $("#missions-std").html(allFilteredStats.std.toFixed(2) + " Missions");
        $("#reg-missions-std").html(regFilteredStats.std.toFixed(2) + " Missions");
        $("#turker-missions-std").html(turkerStats.std.toFixed(2) + " Missions");
        $("#anon-missions-std").html(anonStats.std.toFixed(2) + " Missions");

        const buildMissionCharts = (includeResearchers) => {
            const aHisto = getVegaLiteHistogram(allData, includeResearchers ? allStats.mean : allFilteredStats.mean,
                includeResearchers ? allStats.median : allFilteredStats.median,
                { xAxisTitle: "# Missions per User (all)", xDomain: [0, includeResearchers ? allStats.max : allFilteredStats.max],
                    width: 187, binStep: 15, legendOffset: -80, excludeResearchers: !includeResearchers });
            const rHisto = getVegaLiteHistogram(regData, includeResearchers ? regStats.mean : regFilteredStats.mean,
                includeResearchers ? regStats.median : regFilteredStats.median,
                { xAxisTitle: "# Missions per Registered User", xDomain: [0, includeResearchers ? regStats.max : regFilteredStats.max],
                    width: 187, binStep: 10, legendOffset: -80, excludeResearchers: !includeResearchers });
            const tHisto = getVegaLiteHistogram(turkerData, turkerStats.mean, turkerStats.median,
                { xAxisTitle: "# Missions per Turker User", xDomain: [0, turkerStats.max], width: 187, binStep: 15, legendOffset: -80 });
            const anHisto = getVegaLiteHistogram(anonData, anonStats.mean, anonStats.median,
                { xAxisTitle: "# Missions per Anon User", xDomain: [0, anonStats.max], width: 187, binStep: 1, legendOffset: -80 });
            const combined = { "hconcat": [aHisto, rHisto, tHisto, anHisto].filter(c => c.data.values.length > 0) };
            if (combined.hconcat.length > 0) vegaEmbed("#mission-count-chart", combined, opt);
        };

        buildMissionCharts(false);

        document.getElementById("mission-count-include-researchers-checkbox").addEventListener("click", function(cb) {
            const include = cb.target.checked;
            $("#missions-std").html((include ? allStats.std : allFilteredStats.std).toFixed(2) + " Missions");
            $("#reg-missions-std").html((include ? regStats.std : regFilteredStats.std).toFixed(2) + " Missions");
            buildMissionCharts(include);
        });
    });

    // Label count per user histograms with researcher toggle.
    $.getJSON("/adminapi/labelCounts", function(data) {
        const allData = data.filter(u => u.role !== 'AI');
        const regData = allData.filter(u => u.role === 'Registered' || isResearcherRole(u.role));
        const turkerData = allData.filter(u => u.role === 'Turker');
        const anonData = allData.filter(u => u.role === 'Anonymous');

        const allStats = getSummaryStats(allData, "count");
        const allFilteredStats = getSummaryStats(allData, "count", { excludeResearchers: true });
        const regStats = getSummaryStats(regData, "count");
        const regFilteredStats = getSummaryStats(regData, "count", { excludeResearchers: true });
        const turkerStats = getSummaryStats(turkerData, "count");
        const anonStats = getSummaryStats(anonData, "count");

        $("#all-labels-std").html(allFilteredStats.std.toFixed(2) + " Labels");
        $("#reg-labels-std").html(regFilteredStats.std.toFixed(2) + " Labels");
        $("#turker-labels-std").html(turkerStats.std.toFixed(2) + " Labels");
        $("#anon-labels-std").html(anonStats.std.toFixed(2) + " Labels");

        const buildLabelCharts = (includeResearchers) => {
            const aHisto = getVegaLiteHistogram(allData, includeResearchers ? allStats.mean : allFilteredStats.mean,
                includeResearchers ? allStats.median : allFilteredStats.median,
                { xAxisTitle: "# Labels per User (all)", xDomain: [0, includeResearchers ? allStats.max : allFilteredStats.max],
                    width: 187, binStep: 500, legendOffset: -80, excludeResearchers: !includeResearchers });
            const rHisto = getVegaLiteHistogram(regData, includeResearchers ? regStats.mean : regFilteredStats.mean,
                includeResearchers ? regStats.median : regFilteredStats.median,
                { xAxisTitle: "# Labels per Registered User", xDomain: [0, includeResearchers ? regStats.max : regFilteredStats.max],
                    width: 187, binStep: 500, legendOffset: -80, excludeResearchers: !includeResearchers });
            const tHisto = getVegaLiteHistogram(turkerData, turkerStats.mean, turkerStats.median,
                { xAxisTitle: "# Labels per Turker User", xDomain: [0, turkerStats.max], width: 187, binStep: 500, legendOffset: -80 });
            const anHisto = getVegaLiteHistogram(anonData, anonStats.mean, anonStats.median,
                { xAxisTitle: "# Labels per Anon User", xDomain: [0, anonStats.max], width: 187, legendOffset: -80, binStep: 2 });
            const combined = { "hconcat": [aHisto, rHisto, tHisto, anHisto].filter(c => c.data.values.length > 0) };
            if (combined.hconcat.length > 0) vegaEmbed("#label-count-hist", combined, opt);
        };

        buildLabelCharts(false);

        document.getElementById("label-count-include-researchers-checkbox").addEventListener("click", function(cb) {
            const include = cb.target.checked;
            $("#all-labels-std").html((include ? allStats.std : allFilteredStats.std).toFixed(2) + " Labels");
            $("#reg-labels-std").html((include ? regStats.std : regFilteredStats.std).toFixed(2) + " Labels");
            buildLabelCharts(include);
        });
    });

    // Validation count per user histograms with researcher toggle.
    $.getJSON("/adminapi/validationCounts", function(data) {
        const allData = data.filter(u => u.role !== 'AI');
        const regData = allData.filter(u => u.role === 'Registered' || isResearcherRole(u.role));
        const turkerData = allData.filter(u => u.role === 'Turker');
        const anonData = allData.filter(u => u.role === 'Anonymous');

        const allStats = getSummaryStats(allData, "count");
        const allFilteredStats = getSummaryStats(allData, "count", { excludeResearchers: true });
        const regStats = getSummaryStats(regData, "count");
        const regFilteredStats = getSummaryStats(regData, "count", { excludeResearchers: true });
        const turkerStats = getSummaryStats(turkerData, "count");
        const anonStats = getSummaryStats(anonData, "count");

        $("#all-validation-std").html(allFilteredStats.std.toFixed(2) + " labels");
        $("#reg-validation-std").html(regFilteredStats.std.toFixed(2) + " labels");
        $("#turker-validation-std").html(turkerStats.std.toFixed(2) + " labels");
        $("#anon-validation-std").html(anonStats.std.toFixed(2) + " labels");

        const buildValCharts = (includeResearchers) => {
            const aHisto = getVegaLiteHistogram(allData, includeResearchers ? allStats.mean : allFilteredStats.mean,
                includeResearchers ? allStats.median : allFilteredStats.median,
                { xAxisTitle: "# Labels Validated per User (all)", xDomain: [0, includeResearchers ? allStats.max : allFilteredStats.max],
                    width: 187, binStep: 50, legendOffset: -80, excludeResearchers: !includeResearchers });
            const rHisto = getVegaLiteHistogram(regData, includeResearchers ? regStats.mean : regFilteredStats.mean,
                includeResearchers ? regStats.median : regFilteredStats.median,
                { xAxisTitle: "# Labels Validated per Registered User", xDomain: [0, includeResearchers ? regStats.max : regFilteredStats.max],
                    width: 187, binStep: 50, legendOffset: -80, excludeResearchers: !includeResearchers });
            const tHisto = getVegaLiteHistogram(turkerData, turkerStats.mean, turkerStats.median,
                { xAxisTitle: "# Labels Validated per Turker User", xDomain: [0, turkerStats.max], width: 187, binStep: 50, legendOffset: -80 });
            const anHisto = getVegaLiteHistogram(anonData, anonStats.mean, anonStats.median,
                { xAxisTitle: "# Labels Validated per Anon User", xDomain: [0, anonStats.max], width: 187, legendOffset: -80, binStep: 2 });
            const combined = { "hconcat": [aHisto, rHisto, tHisto, anHisto].filter(c => c.data.values.length > 0) };
            if (combined.hconcat.length > 0) vegaEmbed("#validation-count-hist", combined, opt);
        };

        buildValCharts(false);

        document.getElementById("validation-count-include-researchers-checkbox").addEventListener("click", function(cb) {
            const include = cb.target.checked;
            $("#all-validation-std").html((include ? allStats.std : allFilteredStats.std).toFixed(2) + " Validations");
            $("#reg-validation-std").html((include ? regStats.std : regFilteredStats.std).toFixed(2) + " Validations");
            buildValCharts(include);
        });
    });

    // Login count per registered user histogram with researcher toggle.
    $.getJSON("/adminapi/allSignInCounts", function(data) {
        const stats = getSummaryStats(data, "count");
        const filteredStats = getSummaryStats(data, "count", { excludeResearchers: true });

        const chart = getVegaLiteHistogram(data, stats.mean, stats.median,
            { xAxisTitle: "# Logins per Registered User", binStep: 5, xDomain: [0, stats.max] });
        const filteredChart = getVegaLiteHistogram(data, filteredStats.mean, filteredStats.median,
            { xAxisTitle: "# Logins per Registered User", xDomain: [0, filteredStats.max], excludeResearchers: true });

        $("#login-count-std").html(filteredStats.std.toFixed(2) + " Logins");
        vegaEmbed("#login-count-chart", filteredChart, opt);

        document.getElementById("login-count-include-researchers-checkbox").addEventListener("click", function(cb) {
            if (cb.target.checked) {
                $("#login-count-std").html(stats.std.toFixed(2) + " Logins");
                vegaEmbed("#login-count-chart", chart, opt);
            } else {
                $("#login-count-std").html(filteredStats.std.toFixed(2) + " Logins");
                vegaEmbed("#login-count-chart", filteredChart, opt);
            }
        });
    });

    // Fill the val-by-type table in the Analytics tab.
    loadValidationCountData();

    $('#admin-layout').css('visibility', 'visible');
    _initAdminToc();
}

/**
 * Initializes the Labels admin page: creates LabelPopup, loads label data into the table, and
 * reveals #admin-layout.
 *
 * @param {string} viewerType - Street-view viewer type.
 * @param {string} viewerAccessToken - Access token for the viewer.
 * @param {string} currentUsername - The currently logged-in admin username.
 */
async function initLabels(viewerType, viewerAccessToken, currentUsername) {
    const labelPopup = await LabelPopup(true, viewerType, viewerAccessToken, currentUsername);

    $('#label-table').on('click', '.labelView', async function(e) {
        e.preventDefault();
        await labelPopup.showLabel($(this).data('labelId'), 'AdminContributionsTab');
    });

    loadLabels().then(() => {
        $('#admin-layout').css('visibility', 'visible');
    }).catch(error => {
        console.error("Error loading labels:", error);
    });
}

/**
 * Initializes the Users admin page: loads user stats into the DataTable (initialized in the template)
 * and reveals #admin-layout.
 */
function initUsers() {
    loadUserStats().then(() => {
        $('#admin-layout').css('visibility', 'visible');
    }).catch(error => {
        console.error("Error loading user stats:", error);
    });
}

/**
 * Initializes the Label Search admin page: creates LabelPopup, instantiates AdminLabelSearch, and
 * reveals #admin-layout.
 *
 * @param {string} viewerType - Street-view viewer type.
 * @param {string} viewerAccessToken - Access token for the viewer.
 * @param {string} currentUsername - The currently logged-in admin username.
 */
async function initLabelSearch(viewerType, viewerAccessToken, currentUsername) {
    const labelPopup = await LabelPopup(true, viewerType, viewerAccessToken, currentUsername);
    AdminLabelSearch(true, labelPopup, 'AdminLabelSearchTab');
    $('#admin-layout').css('visibility', 'visible');
}

/**
 * Initializes the Teams admin page: loads teams into the DataTable (initialized in the template) and
 * reveals #admin-layout.
 */
function initTeams() {
    loadTeams().then(() => {
        $('#admin-layout').css('visibility', 'visible');
    }).catch(error => {
        console.error("Error loading teams:", error);
    });
}

/**
 * Initializes the API Analytics admin page: instantiates AdminApiAnalytics, reveals #admin-layout,
 * and triggers the initial data load.
 */
function initApiAnalytics() {
    const analytics = new AdminApiAnalytics();
    $('#admin-layout').css('visibility', 'visible');
    analytics.load().catch(error => {
        console.error("Error loading API analytics:", error);
    });
}
