/**
 * Drives the "Create a team" dialog (shared by the dashboard and leaderboard).
 *
 * Any `.ud-create-team-btn` opens the dialog; submitting POSTs to /userapi/createTeam. The server validates the name
 * (length + profanity/abuse guard) and auto-joins the creator, so on success we just reload. Server-side validation
 * messages are shown inline. CSRF is handled by the global fetch wrapper (AppManager).
 */
class TeamCreate {
    /** Wires the open buttons and the form. Safe to call when the dialog isn't present (no-op). */
    static init() {
        const dialog = document.getElementById('ud-create-team-dialog');
        const form = document.getElementById('ud-create-team-form');
        if (!dialog || !form) return;

        document.querySelectorAll('.ud-create-team-btn').forEach(btn =>
            btn.addEventListener('click', () => {
                TeamCreate.#reset();
                dialog.showModal();
            }));

        const cancel = document.getElementById('ud-team-cancel');
        if (cancel) cancel.addEventListener('click', () => dialog.close());

        form.addEventListener('submit', e => {
            e.preventDefault();
            TeamCreate.#submit();
        });
    }

    /** Clears the form + any prior error. */
    static #reset() {
        const err = document.getElementById('ud-team-error');
        err.hidden = true;
        err.textContent = '';
        document.getElementById('ud-create-team-form').reset();
    }

    /** Posts the new team and reloads on success, or shows the server's error inline. */
    static async #submit() {
        const name = document.getElementById('ud-team-name').value.trim();
        const description = document.getElementById('ud-team-desc').value.trim();
        const submitBtn = document.getElementById('ud-team-submit');

        if (name.length < 2) {
            TeamCreate.#showError('Team name must be at least 2 characters.');
            return;
        }

        submitBtn.setAttribute('disabled', 'disabled');
        try {
            const res = await fetch('/userapi/createTeam', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ name, description })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.success) {
                window.location.reload();
                return;
            }
            TeamCreate.#showError(data.error || 'Could not create the team. Please try again.');
        } catch (e) {
            console.error('Create team failed', e);
            TeamCreate.#showError('Network error — please try again.');
        } finally {
            submitBtn.removeAttribute('disabled');
        }
    }

    /**
     * @param {string} msg - Error text to show in the dialog.
     */
    static #showError(msg) {
        const err = document.getElementById('ud-team-error');
        err.textContent = msg;
        err.hidden = false;
    }
}

document.addEventListener('DOMContentLoaded', () => TeamCreate.init());
