#!/usr/bin/env bash
#
# Makes the e2e admin account on the app at :9000 and gives it the Administrator role, for signInAsAdmin.
#
# The name and password are random, made on the first run and kept in test/e2e/.admin-account.json, which git ignores:
# a dev database's logins are a copy of production's and :9000 listens on the network, so a known admin password would
# open real users' data to anyone nearby. Delete the file to start over with a new account.
#
# The app can't make an admin over HTTP, so the role is set in the database; the account comes from the real sign-up,
# so it has every row a sign-up makes. Signs up only when the account is missing (sign-ups are rate limited), and ends
# by signing in, so stale credentials fail here, once, instead of in every admin spec.
#
# E2E_DB_ROLE writes the role. Defaults to the dev app's DATABASE_USER; CI, whose app runs outside Docker, passes
# postgres. WEB_CONTAINER and DB_CONTAINER follow the Makefile's web-container and db-container.
set -euo pipefail

BASE=http://localhost:9000
WEB_CONTAINER=${WEB_CONTAINER:-projectsidewalk-web}
DB_CONTAINER=${DB_CONTAINER:-projectsidewalk-db}
CREDENTIALS=$(dirname "$0")/../.admin-account.json
ROLE=${E2E_DB_ROLE:-$(docker exec "$WEB_CONTAINER" printenv DATABASE_USER)}

random_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
if [ ! -f "$CREDENTIALS" ]; then
  # The password policy wants an upper-case letter, a lower-case letter and a digit; hex alone may lack the first two.
  printf '{\n  "username": "e2eAdmin_%s",\n  "password": "Ae2%s"\n}\n' "$(random_hex 6)" "$(random_hex 16)" \
    > "$CREDENTIALS"
fi
field() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$CREDENTIALS"; }
USERNAME=$(field username)
PASSWORD=$(field password)

sql() { docker exec "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$ROLE" -d sidewalk -qtA -c "$1"; }

JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

# Prints the CSRF token from a form page, starting a fresh session in the cookie jar.
csrf_from() {
  local page token
  : > "$JAR"
  page=$(curl -s -c "$JAR" "$BASE$1") || { echo "error: no answer from $BASE$1 -- is the app up?" >&2; exit 1; }
  token=$(sed -n 's/.*name="csrfToken" value="\([^"]*\)".*/\1/p' <<< "$page" | head -1)
  [ -n "$token" ] || { echo "error: no CSRF token on $BASE$1" >&2; exit 1; }
  echo "$token"
}

if [ "$(sql "SELECT count(*) FROM sidewalk_login.sidewalk_user WHERE username = '$USERNAME';")" = 0 ]; then
  CSRF=$(csrf_from /signUp)
  curl -s -o /dev/null -b "$JAR" -X POST "$BASE/signUp" \
    --data-urlencode "csrfToken=$CSRF" --data-urlencode "username=$USERNAME" \
    --data-urlencode "email=$USERNAME@example.com" --data-urlencode "password=$PASSWORD" \
    --data-urlencode "passwordConfirm=$PASSWORD" --data-urlencode "terms=true" --data-urlencode "returnUrl=/"
fi

UPDATED=$(sql "UPDATE sidewalk_login.user_role SET role = 'Administrator'
  WHERE user_id = (SELECT user_id FROM sidewalk_login.sidewalk_user WHERE username = '$USERNAME') RETURNING role;")
if [ "$UPDATED" != "Administrator" ]; then
  echo "error: no $USERNAME account to make an admin: its sign-up was refused" >&2
  exit 1
fi

CSRF=$(csrf_from /signIn)
LOCATION=$(curl -s -o /dev/null -w '%{redirect_url}' -b "$JAR" -X POST "$BASE/authenticate/credentials" \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=$USERNAME" --data-urlencode "password=$PASSWORD")
if [ -z "$LOCATION" ] || [[ "$LOCATION" == */signIn* ]]; then
  echo "error: $USERNAME can't sign in with the password in $CREDENTIALS; delete that file to make a new account" >&2
  exit 1
fi
echo "$USERNAME is an Administrator"
