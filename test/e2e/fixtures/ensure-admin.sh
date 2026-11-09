#!/usr/bin/env bash
#
# Makes the e2e admin account (admin-account.json) on the app at :9000 and gives it the Administrator role.
#
# The app can't make an admin over HTTP, so the role is set in the database. The account itself comes from the real
# sign-up, so it gets every row a sign-up makes. Its password is committed on purpose: it exists only on dev and CI
# databases. Safe to re-run: a taken name's sign-up is refused, and the role update is idempotent. It ends by signing
# in, so an account left with another password fails here rather than in every admin spec.
#
# E2E_DB_ROLE writes the role. Defaults to the dev app's DATABASE_USER; CI, whose app runs outside Docker, passes
# postgres. WEB_CONTAINER and DB_CONTAINER follow the Makefile's web-container and db-container.
set -euo pipefail

BASE=http://localhost:9000
WEB_CONTAINER=${WEB_CONTAINER:-projectsidewalk-web}
DB_CONTAINER=${DB_CONTAINER:-projectsidewalk-db}
ACCOUNT=$(dirname "$0")/admin-account.json
field() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$ACCOUNT"; }
USERNAME=$(field username)
EMAIL=$(field email)
PASSWORD=$(field password)
ROLE=${E2E_DB_ROLE:-$(docker exec "$WEB_CONTAINER" printenv DATABASE_USER)}

JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

# Prints the CSRF token from a form page, starting a session in the cookie jar.
csrf_from() {
  local page token
  page=$(curl -s -c "$JAR" "$BASE$1") || { echo "error: no answer from $BASE$1 -- is the app up?" >&2; exit 1; }
  token=$(sed -n 's/.*name="csrfToken" value="\([^"]*\)".*/\1/p' <<< "$page" | head -1)
  [ -n "$token" ] || { echo "error: no CSRF token on $BASE$1" >&2; exit 1; }
  echo "$token"
}

CSRF=$(csrf_from /signUp)
curl -s -o /dev/null -b "$JAR" -c "$JAR" -X POST "$BASE/signUp" \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "username=$USERNAME" --data-urlencode "email=$EMAIL" \
  --data-urlencode "password=$PASSWORD" --data-urlencode "passwordConfirm=$PASSWORD" --data-urlencode "terms=true" \
  --data-urlencode "returnUrl=/"

# Empty output means the sign-up above was refused and no earlier run made the account either.
UPDATED=$(docker exec "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$ROLE" -d sidewalk -qtA -c "
  UPDATE sidewalk_login.user_role SET role = 'Administrator'
  WHERE user_id = (SELECT user_id FROM sidewalk_login.sidewalk_user WHERE username = '$USERNAME')
  RETURNING role;")
if [ "$UPDATED" != "Administrator" ]; then
  echo "error: no $USERNAME account to make an admin: its sign-up failed" >&2
  exit 1
fi

# A fresh session, so the sign-in below proves the password rather than riding on the sign-up's session.
: > "$JAR"
CSRF=$(csrf_from /signIn)
LOCATION=$(curl -s -o /dev/null -w '%{redirect_url}' -b "$JAR" -X POST "$BASE/authenticate/credentials" \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=$USERNAME" --data-urlencode "password=$PASSWORD")
if [ -z "$LOCATION" ] || [[ "$LOCATION" == */signIn* ]]; then
  echo "error: $USERNAME is an admin but admin-account.json's password doesn't sign it in; reset or delete the" \
    "account" >&2
  exit 1
fi
echo "$USERNAME is an Administrator"
