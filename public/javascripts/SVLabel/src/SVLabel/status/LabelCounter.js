/**
 * Label Counter module. 
 * @param d3 d3 module
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabelCounter (d3) {
    var self = this;

    var svgWidth = 200;
    var svgHeight = 120;
    var margin = {top: 10, right: 10, bottom: 10, left: 0};
    var padding = {left: 5, top: 15};
    var width = 200 - margin.left - margin.right;
    var height = 40 - margin.top - margin.bottom;
    var colorScheme = util.misc.getLabelColors();
    var imageWidth = 22;
    var imageHeight = 22;
    var rightColumn = 1.8;

    // Prepare a group to store svg elements, and declare a text
    var dotPlots = {
      "CurbRamp": {
        id: "CurbRamp",
        description: "curb ramp",
        left: margin.left,
        top: margin.top,
        fillColor: colorScheme["CurbRamp"].fillStyle,
          imagePath: svl.rootDirectory + "/img/icons/Sidewalk/Icon_CurbRamp.png",
        count: 0,
        data: []
      },
      "NoCurbRamp": {
          id: "NoCurbRamp",
          description: "missing curb ramp",
          left: margin.left,
          top: (2 * margin.top) + margin.bottom + height,
          // top: 2 * margin.top + margin.bottom + height,
          fillColor: colorScheme["NoCurbRamp"].fillStyle,
          imagePath: svl.rootDirectory + "/img/icons/Sidewalk/Icon_NoCurbRamp.png",
          count: 0,
          data: []
      },
      "Obstacle": {
        id: "Obstacle",
        description: "obstacle",
        left: margin.left,
        // top: 3 * margin.top + 2 * margin.bottom + 2 * height,
        top: (3 * margin.top) + (2 * margin.bottom) + (2 * height),
        fillColor: colorScheme["Obstacle"].fillStyle,
          imagePath: svl.rootDirectory + "/img/icons/Sidewalk/Icon_Obstacle.png",
        count: 0,
        data: []
      },
      "SurfaceProblem": {
        id: "SurfaceProblem",
        description: "surface problem",
        left: margin.left + (width/rightColumn),
        //top: 4 * margin.top + 3 * margin.bottom + 3 * height,
          top: margin.top,
        fillColor: colorScheme["SurfaceProblem"].fillStyle,
          imagePath: svl.rootDirectory + "/img/icons/Sidewalk/Icon_SurfaceProblem.png",
        count: 0,
        data: []
      },
      "NoSidewalk": {
        id: "NoSidewalk",
        description: "no sidewalk",
        left: margin.left + (width/rightColumn),        
        top: (2 * margin.top) + margin.bottom + height,  
        fillColor: colorScheme["NoSidewalk"].fillStyle,
          imagePath: svl.rootDirectory + "/img/icons/Sidewalk/Icon_NoSidewalk.png",
        count: 0,
        data: []
      },
        "Other": {
            id: "Other",
            description: "other",
            left: margin.left + (width/rightColumn),
            top: (3 * margin.top) + (2 * margin.bottom) + (2 * height),
            fillColor: colorScheme["Other"].fillStyle,
            imagePath: svl.rootDirectory + "/img/icons/Sidewalk/Icon_Other.png",
            count: 0,
            data: []
        }
    };

    var keys = Object.keys(dotPlots);

    var x = d3.scale.linear()
              .domain([0, 20])
              .range([0, width]);

    var y = d3.scale.linear()
            .domain([0, 20])
            .range([height, 0]);

    var svg = d3.select('#label-counter')
                  .append('svg')
                  .attr('width', svgWidth)
                  .attr('height', svgHeight);

    var chart = svg.append('g')
                  .attr('width', svgWidth)
                  .attr('height', svgHeight)
                  .attr('class', 'chart')
                  .attr('transform', function () {
                     return 'translate(0,0)';
                  });

    for (var key in dotPlots) {
        dotPlots[key].g = chart.append('g')
                    .attr('transform', 'translate(' + dotPlots[key].left + ',' + dotPlots[key].top + ')')
                    .attr('width', width)
                    .attr('height', height)
                    .attr('class', 'main');

        dotPlots[key].label = dotPlots[key].g.selectAll("text.label")
            .data([0])
            .enter()
            .append("text")
            .text(function () {
                var ret = dotPlots[key].count + " " + dotPlots[key].description;
                ret += dotPlots[key].count > 1 ? "s" : "";
                return ret;
            })
            .style("font-size", "9px")
            .attr("class", "visible")
            .attr('transform', 'translate(0,' + imageHeight + ')');

        dotPlots[key].plot = dotPlots[key].g.append("g")
            .attr('transform', 'translate(' + (padding.left + imageWidth) + ',' + 0 + ')');

        dotPlots[key].g.append("image")
            .attr("xlink:href", dotPlots[key].imagePath)
            .attr("width", imageWidth)
            .attr("height", imageHeight)
            .attr('transform', 'translate(0,-15)');
    }


    this.countLabel = function (labelType) {
        return labelType in dotPlots ? dotPlots[labelType].count : null;
    };

    /**
     * Set label counts to 0
     */
    this.reset = function () {
        for (var key in dotPlots) {
            self.set(key, 0);
        }
    };

    /**
     * Update the label count visualization.
     * @param key {string} Label type
     */
    function update(key) {
        // If a key is given, update the dot plot for that specific data.
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
            if (keys.indexOf(key) == -1) { key = "Other"; }

            var hundredCircles = parseInt(dotPlots[key].count / 100);
            var fiftyCircles = parseInt((dotPlots[key].count % 100) / 50);
            var tenCircles = parseInt((dotPlots[key].count % 50) / 10);
            var oneCircles = dotPlots[key].count % 10;
            var count = hundredCircles + fiftyCircles + tenCircles + oneCircles;
            var multiplier = Math.max(0.5, 1.0 - parseInt(dotPlots[key].count) / 1500.0);
            var radius = 0.2 * multiplier;
            var dR = radius / 3;

            // The code of these three functions was being used so much I decided to separately declare them.
            // The d3 calls look much cleaner now. :)
            function setCX(d, i){
               if (i < hundredCircles && hundredCircles != 0) {
                   return x(i * 5.33 * radius + 2 * dR)
               }
               else if (i < hundredCircles + fiftyCircles && fiftyCircles != 0) {
                   return x(hundredCircles * 5.33 * radius);
               }
               else if (i < hundredCircles + fiftyCircles + tenCircles && tenCircles != 0) {
                   return x(hundredCircles * 2.6 * radius) + x(fiftyCircles * 3.3 * radius) +
                     x((i - fiftyCircles) * 2 * (radius + dR));
               }
               else {
                   return x(hundredCircles * 3.2 * radius) + x(fiftyCircles * 1.3 * radius) +
                     x(tenCircles * 1.95 * (radius + dR))+ x((i - tenCircles) * 2 * radius);
               }
            }
            
            function setCY(d, i){
              if (i < hundredCircles && hundredCircles != 0) {
                return 0;
              }
              else if (i < hundredCircles + fiftyCircles && fiftyCircles != 0) {
                return x(2 * dR);
              }
              else if (i < hundredCircles + fiftyCircles + tenCircles && tenCircles != 0) {
                return x(radius + dR);
              }
              else {
                return x(2 * radius);
              }
            }

            function setR(d, i){
              if (i < hundredCircles && hundredCircles != 0) {
                return x(2 * (radius + dR));
              }
              else if (i < hundredCircles + fiftyCircles && fiftyCircles != 0) {
                return x(2 * radius);
              }
              else if (i < hundredCircles + fiftyCircles + tenCircles && tenCircles != 0) {
                return x(radius + dR);
              }
              else {
                return x(radius);
              }
            }

            // Update the dot plot
            if (dotPlots[key].data.length >= count) {
              // Remove dots
              dotPlots[key].data = dotPlots[key].data.slice(0, count);

                dotPlots[key].plot.selectAll("circle")
                  .transition().duration(500)
                  .attr("r", setR)
                  .attr("cy", setCY)
                  .attr("cx", setCX);

                dotPlots[key].plot.selectAll("circle")
                  .data(dotPlots[key].data)
                  .exit()
                  .transition()
                  .duration(500)
                  .attr("cx", function () {
                    return 0;
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
                .attr("r", setR) 
                .attr("cy", setCY)
                .attr("cx", setCX)
                .data(dotPlots[key].data)
                .enter().append("circle")
                .attr("cx", x(0))
                .attr("cy", setCY)
                .attr("r", radius)
                .style("fill", dotPlots[key].fillColor)
                .transition().duration(1000)
                .attr("cx", setCX)
                .attr("cy", setCY)
                .attr("r", setR);
            }
            dotPlots[key].label.text(function () {
                var ret = dotPlots[key].count + " " + dotPlots[key].description;
                ret += dotPlots[key].count > 1 ? "s" : "";
                return ret;
            });
        }
    }

    /**
     * Decrement the label count
     * @param key {string} Label type
     */
    this.decrement = function (key) {
        if(svl.isOnboarding()) {
            $(document).trigger('RemoveLabel');
        }

        if (keys.indexOf(key) == -1) { key = "Other"; }
        if (key in dotPlots && dotPlots[key].count > 0) {
            dotPlots[key].count -= 1;
        }
        update(key);

        if ("labelContainer" in svl) {
            var regionId = svl.neighborhoodContainer.getCurrentNeighborhood().getProperty("regionId");
            var count = svl.labelContainer.countLabels(regionId) - 1;
            svl.statusFieldNeighborhood.setLabelCount(count);
        }

    };

    /**
     * Increment the label count
     * @param key {string} Label type
     */
    this.increment = function (key) {
        if (keys.indexOf(key) == -1) { key = "Other"; }
        if (key in dotPlots) {
            dotPlots[key].count += 1;
            update(key);
        }

        if ("labelContainer" in svl) {
            var regionId = svl.neighborhoodContainer.getCurrentNeighborhood().getProperty("regionId");
            var count = svl.labelContainer.countLabels(regionId) + 1;
            svl.statusFieldNeighborhood.setLabelCount(count);
        }
    };

    /**
     * Set the number of label count
     * @param key {string} Label type
     * @param num {number} Label type count
     */
    this.set = function (key, num) {
        dotPlots[key].count = num;
        update(key);
    };

    // Initialize
    update();
    // self.countLabel = countLabel;
    // self.increment = increment;
    // self.decrement = decrement;
    // self.set = set;
    // self.reset = reset;
}
