/**
 * Powers the user dashboard: the neighborhood choropleth map plus the team-membership controls.
 */
class Progress {
  #userId;
  #admin;

  /**
     * @param {string} userId - The dashboard's subject user.
     * @param {boolean} admin - Whether the dashboard is being viewed by an admin.
     */
  constructor(userId, admin) {
    this.#userId = userId;
    this.#admin = admin;
  }

  /**
     * Builds the dashboard map and wires up the team controls.
     *
     * Async because the label popup viewer must be created before the map params are assembled;
     * a constructor cannot be async, so callers use this factory instead.
     *
     * @param {Function} $ - jQuery, required by CreatePSMap.
     * @param {string} mapboxApiKey
     * @param {Function} viewerType - Pano viewer constructor (GSV / Mapillary / Infra3d).
     * @param {string} viewerAccessToken
     * @param {string} userId
     * @param {boolean} admin
     * @param {string} currentUsername
     * @returns {Promise<Progress>}
     */
  static async create($, mapboxApiKey, viewerType, viewerAccessToken, userId, admin, currentUsername) {
    const params = {
      mapName: 'user-dashboard-choropleth',
      mapStyle: 'mapbox://styles/mapbox/light-v11?optimize=true',
      mapboxApiKey,
      zoomCorrection: -0.5,
      mapboxLogoLocation: 'bottom-right',
      neighborhoodsURL: '/neighborhoods',
      completionRatesURL: '/adminapi/neighborhoodCompletionRate',
      streetsURL: `/contribution/streets?userId=${encodeURIComponent(userId)}`,
      labelsURL: `/userapi/labels?userId=${encodeURIComponent(userId)}`,
      neighborhoodFillMode: 'singleColor',
      neighborhoodTooltip: admin ? 'none' : 'completionRate',
      neighborhoodFillColor: '#5d6d6b',
      neighborhoodFillOpacity: 0.1,
      uiSource: admin ? 'AdminUserDashboard' : 'UserMap',
      navigationControlPosition: 'top-right',
      popupLabelViewer: await LabelPopup(admin, viewerType, viewerAccessToken, currentUsername),
    };

    const progress = new Progress(userId, admin);
    CreatePSMap($, params).then((m) => {
      progress.map = m[0];
      progress.mapData = m[4];
      setRegionFocus(progress.map);
      new MapSidebarFilter(progress.map, progress.mapData, { highQualityFilter: false });
    });
    window.map = progress;

    progress.#bindTeamControls();
    return progress;
  }

  /**
     * Attaches click handlers to the team-membership and create-team controls.
     */
  #bindTeamControls() {
    document.querySelectorAll('.put-user-team').forEach((el) => {
      el.addEventListener('click', () => this.#putUserTeam(el, null));
    });
    const saveButton = document.getElementById('save-team-button');
    if (saveButton) saveButton.addEventListener('click', () => this.#createTeam());
  }

  /**
     * Moves the user between teams, logs the change, and reloads.
     *
     * @param {{id: string}} element - The clicked control; its id has the form "from-startTeam-to-endTeam".
     * @param {?string} newTeam - Explicit destination team (used when creating a team); falls back to the id.
     */
  #putUserTeam(element, newTeam) {
    const parsedId = element.id.split('-');
    const startTeam = parsedId[1];
    const endTeam = newTeam ? newTeam : parsedId[3];
    fetch(`/userapi/setUserTeam?userId=${this.#userId}&teamId=${endTeam}`, { method: 'PUT' })
      .then(() => {
        if (!this.#admin) {
          if (startTeam && startTeam !== '0') {
            window.logWebpageActivity(`Click_module=leaving_team=${startTeam}`);
          }
          if (endTeam && endTeam !== '0') {
            window.logWebpageActivity(`Click_module=joining_team=${endTeam}`);
          }
        }
        window.location.reload();
      })
      .catch((result) => console.error('Error logging activity:', result));
  }

  /**
     * Validates and creates a new team, then joins the user to it.
     */
  #createTeam() {
    const teamName = util.escapeHTML(document.getElementById('team-name-input').value);
    const teamDescription = util.escapeHTML(document.getElementById('team-description-input').value);

    const specialCharRegex = /[&<>"']/;
    if (specialCharRegex.test(teamName) || specialCharRegex.test(teamDescription)) {
      alert(i18next.t('characters-not-allowed'));
      return;
    }

    fetch('/userapi/createTeam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: teamName, description: teamDescription }),
    })
      .then((response) => response.json())
      .then((result) => {
        const newTeam = result.team_id;
        const userTeamElement = document.querySelector('.put-user-team');
        window.logWebpageActivity(`Click_module=create_team=team_id=${newTeam}`);
        this.#putUserTeam(userTeamElement || { id: '-1' }, newTeam);
      })
      .catch((result) => console.error(result));
  }
}
