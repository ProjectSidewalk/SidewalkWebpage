/**
 * Replays a single audit task on the /admin/task page: an animated map + pano walkthrough of the user's route.
 */
class AdminTask {
  #params;
  #auditTaskId;
  #map;
  #panoManager;

  // Animation state.
  #colorScheme;
  #currStep = 0;
  #paused = false;
  #featuresData;
  #currentTimestamp;
  #currPano = null;
  #renderedLabels = { type: 'FeatureCollection', features: [] };
  #timedata = [];
  #timeToPlaybackTask;
  #speedMultiplier;
  #maxWaitMs;
  #skipFillTimeMs;
  #userMarkerEl;
  #userMarker;

  /**
   * @param {Object} params - auditTaskId, mapboxApiKey, viewerType, and accessToken.
   */
  constructor(params) {
    this.#params = params;
    this.#auditTaskId = params.auditTaskId;

    mapboxgl.accessToken = params.mapboxApiKey;
    this.#map = new mapboxgl.Map({
      container: 'admin-task-choropleth',
      style: 'mapbox://styles/mapbox/light-v11?optimize=true',
      maxZoom: 19,
      minZoom: 8.25,
      scrollZoom: false,
      doubleClickZoom: true,
    }).addControl(new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') }));

    this.#colorScheme = util.misc.getLabelColors();
    this.#speedMultiplier = document.getElementById('speed-multiplier').value;
    this.#maxWaitMs = document.getElementById('wait-time').value * 1000;
    this.#skipFillTimeMs = document.getElementById('fill-time').value * 1000;

    // Add marker to show user's location and orientation.
    this.#userMarkerEl = document.createElement('div');
    this.#userMarkerEl.className = 'user-marker';

    // Plays/Pauses the stream.
    document.getElementById('control-btn').addEventListener('click', () => {
      const label = document.getElementById('control-btn').innerHTML;
      if (label === 'Play') {
        this.#playAnimation();
      } else if (label === 'Pause') {
        this.#pauseAnimation();
      }
    });

    // Pause playback whenever any input field is changed.
    for (const input of document.getElementsByTagName('input')) {
      input.addEventListener('input', () => this.#pauseAnimation());
    }

    this.#init();
  }

  /**
   * Fetches the audit-task path, initializes the pano, and sets up the map once loaded.
   */
  #init() {
    fetch(`/adminapi/auditpath/${this.#auditTaskId}`)
      .then((response) => response.json())
      .then(async (data) => {
        if (data.features.length === 0) {
          alert('No data for this audit task.');
          return;
        }

        this.#featuresData = data.features;
        this.#currentTimestamp = this.#featuresData[0].properties.timestamp;

        // Initialize the pano.
        if (!this.#panoManager) {
          this.#panoManager = await PopupPanoManager.create(
            document.getElementById('svholder'), null, true,
            this.#params.viewerType, this.#params.accessToken);
        }
        this.#panoManager.setPano(this.#featuresData[0].properties.panoId, {
          heading: this.#featuresData[0].properties.heading,
          pitch: this.#featuresData[0].properties.pitch,
          zoom: this.#featuresData[0].properties.zoom,
        });

        // Once the map has loaded, add the user marker and layer for the labels.
        this.#map.on('load', () => {
          const initialCoordinate = this.#featuresData[0].geometry.coordinates;
          this.#map.jumpTo({ center: initialCoordinate, zoom: 17 });

          this.#userMarker = new mapboxgl.Marker(this.#userMarkerEl)
            .setLngLat(initialCoordinate)
            .setRotation(this.#featuresData[0].properties.heading)
            .addTo(this.#map);

          this.#map.addSource('labels', { type: 'geojson', data: this.#renderedLabels });
          this.#map.addLayer({
            id: 'labels',
            type: 'circle',
            source: 'labels',
            paint: {
              'circle-radius': 5,
              'circle-opacity': 0.75,
              'circle-stroke-opacity': 1,
              'circle-stroke-width': 1,
              'circle-color': ['get', 'circleColor'],
              'circle-stroke-color': '#fff',
            },
          });
        });
      })
      .catch((error) => console.error(error));
  }

  /**
   * Plays the animation again by recalculating the stream from where it stopped.
   */
  #playAnimation() {
    this.#paused = false;
    this.#resumeAnimation();
    document.getElementById('control-btn').innerHTML = 'Pause';
  }

  /**
   * Pauses the animation by saving the last moment where it stopped.
   */
  #pauseAnimation() {
    this.#paused = true;
    document.getElementById('control-btn').innerHTML = 'Play';
  }

  /**
   * Executes the current step in the animation and schedules the next one.
   */
  #doNextStep() {
    let duration = this.#featuresData[this.#currStep].properties.timestamp - this.#currentTimestamp;
    this.#currentTimestamp = this.#featuresData[this.#currStep].properties.timestamp;

    // If there is a greater than 30 second pause, log to console but only pause for 1 second.
    if (duration > this.#maxWaitMs) {
      duration = this.#skipFillTimeMs;
    }

    // After the duration, execute the next step (assuming playback has not been paused).
    setTimeout(() => {
      if (this.#paused) return;
      const action = this.#featuresData[this.#currStep];

      // Set orientation of the user.
      this.#userMarker.setLngLat(action.geometry.coordinates).setRotation(action.properties.heading);

      // Update the pano POV.
      if (this.#currPano === null || this.#currPano !== action.properties.panoId) {
        this.#currPano = action.properties.panoId;
        this.#panoManager.setPano(action.properties.panoId, {
          heading: action.properties.heading,
          pitch: action.properties.pitch,
          zoom: action.properties.zoom,
        });
      } else {
        this.#panoManager.panoViewer.setPov({
          heading: action.properties.heading,
          pitch: action.properties.pitch,
          zoom: action.properties.zoom,
        });
      }

      // Update the location of the map.
      this.#map.flyTo({ center: action.geometry.coordinates });

      // Add to the list of events.
      this.#showEvent(action.properties);

      // If this step included adding a label, draw the label on the map and pano.
      if ('label' in action.properties && this.#renderedLabels.features.filter((x) => x.properties.label_id === action.properties.label.label_id).length === 0) {
        const label = action.properties.label;
        label.circleColor = this.#colorScheme[label.label_type].fillStyle;
        this.#renderedLabels.features.push({ type: 'Feature', properties: label, geometry: { type: 'Point', coordinates: label.coordinates } });
        this.#map.getSource('labels').setData(this.#renderedLabels);

        // Plain-object label shape consumed by PopupPanoManager. See LabelPopup.js for full field shape.
        const popupLabel = {
          labelId: label.label_id,
          label_type: label.label_type,
          canvasX: label.canvasX,
          canvasY: label.canvasY,
          originalCanvasWidth: util.EXPLORE_CANVAS_WIDTH,
          originalCanvasHeight: util.EXPLORE_CANVAS_HEIGHT,
          pov: {
            heading: action.properties.heading,
            pitch: action.properties.pitch,
            zoom: action.properties.zoom,
          },
          aiGenerated: false,
        };
        this.#panoManager.renderLabel(popupLabel);
      }

      // Update the UI for time elapsed.
      document.getElementById('current-time-label').innerText = `${(this.#timedata[this.#currStep] / 1000).toFixed(0)}`;
      const progress = 360 * (this.#timedata[this.#currStep] / this.#timeToPlaybackTask);
      document.getElementById('timeline-active').style.width = `${progress}px`;
      document.getElementById('timeline-handle').style.left = `${progress}px`;

      // Either move on to the next step or show that the animation is over.
      this.#currStep += 1;
      if (this.#currStep < this.#featuresData.length) {
        this.#doNextStep();
      } else {
        document.getElementById('control-btn').innerHTML = 'Refresh page to replay';
      }
    }, duration);
  }

  /**
   * Recalculates the timestamps for each step and resumes the animation.
   */
  #resumeAnimation() {
    this.#speedMultiplier = document.getElementById('speed-multiplier').value;
    this.#maxWaitMs = document.getElementById('wait-time').value * 1000;
    this.#skipFillTimeMs = document.getElementById('fill-time').value * 1000;

    // Calculate how long the task takes to replay.
    let totalSkips = 0;
    let skippedTime = 0;
    for (let i = 0; i < this.#featuresData.length; i++) {
      // This controls the speed.
      this.#featuresData[i].properties.timestamp /= this.#speedMultiplier;

      if (i > 0) {
        let duration = this.#featuresData[i].properties.timestamp - this.#featuresData[i - 1].properties.timestamp;
        if (duration > this.#maxWaitMs) {
          totalSkips += 1;
          skippedTime += duration;
          duration = this.#skipFillTimeMs;
        }
        this.#timedata[i] = this.#timedata[i - 1] + duration;
      } else {
        this.#timedata[i] = 0;
      }
    }
    this.#timeToPlaybackTask = this.#timedata[this.#featuresData.length - 1];
    this.#currentTimestamp = this.#featuresData[this.#currStep].properties.timestamp;

    // Log the time to replay the task to the console.
    console.log(`Speed being multiplied by ${this.#speedMultiplier}.`);
    console.log(`${totalSkips} pauses over ${this.#maxWaitMs / 1000} sec totalling ${skippedTime / 1000} sec. Pausing for ${this.#skipFillTimeMs / 1000} sec during those.`);
    console.log(`Time to replay task: ${this.#timeToPlaybackTask / 1000} seconds`);

    document.getElementById('total-time-label').innerHTML = (this.#timeToPlaybackTask / 1000).toFixed(0);

    this.#doNextStep();
  }

  /**
   * Prepends a new event entry to the events list, fading it in.
   * @param {Object} data - Event properties, including 'action' and 'note'.
   */
  #showEvent(data) {
    const eventsHolder = $('#eventsHolder');
    const event = $('<div class=\'event\'/>');
    event.append(`<div class='type'>${data.action}</div>`);
    event.append(`<div class='desc'>${data.note}</div>`);

    event.hide().prependTo(eventsHolder).fadeIn(300);
  }
}
