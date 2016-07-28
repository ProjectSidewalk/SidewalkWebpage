describe("Test for the ModalMissionComplete module.", function () {
   
        this.svl = svl || {};
        this.svl.ui = {};
        this.svl.ui.modalMissionComplete = {};
        // Modal Mission Complete

        // jQuery to mimic the DOM of the mission complete modal section of audit.scala.html
        $('<div>').addClass('container').appendTo('body');
        $('<div>').attr('id','svl-application-holder').appendTo('.container');
        $('<div>').attr('id', 'modal-mission-complete-holder').appendTo('#svl-application-holder');
        $('<div>').addClass('modal-background').attr('id','modal-mission-complete-background').appendTo('#modal-mission-complete-holder');
        $('<div>').addClass('modal-foreground').attr('id','modal-mission-complete-foreground').appendTo('#modal-mission-complete-holder');
        var $fg = $('#modal-mission-complete-foreground');
        $('<span>').addClass('normal').attr('id', 'modal-mission-complete-title').appendTo($fg);
        $('<div>').addClass('row').appendTo($fg);
        $('<div>').addClass('mapbox').addClass('col-sm-7').appendTo('.row');
        $('<div>').attr('id', 'modal-mission-complete-map').appendTo('.mapbox');
        $('<div>').addClass('col-sm-5').appendTo('.row');
        var $p = $('<p>');
        $('<span>').attr('id', 'modal-mission-complete-message').appendTo($p);
        $p.appendTo('.col-sm-5');
        // build table
        var $t1 = $('<table>').addClass('table').appendTo('.col-sm-5');
        var $tr = $('<tr>');
        $('<th>').appendTo($tr);
        $('<td>').addClass('col-right').attr('id', 'modal-mission-complete-curb-ramp-count').appendTo($tr);
        $tr.appendTo($t1);
        var $tr = $('<tr>');
        $('<th>').appendTo($tr);
        $('<td>').addClass('col-right').attr('id', 'modal-mission-complete-no-curb-ramp-count').appendTo($tr);
        $tr.appendTo($t1);
        var $tr = $('<tr>');
        $('<th>').appendTo($tr);
        $('<td>').addClass('col-right').attr('id', 'modal-mission-complete-obstacle-count').appendTo($tr);
        $tr.appendTo($t1);
        var $tr = $('<tr>');
        $('<th>').appendTo($tr);
        $('<td>').addClass('col-right').attr('id', 'modal-mission-complete-surface-problem-count').appendTo($tr);
        $tr.appendTo($t1);
        var $tr = $('<tr>');
        $('<th>').appendTo($tr);
        $('<td>').addClass('col-right').attr('id', 'modal-mission-complete-other-count').appendTo($tr);
        $tr.appendTo($t1);
        $t1.appendTo('.col-sm-5');

        $('<div>').attr('id', 'modal-mission-complete-complete-bar').appendTo('.col-sm-5');

        var $t2 = $('<table>').addClass('table').appendTo('.col-sm-5');
        var $tr = $('<tr>');
        $('<th>').appendTo($tr);
        $('<td>').addClass('col-right').attr('id', 'modal-mission-complete-mission-distance').appendTo($tr);
        $tr.appendTo($t2);
        var $tr = $('<tr>');
        $('<th>').appendTo($tr);
        $('<td>').addClass('col-right').attr('id', 'modal-mission-complete-total-audited-distance').appendTo($tr);
        $tr.appendTo($t2);
        var $tr = $('<tr>');
        $('<th>').appendTo($tr);
        $('<td>').addClass('col-right').attr('id', 'modal-mission-complete-remaining-distance').appendTo($tr);
        $tr.appendTo($t2);
        $t2.appendTo('.col-sm-5');
        var $b = $('<button>').addClass('btn').addClass('blue-btn').attr('id', 'modal-mission-complete-close-button');
        $b.appendTo('.col-sm-5');

        this.svl.ui.modalMissionComplete.map = $("#modal-mission-complete-map");
        this.svl.ui.modalMissionComplete.foreground = $("#modal-mission-complete-foreground");
        this.svl.ui.modalMissionComplete.background = $("#modal-mission-complete-background");
        this.svl.ui.modalMissionComplete.closeButton = $("#modal-mission-complete-close-button");
        this.svl.ui.modalMissionComplete.holder = $("#modal-mission-complete-holder");
        this.svl.ui.modalMissionComplete.missionTitle = $("#modal-mission-complete-title");
        this.svl.ui.modalMissionComplete.message = $("#modal-mission-complete-message");
        this.svl.ui.modalMissionComplete.totalAuditedDistance = $("#modal-mission-complete-total-audited-distance");
        this.svl.ui.modalMissionComplete.missionDistance = $("#modal-mission-complete-mission-distance");
        this.svl.ui.modalMissionComplete.remainingDistance = $("#modal-mission-complete-remaining-distance");
        this.svl.ui.modalMissionComplete.curbRampCount = $("#modal-mission-complete-curb-ramp-count");
        this.svl.ui.modalMissionComplete.noCurbRampCount = $("#modal-mission-complete-no-curb-ramp-count");
        this.svl.ui.modalMissionComplete.obstacleCount = $("#modal-mission-complete-obstacle-count");
        this.svl.ui.modalMissionComplete.surfaceProblemCount = $("#modal-mission-complete-surface-problem-count");
        this.svl.ui.modalMissionComplete.otherCount = $("#modal-mission-complete-other-count");

        this.svl.modalMissionComplete = ModalMissionComplete($, d3, L);
        //this.svl.modalMissionComplete = ModalMissionComplete.bind(this,[$, d3, L]);
        


    it("Test setMissionTitle()", function(){
        expect(svl.ui.modalMissionComplete.missionTitle.html()).toBe('');
        svl.modalMissionComplete.setMissionTitle("Test Title");
        expect(svl.ui.modalMissionComplete.missionTitle.html()).toBe("Test Title");
    });

    it("Test updateTheMissionCompleteMessage()", function(){
        expect(svl.ui.modalMissionComplete.message.html()).toBe('');
        svl.modalMissionComplete.updateTheMissionCompleteMessage();
        expect(svl.ui.modalMissionComplete.message.html()).not.toBe("");
    });

    it("Test show()", function(){
        // all this needs to  be initialized because it is referenced inside show()
        svl.neighborhoodContainer = NeighborhoodContainer($);
        svl.neighborhoodFactory = NeighborhoodFactory();
        var mission = Mission({'regionId': 341, 'distanceMi': 1.2});
        var neighborhoodCoordinates = {
            "type": "FeatureCollection",
            "features": [{
           "type":"Feature",
           "geometry":{
              "type":"Polygon",
              "coordinates":[
                 [
                    [
                       -76.95656026884599,
                       38.89034878689882
                    ],
                    [
                       -76.95676726947781,
                       38.88979078628105
                    ],
                    [
                       -76.95742626940972,
                       38.8897897868532
                    ],
                    [
                       -76.95815726925626,
                       38.889794787141746
                    ],
                    [
                       -76.95834627074952,
                       38.889778787122374
                    ],
                    [
                       -76.95866826977655,
                       38.88979378671661
                    ],
                    [
                       -76.95885627049897,
                       38.88979278671867
                    ],
                    [
                       -76.9591742705137,
                       38.889796786532486
                    ],
                    [
                       -76.9597962700566,
                       38.88980378726053
                    ],
                    [
                       -76.96244927164831,
                       38.8898037862732
                    ],
                    [
                       -76.9626342716392,
                       38.88980178661935
                    ],
                    [
                       -76.96338427140917,
                       38.88980378694471
                    ],
                    [
                       -76.96299027146661,
                       38.891638786618984
                    ],
                    [
                       -76.962398271403,
                       38.89377678719512
                    ],
                    [
                       -76.9618642714893,
                       38.89530778754623
                    ],
                    [
                       -76.9617572705644,
                       38.89672778826547
                    ],
                    [
                       -76.96178227102338,
                       38.897077787796086
                    ],
                    [
                       -76.96118427146251,
                       38.897018788530474
                    ],
                    [
                       -76.96026427059572,
                       38.89692678870559
                    ],
                    [
                       -76.96005127087871,
                       38.896902787591166
                    ],
                    [
                       -76.95998727103576,
                       38.896896788074656
                    ],
                    [
                       -76.95992627105429,
                       38.89688478772818
                    ],
                    [
                       -76.9598492701632,
                       38.896878787616814
                    ],
                    [
                       -76.95916727059247,
                       38.896773787875105
                    ],
                    [
                       -76.95837626976,
                       38.89665378809689
                    ],
                    [
                       -76.95766026949335,
                       38.896560787971666
                    ],
                    [
                       -76.95758927025074,
                       38.89655678783945
                    ],
                    [
                       -76.95749727026131,
                       38.89654478847812
                    ],
                    [
                       -76.95722327064067,
                       38.8965037876698
                    ],
                    [
                       -76.95619927037524,
                       38.89632078835903
                    ],
                    [
                       -76.95480526966008,
                       38.8961027880765
                    ],
                    [
                       -76.9522912681686,
                       38.89600878886908
                    ],
                    [
                       -76.9521812692053,
                       38.89574678843148
                    ],
                    [
                       -76.95218726811704,
                       38.89568078826051
                    ],
                    [
                       -76.95195026820932,
                       38.89564378823933
                    ],
                    [
                       -76.95179126833831,
                       38.895617787640035
                    ],
                    [
                       -76.95135926802796,
                       38.89554978850132
                    ],
                    [
                       -76.9537152683332,
                       38.89340978714005
                    ],
                    [
                       -76.95656026884599,
                       38.89034878689882
                    ]
                 ]
              ]
           }
            }]
        };
        var polygonLayer = L.geoJson(neighborhoodCoordinates);
        var params = { regionId: 341 , regionLayer: polygonLayer , regionName: "nowhere"};
        var neighborhood = svl.neighborhoodFactory.create(params.regionId, params.regionLayer, params.regionName);
        svl.neighborhoodContainer.add(neighborhood);
        svl.neighborhoodContainer.setCurrentNeighborhood(neighborhood);;
        var missionContainerParams = {'currentNeighborhood': neighborhood};
        svl.missionContainer = MissionContainer($, missionContainerParams);
        svl.missionContainer.add(341, mission);
        var completedMissions = [
            Mission({'regionId': 341, "distanceMi": 0.2}), 
            Mission({'regionId': 341, "distanceMi": 0.5}), 
            Mission({'regionId': 341, "distanceMi": 0.9}), 
            Mission({'regionId': 341, "distanceMi": 0.4})
        ];
        svl.missionContainer.addToCompletedMissions(completedMissions[0]);
        svl.missionContainer.addToCompletedMissions(completedMissions[1]);
        svl.missionContainer.addToCompletedMissions(completedMissions[2]);
        svl.taskContainer = TaskContainer(turf);
        svl.modalMissionComplete.show();
        // label counts have no value when current mission is null
        // this happens sometimes when the modals comes up  after mission completion
        expect(svl.ui.modalMissionComplete.curbRampCount.html()).toBe('');
        expect(svl.ui.modalMissionComplete.noCurbRampCount.html()).toBe('');
        expect(svl.ui.modalMissionComplete.obstacleCount.html()).toBe('');
        expect(svl.ui.modalMissionComplete.surfaceProblemCount.html()).toBe('');
        expect(svl.ui.modalMissionComplete.otherCount.html()).toBe('');
        svl.modalMissionComplete.hide();
        // current mission explicitly set
        svl.missionContainer.setCurrentMission(mission);
        svl.modalMissionComplete.show();
        // default set to zero since mission has no label count
        expect(svl.ui.modalMissionComplete.curbRampCount.html()).toBe('0');
        expect(svl.ui.modalMissionComplete.noCurbRampCount.html()).toBe('0');
        expect(svl.ui.modalMissionComplete.obstacleCount.html()).toBe('0');
        expect(svl.ui.modalMissionComplete.surfaceProblemCount.html()).toBe('0');
        expect(svl.ui.modalMissionComplete.otherCount.html()).toBe('0');
        svl.modalMissionComplete.hide();

        var labelCounts = {
                "CurbRamp": '10',
                "NoCurbRamp": '3',
                "Obstacle": '1',
                "SurfaceProblem": '4',
                "Other": '2'
            };
        mission.setLabelCounts(labelCounts);
        svl.missionContainer.setCurrentMission(mission);
        svl.modalMissionComplete.show();
        // label counts when set explicitly
        expect(svl.ui.modalMissionComplete.curbRampCount.html()).toBe('10');
        expect(svl.ui.modalMissionComplete.noCurbRampCount.html()).toBe('3');
        expect(svl.ui.modalMissionComplete.obstacleCount.html()).toBe('1');
        expect(svl.ui.modalMissionComplete.surfaceProblemCount.html()).toBe('4');
        expect(svl.ui.modalMissionComplete.otherCount.html()).toBe('2');
        svl.modalMissionComplete.hide();
        
        var taskGeoJSON = {
           "type":"FeatureCollection",
           "features":[
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
              }
           ]
        };
        var task = Task(turf, taskGeoJSON, 0, 0);
        task.complete();
        svl.taskContainer.storeTask(341, task);
        svl.modalMissionComplete.show(); 
        expect(Number(svl.ui.modalMissionComplete.totalAuditedDistance.html().substring(0,3)) < 0).toBe(false);
        expect(Number(svl.ui.modalMissionComplete.missionDistance.html().substring(0,3)) < 0).toBe(false);
        expect(Number(svl.ui.modalMissionComplete.remainingDistance.html().substring(0,3)) < 0).toBe(false);
        svl.modalMissionComplete.hide();

    });

    it("Test updateMissionLabelStatistics()", function () {
        var curbRampCount = '5';
        var noCurbRampCount = '4';
        var obstacleCount = '3';
        var surfaceProblemCount = '2';
        var otherCount = '0';

        svl.modalMissionComplete.updateMissionLabelStatistics(curbRampCount, noCurbRampCount, obstacleCount, surfaceProblemCount, otherCount);

        expect(svl.ui.modalMissionComplete.curbRampCount.html()).toBe('5');
        expect(svl.ui.modalMissionComplete.noCurbRampCount.html()).toBe('4');
        expect(svl.ui.modalMissionComplete.obstacleCount.html()).toBe('3');
        expect(svl.ui.modalMissionComplete.surfaceProblemCount.html()).toBe('2');
        expect(svl.ui.modalMissionComplete.otherCount.html()).toBe('0');

    });

    it("Test updateMissionProgressStatistics()", function () {
        var auditedDistance = 0.22;
        var missionDistance = 0.38;
        var remainingDistance = 2.44;
        var unit = 'miles';

        svl.modalMissionComplete.updateMissionProgressStatistics(auditedDistance, missionDistance, remainingDistance);
        expect(svl.ui.modalMissionComplete.totalAuditedDistance.html()).toBe('0.2 kilometers');
        expect(svl.ui.modalMissionComplete.missionDistance.html()).toBe('0.4 kilometers');
        expect(svl.ui.modalMissionComplete.remainingDistance.html()).toBe('2.4 kilometers');

        svl.modalMissionComplete.updateMissionProgressStatistics(auditedDistance, missionDistance, remainingDistance, unit);
        expect(svl.ui.modalMissionComplete.totalAuditedDistance.html()).toBe('0.2 miles');
        expect(svl.ui.modalMissionComplete.missionDistance.html()).toBe('0.4 miles');
        expect(svl.ui.modalMissionComplete.remainingDistance.html()).toBe('2.4 miles');

    });

    it("Test linestringToPoint()", function () {
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
        var p = svl.modalMissionComplete.linestringToPoint(c);
        expect(p.features[0].geometry.type).toBe('Point');
    });

    it("Test updateNeighborhoodDistancesBarGraph()", function () {
        svl.modalMissionComplete.updateNeighborhoodDistanceBarGraph(0.1, 0.1);
        var blueBar = $('#missionDist');
        var greenBar = $('#auditedDist');
        var barText = $('#barText');
        expect(blueBar.attr('width') == greenBar.attr('width')).toBe(true);
        expect(blueBar.attr('fill')).toBe('rgba(49,130,189,1)');
        expect(greenBar.attr('fill')).toBe('rgba(100,240,110,1)');
        expect(barText.html()).toBe('20%');
        svl.modalMissionComplete.updateNeighborhoodDistanceBarGraph(0.2, 0.3);
        expect(barText.html()).toBe('50%');
    });

    it("Test getProperty()", function () {
        expect(svl.modalMissionComplete.getProperty('boxTop')).toBe(180);
        expect(svl.modalMissionComplete.getProperty('boxLeft')).toBe(45);
        expect(svl.modalMissionComplete.getProperty('boxWidth')).toBe(640);
        expect(svl.modalMissionComplete.getProperty('noProperty')).toBe(null);
    });

    it("Test hide()", function () {
        svl.modalMissionComplete.hide();
        expect(svl.ui.modalMissionComplete.holder.css('visibility')).toBe('hidden');
        expect(svl.ui.modalMissionComplete.foreground.css('visibility')).toBe('hidden');
        expect(svl.ui.modalMissionComplete.map.css('top')).toBe('500px');
        expect(svl.ui.modalMissionComplete.map.css('left')).toBe('-500px');
    });

});