/** A `fetch` stub that answers by URL, plus the small helpers the page suites share (#5840). */

/**
 * Answers `fetch` by URL prefix. A key may lead with a method (`'PUT /adminapi/setRole'`); the longest matching key
 * wins. A route gives the JSON body, `{ status, body }` for an error, an Error to reject with, or a function of
 * (url, options) giving or promising any of those. An unrouted request fails the test; the stub is undone after each.
 * @param {Record<string, any>} routes - Key to answer.
 * @param {(url: string) => string} [normalize] - Rewrites each URL before it's matched, e.g. to drop a tracking param.
 * @returns {import('vitest').Mock} The stub, whose calls are the requests made.
 */
export function routeFetch(routes, normalize = (url) => url) {
  const stub = vi.fn(async (input, options = {}) => {
    const url = normalize(String(input));
    const method = options.method || 'GET';
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => {
      const [m, prefix] = k.includes(' ') ? k.split(' ') : [null, k];
      return (m === null || m === method) && url.startsWith(prefix);
    });
    if (key === undefined) throw new Error(`unrouted fetch: ${method} ${url}`);
    let answer = routes[key];
    if (typeof answer === 'function') answer = await answer(url, options);
    if (answer instanceof Error) throw answer;
    const { status = 200, body } = isErrorSpec(answer) ? answer : { body: answer };
    return {
      ok: status < 400,
      status,
      // AdminShell.mutate reads replies as text.
      text: async () => (body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body))),
      json: async () => {
        if (body === undefined) throw new SyntaxError('Unexpected end of JSON input');
        return structuredClone(body);
      },
    };
  });
  vi.stubGlobal('fetch', stub);
  return stub;
}

/**
 * @param {import('vitest').Mock} stub - A stub from `routeFetch`.
 * @returns {Array<{method: string, url: string, body: any}>} The requests made so far, any JSON body parsed.
 */
export const sentRequests = (stub) => stub.mock.calls.map(([url, options = {}]) => ({
  method: options.method || 'GET',
  url: String(url),
  body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body,
}));

/** @returns {boolean} Whether an answer is `{ status, body }`, not a body that happens to have a `status`. */
function isErrorSpec(answer) {
  return typeof answer?.status === 'number' && Object.keys(answer).every((key) => key === 'status' || key === 'body');
}

/** Lets pending promise callbacks (fetches, map loads) run. */
export const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** @returns {string} An element's text, whitespace collapsed. */
export const textOf = (el) => el.textContent.replace(/\s+/g, ' ').trim();
