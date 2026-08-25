# Deployment & Stages

How Project Sidewalk's hosted instances are organized in production — the deployment **stages**, how code reaches
each one, and the runtime shape of the servers. This is the production counterpart to the dev setup in
[`docs/dev-environment.md`](dev-environment.md) and the app-internal tour in [`docs/architecture.md`](architecture.md).

> **Source & scope.** This document was written from an analysis (2026-07-01) of the **internal server-deployment
> tooling maintained by UW CSE IT** — a separate ops repository, not part of this codebase. That repo remains the
> source of truth for how the servers are actually run; this is a contributor-facing summary of the parts that affect
> how you develop and ship. **Operational specifics that could aid an attacker are deliberately omitted** — hostnames,
> port numbers, absolute server paths, internal DNS/auth tooling, and the operator control panel. If you need those,
> ask UW CSE IT. Treat this file as explanatory, not as runbook.

---

## Stages

Project Sidewalk runs in three deployment stages. Each is an independent environment with its own database and its
own set of running city instances:

| Stage | Purpose | App config file used |
|-------|---------|----------------------|
| **test** | Integration/QA — where new work lands first and cities are stood up for review. | `conf/application.test.conf` |
| **staging** (a.k.a. *proto*) | Pre-release verification of a release candidate. | `conf/application.staging.conf` |
| **prod** | The public production sites. | `conf/application.conf` (base) |

The stage also drives the `ENV_TYPE` environment variable, which the app reads as `environment-type` in
`conf/application.conf`. Play loads the base `application.conf` and the stage overlay layers on top (the same
mechanism as `application.local.conf` in local dev). For example, the Silhouette auth cookie name is
`prod-authenticator` in the base config and is overridden in the test/local overlays, so sessions don't collide
across environments.

## How code reaches each stage

