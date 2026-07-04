/**
 * Admin controls on a user's profile page: quality/volunteer/infra3D toggles and the task-flag datepickers.
 */
class AdminUser {
  #userId;

  /**
     * @param {string} username - The profile user's username.
     * @param {string} userId - The profile user's id.
     * @param {boolean} serviceHoursUser - Whether the user is currently marked as a volunteer.
     * @param {boolean} infra3dAccess - Whether the user currently has infra3D access.
     */
  constructor(username, userId, serviceHoursUser, infra3dAccess) {
    this.#userId = userId;

    // Initialize datepicker calendars for setting flags. Bootstrap datepicker is a jQuery plugin.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    $('.datepicker').datepicker({ autoclose: true, todayHighlight: true }).datepicker('update', tomorrow);

    document.getElementById('user-quality-dropdown').addEventListener('click', (e) => {
      const anchor = e.target.closest('a');
      if (anchor) this.#updateUserQuality(anchor);
    });

    document.getElementById('low-quality-set-flags').addEventListener('click', () => this.#setLowQualityDate(true));
    document.getElementById('low-quality-remove-flags').addEventListener('click', () => this.#setLowQualityDate(false));
    document.getElementById('incomplete-set-flags').addEventListener('click', () => this.#setIncompleteDate(true));
    document.getElementById('incomplete-remove-flags').addEventListener('click', () => this.#setIncompleteDate(false));

    // The infra3D checkbox is only rendered on cities that use infra3D imagery, so it may be absent.
    const infra3dCheckbox = document.getElementById('check-infra3d-access');
    if (infra3dCheckbox) {
      infra3dCheckbox.checked = Boolean(infra3dAccess);
      infra3dCheckbox.addEventListener('click', () => this.#setInfra3dAccess(infra3dCheckbox.checked));
    }

    const volunteerCheckbox = document.getElementById('check-volunteer');
    volunteerCheckbox.checked = Boolean(serviceHoursUser);
    volunteerCheckbox.addEventListener('click', () => this.#updateVolunteerStatus(volunteerCheckbox.checked));
  }

  /**
     * Sends a request to update a user's high_quality_manual column via a dropdown click.
     * @param {HTMLElement} anchor - The clicked dropdown option; its text is the chosen value.
     * @returns {Promise<void>}
     */
  #updateUserQuality(anchor) {
    const choice = anchor.innerText;
    const data = {
      user_id: this.#userId,
      quality: choice === 'true' ? true : (choice === 'false' ? false : null),
    };
    return fetch('/adminapi/setUserQualityManual', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then((response) => response.json())
      .then((result) => {
        // Owners and 'excluded' users can't have their quality set, so back end might give an error.
        if (result.status === 'Error') throw (result.message);

        // Change the adjacent 'High quality' column to the correct value.
        document.getElementById('stat-high-quality').textContent = result.new_user_quality;

        // Change dropdown button to reflect new quality selection.
        document.getElementById('user-quality-button').childNodes[0].nodeValue = ` ${choice} `;
      })
      .catch((error) => {
        console.error(error);
        alert(`Error updating user quality: ${error}`);
        return undefined;
      });
  }

  /**
     * PUT request to update the user's infra3D access.
     * @param {boolean} isChecked
     * @returns {Promise<void>}
     */
  #setInfra3dAccess(isChecked) {
    const data = { user_id: this.#userId, access: isChecked };
    return fetch('/adminapi/setInfra3dAccess', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then((response) => response.json())
      .then((result) => {
        // Only someone with infra3D access can grant it, so an error may be returned.
        if (result.status === 'Error') throw (result.message);
        alert('infra3D access updated successfully.');
      })
      .catch((error) => {
        console.error(error);
        alert(`Error updating infra3D access: ${error}`);
        return undefined;
      });
  }

  /**
     * PUT request to modify all of a specified flag for the user before a specified date.
     * @param {Date} date
     * @param {string} flag - One of "low_quality", "incomplete", or "stale".
     * @param {boolean} state
     */
  #setTaskFlagByDate(date, flag, state) {
    const data = { userId: this.#userId, date, flag, state };
    fetch('/adminapi/setTaskFlagsBeforeDate', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(data),
    })
      .then((response) => response.json())
      .then(() => this.#datePickedAlert(flag, true, date, state))
      .catch((result) => console.error(result));
  }

  /**
     * Set all tasks' low quality flag before the datepicker calendar's date.
     * @param {boolean} state
     */
  #setLowQualityDate(state) {
    this.#setTaskFlagByDate(new Date(document.getElementById('low-quality-date').value), 'low_quality', state);
  }

  /**
     * Set all tasks' incomplete flag before the datepicker calendar's date.
     * @param {boolean} state
     */
  #setIncompleteDate(state) {
    this.#setTaskFlagByDate(new Date(document.getElementById('incomplete-date').value), 'incomplete', state);
  }

  /**
     * Creates an alert when the flag datepicker is used.
     * @param {string} flag - One of "low_quality", "incomplete", or "stale".
     * @param {boolean} success
     * @param {Date} date
     * @param {boolean} state
     */
  #datePickedAlert(flag, success, date, state) {
    const alertEl = flag === 'low_quality'
      ? document.getElementById('low-quality-alert')
      : document.getElementById('incomplete-alert');
    let alertText;
    if (success) {
      alertText = state
        ? `Flags before ${new Date(date)} set to "${flag}".`
        : `"${flag}" flags before ${new Date(date)} cleared.`;
    } else {
      alertText = 'Flags failed to change.';
    }
    alertEl.textContent = alertText;
    alertEl.className = success ? 'alert alert-success' : 'alert alert-danger';
    alertEl.style.visibility = 'visible';
  }

  /**
     * PUT request to update the user's volunteer status.
     * @param {boolean} isChecked
     */
  #updateVolunteerStatus(isChecked) {
    const url = `/updateVolunteerStatus?userId=${this.#userId}&communityService=${isChecked}`;
    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
      .then((response) => response.json())
      .then(() => console.log('Volunteer status updated successfully.'))
      .catch((result) => console.error(result));
  }
}
