describe("ModalMissionCompleteMap", function () {
    var $uiModalMissionCompleteFixture;
    var neighborhood;
    var mission;
    var map;
    var uiModalMissionComplete;

    // Mocks
    function MissionMock () {
        this.properties = {
            coverage: null,
            label: null,
            distance: null
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
        $uiModalMissionCompleteFixture = $('<div id="modal-mission-complete-map"></div>');

        uiModalMissionComplete = {};
        uiModalMissionComplete.map = $uiModalMissionCompleteFixture;

        this.uiModalMissionComplete = uiModalMissionComplete;
        
        map = new ModalMissionCompleteMap(uiModalMissionComplete);
        
        mission = new MissionMock();
        mission.properties.distance = 1219.2;
        mission.properties.coverage = 0.07575;
        mission.properties.label = "distance-mission";
        neighborhood = new NeighborhoodMock();
        neighborhood.properties.name = "Test Neighborhood";
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
    });

    describe("ModalMissionCompleteMap object declaration", function () {
      it("should initialize attributes", function () {
        expect(map).not.toBe(null);
        expect(map._southWest).not.toBe(null);
        expect(map._northEast).not.toBe(null);
        expect(map._bound).not.toBe(null);
        expect(map._map).not.toBe(null);
        expect(map._overlayPolygon).toBe(null);
        expect(map._overlayPolygonLayer).toBe(null);
        expect(map._ui).not.toBe(null);
      });
    });

    describe("linestringToPoint method", function(){
        it("should convert FeatureCollection of LineString to FeatureCollection of Point", function() {
          // GeoJSON FeatureCollection of LineStrings
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
            expect(p.type).toBe('FeatureCollection');
            expect(p.features[0].geometry.type).toBe('Point');
        });
    });

    describe("`show` method", function () {
        it("should open a modal window", function () {
          expect(uiModalMissionComplete).not.toBe(null);
            map.hide();
            expect(map._ui.map.css('top')).toBe('500px');
            expect(map._ui.map.css('left')).toBe('-500px');

            map.show();
            expect(map._ui.map.css('top')).toBe('0px');
            expect(map._ui.map.css('left')).toBe('15px');
        });

        it("should create map overlays", function (){
            map.show();
            var leafletOverlayPane = $('.leaflet-overlay-pane');
            expect(leafletOverlayPane).not.toBe(null);
            map.hide();
        });
    });

    describe("updateStreetSegments method", function () {
        beforeEach(function (done) {
            var len;
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
            // pause for segements to render
            setTimeout(function () {done();}, 3000);
          });

        it("should visualize segments", function () {
          expect(uiModalMissionComplete.map.find(".leaflet-zoom-hide").length).not.toBe(0);
          map.hide();
        });
    });

    describe("update method", function (){
        beforeEach(function (done) {
          map.show();
          map.update(mission, neighborhood);
          // pause for map animation to run
          setTimeout(function () {done();}, 1000);
        });
        it("should render a neighborhood", function () {
            expect(map._overlayPolygonLayer).not.toBe(undefined);
            expect(map._overlayPolygonLayer._layers).not.toBe(undefined);
            
            var layer = map._overlayPolygonLayer._layers;
            // leaflet assigns the layer an id which can be different
            for(var key in layer){
              var layerStyles = layer[key].options;
              expect(layerStyles.fillColor).toBe('rgb(110, 110, 110)');
              expect(layerStyles.opacity).toBe(0);
              expect(layerStyles.fillOpacity).toBe(0.25);
            }
            map.hide();
        });
    });
});
