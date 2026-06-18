---
name: create-registered-user-account
description: Creates a registered user account for testing purposes in the rare cases where a registered user authentication is required (e.g., to access /dashboard)
---

If you need a full registered account (e.g. to test role-based routes), do a two-step sign-up. The POST requires a CSRF token extracted from the GET response:

```bash
# Step 1: get a session + CSRF token
curl -s -c /tmp/sidewalk_cookies.txt "http://localhost:9000/signUp" > /tmp/signup.html

# Step 2: extract token and POST the form
CSRF=$(grep -o 'name="csrfToken" value="[^"]*"' /tmp/signup.html | head -1 | sed 's/name="csrfToken" value="//;s/"//')
curl -s -b /tmp/sidewalk_cookies.txt -c /tmp/sidewalk_cookies.txt -X POST "http://localhost:9000/signUp" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "csrfToken=${CSRF}&username=claudetest&email=claude%40test.com&password=TestPass123&passwordConfirm=TestPass123&serviceHours=NO&terms=true&returnUrl=%2F"
```
A `303` redirect to `/` (with a `local-authenticator` cookie) means success.
