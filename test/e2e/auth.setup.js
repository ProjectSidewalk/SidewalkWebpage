/**
 * Setup project: saves the two signed-in sessions the specs reuse as storageState.
 *
 * - A throwaway registered user, for the pages anonymous sessions can't reach (/dashboard is WithSignedIn()). Uses the
 *   two-step CSRF flow from .claude/skills/create-registered-user-account/SKILL.md: GET /signUp for a session + CSRF
 *   token, then POST the sign-up form. A 303 with a local-authenticator cookie means success.
 * - The CI seed's Owner (test/e2e/fixtures/gen_ci_seed.py), for admin.spec.js. Owner rather than Administrator because
 *   two admin pages are Owner-only. A dev database has no such account, so this skips there and fails on CI.
 */
const fs = require('fs');
const {test: setup, expect, request} = require('@playwright/test');
const {STORAGE_STATE, ADMIN_STORAGE_STATE} = require('./fixtures');

/**
 * Loads a form page and returns its CSRF token, failing legibly (rather than with a null-index TypeError) if the
 * page's shape changes, since every signed-in spec depends on this setup.
 *
 * @param {import('@playwright/test').APIRequestContext} ctx - The context to load it in.
 * @param {string} path - The form page.
 * @returns {Promise<string>} The token.
 */
async function csrfTokenFrom(ctx, path) {
  const csrfMatch = (await (await ctx.get(path)).text()).match(/name="csrfToken" value="([^"]+)"/);
  expect(csrfMatch, `csrfToken hidden input not found in the ${path} HTML`).toBeTruthy();
  return csrfMatch[1];
}

setup('register a user account', async ({baseURL}) => {
  const ctx = await request.newContext({baseURL});
  const csrfToken = await csrfTokenFrom(ctx, '/signUp');
  // Unique per run so reruns against a long-lived dev DB never collide with an existing account.
  const username = `ci-smoke-${Date.now()}`;
  const response = await ctx.post('/signUp', {
    form: {
      csrfToken,
      username,
      email: `${username}@example.com`,
      password: 'TestPass123',
      passwordConfirm: 'TestPass123',
      serviceHours: 'NO',
      terms: 'true',
      returnUrl: '/',
    },
    maxRedirects: 0,
  });
  expect(response.status(), 'POST /signUp should 303 on success').toBe(303);
  await ctx.storageState({path: STORAGE_STATE});
  await ctx.dispose();
});

setup('sign in as the seeded Owner', async ({baseURL}) => {
  // A file left by an earlier run against another database would hand admin.spec.js a session for nobody.
  fs.rmSync(ADMIN_STORAGE_STATE, {force: true});
  const ctx = await request.newContext({baseURL});
  const csrfToken = await csrfTokenFrom(ctx, '/signIn');
  // The XHR header makes the controller answer 200/401 JSON instead of redirecting either way.
  const response = await ctx.post('/authenticate/credentials', {
    form: {csrfToken, email: 'ciSeedOwner', password: 'ciSeedOwnerPass1', rememberMe: 'false', returnUrl: '/'},
    headers: {'X-Requested-With': 'XMLHttpRequest'},
  });
  if (!process.env.CI) {
    setup.skip(response.status() === 401, 'no ciSeedOwner in this database (only CI seeds it); admin.spec.js skips');
  }
  expect(response.status(), 'signing in as ciSeedOwner failed: is test/e2e/fixtures/ci-seed.sql loaded?').toBe(200);
  await ctx.storageState({path: ADMIN_STORAGE_STATE});
  await ctx.dispose();
});
