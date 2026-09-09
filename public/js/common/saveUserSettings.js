/**
 * Posts to the user-settings save endpoint, shared by the Settings page and the welcome page's privacy toggles so the
 * endpoint's contract — the headers it wants, the `{success, error}` envelope it answers with — is written once.
 *
 * Callers build their own payload and render their own status; this only does the transport and the error decoding.
 * CSRF is added by the global fetch wrapper.
 *
 * @param {string} url - The save endpoint.
 * @param {Object} payload - Fields to write. Every field is optional server-side, so one left out is left alone.
 * @returns {Promise<{ok: boolean, error: ?string}>} `error` is already localized when the server supplied it.
 */
async function saveUserSettings(url, payload) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) return { ok: true, error: null };
    // Server errors arrive already localized (Play messages keyed off the request language).
    return { ok: false, error: data.error || null };
  } catch (e) {
    console.error('Failed to save settings', e);
    return { ok: false, error: null };
  }
}
