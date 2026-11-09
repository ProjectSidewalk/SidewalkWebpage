#!/usr/bin/env bash
#
# Makes the e2e admin account (admin-account.json) on the app at :9000 and gives it the Administrator role.
#
# The app can't make an admin over HTTP, so the role is set in the database. The account itself comes from the real
# sign-up, so it gets every row a sign-up makes. Its password is committed on purpose: it exists only on dev and CI
# databases. Safe to re-run: a taken name's sign-up is refused, and the role update is idempotent.
#
# E2E_DB_ROLE writes the role. Defaults to the dev app's DATABASE_USER; CI, whose app runs outside Docker, passes
# postgres.
set -euo pipefail

BASE=http://localhost:9000
ACCOUNT=$(dirname "$0")/admin-account.json
field() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$ACCOUNT"; }
USERNAME=$(field username)
EMAIL=$(field email)
PASSWORD=$(field password)
ROLE=${E2E_DB_ROLE:-$(docker exec projectsidewalk-web printenv DATABASE_USER)}

JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
CSRF=$(curl -s -c "$JAR" "$BASE/signUp" | sed -n 's/.*name="csrfToken" value="\([^"]*\)".*/\1/p' | head -1)
[ -n "$CSRF" ] || { echo "error: no CSRF token on $BASE/signUp -- is the app up?" >&2; exit 1; }
curl -s -o /dev/null -b "$JAR" -c "$JAR" -X POST "$BASE/signUp" \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "username=$USERNAME" --data-urlencode "email=$EMAIL" \
  --data-urlencode "password=$PASSWORD" --data-urlencode "passwordConfirm=$PASSWORD" \
  --data-urlencode "serviceHours=NO" --data-urlencode "terms=true" --data-urlencode "returnUrl=/"

# Empty output means the sign-up above was refused and no earlier run made the account either.
UPDATED=$(docker exec projectsidewalk-db psql -v ON_ERROR_STOP=1 -U "$ROLE" -d sidewalk -qtA -c "
  UPDATE sidewalk_login.user_role SET role = 'Administrator'
  WHERE user_id = (SELECT user_id FROM sidewalk_login.sidewalk_user WHERE username = '$USERNAME')
  RETURNING role;")
[ "$UPDATED" = "Administrator" ] || { echo "error: no $USERNAME account to make an admin -- its sign-up failed" >&2; exit 1; }
echo "$USERNAME is an Administrator"
