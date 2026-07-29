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
semver tag deploys to prod. A release is more than the tag, though. Do these steps **in order**:

1. **Bump the app version** — edit `version := "X.Y.Z"` in [`build.sbt`](../build.sbt) (patch bump for a hotfix, e.g.
   `11.6.0` → `11.6.1`).
2. **Add a version-table evolution** — create the next-numbered `conf/evolutions/default/NNN.sql` that records the
   release in the `version` table. This row is what the site footer / `commonData.versionId` displays (the app shows
   the row with the latest `version_start_time`, so `now()` is correct and no manual date is needed):
   ```sql
   # --- !Ups
   INSERT INTO version VALUES ('X.Y.Z', now(), 'One-line, user-facing summary of the release.');

   # --- !Downs
   DELETE FROM version WHERE version_id = 'X.Y.Z';
   ```
3. **Land it on `develop` first** (PR) — merging to `develop` redeploys the **test** stage; verify there.
4. **Merge `develop` → `master`** (PR).
5. **Create the GitHub Release** with tag `vX.Y.Z` targeting `master`. That tag/release triggers the **prod** build and
   the rolling per-city restart. Match the existing tag format exactly (`v11.6.0`, `v11.5.1`, …).
6. **Verify prod** — the build isn't instant and city instances come up one-by-one. Confirm the *new code* is live, not
   just that the server responds. Until an explicit version endpoint exists (**#4548**), the reliable check is
   **behavioral**: load a page whose behavior only the new code produces. (The `/anonSignUp` liveness probe is not
   sufficient — it passes even when a page like `/leaderboard` is crashing.)

**Two independent gotchas, both learned from #4545:**
- Merging to `master` alone does **not** deploy to prod — the **tag** (step 5) does.
- Bumping `build.sbt` alone does **not** change the version the site shows — the **evolution** (step 2) does.
A hotfix that changes no schema *still* needs step 2 for the displayed version to update.

> **Design note:** routing release-versioning through schema evolutions couples two unrelated concerns and duplicates
> the version string across `build.sbt`, an evolution, and the git tag. Making the git tag / build metadata the single
> source of truth (an `sbt-buildinfo`-backed `/version` endpoint) is tracked in **#4548**; follow that convention if it
> lands.

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

1. Install Python deps (`requirements.txt`) — needed both by the out-of-band utilities and by `label_clustering.py`,
   which the running app invokes **in-band** during clustering. These must land in the `python3` interpreter the app
   shells out to, or clustering fails at import time (e.g. `ModuleNotFoundError: No module named 'haversine'`).
2. `npm install`, then **Grunt** to concatenate/build the frontend bundles.
3. **sbt** `clean stage` to compile the Scala/Play backend into a runnable package. This also bundles the `scripts/`
   directory into the staged app (via `Universal / mappings` in `build.sbt`) so the in-band `label_clustering.py` is
   present at runtime — the staged app runs from the stage dir, not the repo root, so an unbundled script can't be found.

Because the build is identical in spirit to local dev, **a change that fails to compile or bundle locally will fail
the deploy.** The backend is built with `-Xfatal-warnings`, so warnings block the build too. See
[`docs/testing-and-ci.md`](testing-and-ci.md) and [`docs/dev-environment.md`](dev-environment.md).

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
| **Environment / city** | `ENV_TYPE`, `SIDEWALK_CITY_ID`, image/panorama storage directories |
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
