window.util = window.util || {};

/**
 * Shared rules for the deep-link query strings our pages read and write.
 *
 * Several independent writers touch the same query string on one page — the LabelMap runs MapSidebarUrlSync (filter
 * params) and LabelDetail.syncUrlLabelId (the open label) side by side, and StorySection strips its own marker after
 * a sign-in bounce. They have to agree byte for byte on how a param is serialized, or each rewrite re-encodes the
 * others' params and they fight over the URL on every toggle. That agreement lives here rather than in a comment
 * repeated at each call site.
 */
util.url = util.url || {};

/**
 * Serializes query params, leaving commas and colons as themselves.
 *
 * `URLSearchParams` percent-encodes both, but RFC 3986 allows them unencoded in a query (`pchar` covers sub-delims,
 * ":" and "@"), and our params are comma-separated lists of values that can carry a colon — so a shared LabelMap
 * link reads `tags=CurbRamp:narrow` instead of `tags=CurbRamp%3Anarrow` (#4782).
 *
 * @param {URLSearchParams} params The params to serialize.
 * @returns {string} The query string, without a leading "?" (empty when there are no params).
 */
util.url.serialize = (params) => params.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');

/**
 * Rewrites the current URL's query in place, without adding a history entry.
 *
 * `replaceState` rather than `pushState` throughout: filter toggles and popup opens are not navigation, and rapid
 * toggling would otherwise bury the page the user arrived from under dozens of back-button steps.
 *
 * @param {URL} url The URL whose pathname/params/hash should become the current URL.
 */
util.url.replaceQuery = (url) => {
  const query = util.url.serialize(url.searchParams);
  window.history.replaceState(null, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`);
};

/**
 * Writes a repeatable list param: one occurrence per value (`?tags=a&tags=b`), or none when the list is empty.
 *
 * Use this — rather than joining on commas — for any list whose values are free-form text. Tag names are the case
 * that forces it: they are author-written label text, and at least one real tag contains a comma ("yellow box,
 * accessibility features not visible"), which a joined list shreds into two values that match nothing (#4783).
 * Lists of closed values (severities, label types, validation options) stay comma-joined, since they can't contain
 * a comma and one readable param beats several.
 *
 * @param {URLSearchParams} params The params to write into.
 * @param {string} name The param name.
 * @param {string[]} values The values; an empty array deletes the param.
 */
util.url.setRepeated = (params, name, values) => {
  params.delete(name);
  for (const value of values) params.append(name, value);
};

/**
 * Reads a repeatable list param, accepting both the repeated form and the older comma-joined one.
 *
 * An occurrence that is itself a valid value is taken whole, so a value containing a comma survives; only an
 * occurrence that isn't valid on its own is split on commas, which is what an old shared link looks like. Validating
 * before splitting is what makes the two forms distinguishable, so `isValid` has to be a real membership test
 * against what the page can render, not a shape check.
 *
 * @param {URLSearchParams} params The params to read.
 * @param {string} name The param name.
 * @param {(value: string) => boolean} isValid Whether a value is one this page recognizes.
 * @returns {?string[]} The valid values, `[]` when the param is present but selects nothing, `null` when absent.
 */
util.url.getRepeated = (params, name, isValid) => {
  const occurrences = params.getAll(name);
  if (occurrences.length === 0) return null;
  return occurrences.flatMap((occurrence) => {
    const whole = occurrence.trim();
    if (isValid(whole)) return [whole];
    return whole.split(',').map((value) => value.trim()).filter(isValid);
  });
};
