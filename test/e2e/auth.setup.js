/**
 * Setup project: registers a throwaway user account and saves its session as storageState for the specs
 * that need a registered (non-anonymous) user — anonymous sessions can't reach /dashboard (WithSignedIn()).
 *
 * Uses the two-step CSRF flow from .claude/skills/create-registered-user-account/SKILL.md: GET /signUp for
 * a session + CSRF token, then POST the sign-up form. A 303 with a local-authenticator cookie means success.
 */
const {test: setup, expect, request} = require('@playwright/test');
const {STORAGE_STATE} = require('./fixtures');

setup('register a user account', async ({baseURL}) => {
  const ctx = await request.newContext({baseURL});
  const signUpHtml = await (await ctx.get('/signUp')).text();
  // Every registered-user spec depends on this setup, so fail legibly if the sign-up page's shape changes
  // rather than with a null-index TypeError.
  const csrfMatch = signUpHtml.match(/name="csrfToken" value="([^"]+)"/);
  expect(csrfMatch, 'csrfToken hidden input not found in the /signUp HTML').toBeTruthy();
  const csrfToken = csrfMatch[1];
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
