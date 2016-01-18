var svl = svl || {};

/**
 * LabelCounter class constructor
 */
function LabelCounter ($, d3) {
    var self = {className: 'LabelCounter'};

    var radius = 0.4, dR = radius / 2,
        svgWidth = 800, svgHeight = 200,
        margin = {top: 10, right: 10, bottom: 10, left: 0},
        padding = {left: 5, top: 15},
        width = 200 - margin.left - margin.right,
        height = 40 - margin.top - margin.bottom,
        colorScheme = svl.misc.getLabelColors();

    // Prepare a group to store svg elements, and declare a text
    var dotPlots = {
      "CurbRamp": {
        id: "CurbRamp",
        description: "Curb Ramp",
        left: margin.left,
        top: margin.top,
        fillColor: colorScheme["CurbRamp"].fillStyle,
        count: 0,
        data: []
      },
      "NoCurbRamp": {
        id: "NoCurbRamp",
        description: "Missing Curb Ramp",
        left: margin.left,
        top: 2 * margin.top + margin.bottom + height,
        fillColor: colorScheme["NoCurbRamp"].fillStyle,
        count: 0,
        data: []
      },
      "Obstacle": {
        id: "Obstacle",
        description: "Obstacle in Path",
        left: margin.left,
        top: 3 * margin.top + 2 * margin.bottom + 2 * height,
        fillColor: colorScheme["Obstacle"].fillStyle,
        count: 0,
        data: []
      },
      "SurfaceProblem": {
        id: "SurfaceProblem",
        description: "Surface Problem",
        left: margin.left,
        top: 4 * margin.top + 3 * margin.bottom + 3 * height,
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

    var svg = d3.select('#label-counter')
                  .append('svg')
                  .attr('width', svgWidth)
                  .attr('height', svgHeight)


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
      dotPlots[key].plot = dotPlots[key].g.append("g")
        .attr('transform', 'translate(' + padding.left + ',' + padding.top + ')');

      dotPlots[key].label = dotPlots[key].g.selectAll("text.label")
        .data([0])
        .enter()
        .append("text")
        .text(function () { return dotPlots[key].description; })
        .style("font-size", "11px")
        .attr("class", "visible");

      dotPlots[key].countLabel = dotPlots[key].plot.selectAll("text.count-label")
        .data([0])
        .enter()
        .append("text")
        .style("font-size", "11px")
        .style("fill", "gray")
        .attr("class", "visible");
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
              .attr("cy", function (d, i) {
                if (i < higherDigits) {
                    return 0;
                } else {
                    return x(dR);
                }
              });

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


    /**
     * Decrement the label count
     */
    function decrement(key) {
        if (dotPlots[key].count > 0) {
            dotPlots[key].count -= 1;
        }
        update(key);
    }
    /**
     * Increment the label count
     */
    function increment(key) {
      dotPlots[key].count += 1;
      update(key);
    }

    /**
     * Set the number of label count
     */
    function set(key, num) {
        dotPlots[key].count = num;
        update(key);
    }

    // Initialize
    update();

    self.increment = increment;
    self.decrement = decrement;
    self.set = set;
    return self;
}