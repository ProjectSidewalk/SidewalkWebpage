function Admin(_, $, difficultRegionIds, params) {
    var self = LayerController();
    var mapParams = {
        choroplethType: 'labelMap',
                neighborhoodPolygonStyle: {
                    color: '#888',
                    weight: 2,
                    opacity: 0.80,
                    fillColor: "#808080",
                    fillOpacity: 0.1
                },
                mouseoverStyle: {
                    color: 'red',
                    fillColor: 'red'
                },
                mouseoutStyle: {
                    color: '#888',
                    weight: 2,
                    opacity: 0.80,
                    fillColor: "#808080",
                    fillOpacity: 0.1
                },
                legendPosition: 'bottomleft',
                scrollWheel: true,
                zoomSlider: false,
                zoomControl: true,
                resetButton: false,
                overlayPolygon: true,
                mapName: 'label-map',
                mapStyle: "mapbox.streets",
                accessToken: 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA'
    }
    function initializeAdminLabelSearch() {
        self.adminLabelSearch = AdminLabelSearch();
    }

    function initializeLabelTable() {
        $('.labelView').click(function (e) {
            e.preventDefault();
            self.adminGSVLabelView.showLabel($(this).data('labelId'));
        });
    }

    function isResearcherRole(roleName) {
        return ['Researcher', 'Administrator', 'Owner'].indexOf(roleName) > 0;
    }

    // Takes an array of objects and the name of a property of the objects, returns summary stats for that property
    function getSummaryStats(data, col, options) {
        options = options || {};
        var excludeResearchers = options.excludeResearchers || false;

        var sum = 0;
        var filteredData = [];
        for (var j = 0; j < data.length; j++) {
            if (!excludeResearchers || !isResearcherRole(data[j].role)) {
                sum += data[j][col];
                filteredData.push(data[j])
            }
        }
        var mean = sum / filteredData.length;
        var i = filteredData.length / 2;
        filteredData.sort(function(a, b) {return (a[col] > b[col]) ? 1 : ((b[col] > a[col]) ? -1 : 0);} );

        var median = 0;
        var max = 0;
        var min = 0;

        if (filteredData.length > 0) { // Prevent errors in development where there may be no data
            median = (filteredData.length / 2) % 1 == 0 ? (filteredData[i - 1][col] + filteredData[i][col]) / 2 : filteredData[Math.floor(i)][col];
            min = filteredData[0][col];
            max = filteredData[filteredData.length-1][col];
        }

        var std = 0;
        for(var k = 0; k < filteredData.length; k++) {
            std += Math.pow(filteredData[k][col] - mean, 2);
        }
        std /= filteredData.length;
        std = Math.sqrt(std);

        return {mean:mean, median:median, std:std, min:min, max};
    }

    // takes in some data, summary stats, and optional arguments, and outputs the spec for a vega-lite chart
    function getVegaLiteHistogram(data, mean, median, options) {
        options = options || {};
        var xAxisTitle = options.xAxisTitle || "TODO, fill in x-axis title";
        var yAxisTitle = options.yAxisTitle || "Counts";
        var height = options.height || 300;
        var width = options.width || 600;
        var col = options.col || "count"; // most graphs we are making are made of up counts
        var xDomain = options.xDomain || [0, data[data.length-1][col]];
        var binStep = options.binStep || 1;
        var legendOffset = options.legendOffset || 0;
        var excludeResearchers = options.excludeResearchers || false;

        // var transformList = excludeResearchers ? [{"filter": "!datum.is_researcher"}] : [];
        var nonResearcherRoles = ['Registered', 'Anonymous', 'Turker'];
        var transformList = excludeResearchers ? [{"filter": {"field": "role", "oneOf": nonResearcherRoles}}] : [];

        return {
            "height": height,
            "width": width,
            "data": {"values": data},
            "transform": transformList,
            "layer": [
                {
                    "mark": "bar",
                    "encoding": {
                        "x": {
                            "field": col,
                            "type": "quantitative",
                            "axis": {"title": xAxisTitle, "labelAngle": 0, "tickCount":8},
                            "bin": {"step": binStep}
                        },
                        "y": {
                            "aggregate": "count",
                            "field": "*",
                            "type": "quantitative",
                            "axis": {
                                "title": yAxisTitle
                            }
                        }
                    }
                },
                { // creates lines marking summary statistics
                    "data": {"values": [
                        {"stat": "mean", "value": mean}, {"stat": "median", "value": median}]
                    },
                    "mark": "rule",
                    "encoding": {
                        "x": {
                            "field": "value", "type": "quantitative",
                            "axis": {"labels": false, "ticks": false, "title": "", "grid": false},
                            "scale": {"domain": xDomain}
                        },
                        "color": {
                            "field": "stat", "type": "nominal", "scale": {"range": ["pink", "orange"]},
                            "legend": {
                                "title": "Summary Stats",
                                "values": ["mean: " + mean.toFixed(2), "median: " + median.toFixed(2)],
                                "offset": legendOffset
                            }
                        },
                        "size": {
                            "value": 2
                        }
                    }
                }
            ],
            "resolve": {"x": {"scale": "independent"}},
            "config": {
                "axis": {
                    "titleFontSize": 16
                }
            }
        };
    }

    $('.nav-pills').on('click', function (e) {
        if (e.target.id == "visualization" && self.mapLoaded == false) {
            var map = Choropleth(_, $, "null", mapParams);
            InitializeAuditedStreets(map, self, "/contribution/streets/all", mapParams);
            ToggleController(map, self, true);
            // Adding a 1 second wait to ensure that labels are the top layer and are thus clickable.
            setTimeout(function(){
                InitializeSubmittedLabels(map, self, "/labels/all", mapParams);
            }, 1000);
            setTimeout(function () {
                map.invalidateSize(false);
            }, 1);
            self.mapLoaded = true;
        }
        else if (e.target.id == "analytics" && self.graphsLoaded == false) {

            var opt = {
                "mode": "vega-lite",
                "actions": false
            };

            $.getJSON("/adminapi/completionRateByDate", function (data) {
                var chart = {
                    "data": {"values": data[0], "format": {"type": "json"}},
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    },
                    "vconcat": [
                        {
                            "height":300,
                            "width": 875,
                            "mark": "area",
                            "encoding": {
                                "x": {
                                    "field": "date",
                                    "type": "temporal",
                                    "scale": {"domain": {"selection": "brush", "field": "date"}},
                                    "axis": {"title": "Date", "labelAngle": 0}
                                },
                                "y": {
                                    "field": "completion", 
                                    "type": "quantitative", "scale": {
                                        "domain": [0,100]
                                    },
                                    "axis": {"title": "City Coverage (%)"}
                                }
                            }
                        },
                        {
                        "height": 60,
                        "width": 875,
                        "mark": "area",
                        "selection": {"brush": {"type": "interval", "encodings": ["x"]}},
                        "encoding": {
                            "x": {
                                "field": "date", 
                                "type": "temporal",
                                "axis": {"title": "Date", "labelAngle": 0}
                            },
                            "y": {
                                "field": "completion",
                                "type": "quantitative", "scale": {
                                    "domain": [0,100]
                                },
                                "axis": {
                                    "title": "City Coverage (%)",
                                    "tickCount": 3, "grid": true}
                            }
                        }
                        }
                    ]
                };
                vega.embed("#completion-progress-chart", chart, opt, function(error, results) {});
            });

            $.getJSON('/adminapi/labels/all', function (data) {
                for (var i = 0; i < data.features.length; i++) {
                    data.features[i].label_type = data.features[i].properties.label_type;
                    data.features[i].severity = data.features[i].properties.severity;
                }
                var curbRamps = data.features.filter(function(label) {return label.properties.label_type === "CurbRamp"});
                var noCurbRamps = data.features.filter(function(label) {return label.properties.label_type === "NoCurbRamp"});
                var surfaceProblems = data.features.filter(function(label) {return label.properties.label_type === "SurfaceProblem"});
                var obstacles = data.features.filter(function(label) {return label.properties.label_type === "Obstacle"});
                var noSidewalks = data.features.filter(function(label) {return label.properties.label_type === "NoSidewalk"});
                
                var curbRampStats = getSummaryStats(curbRamps, "severity");
                $("#curb-ramp-mean").html((curbRampStats.mean).toFixed(2));
                $("#curb-ramp-std").html((curbRampStats.std).toFixed(2));
                
                var noCurbRampStats = getSummaryStats(noCurbRamps, "severity");
                $("#missing-ramp-mean").html((noCurbRampStats.mean).toFixed(2));
                $("#missing-ramp-std").html((noCurbRampStats.std).toFixed(2));
                
                var surfaceProblemStats = getSummaryStats(surfaceProblems, "severity");
                $("#surface-mean").html((surfaceProblemStats.mean).toFixed(2));
                $("#surface-std").html((surfaceProblemStats.std).toFixed(2));
                
                var obstacleStats = getSummaryStats(obstacles, "severity");
                $("#obstacle-mean").html((obstacleStats.mean).toFixed(2));
                $("#obstacle-std").html((obstacleStats.std).toFixed(2));
                
                var noSidewalkStats = getSummaryStats(noSidewalks, "severity");
                $("#no-sidewalk-mean").html((noSidewalkStats.mean).toFixed(2));
                $("#no-sidewalk-std").html((noSidewalkStats.std).toFixed(2));

                var allData = data.features;
                var allDataStats = getSummaryStats(allData, "severity");
                $("#labels-mean").html((allDataStats.mean).toFixed(2));
                $("#labels-std").html((allDataStats.std).toFixed(2));
                
                var subPlotHeight = 150;
                var subPlotWidth = 149;
                var chart = {
                    "hconcat": [
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": curbRamps},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "Curb Ramp Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": "# of labels"}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": noCurbRamps},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "Missing Curb Ramp Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": surfaceProblems},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "Surface Problem Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": obstacles},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "Obstacle Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": noSidewalks},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "No Sidewalk Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        }
                    ],
                    "config": {
                        "axis": {
                            "titleFontSize": 14
                        }
                    }
                };
                vega.embed("#severity-histograms", chart, opt, function(error, results) {});
            });
            $.getJSON('/adminapi/neighborhoodCompletionRate', function (data) {
                var choropleth = Choropleth(_, $, difficultRegionIds, params)
                setTimeout(function () {
                    choropleth.invalidateSize(false);
                }, 1);

                // make charts showing neighborhood completion rate
                for (var j = 0; j < data.length; j++) {
                    data[j].rate *= 100.0; // change from proportion to percent
                }
                var stats = getSummaryStats(data, "rate");
                $("#neighborhood-std").html((stats.std).toFixed(2) + "%");

                var coverageRateChartSortedByCompletion = {
                    "width": 810,
                    "height": 1200,
                    "data": {
                        "values": data, "format": {
                            "type": "json"
                        }
                    },
                    "mark": "bar",
                    "encoding": {
                        "x": {
                            "field": "rate", "type": "quantitative",
                            "axis": {"title": "Neighborhood Completion (%)"}
                        },
                        "y": {
                            "field": "name", "type": "nominal",
                            "axis": {"title": "Neighborhood"},
                            "sort": {"field": "rate", "op": "max", "order": "ascending"}
                        }
                    },
                    "config": {
                        "axis": {"titleFontSize": 16, "labelFontSize": 8}
                    }
                };

                var coverageRateChartSortedAlphabetically = {
                    "width": 810,
                    "height": 1200,
                    "data": {
                        "values": data, "format": {
                            "type": "json"
                        }
                    },
                    "mark": "bar",
                    "encoding": {
                        "x": {
                            "field": "rate", "type": "quantitative",
                            "axis": {"title": "Neighborhood Completion (%)"}
                        },
                        "y": {
                            "field": "name", "type": "nominal",
                            "axis": {"title": "Neighborhood"},
                            "sort": {"field": "name", "op": "max", "order": "descending"}
                        }
                    },
                    "config": {
                        "axis": {"titleFontSize": 16, "labelFontSize": 8}
                    }
                };
                vega.embed("#neighborhood-completion-rate", coverageRateChartSortedByCompletion, opt, function(error, results) {});

                document.getElementById("neighborhood-completion-sort-button").addEventListener("click", function() {
                    vega.embed("#neighborhood-completion-rate", coverageRateChartSortedByCompletion, opt, function(error, results) {});
                });
                document.getElementById("neighborhood-alphabetical-sort-button").addEventListener("click", function() {
                    vega.embed("#neighborhood-completion-rate", coverageRateChartSortedAlphabetically, opt, function(error, results) {});
                });

                var histOpts = {col: "rate", xAxisTitle:"Neighborhood Completion (%)", xDomain:[0, 100],
                                width:400, height:250, binStep:10};
                var coverageRateHist = getVegaLiteHistogram(data, stats.mean, stats.median, histOpts);

                vega.embed("#neighborhood-completed-distance", coverageRateHist, opt, function(error, results) {});

            });
            $.getJSON('/adminapi/validationCounts', function (data) {
                var filteredData = data[0].map(function(x) {
                    return {
                        role: x.role,
                        total: x.count,
                        agreed: x.agreed,
                    }
                });

                var pcts = filteredData.filter(function(x) { // Must have 10+ labels validated
                    return x.total >= 10;
                }).map(function (x) { // Convert to percentages
                    return {
                        count: (x.agreed / x.total) * 100,
                        role: x.role
                    };
                });

                var stats = getSummaryStats(pcts, "count");
                $("#validation-agreed-std").html((stats.std).toFixed(2) + " %");

                var histOpts = {xAxisTitle:"Validations Placed Agreed With (%)", xDomain:[0, 100], binStep:5};
                var coverageRateHist = getVegaLiteHistogram(pcts, stats.mean, stats.median, histOpts);
                vega.embed("#validation-agreed", coverageRateHist, opt, function(error, results) {});

            });
            $.getJSON("/contribution/auditCounts/all", function (data) {
                var stats = getSummaryStats(data[0], "count");

                $("#audit-std").html((stats.std).toFixed(2) + " Street Audits");

                var histOpts = {xAxisTitle:"# Street Audits per Day", xDomain:[0, stats.max], width:250, binStep:50, legendOffset:-80};
                var hist = getVegaLiteHistogram(data[0], stats.mean, stats.median, histOpts);

                var chart = {
                    "data": {"values": data[0]},
                    "hconcat": [
                        {
                            "height": 300,
                            "width": 550,
                            "layer": [
                                {
                                    "mark": "bar",
                                    "encoding": {
                                        "x": {
                                            "field": "date",
                                            "type": "temporal",
                                            "axis": {"title": "Date", "labelAngle": 0}
                                        },
                                        "y": {
                                            "field": "count",
                                            "type": "quantitative",
                                            "axis": {
                                                "title": "# Street Audits per Day"
                                            }
                                        }
                                    }
                                },
                                { // creates lines marking summary statistics
                                    "data": {"values": [
                                        {"stat": "mean", "value": stats.mean}, {"stat": "median", "value": stats.median}]
                                    },
                                    "mark": "rule",
                                    "encoding": {
                                        "y": {
                                            "field": "value", "type": "quantitative",
                                            "axis": {"labels": false, "ticks": false, "title": ""},
                                            "scale": {"domain": [0, stats.max]}
                                        },
                                        "color": {
                                            "field": "stat", "type": "nominal", "scale": {"range": ["pink", "orange"]},
                                            "legend": false
                                        },
                                        "size": {
                                            "value": 1
                                        }
                                    }
                                }
                            ],
                            "resolve": {"y": {"scale": "independent"}}
                        },
                        hist
                    ],
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    }
                };
                vega.embed("#audit-count-chart", chart, opt, function(error, results) {});
            });
            $.getJSON("/userapi/labelCounts/all", function (data) {
                var stats = getSummaryStats(data[0], "count");
                $("#label-std").html((stats.std).toFixed(2) + " Labels");

                var histOpts = {xAxisTitle:"# Labels per Day", xDomain:[0, stats.max], width:250, binStep:200, legendOffset:-80};
                var hist = getVegaLiteHistogram(data[0], stats.mean, stats.median, histOpts);

                var chart = {
                    "data": {"values": data[0]},
                    "hconcat": [
                        {
                            "height": 300,
                            "width": 550,
                            "layer": [
                                {
                                    "mark": "bar",
                                    "encoding": {
                                        "x": {
                                            "field": "date",
                                            "type": "temporal",
                                            "axis": {"title": "Date", "labelAngle": 0}
                                        },
                                        "y": {
                                            "field": "count",
                                            "type": "quantitative",
                                            "axis": {
                                                "title": "# Labels per Day"
                                            }
                                        }
                                    }
                                },
                                { // creates lines marking summary statistics
                                    "data": {"values": [
                                            {"stat": "mean", "value": stats.mean}, {"stat": "median", "value": stats.median}]
                                    },
                                    "mark": "rule",
                                    "encoding": {
                                        "y": {
                                            "field": "value", "type": "quantitative",
                                            "axis": {"labels": false, "ticks": false, "title": ""},
                                            "scale": {"domain": [0, stats.max]}
                                        },
                                        "color": {
                                            "field": "stat", "type": "nominal", "scale": {"range": ["pink", "orange"]},
                                            "legend": false
                                        },
                                        "size": {
                                            "value": 2
                                        }
                                    }
                                }
                            ],
                            "resolve": {"y": {"scale": "independent"}}
                        },
                        hist
                    ],
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    }
                };
                vega.embed("#label-count-chart", chart, opt, function(error, results) {});
            });
            $.getJSON("/userapi/validationCounts/all", function (data) {
                var stats = getSummaryStats(data[0], "count");
                $("#validation-std").html((stats.std).toFixed(2) + " Validations");

                var histOpts = {xAxisTitle:"# Validations per Day", xDomain:[0, stats.max], width:250, binStep:200, legendOffset:-80};
                var hist = getVegaLiteHistogram(data[0], stats.mean, stats.median, histOpts);

                var chart = {
                    "data": {"values": data[0]},
                    "hconcat": [
                        {
                            "height": 300,
                            "width": 550,
                            "layer": [
                                {
                                    "mark": "bar",
                                    "encoding": {
                                        "x": {
                                            "field": "date",
                                            "type": "temporal",
                                            "axis": {"title": "Date", "labelAngle": 0}
                                        },
                                        "y": {
                                            "field": "count",
                                            "type": "quantitative",
                                            "axis": {
                                                "title": "# Validations per Day"
                                            }
                                        }
                                    }
                                },
                                { // creates lines marking summary statistics
                                    "data": {"values": [
                                            {"stat": "mean", "value": stats.mean}, {"stat": "median", "value": stats.median}]
                                    },
                                    "mark": "rule",
                                    "encoding": {
                                        "y": {
                                            "field": "value", "type": "quantitative",
                                            "axis": {"labels": false, "ticks": false, "title": ""},
                                            "scale": {"domain": [0, stats.max]}
                                        },
                                        "color": {
                                            "field": "stat", "type": "nominal", "scale": {"range": ["pink", "orange"]},
                                            "legend": false
                                        },
                                        "size": {
                                            "value": 2
                                        }
                                    }
                                }
                            ],
                            "resolve": {"y": {"scale": "independent"}}
                        },
                        hist
                    ],
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    }
                };
                vega.embed("#validation-count-chart", chart, opt, function(error, results) {});
            });
            $.getJSON("/adminapi/userMissionCounts", function (data) {
                var allData = data[0];
                var regData = allData.filter(user => user.role === 'Registered' || isResearcherRole(user.role));
                var anonData = allData.filter(user => user.role === 'Anonymous');
                var turkerData = allData.filter(user => user.role === 'Turker');

                var allStats = getSummaryStats(allData, "count");
                var allFilteredStats = getSummaryStats(allData, "count", {excludeResearchers: true});
                var regStats = getSummaryStats(regData, "count");
                var regFilteredStats = getSummaryStats(regData, "count", {excludeResearchers: true});
                var turkerStats = getSummaryStats(turkerData, "count");
                var anonStats = getSummaryStats(anonData, "count");

                var allHistOpts = {
                    xAxisTitle: "# Missions per User (all)", xDomain: [0, allStats.max], width: 187,
                    binStep: 15, legendOffset: -80
                };
                var allFilteredHistOpts = {
                    xAxisTitle: "# Missions per User (all)", xDomain: [0, allFilteredStats.max],
                    width: 187, binStep: 15, legendOffset: -80, excludeResearchers: true
                };
                var regHistOpts = {
                    xAxisTitle: "# Missions per Registered User", xDomain: [0, regStats.max], width: 187,
                    binStep: 10, legendOffset: -80
                };
                var regFilteredHistOpts = {
                    xAxisTitle: "# Missions per Registered User", width: 187, legendOffset: -80,
                    xDomain: [0, regFilteredStats.max], excludeResearchers: true, binStep: 10
                };
                var turkerHistOpts = {
                    xAxisTitle: "# Missions per Turker User", xDomain: [0, turkerStats.max], width: 187,
                    binStep: 15, legendOffset: -80
                };
                var anonHistOpts = {
                    xAxisTitle: "# Missions per Anon User", xDomain: [0, anonStats.max], width: 187,
                    binStep: 1, legendOffset: -80
                };

                var allChart = getVegaLiteHistogram(allData, allStats.mean, allStats.median, allHistOpts);
                var allFilteredChart = getVegaLiteHistogram(allData, allFilteredStats.mean, allFilteredStats.median, allFilteredHistOpts);
                var regChart = getVegaLiteHistogram(regData, regStats.mean, regStats.median, regHistOpts);
                var regFilteredChart = getVegaLiteHistogram(regData, regFilteredStats.mean, regFilteredStats.median, regFilteredHistOpts);
                var turkerChart = getVegaLiteHistogram(turkerData, turkerStats.mean, turkerStats.median, turkerHistOpts);
                var anonChart = getVegaLiteHistogram(anonData, anonStats.mean, anonStats.median, anonHistOpts);

                $("#missions-std").html((allFilteredStats.std).toFixed(2) + " Missions");
                $("#reg-missions-std").html((regFilteredStats.std).toFixed(2) + " Missions");
                $("#turker-missions-std").html((turkerStats.std).toFixed(2) + " Missions");
                $("#anon-missions-std").html((anonStats.std).toFixed(2) + " Missions");

                var combinedChart = {"hconcat": [allChart, turkerChart, regChart, anonChart]};
                var combinedChartFiltered = {"hconcat": [allFilteredChart, turkerChart, regFilteredChart, anonChart]};

                vega.embed("#mission-count-chart", combinedChartFiltered, opt, function (error, results) {
                });

                var checkbox = document.getElementById("mission-count-include-researchers-checkbox").addEventListener("click", function (cb) {
                    if (cb.srcElement.checked) {
                        $("#missions-std").html((allStats.std).toFixed(2) + " Missions");
                        $("#reg-missions-std").html((regStats.std).toFixed(2) + " Missions");
                        vega.embed("#mission-count-chart", combinedChart, opt, function (error, results) {
                        });
                    } else {
                        $("#missions-std").html((allFilteredStats.std).toFixed(2) + " Missions");
                        $("#reg-missions-std").html((regFilteredStats.std).toFixed(2) + " Missions");
                        vega.embed("#mission-count-chart", combinedChartFiltered, opt, function (error, results) {
                        });
                    }
                });
            });
            $.getJSON("/adminapi/labelCounts", function (data) {
                var allData = data[0];
                var regData = allData.filter(user => user.role === 'Registered' || isResearcherRole(user.role));
                var turkerData = allData.filter(user => user.role === 'Turker');
                var anonData = allData.filter(user => user.role === 'Anonymous');

                var allStats = getSummaryStats(allData, "count");
                var allFilteredStats = getSummaryStats(allData, "count", {excludeResearchers: true});
                var regStats = getSummaryStats(regData, "count");
                var regFilteredStats = getSummaryStats(regData, "count", {excludeResearchers: true});
                var turkerStats = getSummaryStats(turkerData, "count");
                var anonStats = getSummaryStats(anonData, "count");

                var allHistOpts = {
                    xAxisTitle: "# Labels per User (all)", xDomain: [0, allStats.max], width: 187,
                    binStep: 500, legendOffset: -80
                };
                var allFilteredHistOpts = {
                    xAxisTitle: "# Labels per User (all)", xDomain: [0, allFilteredStats.max],
                    width: 187, binStep: 500, legendOffset: -80, excludeResearchers: true
                };
                var regHistOpts = {
                    xAxisTitle: "# Labels per Registered User", xDomain: [0, regStats.max], width: 187,
                    binStep: 500, legendOffset: -80
                };
                var regFilteredHistOpts = {
                    xAxisTitle: "# Labels per Registered User", width: 187, legendOffset: -80,
                    xDomain: [0, regFilteredStats.max], excludeResearchers: true, binStep: 500
                };
                var turkerHistOpts = {
                    xAxisTitle: "# Labels per Turker User", xDomain: [0, turkerStats.max], width: 187,
                    binStep: 500, legendOffset: -80
                };
                var anonHistOpts = {
                    xAxisTitle: "# Labels per Anon User", xDomain: [0, anonStats.max],
                    width: 187, legendOffset: -80, binStep: 2
                };

                var allChart = getVegaLiteHistogram(allData, allStats.mean, allStats.median, allHistOpts);
                var allFilteredChart = getVegaLiteHistogram(allData, allFilteredStats.mean, allFilteredStats.median, allFilteredHistOpts);
                var regChart = getVegaLiteHistogram(regData, regStats.mean, regStats.median, regHistOpts);
                var regFilteredChart = getVegaLiteHistogram(regData, regFilteredStats.mean, regFilteredStats.median, regFilteredHistOpts);
                var turkerChart = getVegaLiteHistogram(turkerData, turkerStats.mean, turkerStats.median, turkerHistOpts);
                var anonChart = getVegaLiteHistogram(anonData, anonStats.mean, anonStats.median, anonHistOpts);

                $("#all-labels-std").html((allFilteredStats.std).toFixed(2) + " Labels");
                $("#reg-labels-std").html((regFilteredStats.std).toFixed(2) + " Labels");
                $("#turker-labels-std").html((turkerStats.std).toFixed(2) + " Labels");
                $("#anon-labels-std").html((anonStats.std).toFixed(2) + " Labels");

                var combinedChart = {"hconcat": [allChart, turkerChart, regChart, anonChart]};
                var combinedChartFiltered = {"hconcat": [allFilteredChart, turkerChart, regFilteredChart, anonChart]};

                vega.embed("#label-count-hist", combinedChartFiltered, opt, function (error, results) {
                });

                var checkbox = document.getElementById("label-count-include-researchers-checkbox").addEventListener("click", function (cb) {
                    if (cb.srcElement.checked) {
                        $("#all-labels-std").html((allStats.std).toFixed(2) + " Labels");
                        $("#reg-labels-std").html((regStats.std).toFixed(2) + " Labels");
                        vega.embed("#label-count-hist", combinedChart, opt, function (error, results) {
                        });
                    } else {
                        $("#all-labels-std").html((allFilteredStats.std).toFixed(2) + " Labels");
                        $("#reg-labels-std").html((regFilteredStats.std).toFixed(2) + " Labels");
                        vega.embed("#label-count-hist", combinedChartFiltered, opt, function (error, results) {
                        });
                    }
                });
            });
            $.getJSON("/adminapi/validationCounts", function (data) {
                var allData = data[0];
                var regData = allData.filter(user => user.role === 'Registered' || isResearcherRole(user.role));
                var turkerData = allData.filter(user => user.role === 'Turker');
                var anonData = allData.filter(user => user.role === 'Anonymous');

                var allStats = getSummaryStats(allData, "count");
                var allFilteredStats = getSummaryStats(allData, "count", {excludeResearchers: true});
                var regStats = getSummaryStats(regData, "count");
                var regFilteredStats = getSummaryStats(regData, "count", {excludeResearchers: true});
                var turkerStats = getSummaryStats(turkerData, "count");
                var anonStats = getSummaryStats(anonData, "count");

                var allHistOpts = {
                    xAxisTitle: "# Validations per User (all)", xDomain: [0, allStats.max], width: 187,
                    binStep: 50, legendOffset: -80
                };
                var allFilteredHistOpts = {
                    xAxisTitle: "# Validations per User (all)", xDomain: [0, allFilteredStats.max],
                    width: 187, binStep: 50, legendOffset: -80, excludeResearchers: true
                };
                var regHistOpts = {
                    xAxisTitle: "# Validations per Registered User", xDomain: [0, regStats.max], width: 187,
                    binStep: 50, legendOffset: -80
                };
                var regFilteredHistOpts = {
                    xAxisTitle: "# Validations per Registered User", width: 187, legendOffset: -80,
                    xDomain: [0, regFilteredStats.max], excludeResearchers: true, binStep: 50
                };
                var turkerHistOpts = {
                    xAxisTitle: "# Validations per Turker User", xDomain: [0, turkerStats.max], width: 187,
                    binStep: 50, legendOffset: -80
                };
                var anonHistOpts = {
                    xAxisTitle: "# Validations per Anon User", xDomain: [0, anonStats.max],
                    width: 187, legendOffset: -80, binStep: 2
                };

                var allChart = getVegaLiteHistogram(allData, allStats.mean, allStats.median, allHistOpts);
                var allFilteredChart = getVegaLiteHistogram(allData, allFilteredStats.mean, allFilteredStats.median, allFilteredHistOpts);
                var regChart = getVegaLiteHistogram(regData, regStats.mean, regStats.median, regHistOpts);
                var regFilteredChart = getVegaLiteHistogram(regData, regFilteredStats.mean, regFilteredStats.median, regFilteredHistOpts);
                var turkerChart = getVegaLiteHistogram(turkerData, turkerStats.mean, turkerStats.median, turkerHistOpts);
                var anonChart = getVegaLiteHistogram(anonData, anonStats.mean, anonStats.median, anonHistOpts);

                $("#all-validation-std").html((allFilteredStats.std).toFixed(2) + " Validations");
                $("#reg-validation-std").html((regFilteredStats.std).toFixed(2) + " Validations");
                $("#turker-validation-std").html((turkerStats.std).toFixed(2) + " Validations");
                $("#anon-validation-std").html((anonStats.std).toFixed(2) + " Validations");

                var combinedChart = {"hconcat": [allChart, turkerChart, regChart, anonChart]};
                var combinedChartFiltered = {"hconcat": [allFilteredChart, turkerChart, regFilteredChart, anonChart]};

                vega.embed("#validation-count-hist", combinedChartFiltered, opt, function (error, results) {
                });

                var checkbox = document.getElementById("validation-count-include-researchers-checkbox").addEventListener("click", function (cb) {
                    if (cb.srcElement.checked) {
                        $("#all-validation-std").html((allStats.std).toFixed(2) + " Validations");
                        $("#reg-validation-std").html((regStats.std).toFixed(2) + " Validations");
                        vega.embed("#validation-count-hist", combinedChart, opt, function (error, results) {
                        });
                    } else {
                        $("#all-validation-std").html((allFilteredStats.std).toFixed(2) + " Validations");
                        $("#reg-validation-std").html((regFilteredStats.std).toFixed(2) + " Validations");
                        vega.embed("#validation-count-hist", combinedChartFiltered, opt, function (error, results) {
                        });
                    }
                });
            });
            $.getJSON("/adminapi/allSignInCounts", function (data) {
                var stats = getSummaryStats(data[0], "count");
                var filteredStats = getSummaryStats(data[0], "count", {excludeResearchers:true});
                var histOpts = {xAxisTitle:"# Logins per Registered User", binStep:5, xDomain:[0, stats.max]};
                var histFilteredOpts = {xAxisTitle:"# Logins per Registered User", xDomain:[0, filteredStats.max],
                                        excludeResearchers:true};

                var chart = getVegaLiteHistogram(data[0], stats.mean, stats.median, histOpts);
                var filteredChart = getVegaLiteHistogram(data[0], filteredStats.mean, filteredStats.median, histFilteredOpts);

                $("#login-count-std").html((filteredStats.std).toFixed(2) + " Logins");
                vega.embed("#login-count-chart", filteredChart, opt, function(error, results) {});

                var checkbox = document.getElementById("login-count-include-researchers-checkbox").addEventListener("click", function(cb) {
                    if (cb.srcElement.checked) {
                        $("#login-count-std").html((stats.std).toFixed(2) + " Logins");
                        vega.embed("#login-count-chart", chart, opt, function (error, results) {});
                    } else {
                        $("#login-count-std").html((filteredStats.std).toFixed(2) + " Logins");
                        vega.embed("#login-count-chart", filteredChart, opt, function(error, results) {});
                    }
                });
            });

            // Creates chart showing how many audit page visits there are, how many people click via choropleth, how
            // many click "start exploring" on navbar, and how many click "start exploring" on the landing page itself.
            $.getJSON("/adminapi/webpageActivity/Visit_Audit", function(visitAuditEvents){
            $.getJSON("/adminapi/webpageActivity/Click/module=StartExploring/location=Index", function(clickStartExploringMainIndexEvents){
            $.getJSON("/adminapi/webpageActivity/Click/module=Choropleth/target=audit", function(choroplethClickEvents){
            $.getJSON("/adminapi/webpageActivity/Referrer=mturk", function(turkerRedirectEvents){
            // YES, we encode twice. This solves an issue with routing on the test/production server. AdminController.scala decodes twice.
            $.getJSON("/adminapi/webpageActivity/Click/module=StartExploring/location=Navbar/"+encodeURIComponent(encodeURIComponent("route=/")), function(clickStartExploringNavIndexEvents){
            $.getJSON("/adminapi/webpageActivity/Click/module=StartMapping/location=Navbar/"+encodeURIComponent(encodeURIComponent("route=/")), function(clickStartMappingNavIndexEvents){
                // Only consider events that take place after all logging was merged (timestamp equivalent to July 20, 2017 17:02:00)
                // TODO switch this to make use of versioning on the backend once it is implemented...
                // See: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/653
                var numVisitAudit = visitAuditEvents[0].filter(function(event){
                    return event.timestamp > 1500584520000;
                }).length;
                var numClickStartMappingMainIndex = clickStartExploringMainIndexEvents[0].filter(function(event){
                    return event.timestamp > 1500584520000;
                }).length;
                var numChoroplethClicks = choroplethClickEvents[0].filter(function(event){
                    return event.timestamp > 1500584520000;
                }).length;
                var numTurkerRedirects = turkerRedirectEvents[0].filter(function(event){
                    return event.timestamp > 1500584520000;
                }).length;
                var numClickStartMappingNavIndex = clickStartMappingNavIndexEvents[0].concat(clickStartExploringNavIndexEvents[0]).filter(function(event){
                    return event.timestamp > 1500584520000;
                }).length;

                // Fill in values in "How users access Audit Page from Landing Page:" table
                $("#audit-access-table-start-main").append(
                    '<td style="text-align: right;">'+
                        numClickStartMappingMainIndex+
                    '</td>'+
                    '<td style="text-align: right;">'+
                        (parseInt(numClickStartMappingMainIndex)/parseInt(numVisitAudit)*100).toFixed(1)+'%'+
                    '</td>'
                );
                $("#audit-access-table-start-nav").append(
                    '<td style="text-align: right;">'+
                        numClickStartMappingNavIndex+
                    '</td>'+
                    '<td style="text-align: right;">'+
                        (parseInt(numClickStartMappingNavIndex)/parseInt(numVisitAudit)*100).toFixed(1)+'%'+
                    '</td>'
                );
                $("#audit-access-table-choro").append(
                    '<td style="text-align: right;">'+
                    numChoroplethClicks+
                    '</td>'+
                    '<td style="text-align: right;">'+
                    (parseInt(numChoroplethClicks)/parseInt(numVisitAudit)*100).toFixed(1)+'%'+
                    '</td>'
                );
                $("#audit-access-table-turker").append(
                    '<td style="text-align: right;">'+
                    numTurkerRedirects+
                    '</td>'+
                    '<td style="text-align: right;">'+
                    (parseInt(numTurkerRedirects)/parseInt(numVisitAudit)*100).toFixed(1)+'%'+
                    '</td>'
                );
                $("#audit-access-table-total").append(
                    '<td style="text-align: right;">'+
                        numVisitAudit+
                    '</td>'+
                    '<td style="text-align: right;">'+
                        '100.0%'+
                    '</td>'
                );
            });
            });
            });
            });
            });
            });
            self.graphsLoaded = true;
        }
    });

    function changeRole(e){
        var userId = $(this).parent() // <li>
            .parent() // <ul>
            .siblings('button')
            .attr('id')
            .substring("userRoleDropdown".length); // userId is stored in id of dropdown
        var newRole = this.innerText;
        
        data = {
            'user_id': userId,
            'role_id': newRole
        };
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: '/adminapi/setRole',
            type: 'put',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                // Change dropdown button to reflect new role
                var button = $('#userRoleDropdown' + result.user_id);
                var buttonContents = button.html();
                var newRole = result.role;
                button.html(buttonContents.replace(/Registered|Turker|Researcher|Administrator|Anonymous/g, newRole));
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    function clearPlayCache() {
        $.ajax( {
            url: '/adminapi/clearPlayCache',
            type: 'put',
            success: function () {
                clearPlayCacheSuccess.innerHTML = i18next.t("admin-clear-play-cache");
            }
        } )
    }

    initializeLabelTable();
    initializeAdminLabelSearch();

    self.clearPlayCache = clearPlayCache;

    $('.change-role').on('click', changeRole);

    return self;
}
