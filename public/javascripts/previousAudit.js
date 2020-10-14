$(document).ready(function () {

    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';
    // var tileUrl = "https://a.tiles.mapbox.com/v4/kotarohara.mmoldjeh/page.html?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA#13/38.8998/-77.0638";
    var tileUrl = "https:\/\/a.tiles.mapbox.com\/v4\/kotarohara.8e0c6890\/{z}\/{x}\/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA";
    var mapboxTiles = L.tileLayer(tileUrl, {
        attribution: '<a href="http://www.mapbox.com/about/maps/" target="_blank">Terms &amp; Feedback</a>'
    });

    var map = L.mapbox.map('map', null, {
        // Don't allow zooming (yet!)
        zoomControl: false,
        touchZoom: false,
        doubleClickZoom: false,
        scrollWheelZoom: false
    })
        .addLayer(L.mapbox.styleLayer('mapbox://styles/mapbox/streets-v11'))
        .setView([38.910, -77.040], 17);

    (function mapAnimation () {
        var overlayPolygon = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [[-75, 36], [-75, 40], [-78, 40], [-78, 36],[-75, 36]]
                        ]
                    }
                }
            ]
        };

        var overlayPolygonLayer = L.geoJson(overlayPolygon).addTo(map);
        var colorScheme = util.misc.getLabelColors();

        // Prepare a layer to put d3 stuff
        var svg = d3.select(map.getPanes().overlayPane).append("svg");  // The base svg
        var g = svg.append("g").attr("class", "leaflet-zoom-hide");  // The root group

        // Import the sample data and start animating
        var geojsonURL = "/contribution/auditInteractions";
        d3.json(geojsonURL, function (collection) {
            animate(collection);
        });

        /**
         * This function animates how a user (represented as a yellow circle) walked through the map and labeled
         * accessibility attributes.
         *
         * param walkTrajectory A trajectory of a user's auditing activity in a GeoJSON FeatureCollection format.
         */
        function animate(walkTrajectory) {
            // https://github.com/mbostock/d3/wiki/Geo-Streams#stream-transforms
            var initialCoordinate = walkTrajectory.features[0].geometry.coordinates,
                transform = d3.geo.transform({point: projectPoint}),
                d3path = d3.geo.path().projection(transform),
                featuresdata = walkTrajectory.features,
                markerGroup = g.append("g").data(featuresdata);
            var marker = markerGroup.append("circle")
                    .attr("r", 2)
                    .attr("id", "marker")
                    .attr("class", "travelMarker");
            var markerNose = markerGroup.append("line")
                    .attr({'x1': 0, 'y1': -3, 'x2': 0, 'y2': -10})
                    .attr('stroke', 'gray')
                    .attr('stroke-width', 2);

            map.setView([initialCoordinate[1], initialCoordinate[0]], 18);

            // Set the initial heading
            markerGroup.attr("transform", function () {
                var y = featuresdata[0].geometry.coordinates[1];
                var x = featuresdata[0].geometry.coordinates[0];
                var heading = featuresdata[0].properties.heading;
                return "translate(" +
                        map.latLngToLayerPoint(new L.LatLng(y, x)).x + "," +
                        map.latLngToLayerPoint(new L.LatLng(y, x)).y + ")" +
                        "rotate(" + heading + ")";
            });


            // Get the bounding box and align the svg
            var bounds = d3path.bounds(walkTrajectory),
                    topLeft = bounds[0],
                    bottomRight = bounds[1];
            svg.attr("width", bottomRight[0] - topLeft[0] + 120)
                    .attr("height", bottomRight[1] - topLeft[1] + 120)
                    .style("left", topLeft[0] - 50 + "px")
                    .style("top", topLeft[1] - 50 + "px");
            g.attr("transform", "translate(" + (-topLeft[0] + 50) + "," + (-topLeft[1] + 50) + ")");

            // Apply the toLine function to align the path to
            markerGroup.attr("transform", function () {
                var y = featuresdata[0].geometry.coordinates[1];
                var x = featuresdata[0].geometry.coordinates[0];
                return "translate(" +
                        map.latLngToLayerPoint(new L.LatLng(y, x)).x + "," +
                        map.latLngToLayerPoint(new L.LatLng(y, x)).y + ")";
            });

            // Animate the marker
            markerGroup = markerGroup.attr("counter", 0)
                    .transition()
                    .each("start", function () {
                        var thisMarker = d3.select(d3.select(this).node().children[0]);
                        var thisMarkerNose = d3.select(d3.select(this).node().children[0]);

                        thisMarker.transition()
                                .duration(250)
                                .attr("r", 7);
                    })
                    .duration(750);


            // Chain transitions
            for (var i = 0; i < featuresdata.length; i++) {
                featuresdata[i].properties.timestamp /= 5;
            }

            var currentTimestamp = featuresdata[0].properties.timestamp;
            for (var i = 0; i < featuresdata.length; i++) {
                var duration = featuresdata[i].properties.timestamp - currentTimestamp,
                    currentTimestamp = featuresdata[i].properties.timestamp;
                markerGroup = markerGroup.transition()
                        .duration(duration)
                        .attr("transform", function () {
                            var y = featuresdata[i].geometry.coordinates[1];
                            var x = featuresdata[i].geometry.coordinates[0];
                            var heading = featuresdata[i].properties.heading;
                            return "translate(" +
                                    map.latLngToLayerPoint(new L.LatLng(y, x)).x + "," +
                                    map.latLngToLayerPoint(new L.LatLng(y, x)).y + ")" +
                                    "rotate(" + heading + ")";
                        })
                        .each("end", function () {
                            // If the "label" is in the data, draw the label data and attach mouseover/mouseout events.
                            var counter = d3.select(this).attr("counter");
                            var d = featuresdata[counter];
                            if (d) {
                                if ("label" in d.properties) {
                                    var label = d.properties.label;
                                    var p = map.latLngToLayerPoint(new L.LatLng(label.coordinates[1], label.coordinates[0]));
                                    var c = g.append("circle")
                                        .attr("r", 5)
                                        .attr("cx", p.x)
                                        .attr("cy", p.y)
                                        .attr("fill", function () {
                                            return util.color.changeAlphaRGBA(colorScheme["CurbRamp"].fillStyle, 0.5);
                                        })
                                        // .attr("color", "white")
                                        // .attr("stroke", "#ddd")
                                        .attr("stroke-width", 1)
                                        .on("mouseover", function () {
                                            d3.select(this).attr("r", 15);
                                        })
                                        .on("mouseout", function () {
                                            d3.select(this).attr("r", 5);
                                        });
                                    // Update the chart as well
                                    dotPlotVisualization.increment(label.label_type);
                                    dotPlotVisualization.update();

                                }
                            }
                            d3.select(this).attr("counter", ++counter);
                        });
            }
            // Finally delete the marker
            markerGroup.transition()
                    .each("start", function () {
                        var thisMarker = d3.select(d3.select(this).node().children[0]);
                        thisMarker.transition()
                                .delay(500)
                                .duration(250)
                                .attr("r", 1);
                    })
                    .duration(750)
                    .remove();
        }

        function projectPoint(x, y) {
            var point = map.latLngToLayerPoint(new L.LatLng(y, x));

            // https://github.com/mbostock/d3/wiki/Geo-Streams#stream-transforms
            this.stream.point(point.x, point.y);
        }
        function applyLatLngToLayer(d) {
            var y = d.geometry.coordinates[1];
            var x = d.geometry.coordinates[0];
            return map.latLngToLayerPoint(new L.LatLng(y, x))
        }
    })();


    function DotPlotVisualization () {
        var radius = 0.4, dR = radius / 2;
        var svgWidth = 800, svgHeight = 50;
        var margin = {top: 10, right: 10, bottom: 10, left: 10},
            padding = {left: 5, top: 15},
            width = 200 - margin.left - margin.right,
            height = 50 - margin.top - margin.bottom;
        var colorScheme = util.misc.getLabelColors();
        // Prepare a group to store svg elements, and declare a text
      var dotPlots = {
        "CurbRamp": {
          id: "CurbRamp",
          description: "Curb Ramp",
          left: margin.left,
          top: margin.top,
          fillColor: util.color.changeAlphaRGBA(colorScheme["CurbRamp"].fillStyle, 0.5),
          count: 0,
          data: []
        },
        "NoCurbRamp": {
          id: "NoCurbRamp",
          description: "Missing Curb Ramp",
          left: width + margin.left,
          top: margin.top,
          fillColor: colorScheme["NoCurbRamp"].fillStyle,
          count: 0,
          data: []
        },
        "Obstacle": {
          id: "Obstacle",
          description: "Obstacle in Path",
          left: 2 * width + margin.left,
          top: margin.top,
          fillColor: colorScheme["Obstacle"].fillStyle,
          count: 0,
          data: []
        },
        "SurfaceProblem": {
          id: "SurfaceProblem",
          description: "Surface Problem",
          left: 3 * width + margin.left,
          top: margin.top,
          fillColor: colorScheme["SurfaceProblem"].fillStyle,
          count: 0,
          data: []
        }
      };

      var x = d3.scale.linear()
                .domain([0, 20])
                .range([0, width]);

      var y = d3.scale.linear()
              .domain([0, 20])
              .range([height, 0]);

      var svg = d3.select('#map-chart')
                    .append('svg')
                    .attr('width', svgWidth)
                    .attr('height', svgHeight);


      var chart = svg.append('g')
                    .attr('width', svgWidth)
                    .attr('height', svgHeight)
                    .attr('class', 'chart')
                    .attr('transform', function () {
                       return 'translate(135,10)';
                    });

      for (var key in dotPlots) {
        dotPlots[key].g = chart.append('g')
                      .attr('transform', 'translate(' + dotPlots[key].left + ',' + dotPlots[key].top + ')')
                      .attr('width', width)
                      .attr('height', height)
                      .attr('class', 'main');
        dotPlots[key].plot = dotPlots[key].g.append("g")
          .attr('transform', 'translate(' + padding.left + ',' + padding.top + ')');

        dotPlots[key].label = dotPlots[key].g.selectAll("text.label")
          .data([0])
          .enter()
          .append("text")
          .text(function () { return dotPlots[key].description; })
          .style("font-size", "13px");
        dotPlots[key].countLabel = dotPlots[key].plot.selectAll("text.count-label")
          .data([0])
          .enter()
          .append("text")
          .style("font-size", "13px")
          .style("fill", "gray");
      }

      function update(key) {
        // If a key is given, udpate the dot plot for that specific data.
        // Otherwise update all.
        if (key) {
          _update(key)
        } else {
          for (var key in dotPlots) {
            _update(key);
          }
        }

        // Actual update function
        function _update(key) {
          var firstDigit = dotPlots[key].count % 10,
            higherDigits = (dotPlots[key].count - firstDigit) / 10,
            count = firstDigit + higherDigits;

          // Update the label
          dotPlots[key].countLabel
            .transition().duration(1000)
            .attr("x", function () {
              return x(higherDigits * 2 * (radius + dR) + firstDigit * 2 * radius)
            })
            .attr("y", function () {
              return x(radius + dR - 0.05);
            })
            // .transition().duration(1000)
            .text(function (d) {
              return dotPlots[key].count;
            });

          // Update the dot plot
          if (dotPlots[key].data.length >= count) {
            // Remove dots
            dotPlots[key].data = dotPlots[key].data.slice(0, count);

              dotPlots[key].plot.selectAll("circle")
                .transition().duration(500)
                .attr("r", function (d, i) {
                  return i < higherDigits ? x(radius + dR) : x(radius);
                })
                .attr("cy", 0);

              dotPlots[key].plot.selectAll("circle")
                .data(dotPlots[key].data)
                .exit()
                .transition()
                .duration(500)
                .attr("cx", function () {
                  return x(higherDigits);
                })
                .attr("r", 0)
                .remove();
          } else {
            // Add dots
            var len = dotPlots[key].data.length;
            for (var i = 0; i < count - len; i++) {
                dotPlots[key].data.push([len + i, 0, radius])
            }
            dotPlots[key].plot.selectAll("circle")
              .data(dotPlots[key].data)
              .enter().append("circle")
              .attr("cx", x(0))
              .attr("cy", 0)
              .attr("r", x(radius + dR))
              .style("fill", dotPlots[key].fillColor)
              .transition().duration(1000)
              .attr("cx", function (d, i) {
                if (i <= higherDigits) {
                  return x(d[0] * 2 * (radius + dR));
                } else {
                  return x((higherDigits) * 2 * (radius + dR)) + x((i - higherDigits) * 2 * radius)
                }
              })
              .attr("cy", function (d, i) {
                if (i < higherDigits) {
                  return 0;
                } else {
                  return x(dR);
                }
              })
              .attr("r", function (d, i) {
                return i < higherDigits ? x(radius + dR) : x(radius);
              });
          }
        }
      }

      function increment(key) {
        dotPlots[key].count += 1;
      }

      // Initialize
      update();
    //  setInterval(function () {
    //    var keys = Object.keys(dotPlots),
    //      idx = parseInt(keys.length * Math.random(), 10);
    //    increment[keys[idx]].count += 1
    //    update(keys[idx]);
    //  }, 1500);

      return {
        update: update,
        increment: increment
      }
    }
    var dotPlotVisualization = new DotPlotVisualization();

});