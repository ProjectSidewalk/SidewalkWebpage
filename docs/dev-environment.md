# Development Environment Setup

This guide gets a local copy of Project Sidewalk running on your machine. Everything runs in **Docker**, so you do
not install Scala, Node, or Postgres directly — you only need Docker, Git, and a terminal.

> **New contributor?** Read [`CONTRIBUTING.md`](../CONTRIBUTING.md) first for the branch/PR workflow and coding
> standards. For a deeper tour of the architecture, see [`CLAUDE.md`](../CLAUDE.md).
>
> **Stuck?** Jump to [Troubleshooting](#troubleshooting) or [Getting help](#getting-help).

---

## What you'll need

- **Docker** (Docker Desktop on macOS/Windows, Docker Engine + Compose on Linux) — installed and running.
- **Git** and terminal/shell access.
- **From a maintainer** (the app will not start without these): a `docker-compose.override.yml` with local secrets
  and one or more **database dumps** to seed Postgres. Email the lead engineer, Mikey
  (**saugstad@cs.washington.edu**), to request them.
- **API keys** — the override file from a maintainer includes our keys. If you're *outside the team*, you'll need to
  create your own [Google Maps](https://developers.google.com/maps/documentation/javascript/get-api-key) and
  [Mapbox](https://docs.mapbox.com/help/getting-started/access-tokens/) keys and add them to the override file.

The dev setup is geared toward team members. If you're outside the team and want to stand up a server for a city we
don't support, start with the [Creating a database for a new city](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Creating-database-for-a-new-city)
wiki page — that's a substantial GIS task on its own.

---

## Platform setup

Install Docker and Git for your platform, then clone the repo. The workflow after that is identical everywhere.

```bash
git clone https://github.com/ProjectSidewalk/SidewalkWebpage.git
cd SidewalkWebpage
```

### Linux (Ubuntu)

1. Install Docker. Consider [rootless Docker](https://docs.docker.com/engine/security/rootless/) — a bit more setup
   now, but smoother development later.
2. [Install Docker Compose](https://docs.docker.com/compose/install/) (bundled on Mac/Windows, separate on Linux).
3. Clone the repo (above).

### macOS

1. [Install Docker Desktop](https://www.docker.com/get-started) — pick **Apple Chip** for M-series Macs or **Intel
   Chip** for older models.
2. Clone the repo (above).

### Windows (WSL2)

We recommend and only support the **WSL2** path — it runs a real Linux kernel in a lightweight VM, giving faster
compiles and better Docker support than legacy WSL.

1. [Install Docker Desktop](https://docs.docker.com/desktop/windows/install/). When prompted, select **Use WSL 2**
   (not Hyper-V).
2. Install WSL2 with the default Ubuntu distro: open PowerShell **as administrator** and run `wsl --install`.
   (Pin Ubuntu to your taskbar for easy access.)
3. Update WSL: `wsl --update`.
4. In Docker Desktop → **Settings → General**, check **Use the WSL 2 based engine**. Then under
   **Resources → WSL Integration**, enable integration with your default distro and check **Ubuntu**.
5. **From inside the Ubuntu (Linux) shell** — not `/mnt/c` — clone the repo into your Linux home (e.g.
   `~/projects/`). Running from the Linux filesystem is required for acceptable performance.

You'll need `make` inside Ubuntu: `sudo apt install make`.

<details>
<summary><strong>Moving files (e.g. database dumps) into the Linux VM</strong></summary>

- **File Explorer:** in the left sidebar open `Linux → Ubuntu → home → <username> → SidewalkWebpage` and drag files
  in. (Right-click the folder → "Pin to Quick access" to find it easily later.) Copied files often get a companion
  `:Zone.Identifier` file — it's safe to delete those.
- **Command line:** your Windows drives are mounted under `/mnt` (e.g. `/mnt/c`), so you can
  `cp /mnt/c/path/to/dump ~/SidewalkWebpage/db/`.
</details>

<details>
<summary><strong>Starting / shutting down WSL2 + Docker</strong></summary>

WSL and Docker use significant memory in the background. When you're not working on Project Sidewalk:

- **Shut down:** close anything using Docker/WSL, quit Docker Desktop from the tray, then run `wsl --shutdown`.
- **Start back up:** run `wsl -d Ubuntu` (or just open your IDE in WSL), then launch Docker Desktop.
</details>

---

## First-time setup

Make sure Docker is running (you'll see the whale icon in your tray; you can set Docker to start on login).

1. **Add the secrets file.** Place the `docker-compose.override.yml` from your maintainer in the repo root, then
   edit it for the city you want to run:
   - **`SIDEWALK_CITY_ID`** — the city to run (e.g. `seattle-wa`); see the [City IDs table](#city-ids).
   - **`DATABASE_USER`** — that city's database user, replacing the default `sidewalk` (e.g. `sidewalk_seattle`).
   - **`platform`** — *Apple Silicon (M-series) only:* uncomment this line.

2. **Stage the database dumps.** Put the dump files from your maintainer in the **`db/`** directory and rename them
   to the exact names the import scripts expect:
   - City data dump → **`<database_user>-dump`** (e.g. `sidewalk_seattle-dump`).
   - Users dump → **`sidewalk_users-dump`** (same name regardless of city).

3. **Build and start the containers**, dropping into a shell in the web container:

   ```bash
   make dev
   ```

   `make dev` starts the `db` container and then opens an interactive shell in the `web` container. The **first**
   build downloads images, spins up containers, and initializes (but does not yet populate) the database — expect
   ~5–30+ minutes depending on your connection. Success ends with a `root@<container-id>:/home#` prompt.

4. **Import users and data** from a *second* terminal on your host (outside the web-container shell):

   ```bash
   make import-users                   # load sidewalk_users-dump (the login schema)
   make import-dump db=<database_user> # load <database_user>-dump; db= defaults to "sidewalk"
   ```

   Both restore from a binary dump and show a live elapsed-time clock — the users dump is ~900 MB, so it runs for a
   couple of minutes (the restore is parallelized to keep that short); a city dump varies with its size. Read the
   output carefully — if it errors, **don't** continue; check [Troubleshooting](#troubleshooting) and ask. (A
   `schema "public" already exists` notice is the one error you can safely ignore.) For what each script does and the
   full set of DB lifecycle/maintenance targets, see [`db/scripts/README.md`](../db/scripts/README.md).

5. **Start the app** from inside the web-container shell opened by `make dev`:

   ```bash
   npm start
   ```

   `npm start` runs Grunt (JS/CSS concatenation + watch) in the background, then `sbt ~ run` for continuous
   recompile. The first compile takes 5+ minutes; later ones are seconds. Use `npm run debug` if you want a JVM
   debug port attached. It's ready when you see `Listening for HTTP on .../9000`.

6. **Open the app:** http://localhost:9000 (or `127.0.0.1:9000`). The first load is slow while Play applies
   evolutions and compiles on demand.

---

## Daily workflow

After a restart you don't repeat the import — just:

```bash
cd SidewalkWebpage
make dev          # start db + open the web-container shell
npm start         # (inside that shell) build assets + run the app
```

Then visit http://localhost:9000. To stop everything: `make docker-stop`.

Other handy targets:

| Command | What it does |
|---------|--------------|
| `make docker-up` | Start all services detached (no shell). |
| `make ssh target=web` | Open a shell in a running container (`target=web` or `target=db`). |

---

## Switching / adding another city

Each city is a separate database. To switch:

1. Put the new dump in `db/`, renamed to `<database_user>-dump` (see the [City IDs table](#city-ids)).
2. If that dump is newer than your existing ones, also re-import users with a fresh `sidewalk_users-dump`
   (ask a maintainer if unsure — the creation date is in the original filename).
3. `make import-dump db=<database_user>` (from the host, outside the Docker shell).
4. Update **`DATABASE_USER`** and **`SIDEWALK_CITY_ID`** in `docker-compose.override.yml` to match.
5. `make dev` again.

To switch back and forth later: `exit` the Docker shell, change the two override values, and re-run `make dev`.

### City IDs

The `SIDEWALK_CITY_ID` and `DATABASE_USER` must correspond. In the repo, **`conf/cityparams.conf` is the source of
truth**; the snapshot below is a convenience copy (it may lag as new cities are added).

| City ID | Database User | | City ID | Database User |
| --- | --- | --- | --- | --- |
| seattle-wa | sidewalk_seattle | | madison-wi | sidewalk_madison |
| columbus-oh | sidewalk_columbus | | tainan-nj | sidewalk_tainan |
| cdmx | sidewalk_cdmx | | niagara-falls-nj | sidewalk_niagara_falls |
| spgg | sidewalk_spgg | | chandigarh-india | sidewalk_chandigarh |
| pittsburgh-pa | sidewalk_pittsburgh | | vancouver-wa | sidewalk_vancouver |
| newberg-or | sidewalk_newberg | | rancagua-chile | sidewalk_rancagua |
| washington-dc | sidewalk | | santiago-chile | sidewalk_santiago |
| chicago-il | sidewalk_chicago | | tucson-az | sidewalk_tucson |
| amsterdam | sidewalk_amsterdam | | paterson-nj | sidewalk_paterson |
| la-piedad | sidewalk_la_piedad | | richmond-va | sidewalk_richmond |
| oradell-nj | sidewalk_oradell | | fort-wayne-in | sidewalk_fort_wayne |
| validation-study | sidewalk_validation | | virden-il | sidewalk_virden |
| zurich | sidewalk_zurich | | gainesville-fl | sidewalk_gainesville |
| taipei | sidewalk_taipei | | sao-paulo-brazil | sidewalk_sao_paulo |
| new-taipei-tw | sidewalk_new_taipei | | winterthur-infra3d | sidewalk_winterthur_infra3d |
| keelung-tw | sidewalk_keelung | | waltham-ma | sidewalk_waltham |
| auckland | sidewalk_auckland | | knox-oh | sidewalk_knox |
| cuenca | sidewalk_cuenca | | kaohsiung-tw | sidewalk_kaohsiung |
| crowdstudy | sidewalk_crowdstudy | | taichung-tw | sidewalk_taichung |
| burnaby | sidewalk_burnaby | | cliffside-park-nj | sidewalk_cliffside_park |
| teaneck-nj | sidewalk_teaneck | | blackhawk-hills-il | sidewalk_blackhawk_hills |
| walla-walla-wa | sidewalk_walla_walla | | columbia-sc | sidewalk_columbia |
| st-louis-mo | sidewalk_st_louis | | west-chester-pa | sidewalk_west_chester |
| la-ca | sidewalk_la | | danville-il | sidewalk_danville |
| mendota-il | sidewalk_mendota | | detroit-mi | sidewalk_detroit |
| hackensack-nj | sidewalk_hackensack | | clifton-nj | sidewalk_clifton |
| maywood-nj | sidewalk_maywood | | | |

---

## Editor and database tools

**Editor:** use whatever you're productive in — the team uses both, and the codebase has two halves with different
sweet spots:

- **[IntelliJ IDEA](https://www.jetbrains.com/idea/)** (free [student license](https://www.jetbrains.com/student/)
  for Ultimate) has the most turnkey **Scala/Play** support.
- **[VS Code](https://code.visualstudio.com/)** is excellent for the **vanilla-JS frontend**; add the
  [Metals](https://scalameta.org/metals/docs/editors/vscode/) extension for Scala.

See [`docs/editor-setup.md`](editor-setup.md) for full setup of either (JDK, plugins/extensions, format-on-save).
Whichever you use, configure it to run **scalafmt** on Scala files (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)).

**Database client:** [Valentina Studio](https://www.valentina-db.com/en/valentina-studio-overview) (cross-platform),
[Postico](https://eggerapps.at/postico/) (Mac), or [pgAdmin](https://www.pgadmin.org/download/) (Windows/Mac).
Connect with:

```
Host:     localhost
Port:     5432
Database: sidewalk
User:     postgres
Password: sidewalk
```

---

## Making changes

The dev server hot-reloads, so you rarely restart it.

- **Scala / Twirl views** — `sbt ~ run` recompiles on save; reload the browser once compilation finishes.
- **JavaScript / CSS** — Grunt's `watch` re-concatenates your `src/` edits into `public/js/*/build/`
  automatically. **Edit `src/` files only; never edit `build/` output**, and don't run `grunt` by hand. If a new
  `src/` file isn't picked up, check that its path matches a glob in `Gruntfile.js`.
- **`build.sbt` or config changes** — these aren't hot-reloaded. In the Docker shell press `Ctrl+D`, then run
  `sbt clean`, then `npm start` again.

### Checking that backend changes compile

There's no backend test suite — validate Scala changes by compiling. The sbt **thin client** uses its own server,
so it won't collide with a running `sbt ~ run`:

```bash
docker exec projectsidewalk-web bash -lc "cd /home && sbt --client compile"
```

The first call after a container boot starts the compile server (~30s); later calls are near-instant. `build.sbt`
sets `-Xfatal-warnings`, so a `[success]` is also warning-clean.

### Running a branch from a git worktree

If you keep in-progress branches in **git worktrees** (`.claude/worktrees/<name>`) — for example to review a
colleague's branch, or to run a second branch alongside your main checkout — you can bring that branch's app up on
http://localhost:9000 with one command:

```bash
make qa-worktree wt=<worktree-name>
```

A worktree needs more setup than the main repo (its `node_modules` and built asset bundles aren't checked in, and
sbt's caches and config have to be pointed at the right places), so this target handles all of it: it links the main
repo's `node_modules`, builds that branch's JS/CSS bundles, frees `:9000`, and launches `sbt ~ run` against the
worktree's own config while reusing the main repo's warm sbt caches. The first request triggers the dev compile;
`Ctrl+C` stops it. It behaves the same on macOS, Linux, and WSL because the work runs inside the web container.

To QA admin-only pages you need an account with a role. The dev database is seeded from a dump that includes real
accounts, so if your own account is in it you can sign in normally — password checks work the same locally as in
production. Otherwise — or if you'd rather use a throwaway account — create a fresh one through the sign-up form and
grant it a role directly in the dev database (roles are checked per request, so you don't need to sign in again). Open a
psql shell (`docker exec -it projectsidewalk-db psql -U sidewalk -d sidewalk`) and run:

```sql
UPDATE sidewalk_login.user_role
SET role_id = (SELECT role_id FROM sidewalk_login.role WHERE role = 'Owner')
WHERE user_id = (SELECT user_id FROM sidewalk_login.sidewalk_user WHERE username = '<your-username>');
```

### Exercising authenticated routes

Most routes need a session. Grab an anonymous cookie once, then reuse the jar:

```bash
curl -s -c /tmp/sidewalk_cookies.txt "http://localhost:9000/anonSignUp?url=%2F"
curl -s -b /tmp/sidewalk_cookies.txt "http://localhost:9000/v3/api/labelTypes"
```

### Inspecting the database

Each city lives in its own schema (`sidewalk_<city>`); authentication lives in `sidewalk_login`. For ad-hoc
queries, prefer the **read-only** role so you can't accidentally write:

```bash
docker exec projectsidewalk-db psql -U readonly_user -d sidewalk -c "\dt sidewalk_seattle.*"
```

---

## Troubleshooting

Roughly ordered by when you'd hit them during setup.

| Symptom | Fix |
|---------|-----|
| `make: docker-compose: No such file or directory` | Newer Docker uses `docker compose` (no hyphen). Edit the `Makefile` to replace `docker-compose` with `docker compose`. |
| `Docker-Compose` command fails on Mac | Recreate the symlink per the [Compose install docs](https://docs.docker.com/compose/install/). |
| `gpg: keyserver receive failed` during build (Windows) | Add `ENV APT_KEY_DONT_WARN_ON_DANGEROUS_USAGE=1` near the top of the `Dockerfile`. |
| `pg_restore: ... schema "public" already exists` | Safe to ignore — no effect. |
| `import-dump` otherwise errors | Don't skip ahead. Re-check the dump filename and `db=` value, then see the [Troubleshooting wiki](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Troubleshooting-Dev-Environment) and ask. |
| `Execution exception [NoSuchElementException: None.get]` at runtime | The data wasn't imported — run `make import-dump` (the init only creates the schema, not the data). |
| `Cannot create container for service web: Conflict ... name "/projectsidewalk-web" already in use` | A prior `web` container wasn't shut down cleanly: `docker container rm /projectsidewalk-web`. |
| Errors after the computer was shut off mid-run (WSL) | Run `wsl --shutdown`; when Docker offers to restart WSL, accept. Otherwise restart Docker manually. |
| Can't connect to the database | The db container may not be listening on all addresses. `make ssh target=db`, edit `/var/lib/postgresql/data/postgresql.conf`, set `listen_addresses = '*'`. |
| `make` commands "just don't work" | Reinstall `make`. As a fallback, run the underlying command from the `Makefile` directly (e.g. `make ssh target=web` ≈ `docker exec -it projectsidewalk-web /bin/bash`). |
| A new `src/` JS file isn't bundled | Make sure its path matches a glob in `Gruntfile.js`. |
| First compile seems stuck | It isn't — initial dependency resolution is genuinely slow. Watch the container logs. |

**Slick query errors while developing:**

- `value transactionally is not a member of slick.dbio.DBIOAction...` → add `import models.utils.MyPostgresProfile.api._`.
- `type mismatch ... NoStream,Nothing ...` (often misleading) → try wrapping the queries in `.transactionally`, or
  use `DBIO.seq().andThen()`.

---

## Getting help

- **Team members:** ask in the **#core** or **#interns** Slack channels (we prefer channels over DMs so everyone
  can learn and help).
- **Anyone:** search the [issues tagged "Dev Environment"](https://github.com/ProjectSidewalk/SidewalkWebpage/issues?q=is%3Aissue+label%3A%22Dev+Environment%22),
  check the [Troubleshooting wiki](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Troubleshooting-Dev-Environment),
  or email **sidewalk@cs.uw.edu**.

If you solve something not covered here, please add it.
