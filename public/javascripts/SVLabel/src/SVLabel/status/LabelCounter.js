/**
 * Label Counter module. 
 * @param d3 d3 module
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabelCounter (d3) {
    var self = this;

    var radius = 0.2, dR = radius / 3,
        svgWidth = 200, svgHeight = 120,
        margin = {top: 10, right: 10, bottom: 10, left: 0},
        padding = {left: 5, top: 15},
        width = 200 - margin.left - margin.right,
        height = 40 - margin.top - margin.bottom,
        colorScheme = util.misc.getLabelColors(),
        imageWidth = 22, imageHeight = 22,
        rightColumn = 1.8;

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
            if (keys.indexOf(key) == -1) { key = "Other"; }

            var fiftyCircles = parseInt(dotPlots[key].count / 50),
              tenCircles = parseInt((dotPlots[key].count % 50) / 10),
              oneCircles = dotPlots[key].count % 10,
              count = fiftyCircles + tenCircles + oneCircles;

            /* 
            the code of these three functions was being used so much I decided to seperately declare them
            the d3 calls look much cleaner now :)
            */
            function setCX(d, i){
              if (i < fiftyCircles && fiftyCircles != 0){
                return x(i * 4 * radius + dR);
              }
              else if (i < fiftyCircles + tenCircles && tenCircles != 0){
                return x(fiftyCircles * 4 * radius + dR) + x((i - fiftyCircles) * 2 * (radius + dR));
              }
              else{
                return x(fiftyCircles * 2 * radius + dR) + x(tenCircles * 1.9 * (radius + dR))+ x((i - tenCircles) * 2 * radius);
              }
            }
            
            function setCY(d, i){
              if (i < fiftyCircles && fiftyCircles != 0){
                return 0;
              }
              else if (i < fiftyCircles + tenCircles && tenCircles != 0){
                return x(dR);
              }
              else{
                return x(radius);
              }
            }

            function setR(d, i){
              if (i < fiftyCircles && fiftyCircles != 0){
                return x(2 * radius);
              }
              else if (i < fiftyCircles + tenCircles && tenCircles != 0){
                return x(radius + dR);
              }
              else{
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