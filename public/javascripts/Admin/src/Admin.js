/**
 * Admin landing page controller (/admin). Loads the Overview tables on construction and lazily builds the Map,
 * Analytics, Labels, Users, Teams, and API Analytics tabs when their nav pill is first clicked.
 */
class Admin {
  #jquery;
  #viewerType;
  #viewerAccessToken;
  #loadingGif;

  #mapLoaded = false;
  #graphsLoaded = false;
  #labelsLoaded = false;
  #usersLoaded = false;
  #teamsLoaded = false;
  #apiAnalyticsLoaded = false;

  #analyticsTabMapParams;
  #mapTabMapParams;

  #labelPopup;
  #apiAnalytics;
  #adminCommentPopup;
  #map;
  #mapData;

  /**
   * @param {Function} $ - jQuery.
   * @param {string} mapboxApiKey
   * @param {Function} viewerType - Pano viewer constructor.
   * @param {string} viewerAccessToken
   */
  constructor($, mapboxApiKey, viewerType, viewerAccessToken) {
    this.#jquery = $;
    this.#viewerType = viewerType;
    this.#viewerAccessToken = viewerAccessToken;
    this.#loadingGif = $('#page-loading');

    this.#analyticsTabMapParams = {
      mapName: 'admin-landing-choropleth',
      mapStyle: 'mapbox://styles/mapbox/light-v11?optimize=true',
      mapboxApiKey,
      mapboxLogoLocation: 'bottom-right',
      scrollWheelZoom: false,
      neighborhoodsURL: '/neighborhoods',
      completionRatesURL: '/adminapi/neighborhoodCompletionRate',
      neighborhoodFillMode: 'completionRate',
      neighborhoodTooltip: 'completionRate',
      logClicks: false,
    };
  }

  /**
   * Builds the Admin controller, awaiting the shared label popup before wiring up the tabs.
   *
   * Async because the label popup viewer must exist before the map params are assembled; a constructor
   * cannot be async, so callers use this factory instead.
   *
   * @param {Function} $ - jQuery.
   * @param {string} mapboxApiKey
   * @param {Function} viewerType
   * @param {string} viewerAccessToken
   * @param {string} currentUsername
   * @returns {Promise<Admin>}
   */
  static async create($, mapboxApiKey, viewerType, viewerAccessToken, currentUsername) {
    const admin = new Admin($, mapboxApiKey, viewerType, viewerAccessToken);
    admin.#labelPopup = await LabelPopup(true, viewerType, viewerAccessToken, currentUsername);
    admin.#mapTabMapParams = {
      mapName: 'admin-labelmap-choropleth',
      mapStyle: 'mapbox://styles/mapbox/light-v11?optimize=true',
      mapboxApiKey,
      mapboxLogoLocation: 'bottom-right',
      neighborhoodsURL: '/neighborhoods',
      completionRatesURL: '/adminapi/neighborhoodCompletionRate',
      streetsURL: '/contribution/streets/all?filterLowQuality=true',
      labelsURL: '/adminapi/labels/all',
      neighborhoodFillMode: 'singleColor',
      neighborhoodFillColor: '#808080',
      neighborhoodFillOpacity: 0.1,
      neighborhoodTooltip: 'none',
      differentiateUnauditedStreets: true,
      interactiveStreets: true,
      navigationControlPosition: 'top-right',
      uiSource: 'AdminMapTab',
      popupLabelViewer: admin.#labelPopup,
      logClicks: false,
      highQualityFilter: true,
    };
    admin.#init();
    return admin;
  }

  // Constructor: load data for the Overview page tables from backend & make the loader finish after that data loads.
  #init() {
    const $ = this.#jquery;

    // Run all the API requests. Once the data has loaded, make the page visible.
    Promise.all([
      Admin.loadStreetEdgeData(), Admin.loadUserCountData(), Admin.loadContributionTimeData(),
      Admin.loadLabelCountData(), Admin.loadValidationCountData(), Admin.loadComments(),
      this.#initializeAdminCommentPopup(),
    ]).then(() => {
      this.#loadingGif.css('visibility', 'hidden');
      $('#admin-page-container').css('visibility', 'visible');
    }).catch((error) => {
      console.error('Error loading street edge data:', error);
    });

    // Create the functionality for the Label Search tab.
    new AdminLabelSearch(true, this.#labelPopup, 'AdminLabelSearchTab');

    // Instantiate the API Analytics tab (sets up its own control listeners).
    this.#apiAnalytics = new AdminApiAnalytics();

    // Set up the listeners for the Labels table.
    $('#label-table').on('click', '.labelView', async (e) => {
      e.preventDefault();
      await this.#labelPopup.showLabel($(e.currentTarget).data('labelId'), 'AdminContributionsTab');
    });

    // Set up the listeners for the comments table.
    $('#comments-table').on('click', '.show-comment-location', async (e) => {
      e.preventDefault();
      const pov = {
        heading: parseFloat($(e.currentTarget).data('heading')),
        pitch: parseFloat($(e.currentTarget).data('pitch')),
        zoom: Number($(e.currentTarget).data('zoom')),
      };
      const labelId = parseInt($(e.currentTarget).data('labelId'), 10);
      await this.#adminCommentPopup.showCommentGSV(e.currentTarget.innerHTML, pov, labelId);
    });

    this.#setupTabListeners();
  }

  async #initializeAdminCommentPopup() {
    this.#adminCommentPopup = await AdminCommentPopup.create(true, this.#viewerType, this.#viewerAccessToken);
  }

  static isResearcherRole(roleName) {
    return ['Researcher', 'Administrator', 'Owner'].indexOf(roleName) > 0;
  }

  // Takes an array of objects and the name of a property of the objects, returns summary stats for that property.
  static getSummaryStats(data, col, options) {
    options = options || {};
    const excludeResearchers = options.excludeResearchers || false;

    let sum = 0;
    const filteredData = [];
    for (let j = 0; j < data.length; j++) {
      if (!excludeResearchers || !Admin.isResearcherRole(data[j].role)) {
        sum += data[j][col];
        filteredData.push(data[j]);
      }
    }
    const mean = sum / filteredData.length;
    const i = filteredData.length / 2;
    filteredData.sort((a, b) => {
      return (a[col] > b[col]) ? 1 : ((b[col] > a[col]) ? -1 : 0);
    });

    let median = 0;
    let max = 0;
    let min = 0;

    if (filteredData.length > 0) { // Prevent errors in development where there may be no data
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

  // takes in some data, summary stats, and optional arguments, and outputs the spec for a vega-lite chart
  static getVegaLiteHistogram(data, mean, median, options) {
    options = options || {};
    const xAxisTitle = options.xAxisTitle || 'TODO, fill in x-axis title';
    const yAxisTitle = options.yAxisTitle || 'Counts';
    const height = options.height || 300;
    const width = options.width || 600;
    const col = options.col || 'count'; // most graphs we are making are made of up counts
    const xDomain = options.xDomain || [0, data[data.length - 1][col]];
    const binStep = options.binStep || 1;
    const legendOffset = options.legendOffset || 0;
    const excludeResearchers = options.excludeResearchers || false;

    const nonResearcherRoles = ['Registered', 'Anonymous', 'Turker'];
    const transformList = excludeResearchers ? [{ filter: { field: 'role', oneOf: nonResearcherRoles } }] : [];

    return {
      height,
      width,
      data: { values: data },
      transform: transformList,
      layer: [
        {
          mark: 'bar',
          encoding: {
            x: {
              field: col,
              type: 'quantitative',
              axis: { title: xAxisTitle, labelAngle: 0, tickCount: 8 },
              bin: { step: binStep },
            },
            y: {
              aggregate: 'count',
              field: '*',
              type: 'quantitative',
              axis: {
                title: yAxisTitle,
              },
            },
          },
        },
        { // creates lines marking summary statistics
          data: { values: [
            { stat: 'mean', value: mean }, { stat: 'median', value: median }],
          },
          mark: 'rule',
          encoding: {
            x: {
              field: 'value', type: 'quantitative',
              axis: { labels: false, ticks: false, title: '', grid: false },
              scale: { domain: xDomain },
            },
            color: {
              field: 'stat', type: 'nominal', scale: { range: ['pink', 'orange'] },
              legend: {
                title: 'Summary Stats',
                values: [`mean: ${mean.toFixed(2)}`, `median: ${median.toFixed(2)}`],
                offset: legendOffset,
              },
            },
            size: {
              value: 2,
            },
          },
        },
      ],
      resolve: { x: { scale: 'independent' } },
      config: {
        axis: {
          titleFontSize: 16,
        },
      },
    };
  }

  // Lazily builds each tab's content the first time its nav pill is clicked.
  #setupTabListeners() {
    const $ = this.#jquery;
    $('.nav-pills').on('click', (e) => {
      if (e.target.id === 'visualization' && this.#mapLoaded === false) {
        CreatePSMap($, this.#mapTabMapParams).then((m) => {
          this.#map = m[0];
          this.#mapData = m[4];
          new MapSidebarFilter(this.#map, this.#mapData, { highQualityFilter: true });
          this.#mapLoaded = true;
        });
      } else if (e.target.id === 'analytics' && this.#graphsLoaded === false) {
        // Create the choropleth.
        CreatePSMap($, this.#analyticsTabMapParams);

        const opt = {
          mode: 'vega-lite',
          actions: false,
        };

        $.getJSON('/adminapi/completionRateByDate', (data) => {
          const chart = {
            data: { values: data, format: { type: 'json' } },
            config: {
              axis: {
                titleFontSize: 16,
              },
            },
            vconcat: [
              {
                height: 300,
                width: 875,
                mark: 'area',
                encoding: {
                  x: {
                    field: 'date',
                    type: 'temporal',
                    scale: { domain: { selection: 'brush', field: 'date' } },
                    axis: { title: 'Date', labelAngle: 0 },
                  },
                  y: {
                    field: 'completion',
                    type: 'quantitative', scale: {
                      domain: [0, 100],
                    },
                    axis: { title: 'City Coverage (%)' },
                  },
                },
              },
              {
                height: 60,
                width: 875,
                mark: 'area',
                selection: { brush: { type: 'interval', encodings: ['x'] } },
                encoding: {
                  x: {
                    field: 'date',
                    type: 'temporal',
                    axis: { title: 'Date', labelAngle: 0 },
                  },
                  y: {
                    field: 'completion',
                    type: 'quantitative', scale: {
                      domain: [0, 100],
                    },
                    axis: {
                      title: 'City Coverage (%)',
                      tickCount: 3, grid: true },
                  },
                },
              },
            ],
          };
          vega.embed('#completion-progress-chart', chart, opt);
        });

        $.getJSON('/adminapi/labelTags', (tagCountData) => {
          const subPlotHeight = 175;
          const subPlotWidth = 250;

          for (const item of tagCountData) {
            if (item.tag.length > 15) {
              item.tag = `${item.tag.slice(0, 15)}...`;
            }
          }

          const chart1 = {
            hconcat: [
              {
                height: subPlotHeight,
                width: subPlotWidth,
                data: { values: tagCountData.filter((label) => {
                  return label.label_type === 'CurbRamp';
                }) },
                mark: 'bar',
                encoding: {
                  x: { field: 'tag', type: 'ordinal', sort: { field: 'count', op: 'sum', order: 'descending' },
                    axis: { title: 'Curb Ramp Tags', labelAngle: -48, labelPadding: 20 } },
                  y: { field: 'count', type: 'quantitative', axis: { title: '# of tags' } },
                },
              },
              {
                height: subPlotHeight,
                width: subPlotWidth,
                data: { values: tagCountData.filter((label) => {
                  return label.label_type === 'NoCurbRamp';
                }) },
                mark: 'bar',
                encoding: {
                  x: { field: 'tag', type: 'ordinal', sort: { field: 'count', op: 'sum', order: 'descending' },
                    axis: { title: 'No Curb Ramps Tags', labelAngle: -48, labelPadding: 20 } },
                  y: { field: 'count', type: 'quantitative', sort: 'descending', axis: { title: '' } },
                },
              },
              {
                height: subPlotHeight,
                width: subPlotWidth,
                data: { values: tagCountData.filter((label) => {
                  return label.label_type === 'Obstacle';
                }) },
                mark: 'bar',
                encoding: {
                  x: { field: 'tag', type: 'ordinal', sort: { field: 'count', op: 'sum', order: 'descending' },
                    axis: { title: 'Obstacles Tags', labelAngle: -48, labelPadding: 20 } },
                  y: { field: 'count', type: 'quantitative', axis: { title: '' } },
                },
              },
            ],
          };

          const chart2 = {
            hconcat: [
              {
                height: subPlotHeight,
                width: subPlotWidth,
                data: { values: tagCountData.filter((label) => {
                  return label.label_type === 'SurfaceProblem';
                }) },
                mark: 'bar',
                encoding: {
                  x: { field: 'tag', type: 'ordinal', sort: { field: 'count', op: 'sum', order: 'descending' },
                    axis: { title: 'Surface Problems Tags', labelAngle: -48, labelPadding: 20 } },
                  y: { field: 'count', type: 'quantitative', sort: 'descending', axis: { title: '# of tags' } },
                },
              },
              {
                height: subPlotHeight,
                width: subPlotWidth,
                data: { values: tagCountData.filter((label) => {
                  return label.label_type === 'NoSidewalk';
                }) },
                mark: 'bar',
                encoding: {
                  x: { field: 'tag', type: 'ordinal', sort: { field: 'count', op: 'sum', order: 'descending' },
                    axis: { title: 'No Sidewalk Tags', labelAngle: -48, labelPadding: 20 } },
                  y: { field: 'count', type: 'quantitative', axis: { title: '' } },
                },
              },
              {
                height: subPlotHeight,
                width: subPlotWidth,
                data: { values: tagCountData.filter((label) => {
                  return label.label_type === 'Crosswalk';
                }) },
                mark: 'bar',
                encoding: {
                  x: { field: 'tag', type: 'ordinal', sort: { field: 'count', op: 'sum', order: 'descending' },
                    axis: { title: 'Marked Crosswalks Tags', labelAngle: -48, labelPadding: 20 } },
                  y: { field: 'count', type: 'quantitative', sort: 'descending', axis: { title: '' } },
                },
              },
            ],
          };

          vega.embed('#tag-usage-histograms', chart1, opt);
          vega.embed('#tag-usage-histograms2', chart2, opt);
        });

        $.getJSON('/adminapi/labels/all', (data) => {
          for (let i = 0; i < data.features.length; i++) {
            data.features[i].label_type = data.features[i].properties.label_type;
            data.features[i].severity = data.features[i].properties.severity;
          }
          const curbRamps = data.features.filter((label) => {
            return label.properties.label_type === 'CurbRamp';
          });
          const noCurbRamps = data.features.filter((label) => {
            return label.properties.label_type === 'NoCurbRamp';
          });
          const obstacles = data.features.filter((label) => {
            return label.properties.label_type === 'Obstacle';
          });
          const surfaceProblems = data.features.filter((label) => {
            return label.properties.label_type === 'SurfaceProblem';
          });
          const crosswalks = data.features.filter((label) => {
            return label.properties.label_type === 'Crosswalk';
          });

          const curbRampStats = Admin.getSummaryStats(curbRamps, 'severity');
          $('#curb-ramp-mean').html((curbRampStats.mean).toFixed(2));
          $('#curb-ramp-std').html((curbRampStats.std).toFixed(2));

          const noCurbRampStats = Admin.getSummaryStats(noCurbRamps, 'severity');
          $('#missing-ramp-mean').html((noCurbRampStats.mean).toFixed(2));
          $('#missing-ramp-std').html((noCurbRampStats.std).toFixed(2));

          const obstacleStats = Admin.getSummaryStats(obstacles, 'severity');
          $('#obstacle-mean').html((obstacleStats.mean).toFixed(2));
          $('#obstacle-std').html((obstacleStats.std).toFixed(2));

          const surfaceProblemStats = Admin.getSummaryStats(surfaceProblems, 'severity');
          $('#surface-mean').html((surfaceProblemStats.mean).toFixed(2));
          $('#surface-std').html((surfaceProblemStats.std).toFixed(2));

          const crosswalkStats = Admin.getSummaryStats(crosswalks, 'severity');
          $('#crosswalk-mean').html((crosswalkStats.mean).toFixed(2));
          $('#crosswalk-std').html((crosswalkStats.std).toFixed(2));

          const allData = data.features;
          const allDataStats = Admin.getSummaryStats(allData, 'severity');
          $('#labels-mean').html((allDataStats.mean).toFixed(2));
          $('#labels-std').html((allDataStats.std).toFixed(2));

          const subPlotHeight = 155; // Before, it was 150
          const subPlotWidth = 220; // Before, it was 130

          const chart = {
            hconcat: [
              {
                height: subPlotHeight,
                width: subPlotWidth,
                data: { values: curbRamps },
                mark: 'bar',
                encoding: {
                  x: { field: 'severity', type: 'ordinal',
                    axis: { title: 'Curb Ramp Severity', labelAngle: 0 } },
                  y: { aggregate: 'count', type: 'quantitative', axis: { title: '# of labels' } },
                },
              },
              {
                height: subPlotHeight,
                width: subPlotWidth,
                data: { values: noCurbRamps },
                mark: 'bar',
                encoding: {
                  x: { field: 'severity', type: 'ordinal',
                    axis: { title: 'Missing Curb Ramp Severity', labelAngle: 0 } },
                  y: { aggregate: 'count', type: 'quantitative', axis: { title: '' } },
                },
              },
              {
                height: subPlotHeight,
                width: subPlotWidth,
                data: { values: obstacles },
                mark: 'bar',
                encoding: {
                  x: { field: 'severity', type: 'ordinal',
                    axis: { title: 'Obstacle Severity', labelAngle: 0 } },
                  y: { aggregate: 'count', type: 'quantitative', axis: { title: '' } },
                },
              },
            ],
            config: {
              axis: {
                titleFontSize: 10,
              },
            },
          };

          const chart2 = {
            hconcat: [
              {
                height: subPlotHeight,
                width: subPlotWidth,
                data: { values: surfaceProblems },
                mark: 'bar',
                encoding: {
                  x: { field: 'severity', type: 'ordinal',
                    axis: { title: 'Surface Problem Severity', labelAngle: 0 } },
                  y: { aggregate: 'count', type: 'quantitative', axis: { title: '# of labels' } },
                },
              },
              {
                height: subPlotHeight,
                width: subPlotWidth,
                data: { values: crosswalks },
                mark: 'bar',
                encoding: {
                  x: { field: 'severity', type: 'ordinal',
                    axis: { title: 'Marked Crosswalk Severity', labelAngle: 0 } },
                  y: { aggregate: 'count', type: 'quantitative', axis: { title: '' } },
                },
              },
            ],
            config: {
              axis: {
                titleFontSize: 10,
              },
            },
          };

          vega.embed('#severity-histograms', chart, opt);
          vega.embed('#severity-histograms2', chart2, opt);
        });

        $.getJSON('/adminapi/neighborhoodCompletionRate', (data) => {
          // Determine height of the chart based on the number of neighborhoods.
          const chartHeight = 150 + (data.length * 30);

          // Make charts showing neighborhood completion rate.
          for (let j = 0; j < data.length; j++) {
            data[j].rate *= 100.0; // change from proportion to percent
          }
          const stats = Admin.getSummaryStats(data, 'rate');
          $('#neighborhood-std').html(`${(stats.std).toFixed(2)}%`);

          const coverageRateChartSortedByCompletion = {
            width: 700,
            height: chartHeight,
            data: {
              values: data, format: {
                type: 'json',
              },
            },
            mark: 'bar',
            encoding: {
              x: {
                field: 'rate', type: 'quantitative',
                axis: { title: 'Neighborhood Completion (%)' },
              },
              y: {
                field: 'name', type: 'nominal',
                axis: { title: 'Neighborhood', labelAngle: -45 },
                sort: { field: 'rate', op: 'max', order: 'ascending' },
              },
            },
            config: {
              axis: { titleFontSize: 16, labelFontSize: 13 },
            },
          };

          const coverageRateChartSortedAlphabetically = {
            width: 700,
            height: chartHeight,
            data: {
              values: data, format: {
                type: 'json',
              },
            },
            mark: 'bar',
            encoding: {
              x: {
                field: 'rate', type: 'quantitative',
                axis: { title: 'Neighborhood Completion (%)' },
              },
              y: {
                field: 'name', type: 'nominal',
                axis: { title: 'Neighborhood', labelAngle: -45 },
                sort: { field: 'name', op: 'max', order: 'descending' },
              },
            },
            config: {
              axis: { titleFontSize: 16, labelFontSize: 13 },
            },
          };
          vega.embed('#neighborhood-completion-rate', coverageRateChartSortedByCompletion, opt);

          document.getElementById('neighborhood-completion-sort-button').addEventListener('click', () => {
            vega.embed('#neighborhood-completion-rate', coverageRateChartSortedByCompletion, opt);
          });
          document.getElementById('neighborhood-alphabetical-sort-button').addEventListener('click', () => {
            vega.embed('#neighborhood-completion-rate', coverageRateChartSortedAlphabetically, opt);
          });

          const histOpts = {
            col: 'rate', xAxisTitle: 'Neighborhood Completion (%)', xDomain: [0, 100],
            width: 400, height: 250, binStep: 10,
          };
          const coverageRateHist = Admin.getVegaLiteHistogram(data, stats.mean, stats.median, histOpts);

          vega.embed('#neighborhood-completed-distance', coverageRateHist, opt);
        });
        $.getJSON('/adminapi/validationCounts', (data) => {
          // Must have 50+ labels validated. Also removing AI user.
          const filteredData = data.filter((x) => {
            return x.count >= 50 && x.role !== 'AI';
          });

          // Convert to percentages.
          const pcts = filteredData.map((x) => {
            return { count: (x.agreed / x.count) * 100 };
          });

          const stats = Admin.getSummaryStats(pcts, 'count');
          $('#validation-agreed-std').html(`${(stats.std).toFixed(2)} %`);

          const histOpts = { xAxisTitle: 'User Accuracy (%)', xDomain: [0, 100], binStep: 5 };
          const coverageRateHist = Admin.getVegaLiteHistogram(pcts, stats.mean, stats.median, histOpts);
          vega.embed('#validation-agreed', coverageRateHist, opt);
        });
        $.getJSON('/contribution/auditCounts/all', (data) => {
          const stats = Admin.getSummaryStats(data, 'count');

          $('#audit-std').html(`${(stats.std).toFixed(2)} Street Audits`);

          const histOpts = {
            xAxisTitle: '# Street Audits per Day', xDomain: [0, stats.max], width: 250, binStep: 50, legendOffset: -80,
          };
          const hist = Admin.getVegaLiteHistogram(data, stats.mean, stats.median, histOpts);

          const chart = {
            data: { values: data },
            hconcat: [
              {
                height: 300,
                width: 550,
                layer: [
                  {
                    mark: 'bar',
                    encoding: {
                      x: {
                        field: 'date',
                        type: 'temporal',
                        axis: { title: 'Date', labelAngle: 0 },
                      },
                      y: {
                        field: 'count',
                        type: 'quantitative',
                        axis: {
                          title: '# Street Audits per Day',
                        },
                      },
                    },
                  },
                  { // creates lines marking summary statistics
                    data: { values: [
                      { stat: 'mean', value: stats.mean }, { stat: 'median', value: stats.median }],
                    },
                    mark: 'rule',
                    encoding: {
                      y: {
                        field: 'value', type: 'quantitative',
                        axis: { labels: false, ticks: false, title: '' },
                        scale: { domain: [0, stats.max] },
                      },
                      color: {
                        field: 'stat', type: 'nominal', scale: { range: ['pink', 'orange'] },
                        legend: false,
                      },
                      size: {
                        value: 1,
                      },
                    },
                  },
                ],
                resolve: { y: { scale: 'independent' } },
              },
              hist,
            ],
            config: {
              axis: {
                titleFontSize: 16,
              },
            },
          };
          vega.embed('#audit-count-chart', chart, opt);
        });
        $.getJSON('/userapi/labelCounts/all', (data) => {
          const stats = Admin.getSummaryStats(data, 'count');
          $('#label-std').html(`${(stats.std).toFixed(2)} Labels`);

          const histOpts = {
            xAxisTitle: '# Labels per Day', xDomain: [0, stats.max], width: 250, binStep: 200, legendOffset: -80,
          };
          const hist = Admin.getVegaLiteHistogram(data, stats.mean, stats.median, histOpts);

          const chart = {
            data: { values: data },
            hconcat: [
              {
                height: 300,
                width: 550,
                layer: [
                  {
                    mark: 'bar',
                    encoding: {
                      x: {
                        field: 'date',
                        type: 'temporal',
                        axis: { title: 'Date', labelAngle: 0 },
                      },
                      y: {
                        field: 'count',
                        type: 'quantitative',
                        axis: {
                          title: '# Labels per Day',
                        },
                      },
                    },
                  },
                  { // creates lines marking summary statistics
                    data: { values: [
                      { stat: 'mean', value: stats.mean }, { stat: 'median', value: stats.median }],
                    },
                    mark: 'rule',
                    encoding: {
                      y: {
                        field: 'value', type: 'quantitative',
                        axis: { labels: false, ticks: false, title: '' },
                        scale: { domain: [0, stats.max] },
                      },
                      color: {
                        field: 'stat', type: 'nominal', scale: { range: ['pink', 'orange'] },
                        legend: false,
                      },
                      size: {
                        value: 2,
                      },
                    },
                  },
                ],
                resolve: { y: { scale: 'independent' } },
              },
              hist,
            ],
            config: {
              axis: {
                titleFontSize: 16,
              },
            },
          };
          vega.embed('#label-count-chart', chart, opt);
        });
        $.getJSON('/userapi/validationCounts/all', (data) => {
          const stats = Admin.getSummaryStats(data, 'count');
          $('#validation-std').html(`${(stats.std).toFixed(2)} Validations`);

          const histOpts = {
            xAxisTitle: '# Validations per Day', xDomain: [0, stats.max], width: 250, binStep: 200, legendOffset: -80,
          };
          const hist = Admin.getVegaLiteHistogram(data, stats.mean, stats.median, histOpts);

          const chart = {
            data: { values: data },
            hconcat: [
              {
                height: 300,
                width: 550,
                layer: [
                  {
                    mark: 'bar',
                    encoding: {
                      x: {
                        field: 'date',
                        type: 'temporal',
                        axis: { title: 'Date', labelAngle: 0 },
                      },
                      y: {
                        field: 'count',
                        type: 'quantitative',
                        axis: {
                          title: '# Validations per Day',
                        },
                      },
                    },
                  },
                  { // creates lines marking summary statistics
                    data: { values: [
                      { stat: 'mean', value: stats.mean }, { stat: 'median', value: stats.median }],
                    },
                    mark: 'rule',
                    encoding: {
                      y: {
                        field: 'value', type: 'quantitative',
                        axis: { labels: false, ticks: false, title: '' },
                        scale: { domain: [0, stats.max] },
                      },
                      color: {
                        field: 'stat', type: 'nominal', scale: { range: ['pink', 'orange'] },
                        legend: false,
                      },
                      size: {
                        value: 2,
                      },
                    },
                  },
                ],
                resolve: { y: { scale: 'independent' } },
              },
              hist,
            ],
            config: {
              axis: {
                titleFontSize: 16,
              },
            },
          };
          vega.embed('#validation-count-chart', chart, opt);
        });
        $.getJSON('/adminapi/userMissionCounts', (data) => {
          const allData = data.filter((user) => user.role !== 'AI');
          const regData = allData.filter((user) => user.role === 'Registered' || Admin.isResearcherRole(user.role));
          const anonData = allData.filter((user) => user.role === 'Anonymous');
          const turkerData = allData.filter((user) => user.role === 'Turker');

          const allStats = Admin.getSummaryStats(allData, 'count');
          const allFilteredStats = Admin.getSummaryStats(allData, 'count', { excludeResearchers: true });
          const regStats = Admin.getSummaryStats(regData, 'count');
          const regFilteredStats = Admin.getSummaryStats(regData, 'count', { excludeResearchers: true });
          const turkerStats = Admin.getSummaryStats(turkerData, 'count');
          const anonStats = Admin.getSummaryStats(anonData, 'count');

          $('#missions-std').html(`${(allFilteredStats.std).toFixed(2)} Missions`);
          $('#reg-missions-std').html(`${(regFilteredStats.std).toFixed(2)} Missions`);
          $('#turker-missions-std').html(`${(turkerStats.std).toFixed(2)} Missions`);
          $('#anon-missions-std').html(`${(anonStats.std).toFixed(2)} Missions`);

          const allHistOpts = {
            xAxisTitle: '# Missions per User (all)', xDomain: [0, allStats.max], width: 187,
            binStep: 15, legendOffset: -80,
          };
          const allFilteredHistOpts = {
            xAxisTitle: '# Missions per User (all)', xDomain: [0, allFilteredStats.max],
            width: 187, binStep: 15, legendOffset: -80, excludeResearchers: true,
          };
          const regHistOpts = {
            xAxisTitle: '# Missions per Registered User', xDomain: [0, regStats.max], width: 187,
            binStep: 10, legendOffset: -80,
          };
          const regFilteredHistOpts = {
            xAxisTitle: '# Missions per Registered User', width: 187, legendOffset: -80,
            xDomain: [0, regFilteredStats.max], excludeResearchers: true, binStep: 10,
          };
          const turkerHistOpts = {
            xAxisTitle: '# Missions per Turker User', xDomain: [0, turkerStats.max], width: 187,
            binStep: 15, legendOffset: -80,
          };
          const anonHistOpts = {
            xAxisTitle: '# Missions per Anon User', xDomain: [0, anonStats.max], width: 187,
            binStep: 1, legendOffset: -80,
          };

          const allChart = Admin.getVegaLiteHistogram(allData, allStats.mean, allStats.median, allHistOpts);
          const allFilteredChart = Admin.getVegaLiteHistogram(
            allData, allFilteredStats.mean, allFilteredStats.median, allFilteredHistOpts,
          );
          const regChart = Admin.getVegaLiteHistogram(regData, regStats.mean, regStats.median, regHistOpts);
          const regFilteredChart = Admin.getVegaLiteHistogram(
            regData, regFilteredStats.mean, regFilteredStats.median, regFilteredHistOpts,
          );
          const turkerChart = Admin.getVegaLiteHistogram(
            turkerData, turkerStats.mean, turkerStats.median, turkerHistOpts,
          );
          const anonChart = Admin.getVegaLiteHistogram(anonData, anonStats.mean, anonStats.median, anonHistOpts);

          // Only includes charts with data, because charts with no data prevent all charts from rendering.
          const combinedChart = { hconcat: [] };
          const combinedChartFiltered = { hconcat: [] };

          [allChart, regChart, turkerChart, anonChart].forEach((element) => {
            if (element.data.values.length > 0) combinedChart.hconcat.push(element);
          });

          [allFilteredChart, regFilteredChart, turkerChart, anonChart].forEach((element) => {
            if (element.data.values.length > 0) combinedChartFiltered.hconcat.push(element);
          });

          if (combinedChartFiltered.hconcat.length > 0) {
            vega.embed('#mission-count-chart', combinedChartFiltered, opt);
          }

          document.getElementById('mission-count-include-researchers-checkbox').addEventListener('click', (cb) => {
            if (cb.target.checked) {
              $('#missions-std').html(`${(allStats.std).toFixed(2)} Missions`);
              $('#reg-missions-std').html(`${(regStats.std).toFixed(2)} Missions`);
              if (combinedChart.hconcat.length > 0) {
                vega.embed('#mission-count-chart', combinedChart, opt);
              }
            } else {
              $('#missions-std').html(`${(allFilteredStats.std).toFixed(2)} Missions`);
              $('#reg-missions-std').html(`${(regFilteredStats.std).toFixed(2)} Missions`);
              if (combinedChartFiltered.hconcat.length > 0) {
                vega.embed('#mission-count-chart', combinedChartFiltered, opt);
              }
            }
          });
        });
        $.getJSON('/adminapi/labelCounts', (data) => {
          const allData = data.filter((user) => user.role !== 'AI');
          const regData = allData.filter((user) => user.role === 'Registered' || Admin.isResearcherRole(user.role));
          const turkerData = allData.filter((user) => user.role === 'Turker');
          const anonData = allData.filter((user) => user.role === 'Anonymous');

          const allStats = Admin.getSummaryStats(allData, 'count');
          const allFilteredStats = Admin.getSummaryStats(allData, 'count', { excludeResearchers: true });
          const regStats = Admin.getSummaryStats(regData, 'count');
          const regFilteredStats = Admin.getSummaryStats(regData, 'count', { excludeResearchers: true });
          const turkerStats = Admin.getSummaryStats(turkerData, 'count');
          const anonStats = Admin.getSummaryStats(anonData, 'count');

          $('#all-labels-std').html(`${(allFilteredStats.std).toFixed(2)} Labels`);
          $('#reg-labels-std').html(`${(regFilteredStats.std).toFixed(2)} Labels`);
          $('#turker-labels-std').html(`${(turkerStats.std).toFixed(2)} Labels`);
          $('#anon-labels-std').html(`${(anonStats.std).toFixed(2)} Labels`);

          const allHistOpts = {
            xAxisTitle: '# Labels per User (all)', xDomain: [0, allStats.max], width: 187,
            binStep: 500, legendOffset: -80,
          };
          const allFilteredHistOpts = {
            xAxisTitle: '# Labels per User (all)', xDomain: [0, allFilteredStats.max],
            width: 187, binStep: 500, legendOffset: -80, excludeResearchers: true,
          };
          const regHistOpts = {
            xAxisTitle: '# Labels per Registered User', xDomain: [0, regStats.max], width: 187,
            binStep: 500, legendOffset: -80,
          };
          const regFilteredHistOpts = {
            xAxisTitle: '# Labels per Registered User', width: 187, legendOffset: -80,
            xDomain: [0, regFilteredStats.max], excludeResearchers: true, binStep: 500,
          };
          const turkerHistOpts = {
            xAxisTitle: '# Labels per Turker User', xDomain: [0, turkerStats.max], width: 187,
            binStep: 500, legendOffset: -80,
          };
          const anonHistOpts = {
            xAxisTitle: '# Labels per Anon User', xDomain: [0, anonStats.max],
            width: 187, legendOffset: -80, binStep: 2,
          };

          const allChart = Admin.getVegaLiteHistogram(allData, allStats.mean, allStats.median, allHistOpts);
          const allFilteredChart = Admin.getVegaLiteHistogram(
            allData, allFilteredStats.mean, allFilteredStats.median, allFilteredHistOpts,
          );
          const regChart = Admin.getVegaLiteHistogram(regData, regStats.mean, regStats.median, regHistOpts);
          const regFilteredChart = Admin.getVegaLiteHistogram(
            regData, regFilteredStats.mean, regFilteredStats.median, regFilteredHistOpts,
          );
          const turkerChart = Admin.getVegaLiteHistogram(
            turkerData, turkerStats.mean, turkerStats.median, turkerHistOpts,
          );
          const anonChart = Admin.getVegaLiteHistogram(anonData, anonStats.mean, anonStats.median, anonHistOpts);

          // Only includes charts with data, because charts with no data prevent all charts from rendering.
          const combinedChart = { hconcat: [] };
          const combinedChartFiltered = { hconcat: [] };

          [allChart, regChart, turkerChart, anonChart].forEach((element) => {
            if (element.data.values.length > 0) combinedChart.hconcat.push(element);
          });

          [allFilteredChart, regFilteredChart, turkerChart, anonChart].forEach((element) => {
            if (element.data.values.length > 0) combinedChartFiltered.hconcat.push(element);
          });

          if (combinedChartFiltered.hconcat.length > 0) {
            vega.embed('#label-count-hist', combinedChartFiltered, opt);
          }

          document.getElementById('label-count-include-researchers-checkbox').addEventListener('click', (cb) => {
            if (cb.target.checked) {
              $('#all-labels-std').html(`${(allStats.std).toFixed(2)} Labels`);
              $('#reg-labels-std').html(`${(regStats.std).toFixed(2)} Labels`);
              if (combinedChart.hconcat.length > 0) {
                vega.embed('#label-count-hist', combinedChart, opt);
              }
            } else {
              $('#all-labels-std').html(`${(allFilteredStats.std).toFixed(2)} Labels`);
              $('#reg-labels-std').html(`${(regFilteredStats.std).toFixed(2)} Labels`);
              if (combinedChartFiltered.hconcat.length > 0) {
                vega.embed('#label-count-hist', combinedChartFiltered, opt);
              }
            }
          });
        });
        $.getJSON('/adminapi/validationCounts', (data) => {
          const allData = data.filter((user) => user.role !== 'AI');
          const regData = allData.filter((user) => user.role === 'Registered' || Admin.isResearcherRole(user.role));
          const turkerData = allData.filter((user) => user.role === 'Turker');
          const anonData = allData.filter((user) => user.role === 'Anonymous');

          const allStats = Admin.getSummaryStats(allData, 'count');
          const allFilteredStats = Admin.getSummaryStats(allData, 'count', { excludeResearchers: true });
          const regStats = Admin.getSummaryStats(regData, 'count');
          const regFilteredStats = Admin.getSummaryStats(regData, 'count', { excludeResearchers: true });
          const turkerStats = Admin.getSummaryStats(turkerData, 'count');
          const anonStats = Admin.getSummaryStats(anonData, 'count');

          $('#all-validation-std').html(`${(allFilteredStats.std).toFixed(2)} labels`);
          $('#reg-validation-std').html(`${(regFilteredStats.std).toFixed(2)} labels`);
          $('#turker-validation-std').html(`${(turkerStats.std).toFixed(2)} labels`);
          $('#anon-validation-std').html(`${(anonStats.std).toFixed(2)} labels`);

          const allHistOpts = {
            xAxisTitle: '# Labels Validated per User (all)', xDomain: [0, allStats.max], width: 187,
            binStep: 50, legendOffset: -80,
          };
          const allFilteredHistOpts = {
            xAxisTitle: '# Labels Validated per User (all)', xDomain: [0, allFilteredStats.max],
            width: 187, binStep: 50, legendOffset: -80, excludeResearchers: true,
          };
          const regHistOpts = {
            xAxisTitle: '# Labels Validated per Registered User', xDomain: [0, regStats.max], width: 187,
            binStep: 50, legendOffset: -80,
          };
          const regFilteredHistOpts = {
            xAxisTitle: '# Labels Validated per Registered User', width: 187, legendOffset: -80,
            xDomain: [0, regFilteredStats.max], excludeResearchers: true, binStep: 50,
          };
          const turkerHistOpts = {
            xAxisTitle: '# Labels Validated per Turker User', xDomain: [0, turkerStats.max], width: 187,
            binStep: 50, legendOffset: -80,
          };
          const anonHistOpts = {
            xAxisTitle: '# Labels Validated per Anon User', xDomain: [0, anonStats.max],
            width: 187, legendOffset: -80, binStep: 2,
          };

          const allChart = Admin.getVegaLiteHistogram(allData, allStats.mean, allStats.median, allHistOpts);
          const allFilteredChart = Admin.getVegaLiteHistogram(
            allData, allFilteredStats.mean, allFilteredStats.median, allFilteredHistOpts,
          );
          const regChart = Admin.getVegaLiteHistogram(regData, regStats.mean, regStats.median, regHistOpts);
          const regFilteredChart = Admin.getVegaLiteHistogram(
            regData, regFilteredStats.mean, regFilteredStats.median, regFilteredHistOpts,
          );
          const turkerChart = Admin.getVegaLiteHistogram(
            turkerData, turkerStats.mean, turkerStats.median, turkerHistOpts,
          );
          const anonChart = Admin.getVegaLiteHistogram(anonData, anonStats.mean, anonStats.median, anonHistOpts);

          // Only includes charts with data, because charts with no data prevent all charts from rendering.
          const combinedChart = { hconcat: [] };
          const combinedChartFiltered = { hconcat: [] };

          [allChart, regChart, turkerChart, anonChart].forEach((element) => {
            if (element.data.values.length > 0) combinedChart.hconcat.push(element);
          });

          [allFilteredChart, regFilteredChart, turkerChart, anonChart].forEach((element) => {
            if (element.data.values.length > 0) combinedChartFiltered.hconcat.push(element);
          });

          if (combinedChartFiltered.hconcat.length > 0) {
            vega.embed('#validation-count-hist', combinedChartFiltered, opt);
          }

          document.getElementById('validation-count-include-researchers-checkbox').addEventListener('click', (cb) => {
            if (cb.target.checked) {
              $('#all-validation-std').html(`${(allStats.std).toFixed(2)} Validations`);
              $('#reg-validation-std').html(`${(regStats.std).toFixed(2)} Validations`);
              if (combinedChart.hconcat.length > 0) {
                vega.embed('#validation-count-hist', combinedChart, opt);
              }
            } else {
              $('#all-validation-std').html(`${(allFilteredStats.std).toFixed(2)} Validations`);
              $('#reg-validation-std').html(`${(regFilteredStats.std).toFixed(2)} Validations`);
              if (combinedChartFiltered.hconcat.length > 0) {
                vega.embed('#validation-count-hist', combinedChartFiltered, opt);
              }
            }
          });
        });
        $.getJSON('/adminapi/allSignInCounts', (data) => {
          const stats = Admin.getSummaryStats(data, 'count');
          const filteredStats = Admin.getSummaryStats(data, 'count', { excludeResearchers: true });
          const histOpts = { xAxisTitle: '# Logins per Registered User', binStep: 5, xDomain: [0, stats.max] };
          const histFilteredOpts = { xAxisTitle: '# Logins per Registered User', xDomain: [0, filteredStats.max],
            excludeResearchers: true };

          const chart = Admin.getVegaLiteHistogram(data, stats.mean, stats.median, histOpts);
          const filteredChart = Admin.getVegaLiteHistogram(
            data, filteredStats.mean, filteredStats.median, histFilteredOpts,
          );

          $('#login-count-std').html(`${(filteredStats.std).toFixed(2)} Logins`);
          vega.embed('#login-count-chart', filteredChart, opt);

          document.getElementById('login-count-include-researchers-checkbox').addEventListener('click', (cb) => {
            if (cb.target.checked) {
              $('#login-count-std').html(`${(stats.std).toFixed(2)} Logins`);
              vega.embed('#login-count-chart', chart, opt);
            } else {
              $('#login-count-std').html(`${(filteredStats.std).toFixed(2)} Logins`);
              vega.embed('#login-count-chart', filteredChart, opt);
            }
          });
        });

        this.#graphsLoaded = true;
      } else if (e.target.id === 'labels' && this.#labelsLoaded === false) {
        $('#tabs-4').css('visibility', 'hidden');
        this.#loadingGif.css('visibility', 'visible');
        Admin.loadLabels().then(() => {
          this.#labelsLoaded = true;
          this.#loadingGif.css('visibility', 'hidden');
          $('#tabs-4').css('visibility', 'visible');
        }).catch((error) => {
          console.error('Error loading labels:', error);
        });
      } else if (e.target.id === 'users' && this.#usersLoaded === false) {
        $('#tabs-5').css('visibility', 'hidden');
        this.#loadingGif.css('visibility', 'visible');
        Admin.loadUserStats().then(() => {
          this.#usersLoaded = true;
          this.#loadingGif.css('visibility', 'hidden');
          $('#tabs-5').css('visibility', 'visible');
        }).catch((error) => {
          console.error('Error loading users:', error);
        });
      } else if (e.target.id === 'teams' && this.#teamsLoaded === false) {
        $('#tabs-7').css('visibility', 'hidden');
        this.#loadingGif.css('visibility', 'visible');
        Admin.loadTeams().then(() => {
          this.#teamsLoaded = true;
          this.#loadingGif.css('visibility', 'hidden');
          $('#tabs-7').css('visibility', 'visible');
        }).catch((error) => {
          console.error('Error loading teams:', error);
        });
      } else if (e.target.id === 'api-analytics' && this.#apiAnalyticsLoaded === false) {
        this.#apiAnalyticsLoaded = true;
        this.#apiAnalytics.load().catch((error) => {
          console.error('Error loading API analytics:', error);
        });
      }
    });
  }

  static changeRole(e) {
    const userId = $(e.target).parent() // <li>
      .parent() // <ul>
      .siblings('button')
      .attr('id')
      .substring('userRoleDropdown'.length); // userId is stored in id of dropdown
    const newRole = e.target.innerText;
    const data = {
      user_id: userId,
      role_id: newRole,
    };
    $.ajax({
      async: true,
      contentType: 'application/json; charset=utf-8',
      url: '/adminapi/setRole',
      method: 'PUT',
      data: JSON.stringify(data),
      dataType: 'json',
      success(result) {
        // Change dropdown button to reflect new role.
        const button = $(`#userRoleDropdown${result.user_id}`);
        const buttonContents = button.html();
        button.html(buttonContents.replace(/Registered|Turker|Researcher|Administrator|Anonymous/g, result.role));
      },
      error(result) {
        console.error(result);
      },
    });
  }

  static changeTeam(e) {
    const userId = $(e.target).parent() // <li>
      .parent() // <ul>
      .siblings('button')
      .attr('id')
      .substring('userTeamDropdown'.length); // userId is stored in id of dropdown.
    const teamId = parseInt(e.target.getAttribute('data-team-id'), 10);
    const teamName = e.target.innerText;

    $.ajax({
      async: true,
      url: `/userapi/setUserTeam?userId=${userId}&teamId=${teamId}`,
      method: 'PUT',
      success(result) {
        // Change dropdown button to reflect new team.
        const button = document.getElementById(`userTeamDropdown${result.user_id}`);
        button.childNodes[0].nodeValue = ` ${teamName} `;
      },
      error(result) {
        console.error(result);
      },
    });
  }

  static changeTeamStatus(e) {
    const teamId = $(e.target).parent() // <li>
      .parent() // <ul>
      .siblings('button')
      .attr('id')
      .substring('statusDropdown'.length); // teamId is stored in id of dropdown.

    const newStatus = e.target.innerText === 'Open';
    const data = {
      open: newStatus,
    };

    $.ajax({
      async: true,
      contentType: 'application/json; charset=utf-8',
      url: `/adminapi/updateTeamStatus/${teamId}`,
      method: 'PUT',
      data: JSON.stringify(data),
      dataType: 'json',
      success(result) {
        // Change dropdown button to reflect new status.
        const button = document.getElementById(`statusDropdown${result.team_id}`);
        button.childNodes[0].nodeValue = ` ${newStatus === true ? 'Open' : 'Closed'} `;
      },
      error(xhr, status, error) {
        console.error('Error updating team status:', error);
      },
    });
  }

  static changeTeamVisibility(e) {
    const teamId = $(e.target).parent() // <li>
      .parent() // <ul>
      .siblings('button')
      .attr('id')
      .substring('visibilityDropdown'.length); // teamId is stored in id of dropdown.

    const newVisibility = e.target.innerText === 'Visible';
    const data = {
      visible: newVisibility,
    };

    $.ajax({
      async: true,
      contentType: 'application/json; charset=utf-8',
      url: `/adminapi/updateTeamVisibility/${teamId}`,
      method: 'PUT',
      data: JSON.stringify(data),
      dataType: 'json',
      success(result) {
        // Change dropdown button to reflect new visibility.
        const button = document.getElementById(`visibilityDropdown${result.team_id}`);
        button.childNodes[0].nodeValue = ` ${newVisibility === true ? 'Visible' : 'Hidden'} `;
      },
      error(xhr, status, error) {
        console.error('Error updating team visibility:', error);
      },
    });
  }

  clearPlayCache() {
    $.ajax({
      url: '/adminapi/clearPlayCache',
      method: 'PUT',
      success() {
        clearPlayCacheSuccess.innerHTML = i18next.t('admin-clear-play-cache');
      },
    });
  }

  static formatDistance(distance) {
    const distanceMetricAbbrev = i18next.t('common:unit-distance-abbreviation');

    let distanceInCorrectUnits = distance;
    if (i18next.t('common:measurement-system') === 'metric') {
      distanceInCorrectUnits = util.math.milesToKms(distance);
    }
    return `${distanceInCorrectUnits.toFixed(1)} ${distanceMetricAbbrev}`;
  }

  static formatPercent(percent) {
    return isNaN(percent) ? '-' : `${Math.round(percent)}%`;
  }

  static calculatePercent(value, total) {
    return (value / total) * 100;
  }

  static formatCountWithPercent(count, total) {
    const percent = Admin.calculatePercent(count, total);
    return `${count} (${Admin.formatPercent(percent)})`;
  }

  static formatDistanceWithPercent(distance, total) {
    const percent = Admin.calculatePercent(distance, total);
    return `${Admin.formatDistance(distance)} (${Admin.formatPercent(percent)})`;
  }

  /**
   * Fetches street coverage stats and fills in the Street Edge and Overview tables.
   * @returns {Promise<void>} Resolves once the tables have been populated.
   */
  static loadStreetEdgeData() {
    return new Promise((resolve) => {
      $.getJSON('/adminapi/getCoverageData', (data) => {
        const totalAuditedStreets = data.street_counts.total;
        const totalAuditedDistance = data.street_distance.total;

        // Set Audited Streets section of the Street Edge Table.
        const auditedCounts = data.street_counts.audited;
        $('#street-count-audited-all')
          .text(Admin.formatCountWithPercent(auditedCounts.any_quality.all_users, totalAuditedStreets));
        $('#street-count-audited-high-quality')
          .text(Admin.formatCountWithPercent(auditedCounts.high_quality.all_users, totalAuditedStreets));

        $('#street-count-total').text(totalAuditedStreets);

        $('#street-count-audited-registered-all')
          .text(Admin.formatCountWithPercent(auditedCounts.any_quality.registered, totalAuditedStreets));
        $('#street-count-audited-registered-high-quality')
          .text(Admin.formatCountWithPercent(auditedCounts.high_quality.registered, totalAuditedStreets));

        $('#street-count-audited-anonymous-all')
          .text(Admin.formatCountWithPercent(auditedCounts.any_quality.anonymous, totalAuditedStreets));
        $('#street-count-audited-anonymous-high-quality')
          .text(Admin.formatCountWithPercent(auditedCounts.high_quality.anonymous, totalAuditedStreets));

        $('#street-count-audited-turker-all')
          .text(Admin.formatCountWithPercent(auditedCounts.any_quality.turker, totalAuditedStreets));
        $('#street-count-audited-turker-high-quality')
          .text(Admin.formatCountWithPercent(auditedCounts.high_quality.turker, totalAuditedStreets));

        $('#street-count-audited-researcher-all')
          .text(Admin.formatCountWithPercent(auditedCounts.any_quality.researcher, totalAuditedStreets));
        $('#street-count-audited-researcher-high-quality')
          .text(Admin.formatCountWithPercent(auditedCounts.high_quality.researcher, totalAuditedStreets));

        // Set the explored street count fields in Overview table.
        $('#explored-street-count-all-time').text(auditedCounts.with_overlap.all_time);
        $('#explored-street-count-today').text(auditedCounts.with_overlap.today);
        $('#explored-street-count-week').text(auditedCounts.with_overlap.week);

        // Set Distance section of the Street Edge Table.
        const auditedDist = data.street_distance.audited;
        $('#street-distance-audited-all')
          .text(Admin.formatDistanceWithPercent(auditedDist.any_quality.all_users, totalAuditedDistance));
        $('#street-distance-audited-high-quality')
          .text(Admin.formatDistanceWithPercent(auditedDist.high_quality.all_users, totalAuditedDistance));

        $('#street-distance-total').text(Admin.formatDistance(totalAuditedDistance));

        $('#street-distance-registered-all')
          .text(Admin.formatDistanceWithPercent(auditedDist.any_quality.registered, totalAuditedDistance));
        $('#street-distance-registered-high-quality')
          .text(Admin.formatDistanceWithPercent(auditedDist.high_quality.registered, totalAuditedDistance));

        $('#street-distance-anonymous-all')
          .text(Admin.formatDistanceWithPercent(auditedDist.any_quality.anonymous, totalAuditedDistance));
        $('#street-distance-anonymous-high-quality')
          .text(Admin.formatDistanceWithPercent(auditedDist.high_quality.anonymous, totalAuditedDistance));

        $('#street-distance-turker-all')
          .text(Admin.formatDistanceWithPercent(auditedDist.any_quality.turker, totalAuditedDistance));
        $('#street-distance-turker-high-quality')
          .text(Admin.formatDistanceWithPercent(auditedDist.high_quality.turker, totalAuditedDistance));

        $('#street-distance-researcher-all')
          .text(Admin.formatDistanceWithPercent(auditedDist.any_quality.researcher, totalAuditedDistance));
        $('#street-distance-researcher-high-quality')
          .text(Admin.formatDistanceWithPercent(auditedDist.high_quality.researcher, totalAuditedDistance));

        // Set the audited distance fields in Overview table.
        $('#audited-distance-all-time').text(Admin.formatDistance(data.street_distance.audited.with_overlap.all_time));
        $('#audited-distance-today').text(Admin.formatDistance(data.street_distance.audited.with_overlap.today));
        $('#audited-distance-week').text(Admin.formatDistance(data.street_distance.audited.with_overlap.week));

        resolve();
      });
    });
  }

  /**
   * Fetches contributor counts and fills in the user count cells across the dashboard tables.
   * @returns {Promise<void>} Resolves once the counts have been filled in.
   */
  static loadUserCountData() {
    return new Promise((resolve) => {
      $.getJSON('/adminapi/getNumUsersContributed', (data) => {
        for (const userCount of data) {
          const taskCompleted = userCount.task_completed_only ? 'task_completed' : 'no_task_constraint';
          const highQuality = userCount.high_quality_only ? 'high_quality' : 'any_quality';
          const { tool_used, role, time_interval } = userCount;
          $(`#user-count-${tool_used}-${role}-${time_interval}-${taskCompleted}-${highQuality}`)
            .text(userCount.count);
        }
        resolve();
      });
    });
  }

  /**
   * Fetches contribution time stats and fills in the corresponding dashboard cells.
   * @returns {Promise<void>} Resolves once the stats have been filled in.
   */
  static loadContributionTimeData() {
    return new Promise((resolve) => {
      $.getJSON('/adminapi/getContributionTimeStats', (data) => {
        for (const timeStat of data) {
          const time = timeStat.time ? timeStat.time.toFixed(2) : 'NA';
          const unit = timeStat.time ? (timeStat.stat === 'explore_per_100m' ? ' min' : ' hr') : '';
          $(`#time-${timeStat.stat}-${timeStat.time_interval}`).text(time + unit);
        }
        resolve();
      });
    });
  }

  /**
   * Fetches label counts per label type and fills in the corresponding dashboard cells.
   * @returns {Promise<void>} Resolves once the counts have been filled in.
   */
  static loadLabelCountData() {
    return new Promise((resolve) => {
      $.getJSON('/adminapi/getLabelCountStats', (data) => {
        for (const labelCount of data) {
          $(`#label-count-${labelCount.label_type}-${labelCount.time_interval}`).text(labelCount.count);
        }
        resolve();
      });
    });
  }

  /**
   * Fetches validation counts and fills in the Overview activities table and the Analytics per-label-type table.
   * @returns {Promise<void>} Resolves once the tables have been populated.
   */
  static loadValidationCountData() {
    return new Promise((resolve) => {
      $.getJSON('/adminapi/getValidationCountStats', (data) => {
        // Fill in the validation section on the Overview tab's Activities table.
        for (const timeInterval of ['all_time', 'today', 'week']) {
          const currData = data.filter(
            (x) => x.label_type === 'All' && x.validator === 'Both' && x.time_interval === timeInterval,
          );
          const totalCount = currData.find((x) => x.result === 'All').count;
          $(`#val-count-All-${timeInterval}`).text(totalCount);
          for (const valResult of ['Agree', 'Disagree', 'Unsure']) {
            const resultCount = currData.find((x) => x.result === valResult).count;
            $(`#val-count-${valResult}-${timeInterval}`).text(Admin.formatCountWithPercent(resultCount, totalCount));
          }
        }

        // Fill in the Validations Per Label Type table in the Analytics tab.
        for (const labelType of ['All'].concat(util.misc.PRIMARY_LABEL_TYPES)) {
          for (const validator of ['Human', 'AI', 'Both']) {
            const currData = data.filter(
              (x) => x.time_interval === 'all_time' && x.validator === validator && x.label_type === labelType,
            );
            const totalCount = currData.find((x) => x.result === 'All').count;
            $(`#val-count-${labelType}-All-${validator}`).text(totalCount);
            for (const valResult of ['Agree', 'Disagree', 'Unsure']) {
              const resultCount = currData.find((x) => x.result === valResult).count;
              const percentage = Admin.calculatePercent(resultCount, totalCount);
              $(`#val-count-${labelType}-${valResult}-${validator}`).text(Admin.formatPercent(percentage));
            }
          }
        }

        resolve();
      });
    });
  }

  /**
   * Fetches recent comments and adds them to the comments DataTable.
   * @returns {Promise<void>} Resolves once the table has been populated; rejects if the request fails.
   */
  static loadComments() {
    return new Promise((resolve, reject) => {
      $.getJSON('/adminapi/getRecentComments', (data) => {
        const commentsTable = $('#comments-table').DataTable();

        // Add the rows using the DataTable API.
        // TODO we do want to sort descending, but if I switch to ascending, it doesn't change...
        commentsTable.rows.add(data.map((c) => {
          return [
            `<a href='/admin/user/${c.username}'>${c.username}</a>`,
            // NOTE defining how we can sort based on timestamps is defined in admin/index.scala.html.
            `<span class="timestamp" data-timestamp="${c.timestamp}">${new Date(c.timestamp)}</span>`,
            `<a class="show-comment-location" href="#" data-heading="${c.heading}" data-pitch="${c.pitch}"
              data-zoom="${c.zoom}" data-label-id="${c.label_id}">${c.pano_id}</a>`,
            c.comment_type,
            c.comment,
            c.label_id,
          ];
        })).order([1, 'desc']).draw();

        resolve();
      }).fail((error) => {
        console.error('Failed to load comments', error);
        reject(error);
      });
    });
  }

  /**
   * Fetches recent label metadata and adds it to the labels DataTable.
   * @returns {Promise<void>} Resolves once the table has been populated; rejects if the request fails.
   */
  static loadLabels() {
    return new Promise((resolve, reject) => {
      $.getJSON('/adminapi/getRecentLabelMetadata', (data) => {
        const labelTable = $('#label-table').DataTable();

        // Add the rows using the DataTable API.
        // TODO we do want to sort descending, but if I switch to ascending, it doesn't change...
        labelTable.rows.add(data.map((l) => {
          return [
            `<a href='/admin/user/${l.username}'>${l.username}</a>`,
            // NOTE defining how we can sort based on timestamps is defined in admin/index.scala.html.
            `<span class="timestamp" data-timestamp="${l.timestamp}">${new Date(l.timestamp)}</span>`,
            l.label_type,
            l.severity,
            l.tags.join(', '),
            l.description,
            l.validations.agree,
            l.validations.disagree,
            l.validations.unsure,
            `<a class="labelView" data-label-id="${l.label_id}" href="#">View</a>`,
          ];
        })).order([1, 'desc']).draw();

        resolve();
      }).fail((error) => {
        console.error('Failed to load comments', error);
        reject(error);
      });
    });
  }

  /**
   * Fetches user stats, adds them to the users DataTable, and wires up the role/team dropdowns.
   * @returns {Promise<void>} Resolves once the table has been populated; rejects if the request fails.
   */
  static loadUserStats() {
    return new Promise((resolve, reject) => {
      $.getJSON('/adminapi/getUserStats', (data) => {
        const usersTable = $('#user-table').DataTable();

        // Add the rows using the DataTable API.
        // TODO we do want to sort descending, but if I switch to ascending, it doesn't change...
        usersTable.rows.add(data.user_stats.map((u) => {
          const roleDropdown = u.role !== 'Owner'
            ? `
              <div class="dropdown role-dropdown">
                <button class="btn btn-default dropdown-toggle" type="button"
                  id="userRoleDropdown${u.userId}" data-toggle="dropdown">
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
            `
            : u.role;

          const teamDropdown = `
            <div class="dropdown team-dropdown">
              <button class="btn btn-default dropdown-toggle" type="button"
                id="userTeamDropdown${u.userId}" data-toggle="dropdown">
                ${u.team || 'None'} <span class="caret"></span>
              </button>
              <ul class="dropdown-menu" role="menu" aria-labelledby="userTeamDropdown${u.userId}">
                ${data.teams.map((team) => `
                  <li><a href="#!" class="change-team"data-team-id="${team.teamId}">${team.name}</a></li>
                `).join('')}
                <li><a href="#!" class="change-team" data-team-id="-1">None</a></li>
              </ul>
            </div>`;

          const signUpTime = u.signUpTime ? new Date(u.signUpTime) : '';
          const lastSignInTime = u.lastSignInTime ? new Date(u.lastSignInTime) : '';

          return [
            `<a href='/admin/user/${u.username}'>${u.username}</a>`,
            u.userId,
            u.email,
            roleDropdown,
            teamDropdown,
            u.highQuality,
            u.labels,
            u.ownValidated,
            `${(u.ownValidatedAgreedPct * 100).toFixed(0)}%`,
            u.othersValidated,
            `${(u.othersValidatedAgreedPct * 100).toFixed(0)}%`,
            `<span class="timestamp"">${signUpTime}</span>`,
            `<span class="timestamp"">${lastSignInTime}</span>`,
            u.signInCount,
          ];
        })).order([6, 'desc']).draw();

        // Add listeners to update role or team from dropdown.
        usersTable.on('click', '.role-dropdown a', Admin.changeRole);
        usersTable.on('click', '.team-dropdown a', Admin.changeTeam);

        resolve();
      }).fail((error) => {
        console.error('Failed to load user stats', error);
        reject(error);
      });
    });
  }

  /**
   * Fetches the list of teams and adds them to the teams DataTable.
   * @returns {Promise<void>} Resolves once the table has been populated; rejects if the request fails.
   */
  static loadTeams() {
    return new Promise((resolve, reject) => {
      $.getJSON('/userapi/getTeams', (data) => {
        const teamsTable = $('#teams-table').DataTable();

        // Add the rows using the DataTable API.
        teamsTable.rows.add(data.map((t) => {
          const statusDropdown = `
            <div class="dropdown status-dropdown">
              <button class="btn btn-default dropdown-toggle" type="button"
                id="statusDropdown${t.teamId}" data-toggle="dropdown">
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
              <button class="btn btn-default dropdown-toggle" type="button"
                id="visibilityDropdown${t.teamId}" data-toggle="dropdown">
                ${t.visible ? 'Visible' : 'Hidden'}
                <span class="caret"></span>
              </button>
              <ul class="dropdown-menu" role="menu" aria-labelledby="visibilityDropdown${t.teamId}">
                <li><a href="#!" class="change-visibility" data-team-id="${t.teamId}"
                  data-visibility="true">Visible</a></li>
                <li><a href="#!" class="change-visibility" data-team-id="${t.teamId}"
                  data-visibility="false">Hidden</a></li>
              </ul>
            </div>`;

          return [
            t.name,
            t.description,
            statusDropdown,
            visibilityDropdown,
          ];
        })).order([0, 'asc']).draw();

        // Add listeners to update status or visibility from dropdown.
        teamsTable.on('click', '.status-dropdown a', Admin.changeTeamStatus);
        teamsTable.on('click', '.visibility-dropdown a', Admin.changeTeamVisibility);

        resolve();
      }).fail((error) => {
        console.error('Failed to load teams', error);
        reject(error);
      });
    });
  }
}
