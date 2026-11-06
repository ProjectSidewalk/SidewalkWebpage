---
name: create-registered-user-account
description: Creates a registered or admin test account on the local dev app, for pages that need one (e.g. /dashboard, the admin pages, role checks). Always allowed on the local dev DB.
---

Test accounts on the local dev DB are always fine to make; no need to ask. Anonymous sessions (`/anonSignUp`) cover
most pages; use this when a page needs a registered account or an admin.

## Registered account

The sign-up POST needs a CSRF token from the GET. Passwords need an uppercase letter, a lowercase letter and a number.

```bash
J=/tmp/sidewalk_cookies.txt   # use a scratchpad path in a Claude session
U=claudetest
PW="Qa$(openssl rand -hex 10)"   # keep it beside the cookie jar if you'll sign in again
curl -s -c "$J" "http://localhost:9000/signUp" > /tmp/signup.html
CSRF=$(grep -o 'name="csrfToken" value="[^"]*"' /tmp/signup.html | head -1 | sed 's/name="csrfToken" value="//;s/"//')
curl -s -D - -o /dev/null -b "$J" -c "$J" -X POST "http://localhost:9000/signUp" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "csrfToken=${CSRF}&username=${U}&email=${U}%40test.com&password=${PW}&passwordConfirm=${PW}&terms=true&returnUrl=%2F" \
  | grep -i '^location'
```

A `303` to `/welcome?next=...` means success, and the jar now holds the signed-in session. A `303` back to `/signUp`
means the form was refused; the reason is in the `PLAY_FLASH` cookie in the jar (its middle part is base64 JSON).

## Admin account

Sign up as above, then raise the role on the dev DB. Roles live in the shared `sidewalk_login` schema, so this covers
every city, and the session in the jar picks it up on the next request:

```bash
docker exec projectsidewalk-db psql -U sidewalk -d sidewalk -c "UPDATE sidewalk_login.user_role SET role = 'Administrator'
  WHERE user_id = (SELECT user_id FROM sidewalk_login.sidewalk_user WHERE username = '${U}') RETURNING role;"
```

Use `'Owner'` for an owner-only action. Check it took: `curl -s -o /dev/null -w "%{http_code}" -b "$J" http://localhost:9000/admin`
gives `200`.

This write is only ever for the local dev DB, never test or prod.

To drive a browser as this user, load the jar's cookies into Playwright (`context.addCookies`, domain `localhost`).