Deployment is driven by what you push to the [`SidewalkWebpage`](https://github.com/ProjectSidewalk/SidewalkWebpage)
git history. The mapping observed in the ops tooling is:

| You push… | …and it deploys to |
|-----------|--------------------|
| the **`develop`** branch | **test** |
| the **`staging`** branch | **staging** / proto |
| a **semver release tag** (`vX.Y.Z`) | **prod** |

Practical implications for contributors:

- Merging a PR into `develop` is not just a merge — it triggers a **build and redeploy of the test sites**. If your
  change breaks the build, it breaks test for everyone until fixed.
- Production releases are cut by **tagging**, not by pushing a branch. Only properly formatted version tags go to
  prod.
- A redeploy re-runs the full build (below) and restarts the affected city instances, so it is not instantaneous and
  briefly interrupts the sites on that stage.

## Cutting a release (runbook)

Production is deployed by **creating a GitHub Release with a `vX.Y.Z` tag on `master`** — per the table above, only a
semver tag deploys to prod. A release is more than the tag, though: the version the site *displays* comes from the
database, and code reaches `master` only by way of `develop`.

Releases are cut by a maintainer (**@jonfroehlich**, **@misaugstad**). Start from a `develop` that is green in CI, and
remember that everything already merged there ships with this release — `develop` *is* the release contents. Do the
steps below in order.

### 1. Pick the version number

Adapted from [semver](https://semver.org/), versions are **X.Y.Z** = **Major.Minor.Patch**:

| Bump | When | Example |
|------|------|---------|
| **Patch (Z)** | Bug fixes only. | `11.6.0` → `11.6.1`, which only fixed the leaderboard failing to load. |
| **Minor (Y)** | Backward-compatible change — new features, enhancements, redesigns of existing pages. | `11.6.1` → `11.7.0`, which added Lived Experience Stories and redesigned the navbar and label card. |
| **Major (X)** | Backward-incompatible change, or a release that revamps the product rather than adding to it. | `v9.0.0`, `v10.0.0`, `v11.0.0` — roughly one every six to twelve months. |

Most scheduled releases are a **minor** bump; most hotfixes are a **patch**. Note that a minor bump is not capped by
size — several 11.x minors carried 60–90 merged PRs including whole-page redesigns. **When in doubt, ask the team**
before choosing: the number is public and permanent.

### 2. Create a prep branch off `develop`

```bash
git fetch origin
git switch -c prep-v<X.Y.Z>-release origin/develop
```

### 3. Bump the app version

Edit `version := "X.Y.Z"` in [`build.sbt`](../build.sbt).

### 4. Add a version-table evolution

Create the next-numbered `conf/evolutions/default/NNN.sql` recording the release in the `version` table. This row is
what the site footer / `commonData.versionId` displays — the app shows the row with the latest `version_start_time`,
so `now()` is correct and no manual date is needed:

```sql
# --- !Ups
INSERT INTO version VALUES ('X.Y.Z', now(), 'One-line, user-facing summary of the release.');

# --- !Downs
DELETE FROM version WHERE version_id = 'X.Y.Z';
```

Take **exactly one higher than the highest-numbered file on `develop`**. Do not skip a number to dodge one an open PR
already claims: whichever PR merges second renumbers, and a collision is cheap to fix while a gap is not. In practice
the question rarely comes up here, since a release is cut once `develop` has settled.

**Why a gap is the dangerous mistake.** Play pairs the applied rows in `play_evolutions` against the evolution files
*positionally*, highest revision first, and takes the first pair whose hashes differ as the point where the database
diverged. An evolution that lands later in a skipped slot shifts every pair below it by one, so nothing matches and
Play concludes the whole history diverged: it emits a `Down` for every applied evolution and re-applies all of them.
We set `autoApplyDowns=true` (`conf/application.conf`), so it does that on startup without asking.

`make lint-evolutions` runs the static checks CI enforces.

### 5. Open the prep PR into `develop`

Commit message: `<old-version> - <new-version>` (e.g. `11.7.0 - 11.8.0`). PR title: **`Prep for v<X.Y.Z> release`**.

Merging it redeploys the **test** stage automatically, within roughly 15 minutes. **Verify the new version number
appears in the site footer on test** before going further — that confirms both the build and the evolution applied.

### 6. Open the release PR: `develop` → `master`

Title it exactly **`v<X.Y.Z>`** (e.g. `v11.7.0`). The body is the release notes — see
[Writing the release notes](#writing-the-release-notes) below. Then merge it into `master`.

### 7. Create the GitHub Release

Create a [new release](https://github.com/ProjectSidewalk/SidewalkWebpage/releases/new):

- **Tag:** `v<X.Y.Z>` — match the existing format exactly (`v11.6.0`, `v11.5.1`, …).
- **Target branch:** `master`.
- **Title:** `v<X.Y.Z>`.
- **Description:** the same release notes you put in the PR body.

Publishing this is what triggers the **prod** build and the rolling per-city restart.

### 8. Verify prod

The build isn't instant and city instances come up one-by-one. Confirm the *new code* is live, not just that the
server responds. Until an explicit version endpoint exists (**#4548**), the reliable check is **behavioral**: load a
page whose behavior only the new code produces. (The `/anonSignUp` liveness probe is not sufficient — it passes even
when a page like `/leaderboard` is crashing.) Also check the footer version and spot-check a few different cities,
since they restart independently.

**Two independent gotchas, both learned from #4545:**
- Merging to `master` alone does **not** deploy to prod — the **tag** (step 7) does.
- Bumping `build.sbt` alone does **not** change the version the site shows — the **evolution** (step 4) does.
A hotfix that changes no schema *still* needs step 4 for the displayed version to update.

> **Design note:** routing release-versioning through schema evolutions couples two unrelated concerns and duplicates
> the version string across `build.sbt`, an evolution, and the git tag. Making the git tag / build metadata the single
> source of truth (an `sbt-buildinfo`-backed `/version` endpoint) is tracked in **#4548**; follow that convention if it
> lands.

### Rolling back a release

Deploying an older tag rolls the **schema** back too: `autoApplyDowns=true` (`conf/application.conf`, no stage
override) means each city instance runs the `Downs` of every evolution above the target version at startup,
unattended. A Down that cannot apply leaves that instance **down until a human intervenes** — which is deliberate for
evolutions that refuse to destroy data silently, so check those for conflicts *before* rolling back rather than
discovering them one crashed city at a time.

The canonical example is evolution **354** (#4842): its Down re-inserts archived voided votes with deliberately no
`ON CONFLICT`. If any validator re-voted on a repaired label after the evolution applied, their new vote holds the
`(user_id, label_id)` unique slot, the re-insert fails on `label_validation_user_id_label_id_unique`, and the instance
won't start. That is the designed outcome — an archived verdict must never be discarded silently; a human decides
which of the two votes survives. Before rolling back past 354, run this per city schema and resolve any rows it
returns (delete whichever vote loses, then roll back):

```sql
-- Re-votes that will collide with the Downs' archive restore: same validator, same label, one live + one archived.
SELECT voided_label_validation.label_validation_id AS archived_vote,
       label_validation.label_validation_id        AS live_re_vote,
       voided_label_validation.user_id,
       voided_label_validation.label_id
FROM voided_label_validation
INNER JOIN label_validation
    ON  label_validation.user_id  = voided_label_validation.user_id
    AND label_validation.label_id = voided_label_validation.label_id;
```

### Adding a table that cross-schema queries read

`ConfigTable`'s fan-out queries read *other* cities' schemas, and each city instance applies its own evolutions when it
restarts — so mid-rollout an already-updated instance can query a schema that hasn't applied the new evolution yet. The
missing relation fails that city's whole query, and the service layer's `.recover` then drops the city from the
aggregate surfaces silently. Two ways to handle it: ship the evolution one release ahead of the code that reads it, or
add a `to_regclass` existence probe that skips the new table's arm (`ConfigTable.schemaHasVoidedValidationArchive` does
this for 354) **plus a tracking issue to delete the probe once the release has reached every server** — without the
issue, the temporary guard becomes permanent.

### Writing the release notes

The notes are written **for non-technical users** — contributors, city partners, and researchers read them. Same text
serves the `develop` → `master` PR body and the GitHub Release description.

Conventions, from past releases (a good model: [PR #4188](https://github.com/ProjectSidewalk/SidewalkWebpage/pull/4188),
[PR #4614](https://github.com/ProjectSidewalk/SidewalkWebpage/pull/4614)):

- One bullet per user-visible change, in **decreasing order of importance to end users** — not chronological order.
- **Bold the one or two biggest headlines**, leave the rest plain.
- Describe the change in plain language, from the user's point of view ("Fixes neighborhood names with `/` rendering
  incorrectly in the mission complete screen"), not the implementation ("escapes HTML entities in `MissionTable`").
- Cite **both the issue number and the PR number** — `#4054 (PR #4593)` — so a future reader can get back to the
  discussion *and* the diff.
- Group or omit pure-infra churn (CI config, lint fixes, dependency bumps, docs). One catch-all line is plenty; these
  bullets are not a changelog of every merge.

**Finding what's in the release.** Enumerate PRs by *commit reachability* from the previous tag rather than by merge
date — a date filter both misses stragglers and picks up PRs that merged after the last tag was cut:

```bash
git fetch origin --tags
PREV=v11.7.0   # the previous release tag
git log $PREV..origin/develop --merges --format='%s' \
  | grep -oP 'Merge pull request #\K[0-9]+' | sort -n -u > /tmp/prs.txt

# titles
while read n; do gh pr view "$n" --json number,title --jq '"* \(.title) (PR #\(.number))"'; done < /tmp/prs.txt

# the issues each PR closes, so you can cite both numbers
while read n; do
  gh api graphql -f query="query{repository(owner:\"ProjectSidewalk\",name:\"SidewalkWebpage\")
    {pullRequest(number:$n){closingIssuesReferences(first:10){nodes{number}}}}}" \
    --jq "\"$n|\" + ([.data.repository.pullRequest.closingIssuesReferences.nodes[].number]|join(\",\"))"
done < /tmp/prs.txt
```

That list is the raw material, not the notes — expect to merge related PRs into a single bullet, drop internal-only
work, and rewrite every title into user-facing language.

### Hotfixes

A production bug that can't wait for the next scheduled release follows the same path — there is no way to reach prod
that skips `develop` and `master`. Branch the fix off `develop`, merge it, then run the full runbook with a **patch**
bump. The release notes can be a single bullet.

## Runtime shape

Each stage hosts **many cities at once**, and each city runs as its **own independent instance of this app** —
a separate built Play process, reverse-proxied behind a web server so each city gets its own public URL. Instances
are supervised per stage, so cities can be started, stopped, and restarted individually without touching the others.

Data isolation matches the per-city model described in [`docs/architecture.md`](architecture.md):

- **One database per stage** (a test database, a prod database, etc.).
- **One schema per city** within that database (`sidewalk_<city>`), plus shared authentication in `sidewalk_login`.
- Each city connects as its own database role whose search path resolves to its schema, the login schema, and the
  shared/public schema — so the identical codebase serves different cities purely by connection configuration. This
  is the production analogue of switching `DATABASE_USER` + `SIDEWALK_CITY_ID` locally (see
  [`docs/dev-environment.md`](dev-environment.md)).

### Build performed on deploy

A deploy builds the app essentially the same way you do locally, in this order:

1. Install Python deps (`requirements.txt`) — needed by `label_clustering.py`, which the running app invokes
   **in-band** during clustering. These must land in the `python3` interpreter the app shells out to, or clustering
   fails at import time (e.g. `ModuleNotFoundError: No module named 'haversine'`). That interpreter is the server's
   system Python (3.8), which is why `requirements.txt` stays pinned to 3.8-installable versions (#4396). The
   out-of-band utilities are **not** deployed: `requirements-offline-tools.txt` needs ≥ 3.11 and is installed by hand
   into the 3.13 on whichever user account runs those scripts.
2. `npm install`, then **Grunt** to concatenate/build the frontend bundles.
3. **sbt** `clean stage` to compile the Scala/Play backend into a runnable package. This also bundles the `scripts/`
   directory into the staged app (via `Universal / mappings` in `build.sbt`) so the in-band `label_clustering.py` is
   present at runtime — the staged app runs from the stage dir, not the repo root, so an unbundled script can't be found.
   Staging also runs the **asset pipeline**, which content-fingerprints assets so browsers can cache them for a year
   (see [Asset caching](#asset-caching)). Fingerprints are computed from the built bundles, so step 2 must run first.

The compile step also stamps git metadata (commit SHA, `git describe`, dirty flag) into the binary via a source
generator in `build.sbt` (`models.utils.BuildInfo`), which the admin pages' deployment-info strip displays. The values
require the build to run from a git clone with history and tags — true for the per-stage clones on the deploy server
and for local dev — and degrade gracefully to "unknown" elsewhere (e.g. CI's shallow checkouts) rather than failing
the build.

Because the build is identical in spirit to local dev, **a change that fails to compile or bundle locally will fail
the deploy.** The backend is built with `-Xfatal-warnings`, so warnings block the build too. See
[`docs/testing-and-ci.md`](testing-and-ci.md) and [`docs/dev-environment.md`](dev-environment.md).

### Directories that must survive a deploy

Note the `clean` in step 3: **the deploy deletes the entire `target/` build tree and rebuilds it**, and the staged
app then runs from inside it (`target/universal/stage`). So any file the app writes to a path that resolves *within*
that tree is destroyed by the next release — silently, because the database rows that point at it survive. That
includes paths that merely climb out of the stage directory: `../media` lands in `target/universal/`, which
`sbt clean` deletes just the same.

Everything users upload or that cannot be recreated therefore lives on storage the deploy never touches. The relative
defaults in `application.conf` are for local dev only; **every deployed stage must point each of these at a path
outside the build tree** via its environment variable (a variable that is set but blank is rejected too):

| Config key | Env var | Holds | Missing on a deployed stage |
|---|---|---|---|
| `story.media.directory` | `SIDEWALK_STORY_MEDIA_DIR` | User-uploaded story photos (**irreplaceable**) | **App refuses to start** |
| `pano.images.directory` | `SIDEWALK_PANO_DIR` | Self-hosted pano store — the only copies of GSV imagery Google has expired (**irreplaceable**) | **App refuses to start** |
| `cropped.image.directory` | `SIDEWALK_IMAGES_DIR` | Label crops (re-derivable from pano imagery) | Error logged at boot |
| `share.image.directory` | `SIDEWALK_SHARE_IMAGES_DIR` | Cached social-share previews (regenerable) | Error logged at boot |

`PersistentMediaDirCheck` enforces this at boot in **prod mode** — what every staged binary runs in — so it covers
every deployed stage *and* a staged binary run by hand (export the four variables to `/tmp` paths for that; CI's
`e2e-smoke` job does exactly this). It deliberately does not key on `ENV_TYPE`: that variable arrives through the
same env file as the media paths, so the incomplete-env-file mistake behind #4925 would disarm the guard exactly when
it is needed. Dev and test runs (`sbt run`, the test suites) skip the check.

The fatal tier is deliberate for irreplaceable content: accepting a photo we already know the next release will
delete is worse than not starting, and since `develop` redeploys **test** while prod waits for a release tag, a
forgotten variable surfaces on test long before it can reach prod.

**Adding a fifth one?** Resolve it through `MediaDirs` (never a hand-rolled path concat — the check's verdict is only
meaningful while it models the exact resolution the write paths use), add it to `persistentDirs` in
`PersistentMediaDirCheck`, decide whether its contents are irreplaceable (fatal) or derived (logged), and have the
deployment tooling export its variable. Losing a story photo this way (#4925) took three weeks to notice, so the
check — not a comment in `application.conf` — is what holds the contract.

### Asset caching

**sbt-digest** content-fingerprints every asset at stage time, writing an `<md5>-<name>` copy beside the original.
`assets.path("css/main.css")` resolves to that URL (`/assets/css/91f6…-main.css`), and since `conf/routes` serves
assets through `controllers.Assets.versioned`, Play answers with `max-age=31536000, immutable` rather than the
`max-age=3600` default. Changed content always arrives under a new URL, so there is no staleness risk.

**It is a correctness fix, not only a speed one.** Play's fallback ETag for an un-fingerprinted asset comes from its
path and last-modified date, not its bytes — and sbt's `packageTimestamp` (an sbt-wide default) freezes every jar
entry at `2010-01-01` for reproducible builds. Both inputs are constant across deploys, so replacing a file's contents
under the same name leaves the ETag unchanged and every cached copy revalidates to a `304` **indefinitely**. Don't fix
that by unfreezing `packageTimestamp`: it would cost reproducible builds *and* invalidate every asset on every deploy.

Costs ~291MB of duplicate files per staged instance and ~25s of stage time. Boot time is unaffected — Play resolves
fingerprints lazily per asset, not at startup.

The one-hour default applies only to the `Assets` controller, so **HTML isn't cached at all** — Play's Twirl responses
carry no `Cache-Control`, `ETag`, or `Last-Modified`. That is what makes fingerprinting safe: a browser refetches the
page on every navigation, so a deploy's new asset URLs are picked up immediately and nobody is left holding stale HTML
that points at a fingerprinted file the new build no longer contains.

Originals stay in place too, so hardcoded `/assets/...` paths and relative `url(...)` in CSS keep resolving — but only
`assets.path(...)` yields the long-lived URL, which is why it's preferred everywhere.

Stage/dist only: local `sbt run` serves plain paths and `no-cache` as before, so exercising the real behavior means
staging the app and running the binary directly rather than `npm start`. That depends on `pipelineStages` in
`build.sbt` staying **unscoped** — the `Assets /`-scoped form of the same setting runs the digest on every dev request
instead, which fingerprints for no benefit and roughly triples `target/web`.

### Liveness convention

Health checks treat an instance as up when an anonymous request to **`/anonSignUp`** returns a valid session cookie
(`PLAY_SESSION`) — i.e. the app can boot into an anonymous session. This is the same anonymous-session trick used to
exercise authenticated routes in local dev (see [`docs/dev-environment.md`](dev-environment.md)). Instances that
return server errors are automatically restarted, and application logs are archived on each rebuild.

## Logs

Each running city instance writes a **rolling file log** (configured in [`conf/logback.xml`](../conf/logback.xml)):

- **File name:** `application-<SIDEWALK_CITY_ID>.log` in the instance's `logs/` directory — e.g.
  `application-newberg-or.log`. `application.home` resolves to that city's staged app directory, so **every city has its
  own `logs/` subdirectory**; the app also mirrors output to stdout.
- **Rotation:** daily (`application-<city>-YYYY-MM-DD.log`), 90-day history, 3 GB cap; logs are archived on each rebuild.
- **Levels:** root is `INFO`, and **successful requests are not access-logged** — a working page produces *no* log
  line. Only warnings and errors appear (client 4xx via the error handler, server-side exceptions, etc.).

Finding them on a server without hardcoding paths:

```bash
# each instance's home dir + city id are on the running process's command line
pgrep -af 'java .*ProdServerStart'
# or locate the files directly
find / -name 'application-*.log' 2>/dev/null
```

**Access:** instances run under a dedicated service account, so the log files are owned by that account. Reading them
may require membership in that account's group; if you're locked out, ask UW CSE IT. (Absolute on-server paths,
hostnames, and ports are omitted here for the same reason as the rest of this doc — see the note at the top.)

**A `502` with nothing in the app log — where to look.** Successful requests aren't access-logged and a reverse-proxy
`502` can originate at the proxy itself, so a failing page may leave **no** trace in the application log. Two checks:

- **Reproduce against the backend directly, bypassing the proxy** — but carry a session cookie and follow redirects
  (`curl -L -c jar -b jar`): an anonymous request is bounced through the anon-session flow (a fast `303` to
  `/anonSignUp?url=…`) and never runs the real page. Send the proxy's `Host` / `X-Forwarded-Proto` headers too if the
  app also canonicalizes the host. A fast success on the *followed* request points at the proxy layer; a hang or error
  points at the app/DB.
- **If the request dies inside the database** (e.g. a PostGIS/JIT segfault,
  [#4545](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4545)), the app only sees a dropped connection — the
  real crash (`server process … was terminated by signal 11`) is written to the **Postgres server log**, not the
  application log. That log lives on the database host under the standard PostgreSQL data-directory layout; ask a running
  server for its exact location with `psql -c 'SHOW log_directory;'` (relative to `SHOW data_directory;`) rather than
  hardcoding a path. Members of the project's UW CSE group have command-line read access to it.

## Runtime configuration contract

At runtime the app is configured almost entirely through **environment variables** (values are injected by the
deployment tooling and, locally, by your `docker-compose.override.yml`). The variable **names** below are already
part of this repo's own config files; the **values** are secrets and live only on the servers / in maintainer-held
override files. This is the practical list to keep in sync when you add a new integration — a new secret has to be
plumbed through both this app's config *and* the deployment tooling, or it will be missing in production.

| Group | Variables (names only) |
|-------|------------------------|
| **Database** | `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_DB`, `DATABASE_URL` |
| **Environment / city** | `ENV_TYPE`, `SIDEWALK_CITY_ID`, the media storage directories ([above](#directories-that-must-survive-a-deploy)) |
| **App secrets** | `SIDEWALK_APPLICATION_SECRET`, `SILHOUETTE_SIGNER_KEY`, `SILHOUETTE_CRYPTER_KEY` |
| **Email** | `SIDEWALK_EMAIL_ADDRESS`, `SIDEWALK_EMAIL_PASSWORD` |
| **Imagery / maps** | `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_SECRET`, `MAPBOX_API_KEY`, `MAPILLARY_ACCESS_TOKEN`, Infra3d client id/secret (including per-city credentials) |
| **Other integrations** | `GEMINI_API_KEY`, `SCISTARTER_API_KEY`, `INTERNAL_API_KEY` |

> If this table drifts from reality, the authoritative sources are `conf/application.conf` (+ the stage overlays) in
> this repo and the deployment tooling in the IT ops repo.

## What this document intentionally does not cover

To avoid publishing anything that could put the running servers at risk, the following are omitted here and kept in
UW CSE IT's private ops repo: server hostnames and network topology, port assignments, absolute on-server paths, the
internal DNS/Kerberos/authentication tooling, the operator control panel, and the exact new-city provisioning steps.
Maintainers who need those should consult the ops repo or contact UW CSE IT (**sidewalk@cs.uw.edu**).

---

*Provenance: derived from a point-in-time (2026-07-01) reading of UW CSE IT's internal Project Sidewalk deployment
tooling by a maintainer. The ops repo is the source of truth and may have changed since; update this summary if you
notice drift.*
