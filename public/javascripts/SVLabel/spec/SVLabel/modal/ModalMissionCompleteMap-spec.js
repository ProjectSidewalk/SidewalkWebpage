describe("ModalMissionCompleteMap", function () {
    var modal;
    var uiModalMissionComplete;
    var $uiModalMissionCompleteFixture;
    var missionContainerMock;
    var modalMissionCompleteMapMock;
    var neighborhood;
    var mission;
    var map;

    // Mocks
    function MissionMock () {
        this.properties = {
            coverage: null,
            label: null,
            distance: null,
            distanceFt: null,
            distanceMi: null
        };
    }
    MissionMock.prototype.getProperty = function (key) {
        return this.properties[key];
    };

    function NeighborhoodMock() {
        this.properties = {
            name: null,
            regionId: null,
            center: null,
            geoJSON: null
        };
    }
    NeighborhoodMock.prototype.getProperty = function (key) {
        return this.properties[key];
    };
    NeighborhoodMock.prototype.center = function () {
        return this.properties.center;
    };
    NeighborhoodMock.prototype.getGeoJSON = function () {
        return this.properties.geoJSON;
    };

    function TaskContainerMock(){
        this.properties = {};
    }

    function TaskMock() {
        this.properties = {
            streetEdgeId: null,
            feature: null
        };
    } 

    TaskMock.prototype.getStreetEdgeId = function () {
        return this.properties.streetEdgeId;
    };

    TaskMock.prototype.getFeature = function () {
        return this.properties.feature;
    };

    TaskMock.prototype.getGeoJSON = function () {
        var geoJSON = {
            "type":"FeatureCollection",
            "features": [this.properties.feature]
        };
        return geoJSON;
    };

    beforeEach(function () {
        $uiModalMissionCompleteFixture = $('<div id="modal-mission-complete-holder"> \
        <div id="modal-mission-complete-background" class="modal-background"></div> \
        <div id="modal-mission-complete-foreground" class="modal-foreground"> \
        <h1>Mission Complete! <span class="normal" id="modal-mission-complete-title"></span></h1> \
        <div class="row"> \
            <div class="mapbox col-sm-7"> \
                <div id="modal-mission-complete-map"></div> \
                <div id="map-legend"> \
                    <span><svg class="legend-label" width="15" height="10"><rect width="15" height="10" id="green-square"></svg> This Mission</span><br> \
                    <span><svg class="legend-label" width="15" height="10"><rect width="15" height="10" id="blue-square"></svg> Previous Missions</span> \
                </div> \
            </div> \
            <div class="col-sm-5"> \
                <p><span id="modal-mission-complete-message"></span></p> \
                <h3>Mission Labels</h3> \
                <table class="table"> \
                    <tr> \
                        <th class="width-50-percent">Curb Ramp</th> \
                        <td id="modal-mission-complete-curb-ramp-count" class="col-right"></td> \
                    </tr> \
                    <tr> \
                        <th>Missing Curb Ramp</th> \
                        <td id="modal-mission-complete-no-curb-ramp-count" class="col-right"></td> \
                    </tr> \
                    <tr> \
                        <th>Obstacle in Path</th> \
                        <td id="modal-mission-complete-obstacle-count" class="col-right"></td> \
                    </tr> \
                    <tr> \
                        <th>Surface Problem</th> \
                        <td id="modal-mission-complete-surface-problem-count" class="col-right"></td> \
                    </tr> \
                    <tr> \
                        <th>Other</th> \
                        <td id="modal-mission-complete-other-count" class="col-right"></td> \
                    </tr> \
                </table> \
                <h3>Neighborhood Progress</h3> \
                <div id="modal-mission-complete-complete-bar"></div> \
                <table class="table"> \
                <tr> \
                    <th>Audited in this mission</th> \
                    <td id="modal-mission-complete-mission-distance" class="col-right"></td> \
                </tr> \
                <tr> \
                    <th>Audited in this neighborhood</th> \
                    <td id="modal-mission-complete-total-audited-distance" class="col-right"></td> \
                </tr> \
                <tr> \
                    <th>Remaining in this neighborhood</th> \
                    <td id="modal-mission-complete-remaining-distance" class="col-right"></td> \
                </tr> \
            </table> \
            <button class="btn blue-btn" id="modal-mission-complete-close-button">Continue</button> \
            </div> \
        </div> \
        </div> \
        </div>');

        $('body').append($uiModalMissionCompleteFixture);

        uiModalMissionComplete = {};
        uiModalMissionComplete.holder = $uiModalMissionCompleteFixture;
        uiModalMissionComplete.foreground = $uiModalMissionCompleteFixture.find("#modal-mission-complete-foreground");
        uiModalMissionComplete.background = $uiModalMissionCompleteFixture.find("#modal-mission-complete-background");
        uiModalMissionComplete.missionTitle = $uiModalMissionCompleteFixture.find("#modal-mission-complete-title");
        uiModalMissionComplete.message = $uiModalMissionCompleteFixture.find("#modal-mission-complete-message");
        uiModalMissionComplete.map = $uiModalMissionCompleteFixture.find("#modal-mission-complete-map");
        uiModalMissionComplete.closeButton = $uiModalMissionCompleteFixture.find("#modal-mission-complete-close-button");
        uiModalMissionComplete.totalAuditedDistance = $uiModalMissionCompleteFixture.find("#modal-mission-complete-total-audited-distance");
        uiModalMissionComplete.missionDistance = $uiModalMissionCompleteFixture.find("#modal-mission-complete-mission-distance");
        uiModalMissionComplete.remainingDistance = $uiModalMissionCompleteFixture.find("#modal-mission-complete-remaining-distance");
        uiModalMissionComplete.curbRampCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-curb-ramp-count");
        uiModalMissionComplete.noCurbRampCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-no-curb-ramp-count");
        uiModalMissionComplete.obstacleCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-obstacle-count");
        uiModalMissionComplete.surfaceProblemCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-surface-problem-count");
        uiModalMissionComplete.otherCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-other-count");

        this.uiModalMissionComplete = uiModalMissionComplete;
        modalMissionCompleteMapMock = {
            hide: function () {},
            show: function () {}
        };
        taskContainerMock = new TaskContainerMock();
        modal = new ModalMissionComplete($, d3, L, missionContainerMock, taskContainerMock, modalMissionCompleteMapMock, uiModalMissionComplete, Backbone.Events);
        if(!map){
            map = new ModalMissionCompleteMap(uiModalMissionComplete);
        }
        mission = new MissionMock();
        mission.properties.distanceMi = 0.7575;
        mission.properties.distance = 1219.2;
        mission.properties.distanceFt = 4000;
        mission.properties.coverage = 0.07575;
        mission.properties.auditDistanceFt = 2000;
        mission.properties.auditDistanceMi = 0.3788;
        mission.properties.auditDistance = 609;
        mission.properties.label = "distance-mission";
        neighborhood = new NeighborhoodMock();
        neighborhood.properties.name = "Test Neighborhood";
    });

    

    describe("linestringToPoint method", function(){
        it("should convert LineString to Point GeoJSON", function() {
            var c = {"type":"FeatureCollection",
                        "features":[
                        {"type":"Feature","geometry":{"type":"LineString",
                        "coordinates":[
                        [-77.041402,38.8764389],
                        [-77.059005,38.8864323],
                        [-77.063005,38.8864250],
                        [-77.063005,38.8964180],
                        [-77.069005,38.8964180]
                        ]
                        }},
                        {"type":"Feature","geometry":{"type":"LineString",
                        "coordinates":[
                        [-77.069005,38.9164120],
                        [-77.075005,38.9164120],
                        [-77.075005,38.9364080],
                        [-77.092005,38.9564080]
                        ]
                        }}
                        ]
                    };
            var p = map._linestringToPoint(c);
            expect(p.features[0].geometry.type).toBe('Point');
        });
    });

    describe("`show` method", function () {
        it("should open a modal window", function () {
            map.hide();
            expect(map._ui.map.css('top')).toBe('500px');
            expect(map._ui.map.css('left')).toBe('-500px');

            map.show();
            expect(map._ui.map.css('top')).toBe('0px');
            expect(map._ui.map.css('left')).toBe('15px');
        });

        it("should create map overlays", function (){
            modal.show(mission, neighborhood);
            var leafletOverlayPane = $('.leaflet-overlay-pane');
            expect(leafletOverlayPane).not.toBe(null);
        });
    });

    describe("updateStreetSegments method", function () {
        it("should visualize segments", function () {
            var len;
            var m = Mission({'regionId': 341, 'distanceMi': 1.2});
            var completedTaskGeoJSONList = [
                  {
                     "type":"Feature",
                     "geometry":{
                        "type":"LineString",
                        "coordinates":[
                           [
                              -77.0345804,
                              38.9026435
                           ],
                           [
                              -77.15,
                              38.9026425
                           ]
                        ]
                     },
                     "properties":{
                        "street_edge_id":26392,
                        "x1":-77.03458404541016,
                        "y1":38.902645111083984,
                        "x2":-77.03369140625,
                        "y2":38.90264129638672,
                        "task_start":"2016-07-29 12:37:03.347",
                        "completed":false
                     }  
                },
                {
                   "type":"Feature",
                   "geometry":{
                      "type":"LineString",
                      "coordinates":[
                         [
                            -76.956585,
                            38.893561
                         ],
                         [
                            -76.956577,
                            38.894767
                         ]
                      ]
                   },
                   "properties":{
                      "street_edge_id":1853,
                      "x1":-76.95657348632812,
                      "y1":38.89476776123047,
                      "x2":-76.95658874511719,
                      "y2":38.89356231689453,
                      "task_start":"2015-11-16 23:20:19.46",
                      "completed":false
                   }
            }];
            var missionTaskGeoJSONList = [
                {
                "type":"Feature",
               "geometry":{
                  "type":"LineString",
                  "coordinates":[
                     [
                        -76.9574863,
                        38.8965631
                     ],
                     [
                        -76.9562874,
                        38.8963878
                     ],
                     [
                        -76.9549743,
                        38.8961824
                     ],
                     [
                        -76.9527683,
                        38.8958242
                     ],
                     [
                        -76.9503329,
                        38.895415
                     ],
                     [
                        -76.94929,
                        38.8952549
                     ],
                     [
                        -76.9491136,
                        38.8951775
                     ]
                  ]
               },
               "properties":{
                  "street_edge_id":25004,
                  "x1":-76.94911193847656,
                  "y1":38.89517593383789,
                  "x2":-76.95748901367188,
                  "y2":38.89656448364258,
                  "task_start":"2015-11-16 23:20:19.46",
                  "completed":false
               }
            }
            ];
            var missionTasks = [];
            var completedTasks = [];
            len = completedTaskGeoJSONList.length;
            for(var i = 0; i < len; i ++){
                var task = new TaskMock();
                task.properties.feature = completedTaskGeoJSONList[i];
                task.properties.streetEdgeId = completedTaskGeoJSONList[i].properties.street_edge_id;
                completedTasks.push(task);
            }
            len = missionTaskGeoJSONList.length;
            for(var i = 0; i < len; i ++){
                var task = new TaskMock();
                task.properties.feature = missionTaskGeoJSONList[i];
                task.properties.streetEdgeId = missionTaskGeoJSONList[i].properties.street_edge_id;
                missionTasks.push(task);
            }
            map.show();
            map.updateStreetSegments(missionTasks, completedTasks);
            expect($(".leaflet-zoom-hide").length).not.toBe(0);
            map.hide();

        });
    });
    describe("update method", function (){
        it("should render a neighborhood", function () {
            neighborhood.properties.geoJSON = {
               "type":"Feature",
               "properties":{

               },
               "geometry":{
                  "type":"Polygon",
                  "coordinates":[
                     [
                        [
                           -76.9238,
                           38.9035
                        ],
                        [
                           -76.9239,
                           38.9032
                        ],
                        [
                           -76.9240,
                           38.9028
                        ]
                     ]
                  ]
               }
            };
            map.update(neighborhood);
            expect(true).toBe(true);
        });
    });
});