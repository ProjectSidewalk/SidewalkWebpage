"""
Guided end-to-end setup of a new city from its onboarding artifacts (issue #4291).

Run after scripts/onboard_city.py has produced db/onboarding/<city-id>/ and the GeoPackage has been QA'd:

    make onboard-city id=laurens-ia        (host-side; wraps `python3 tools/setup_new_city.py laurens-ia`)

It chains every remaining setup step, pausing only where a human is required:

  0. Shows the build report's headline numbers and the imagery preflight table (if one was run) and asks to go on.
  1. Registers the city in conf/cityparams.conf (every per-city map, with derived defaults and empty GA ids),
     conf/messages (city name; state or country name if new to the platform), and the City IDs table in
     docs/dev-environment.md — then lists the translation keys a human still owes.
  2. Creates the city's GA4 properties and fills the measurement + property ids (tools/create_ga_properties.py) —
     when the repo-root ga-service-account.json key exists and the ids are still empty; skipped with a pointer
     otherwise.
  3. Creates the empty city schema by cloning a donor city's structure + seed rows (db/scripts/create-new-schema.sh;
     the donor defaults to the active dev city and is refused if it sits ahead of this checkout's evolutions, or if
     its top evolution is another branch's under the same number — the script gets the file's Play hash to tell).
  4. Boots the app one-shot inside the web container with DATABASE_USER/SIDEWALK_CITY_ID overridden via
     `docker exec -e` (a running container's env is fixed at creation, so editing docker-compose.override.yml can't
     retarget it), and watches play_evolutions until the schema is current. Right after a clone the boot happens
     even when the donor was current: Play checks every applied evolution's hash against this checkout's files and
     (autoApplyDowns) corrects one the donor picked up from another branch at the same number. A schema kept from a
     run that stopped before the fill gets the same treatment, since its hashes were never verified either; a kept
     schema that already holds streets skips the boot. The boot needs :9000 and the checkout it compiles, so the
     step asks the web container about both first and waits for whatever holds them (or stops naming them,
     unattended); --allow-running-apps overrides a build in that checkout, never a taken port.
  5. Loads db/onboarding/<city-id>/qgis_tables.sql into the schema.
  6. Runs fill-new-schema.sh non-interactively (you pick the tutorial region and which regions open at launch, or
     pass --tutorial-region and --regions).
  7. Runs the scripts/check_streets_for_imagery.py scan for the city's imagery provider in the web container (which
     holds the API keys and the python3.13 deps) against a freshly exported endpoints CSV, hides the no-imagery
     streets, and imports the imagery-age summary into street_imagery.
  8. Checks that nothing but onboarding has written to the schema (a local QA pass, or a job run, would ride into the
     launched city inside the dump; it offers to clear it), then dumps the finished schema to db/<schema>-dump — the
     file import-dump.sh and the server both restore — and prints the server handoff checklist.

A rerun skips whatever already happened: registered configs, an existing schema (answer "n"), applied evolutions,
a filled schema (jumping straight to the imagery scan), and a scan already applied. `--skip-scan` defers step 7;
`--dump-only` runs step 8 alone, for a city that was cleaned up or QA'd after its first dump.

Every question takes its default with --yes (the review of the build report counts as answered), and only then:
without a terminal, a question whose default would be a choice — the display name, the regions to open — stops the
run rather than being decided by nobody. The cautious ones (keep an existing schema, stop before a dirty dump) take
their default either way.

Host-side and stdlib-only (it edits repo files and drives docker), unlike scripts/, which runs in the web container.
Config edits are idempotent — a city already present in cityparams.conf is left alone — and `--dry-run` previews the
file edits and stops before any docker/db step. The pure helpers are unit-tested in test/python/test_setup_new_city.py.
"""

import argparse
import hashlib
import http.client
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CITYPARAMS = REPO_ROOT / 'conf' / 'cityparams.conf'
MESSAGES_DIR = REPO_ROOT / 'conf' / 'messages'
EVOLUTIONS_DIR = REPO_ROOT / 'conf' / 'evolutions' / 'default'
DB_CONTAINER = 'projectsidewalk-db'
WEB_CONTAINER = 'projectsidewalk-web'
# Where the main checkout is mounted in the web container — the one the boot builds from, and so the one an app
# already running there would collide with.
CHECKOUT_IN_CONTAINER = '/home'

# The same sbt invocation `npm start` uses, minus `~` (one-shot, no watch). The tail pipe keeps stdin open — Play's
# dev server stops on stdin EOF, which a detached `docker exec` would deliver immediately. Every process of the boot
# carries BOOT_MARKER on its command line (tail via `exec -a`, sbt and its JVM via a -D property nothing reads), so
# stopping it is one `pkill -f` that can't touch another `tail -f /dev/null` in the container (make qa-worktree
# holds one open the same way).
BOOT_MARKER = 'onboard-city-boot'
BOOT_PORT = 9000
# What the boot is polled on: a path that matches no route, under the one prefix CustomErrorHandler keeps out of the
# log. Play's dev mode starts the app — and so applies evolutions — for any request, including one it then 404s,
# and a request that reaches no controller writes no webpage_activity row. Measured 2026-09-10 against a schema at
# evolution 382 with the repo at 384: polling an unrouted path alone took it to 384 and left webpage_activity
# untouched, where both "/" and /v3/api/cities log a row each (every /v3/api route goes through LoggingService), and
# that row would then be found by the dump step's own leftover-data check. The prefix matters as much as the miss:
# any other unrouted path is WARN-logged on every poll, so the log the timeout message points at would be mostly
# probe noise (#5297).
BOOT_URL = f'http://localhost:{BOOT_PORT}/.well-known/onboard-city-boot-probe'
# The boot's own config: the dev profile, with the nightly actors off. The boot runs as the new city for as long as
# the compile takes, and each actor fires at a fixed minute of the day shifted by the city's offset, so a boot that
# straddles one writes background_job_run, funnel_stat, sidewalk_presence, ... into a schema nothing has used yet —
# the first Laurens rebuild picked up two such rows — and the dump step then stops on them as if a QA pass had run.
# `+=` through an include, not a -D property: a property would replace play.modules.disabled, which already carries
# silhouette.conf's two entries, and the boot then dies on duplicate Silhouette bindings (measured; the same reason
# conf/application.ci.conf is written this way).
BOOT_CONF = '/tmp/onboard-city-boot.conf'
BOOT_CONF_TEXT = f'include file("{CHECKOUT_IN_CONTAINER}/conf/application.local.conf")\n' \
                 'play.modules.disabled += "modules.ActorModule"\n'
BOOT_CMD = (f"printf '%s' '{BOOT_CONF_TEXT}' > {BOOT_CONF} && cd {CHECKOUT_IN_CONTAINER} && "
            f"(exec -a {BOOT_MARKER}-stdin tail -f /dev/null) | sbt -D{BOOT_MARKER}=1 -Dconfig.file={BOOT_CONF} "
            "-Dsbt.coursier.home='.coursier' -Dsbt.global.base='.sbt' -Dsbt.boot.directory='.sbt/boot' "
            "-Dsbt.repository.config='.sbt/repositories' -J-Xmx1536m run > /tmp/onboard-city-boot.log 2>&1")

# Runs inside the web container and prints what the boot needs to know, one fact per line, in a shape that cannot
# read as "clear" by accident: a missing `port` line, or a `pid` line without a directory, reports as "could not
# inspect" rather than as nothing in the way (#5297).
#   port taken|free   asked from inside the container (bash's /dev/tcp). Docker's published-port forwarder on the host
#                     accepts a connect for the container's whole lifetime, listener or not, so a host-side probe of
#                     :9000 reads "taken" whatever is running (measured: it is why the first form of this gate could
#                     never clear). tools/qa-worktree.sh asks the same way.
#   pid <pid> <cwd>   every sbt JVM and its working directory ('?' when unreadable). The pattern is bracketed so it
#                     cannot match the shell running it — `docker exec` starts that shell with the pattern on its own
#                     command line — and $$ is skipped so that stays true if the pattern is ever widened.
PROBE_CMD = (
    'command -v pgrep >/dev/null || { echo "pgrep is not installed in the container" >&2; exit 3; }; '
    f'if (exec 3<>/dev/tcp/127.0.0.1/{BOOT_PORT}) 2>/dev/null; then echo "port taken"; else echo "port free"; fi; '
    'for pid in $(pgrep -f "[s]bt-launch"); do [ "$pid" = "$$" ] && continue; '
    'echo "pid $pid $(readlink /proc/$pid/cwd 2>/dev/null || echo "?")"; done'
)

US_STATES = {
    'al': 'alabama', 'ak': 'alaska', 'az': 'arizona', 'ar': 'arkansas', 'ca': 'california', 'co': 'colorado',
    'ct': 'connecticut', 'de': 'delaware', 'fl': 'florida', 'ga': 'georgia', 'hi': 'hawaii', 'id': 'idaho',
    'il': 'illinois', 'in': 'indiana', 'ia': 'iowa', 'ks': 'kansas', 'ky': 'kentucky', 'la': 'louisiana',
    'me': 'maine', 'md': 'maryland', 'ma': 'massachusetts', 'mi': 'michigan', 'mn': 'minnesota',
    'ms': 'mississippi', 'mo': 'missouri', 'mt': 'montana', 'ne': 'nebraska', 'nv': 'nevada',
    'nh': 'new-hampshire', 'nj': 'new-jersey', 'nm': 'new-mexico', 'ny': 'new-york', 'nc': 'north-carolina',
    'nd': 'north-dakota', 'oh': 'ohio', 'ok': 'oklahoma', 'or': 'oregon', 'pa': 'pennsylvania',
    'ri': 'rhode-island', 'sc': 'south-carolina', 'sd': 'south-dakota', 'tn': 'tennessee', 'tx': 'texas',
    'ut': 'utah', 'vt': 'vermont', 'va': 'virginia', 'wa': 'washington', 'wv': 'west-virginia',
    'wi': 'wisconsin', 'wy': 'wyoming', 'dc': 'district-of-columbia',
}

# cityparams pano-viewer-type -> (check_streets_for_imagery.py flag, env vars the web container must hold to scan).
# Panoramax's API is public, so its scan needs no credential.
PROVIDERS = {
    'gsv': ('--gsv', ('GOOGLE_MAPS_API_KEY',)),
    'mapillary': ('--mapillary', ('MAPILLARY_ACCESS_TOKEN',)),
    'panoramax': ('--panoramax', ()),
    'infra3d': ('--infra3d', ('INFRA3D_CLIENT_ID', 'INFRA3D_CLIENT_SECRET')),
}

# Per-city maps a new city is deliberately *not* added to: each is a false-by-default flag (ConfigService.cityFlag)
# that a maintainer opts a city into; a missing entry is the default.
OPTIONAL_FLAG_MAPS = ('private-profiles-by-default', 'global-leaderboard-excluded', 'ai-label-submission-enabled')

# The message files besides the base `messages` that carry place names; each needs a line only where its rendering
# differs from the base (zh-TW always does).
# The file that transliterates every place name, so a gap in it is always a real gap.
ZH_TW_MESSAGES = 'messages.zh-TW'
TRANSLATED_MESSAGE_FILES = (ZH_TW_MESSAGES, 'messages.es', 'messages.nl', 'messages.de', 'messages.pt-BR',
                            'messages.fr')


def schema_name(city_id):
    """Same derivation as scripts/onboard_city.py: full city id, hyphens as underscores."""
    return 'sidewalk_' + city_id.replace('-', '_')


def valid_city_id(value):
    """
    argparse type for the city id — the same rule scripts/onboard_city.py applies to --city-id (kept local: this
    script is stdlib-only). The id becomes a schema name interpolated into SQL and paths, so it must be a plain
    kebab-case token.
    """
    if not re.fullmatch(r'[a-z][a-z0-9-]*', value):
        raise argparse.ArgumentTypeError(f'"{value}" — use lowercase kebab-case, e.g. "laurens-ia".')
    return value


# Set by --yes: every question takes its default without being asked.
ASSUME_DEFAULTS = False


def prompt(text, default=None, cautious=False):
    """
    Prompts on the terminal; empty input takes the default (re-prompts when there is none).

    With nothing on stdin to answer — CI, a scripted rebuild, an agent — the answer is taken from the default only
    where that was asked for: --yes says so for the whole run, and a ``cautious`` question is one whose default is
    the answer that does nothing (keep the schema, stop before the dump), which nobody can be sorry to have taken.
    Any other question stops the run with a usable message instead of an EOFError traceback. Without that rule one
    piped `y` would clear the review of the build report and then let every later question — the display name, the
    tutorial region, which regions open — be decided by nobody, ending in a fill that cannot be undone (#5297).

    Args:
        text:     The question.
        default:  What an empty answer means; None makes the question mandatory.
        cautious: Whether the default is safe to take unattended without --yes.

    Returns:
        The answer, stripped.
    """
    suffix = f' [{default}]' if default is not None else ''
    if ASSUME_DEFAULTS and default is not None:
        print(f'{text}{suffix}: {default}  (--yes)')
        return default
    while True:
        try:
            value = input(f'{text}{suffix}: ').strip()
        except EOFError:
            if default is None:
                sys.exit(f'\nerror: "{text}" has no default and there is nothing on stdin to answer it. '
                         'Rerun attached to a terminal.')
            if not cautious:
                sys.exit(f'\nerror: "{text}" needs an answer and there is nothing on stdin to give one. Rerun '
                         f'attached to a terminal, or pass --yes to take every default (this one: {default}).')
            print(f'\n  (nothing on stdin; taking the default: {default})')
            return default
        if value:
            return value
        if default is not None:
            return default


# ---------------------------------------------------------------------------------------------------------------------
# Pure derivations (unit-tested).
# ---------------------------------------------------------------------------------------------------------------------

def split_city_id(city_id):
    """
    Splits a city id into its display tokens and, for US cities, the state the trailing token abbreviates.

    Args:
        city_id: e.g. ``laurens-ia`` or ``bayonne-fr``.

    Returns:
        ``(display_default, us_state)``: the title-cased name without the state suffix, and the state id
        (``iowa``) or None.
    """
    tokens = city_id.split('-')
    us_state = US_STATES.get(tokens[-1]) if len(tokens) > 1 else None
    return ' '.join(tokens[:-1] if us_state else tokens).title(), us_state


def default_prod_url(city_id, us_state):
    """The server-name convention drops the state qualifier (teaneck-nj -> sidewalk-teaneck) but keeps a country's."""
    tokens = city_id.split('-')
    url_base = '-'.join(tokens[:-1]) if us_state else city_id
    return f'https://sidewalk-{url_base}.cs.washington.edu'


def test_url_for(prod_url):
    """The test stage's URL: ``-test`` appended to the first host label (sidewalk-x -> sidewalk-x-test)."""
    scheme, host = prod_url.rstrip('/').split('://', 1)
    first_label, _, rest = host.partition('.')
    return f'{scheme}://{first_label}-test' + (f'.{rest}' if rest else '')


def default_launch_date(today):
    """The convention: the Friday of the week after ``today`` (weekday(): Monday = 0, so 11 - weekday lands there)."""
    return (today + timedelta(days=11 - today.weekday())).isoformat()


def highest_evolution(evolutions_dir=None):
    """The repo's highest evolution number — what a donor schema must not exceed."""
    evolutions_dir = evolutions_dir or EVOLUTIONS_DIR
    return max(int(path.stem) for path in evolutions_dir.glob('*.sql') if path.stem.isdigit())


def evolution_hash(path):
    """
    Play's hash of an evolution file — ``sha1(downs.trim + ups.trim)`` over the ``!Ups`` / ``!Downs`` sections — as
    stored in ``play_evolutions.hash`` when the app applies it.

    Only a *match* means anything: the donor's row was written by Play from this very file, so the donor is on this
    checkout's evolution. A mismatch is inconclusive — Play's parser normalizes some files in ways this
    transcription doesn't reproduce (measured: 237 of 375 shipped evolutions round-trip), so create-new-schema.sh
    falls back to comparing the donor with the other city schemas in that case.

    Args:
        path: The ``<n>.sql`` evolution file.

    Returns:
        The 40-character hex digest.
    """
    ups, downs, section = [], [], None
    for line in path.read_text().split('\n'):
        if re.match(r'^(#|--).*!Ups.*$', line):
            section = ups
        elif re.match(r'^(#|--).*!Downs.*$', line):
            section = downs
        elif section is not None:
            section.append(line)
    return hashlib.sha1(('\n'.join(downs).strip() + '\n'.join(ups).strip()).encode()).hexdigest()


def highest_evolution_hash(evolutions_dir=None):
    """:func:`evolution_hash` of the repo's highest evolution — the donor check's positive evidence."""
    evolutions_dir = evolutions_dir or EVOLUTIONS_DIR
    return evolution_hash(evolutions_dir / f'{highest_evolution(evolutions_dir)}.sql')


def report_headlines(report_text):
    """The build report's summary bullets (streets, tiny segments, regions, ...) and any flagged-region rows."""
    lines = report_text.split('\n')
    bullets = [line for line in lines if line.startswith('- ') and not line.startswith('- Generated')]
    flagged = [line for line in lines if line.startswith('| ') and line.rstrip('| ').endswith(('splitting',
                                                                                              'neighbor',
                                                                                              'no streets'))]
    return bullets + flagged


def preflight_table(preflight_text):
    """The provider rows of a preflight_report.md (header + data rows), or an empty list without one."""
    lines = [line for line in preflight_text.split('\n') if line.startswith('|')]
    return lines if len(lines) > 2 else []


def translation_todo(city_id, state, country, added=()):
    """
    The message keys the translated files still lack, one line per key.

    zh-TW is listed as owed outright: it transliterates every place name, so a gap there is always a gap. The
    Latin-script files are listed as gaps to look at, no more. A name reads the same in some of those languages and
    not others (New Jersey in nl, de, fr; Nueva Jersey in es), the convention is to add no line where it reads the
    same, and nothing in the files records that decision — so the tool cannot tell "not translated yet" from "same
    as English", and every rule that tried went wrong in both directions: asking for a French line for
    country.name.france on every run, forever, and dropping five files from the list the moment zh-TW alone had been
    done. A person reads the list; the tool only keeps it complete (#5297).

    Args:
        city_id: The city id (its ``city.name.<id>`` key).
        state:   The US state id the city sits in, or None; its ``state.name.<state>`` key is listed too.
        country: The country id the city sits in, or None for one whose name every file already carries.
        added:   Keys this run put in the base file, or would under --dry-run, when the file cannot be read back
                 for them yet.

    Returns:
        Human-readable lines, one per key that any translated file lacks — empty when every file carries every
        name, which is the only state that reads as done.
    """
    keys = [f'city.name.{city_id}']
    if state:
        keys.append(f'state.name.{state}')
    if country:
        keys.append(f'country.name.{country}')
    # Only what English defines: a territory outside US_STATES never gets a base state.name line, and asking for a
    # translation of a key that does not exist sends someone looking for nothing.
    keys = [key for key in keys if key in added or message_key_exists('messages', key)]
    lines = []
    for key in keys:
        missing = [file_name for file_name in TRANSLATED_MESSAGE_FILES if not message_key_exists(file_name, key)]
        parts = []
        if ZH_TW_MESSAGES in missing:
            parts.append(f'{ZH_TW_MESSAGES} (owed: it transliterates every name)')
        latin = [file_name for file_name in missing if file_name != ZH_TW_MESSAGES]
        if latin:
            parts.append(f'{", ".join(latin)} (a line only where the name differs from English)')
        if parts:
            lines.append(f'  {key}: {"; ".join(parts)}')
    return lines


def handoff_checklist(city_id, schema, prod_url, test_url):
    """The steps outside this repo that stand between a finished local schema and a live city."""
    return f'''
Server handoff for {city_id}:
  1. Copy the dump to the server, renaming it to the convention every file there follows (the local name stays
     `{schema}-dump`, which is what `make import-dump` restores, and which a populated prod pull also uses):
       scp db/{schema}-dump <netid>@makelab1.cs.washington.edu:/www/sidewalk/new-city-dumps/{schema}-empty-dump
     (or an ssh alias of your own that sets the user; a bare hostname without one fails with "Permission denied").
  2. On the server, register the city with the IT tooling (uwcseit-sidewalk-tools: bin/setup-new.pl), which creates the
     DB role, restores the dump into sidewalk_test / sidewalk_prod, and writes the vhost — test stage first.
  3. DNS + Google Cloud: add {test_url} and {prod_url} as referrers on the Maps API key (docs/google-cloud.md).
  4. Open the PR with the config, message, and docs changes; the auto-deploy picks the city up once it lands on
     develop (test) and in a release (prod).
  5. Nightly jobs fill what onboarding leaves empty, so the dump you just copied has none of it: `intersection`
     (with each street's corner links), `cluster`, `sidewalk_presence`, and the `osm_way` tag cache each arrive
     with their job's first nightly run (the schedule is actor/ScheduledJobs.scala, shifted by the city's
     update_offset_hours), and AccessScore reads zero until then. An admin can force the intersections and
     clusters early from /clustering; the osm_way tags have their own nightly refresh (#5297).
  6. Round-trip check any time: make import-dump db={schema} restores db/{schema}-dump into the dev DB.
'''


# ---------------------------------------------------------------------------------------------------------------------
# Config-file edits (unit-tested against copies of the real files).
# ---------------------------------------------------------------------------------------------------------------------

def find_block(lines, name, start=0):
    """
    Locates a `<name> {`/`<name> = {`/`<name> = [` block at or after ``start``.

    Returns:
        A ``(open_idx, close_idx)`` line-index pair (the close line holds the matching brace/bracket).
    """
    open_re = re.compile(r'^(\s*)' + re.escape(name) + r'\s*=?\s*([\[{])\s*$')
    for i in range(start, len(lines)):
        match = open_re.match(lines[i])
        if not match:
            continue
        opener = match.group(2)
        closer = ']' if opener == '[' else '}'
        depth = 1
        for j in range(i + 1, len(lines)):
            depth += lines[j].count('[' if opener == '[' else '{')
            depth -= lines[j].count(closer)
            if depth == 0:
                return i, j
        break
    sys.exit(f'error: could not find block "{name}" in {CITYPARAMS} — has its structure changed?')


def insert_entry(lines, path, entry):
    """Inserts ``entry`` (unindented) as the last item of the (possibly nested) block at ``path``."""
    start = 0
    close = None
    for name in path:
        start, close = find_block(lines, name, start)
        start += 1
    indent = re.match(r'\s*', lines[close - 1]).group(0) if lines[close - 1].strip() else '    '
    lines.insert(close, f'{indent}{entry}')


def add_cityparams_entries(city_id, values, dry_run):
    """Registers the city in every per-city map of cityparams.conf; no-op if the id is already present."""
    text = CITYPARAMS.read_text()
    if re.search(rf'^\s*("?){re.escape(city_id)}\1\s*(=|$)', text, re.MULTILINE):
        print(f'  cityparams.conf already knows {city_id}; leaving it alone.')
        return False
    lines = text.split('\n')
    insert_entry(lines, ['city-ids'], f'"{city_id}"')
    for path, value in values:
        insert_entry(lines, path, f'{city_id} = {value}')
    if dry_run:
        print(f'  [dry-run] would add {1 + len(values)} entries to {CITYPARAMS}')
        return True
    CITYPARAMS.write_text('\n'.join(lines))
    print(f'  Registered {city_id} in {CITYPARAMS.name} ({1 + len(values)} entries).')
    return True


def message_key_exists(file_name, key):
    """Whether ``key`` is already defined in the given message file."""
    lines = (MESSAGES_DIR / file_name).read_text().split('\n')
    return any(line.startswith(f'{key} ') or line.startswith(f'{key}=') for line in lines)


def add_message_line(file_name, key, value, dry_run):
    """Appends `key = value` right after the file's last key of the same family; no-op if the key exists."""
    path = MESSAGES_DIR / file_name
    if message_key_exists(file_name, key):
        return False
    lines = path.read_text().split('\n')
    family = key.rsplit('.', 1)[0] + '.'
    last = max(i for i, line in enumerate(lines) if line.startswith(family))
    lines.insert(last + 1, f'{key} = {value}')
    if dry_run:
        print(f'  [dry-run] would add "{key} = {value}" to {file_name}')
        return True
    path.write_text('\n'.join(lines))
    print(f'  Added "{key} = {value}" to {file_name}.')
    return True


def add_docs_city_row(city_id, schema, dry_run):
    """Adds the city to docs/dev-environment.md's two-pairs-per-row City IDs table; no-op if it's already there."""
    path = REPO_ROOT / 'docs' / 'dev-environment.md'
    lines = path.read_text().split('\n')
    if any(f'| {city_id} |' in line for line in lines):
        return
    header = next((i for i, line in enumerate(lines) if line.startswith('| City ID |')), None)
    if header is None:
        print(f'  Could not find the City IDs table in docs/dev-environment.md; add {city_id} there by hand.')
        return
    last = header
    while lines[last + 1].startswith('|'):
        last += 1
    cells = [cell.strip() for cell in lines[last].strip('|').split('|')]
    if len(cells) == 5 and not cells[3]:
        lines[last] = f'| {cells[0]} | {cells[1]} | | {city_id} | {schema} |'
    else:
        lines.insert(last + 1, f'| {city_id} | {schema} | | | |')
    if dry_run:
        print(f'  [dry-run] would add {city_id} to the City IDs table in docs/dev-environment.md')
        return
    path.write_text('\n'.join(lines))
    print(f'  Added {city_id} to the City IDs table in docs/dev-environment.md.')


# ---------------------------------------------------------------------------------------------------------------------
# Docker / DB steps.
# ---------------------------------------------------------------------------------------------------------------------

def docker_db(*args, **kwargs):
    return subprocess.run(['docker', 'exec', '-i', DB_CONTAINER, *args], **kwargs)


def db_query(sql):
    """One value from psql as postgres (readonly_user may lack rights on a brand-new schema)."""
    result = docker_db('psql', '-U', 'postgres', '-d', 'sidewalk', '-tAc', sql, capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


def web_env(name):
    """An environment variable's value inside the web container, or None when unset."""
    result = subprocess.run(['docker', 'exec', WEB_CONTAINER, 'printenv', name], capture_output=True, text=True)
    return result.stdout.strip() or None if result.returncode == 0 else None


def inspect_container():
    """
    What the web container can say about the one-shot boot's way being clear, asked with PROBE_CMD.

    Returns:
        ``(port_taken, builds)`` — whether :9000 has a listener, and ``[(pid, cwd), ...]`` for every sbt JVM in
        the container — or a string saying why the container could not be inspected. Not knowing is not the same as
        being clear, so a caller treats the string as a conflict in its own right.
    """
    listing = subprocess.run(['docker', 'exec', WEB_CONTAINER, 'bash', '-c', PROBE_CMD],
                             capture_output=True, text=True)
    if listing.returncode != 0:
        why = listing.stderr.strip() or f'exit {listing.returncode}'
        return f'could not inspect {WEB_CONTAINER} for running builds ({why})'
    port_taken = None
    builds = []
    for line in listing.stdout.split('\n'):
        words = line.split(' ', 2)
        if words[0] == 'port' and words[1:] in (['taken'], ['free']):
            port_taken = words[1] == 'taken'
        elif words[0] == 'pid' and len(words) == 3 and words[1].isdigit() and words[2].strip():
            builds.append((int(words[1]), words[2].strip()))
        elif line.strip():
            return f'could not read {WEB_CONTAINER}\'s answer about running builds ("{line.strip()}")'
    if port_taken is None:
        return f'could not tell whether :{BOOT_PORT} is free in {WEB_CONTAINER}'
    return port_taken, builds


def boot_conflicts():
    """
    What would stop the one-shot boot, as two lists of human-readable strings — both empty when the way is clear.

    The boot needs two things. :9000, asked directly: `make qa-worktree` serves a worktree's app there and passes no
    -Dhttp.port, so nothing about a process says whether it holds the port. And the checkout it compiles: sbt
    refuses a second server in the same project directory, and two compiles sharing one `target/` corrupt it, so an
    sbt whose working directory is CHECKOUT_IN_CONTAINER is in the way. One in a worktree is not — the caches under
    /home/.sbt and /home/.coursier are shared by every worktree on purpose (qa-worktree.sh points each at them to
    reuse the warm download) and are built for concurrent use; the Laurens rebuild ran to completion with five
    worktree JVMs up. `target/` is the only thing a checkout has to itself (#5297).

    Returns:
        ``(hard, soft)``: what no flag overrides — the port is taken, so the boot could not bind and every poll
        would be answered by whatever holds it; or the container could not be inspected — and what
        --allow-running-apps may: a build in the boot's own checkout, for a caller who knows it is idle.
    """
    inspected = inspect_container()
    if isinstance(inspected, str):
        hard, soft = [inspected], []
    else:
        port_taken, builds = inspected
        hard = [f':{BOOT_PORT} is already taken (the boot needs it)'] if port_taken else []
        soft = []
        for pid, cwd in builds:
            if cwd == CHECKOUT_IN_CONTAINER:
                soft.append(f'pid {pid} is building in {cwd} (shares the boot\'s target/)')
            elif cwd == '?':
                soft.append(f'pid {pid} is an sbt whose working directory could not be read, so it may be building '
                            f'in {CHECKOUT_IN_CONTAINER}')
    # A boot an earlier run left behind (killed by SIGTERM, a closed terminal) compiles in /home and holds no port
    # yet, so it would file as overridable — and then boot_jvm_alive() would answer for the stale JVM, not the new
    # one, for the whole wait. It is never overridable: nothing legitimate carries the marker.
    if (hard or soft) and own_boot_alive():
        hard.append(f'one of these is a boot this script left behind — a run killed outright never reaches the '
                    f'stop; clear it with: docker exec {WEB_CONTAINER} pkill -f {BOOT_MARKER}')
    return hard, soft


def own_boot_alive():
    """Whether anything of a one-shot boot from an earlier run of this script is still up, by its marker."""
    return subprocess.run(['docker', 'exec', WEB_CONTAINER, 'pgrep', '-f', BOOT_MARKER],
                          capture_output=True).returncode == 0


def boot_jvm_alive():
    """
    Whether the one-shot boot's JVM is still running.

    The marker alone does not say: the `tail` that holds the boot's stdin open and the shell around the pipeline
    both carry it, and both outlive an sbt that has exited (a pipeline's shell waits for every member, and
    `tail -f /dev/null` never ends). Only the JVM's command line carries the marker property *and* the launcher jar.
    """
    # `--` because the pattern starts with -D, which pgrep otherwise reads as an option and exits 2 — the same exit
    # a dead boot gives, so without it every fresh boot was declared dead ten seconds in (measured).
    return subprocess.run(['docker', 'exec', WEB_CONTAINER, 'pgrep', '-f', '--', f'-D{BOOT_MARKER}=1 .*sbt-launch'],
                          capture_output=True).returncode == 0


def run_or_exit(args, what_failed, hint):
    """
    Runs a db-container command with its output streaming, and on failure exits quoting the reason it gave.

    stdout is left alone: fill-new-schema.sh prints its configuration summary and then runs one long psql heredoc,
    the longest step in the run. stderr is echoed line by line as it arrives, because it carries both the diagnosis
    worth quoting — which donor was refused and why, which SQL statement broke — and, for create-new-schema.sh, the
    progress of helpers.sh's run_with_progress, which writes all of it to stderr and would go silent for minutes if
    the pipe were only drained at the end. Read through a pipe that helper sees no TTY and prints its heartbeat lines
    instead of a spinner, which is what the heartbeat is for. Quoting the reason into the exit message means it
    survives however the caller is handling streams, where an unhandled CalledProcessError leaves only a traceback
    and an argv list (#5297).

    Args:
        args:        The command, as it would be passed to docker_db.
        what_failed: The first line of the error, naming the step in the operator's terms.
        hint:        What to do about it, printed under the quoted reason.
    """
    process = subprocess.Popen(['docker', 'exec', '-i', DB_CONTAINER, *args], stderr=subprocess.PIPE, text=True)
    captured = []
    for line in process.stderr:
        print(line, end='', file=sys.stderr, flush=True)
        captured.append(line.rstrip())
    returncode = process.wait()
    if returncode != 0:
        said = [line for line in captured if line.strip()]
        reason = '\n'.join(f'  | {line}' for line in said) if said \
            else '  | (it gave no reason of its own; look at its output above)'
        sys.exit(f'error: {what_failed} (exit {returncode}):\n{reason}\n  {hint}')


def evolution_problem(schema):
    """The newest evolution Play failed on, as ``"<id>: <problem>"``, or None when every row is clean."""
    return db_query(f"SELECT id || ': ' || left(last_problem, 300) FROM {schema}.play_evolutions "
                    "WHERE last_problem IS NOT NULL AND last_problem <> '' ORDER BY id DESC LIMIT 1")


def apply_evolutions(schema, city_id, verify=False, allow_running_apps=False):
    """
    Boots the app one-shot as the new city and blocks until play_evolutions reaches the repo's latest.

    Args:
        schema:  The city schema.
        city_id: Its city id (SIDEWALK_CITY_ID for the boot).
        verify:  Boot even when the schema already reads the latest number. Right after a donor clone this is the
                 only check that the donor's evolutions are *this checkout's*: Play compares every applied hash
                 with the file and, with autoApplyDowns on, reverts and re-applies from the first mismatch — the case
                 of a dev schema that hosted another branch's evolution at the same number.
        allow_running_apps: Boot even with a build running in the boot's own checkout (see [[boot_conflicts]]),
                 for a caller who knows it is idle. A taken port is never overridden: the boot could not bind it,
                 and every poll would then be answered by whatever holds it — a stranger's app on the donor's
                 schema, whose play_evolutions reads current, so the verification this boot exists for would be
                 skipped and reported as done (#5297).
    """
    latest = highest_evolution()
    applied = db_query(f'SELECT max(id) FROM {schema}.play_evolutions')
    current = bool(applied) and int(applied) >= latest
    if current and not verify:
        print(f'  Schema is already at evolution {applied}; no app boot needed.')
        return
    hard, soft = boot_conflicts()
    overridden = soft if allow_running_apps and not hard else []
    if overridden:
        print(f'  --allow-running-apps: booting anyway, with {"; ".join(overridden)}.')
    conflicts = hard + (soft if not allow_running_apps else [])
    while conflicts:
        clear_it = ('Clear it (Ctrl-C the `npm start` or `make qa-worktree` that owns :9000, or docker exec '
                    f'{WEB_CONTAINER} kill <pid>) and rerun'
                    + ('.' if hard else ', or pass --allow-running-apps to boot anyway.'))
        if not sys.stdin.isatty():
            sys.exit(f'error: the one-shot boot cannot start — {"; ".join(conflicts)}.\n  {clear_it}')
        try:
            input(f'  The one-shot boot cannot start — {"; ".join(conflicts)}. Clear it, then press Enter... ')
        except EOFError:
            sys.exit('\nerror: nothing left on stdin to answer with; clear the conflict and rerun.')
        hard, soft = boot_conflicts()
        conflicts = hard + (soft if not allow_running_apps else [])
    subprocess.run(['docker', 'exec', '-d', '-e', f'DATABASE_USER={schema}', '-e', f'SIDEWALK_CITY_ID={city_id}',
                    WEB_CONTAINER, 'bash', '-c', BOOT_CMD], check=True)
    if current:
        print(f'  Schema reads evolution {applied}; booting the app as {city_id} once anyway so Play checks every '
              'applied hash against this checkout (the dev compile takes a while)...')
    else:
        print(f'  Booting the app as {city_id} to apply evolutions (needs {latest}; the dev compile takes a while)...')
    log_hint = f'docker exec {WEB_CONTAINER} tail -50 /tmp/onboard-city-boot.log'
    try:
        deadline = time.monotonic() + 30 * 60
        while time.monotonic() < deadline:
            # Any HTTP response (even an error page) means the app booted; the evolutions check is the real gate.
            # HTTPException covers BadStatusLine, which is neither HTTPError nor OSError: a listener that is not
            # speaking HTTP (a socat forwarder, say) would otherwise end the wait with a traceback.
            try:
                urllib.request.urlopen(BOOT_URL, timeout=240).close()
            except urllib.error.HTTPError:
                pass
            except (urllib.error.URLError, OSError, http.client.HTTPException):
                time.sleep(10)
                # A boot that died — failed to bind, or fell over compiling — would otherwise be waited on for the
                # full half hour. Checked after the sleep so the JVM has had time to appear at all.
                if not boot_jvm_alive():
                    sys.exit(f'error: the one-shot boot exited before the app answered. Check the boot log: '
                             f'{log_hint} — then rerun.')
                continue
            problem = evolution_problem(schema)
            if problem:
                sys.exit(f'error: Play could not apply evolution {problem}\n  Fix the cause ({log_hint}), then rerun.')
            applied = db_query(f'SELECT max(id) FROM {schema}.play_evolutions')
            if applied and int(applied) >= latest:
                print(f'  Evolutions applied and verified (at {applied}).')
                return
            print(f'  ...at {applied or "?"} of {latest}')
            time.sleep(10)
        blamed = f'\n  --allow-running-apps was passed over: {"; ".join(overridden)} — a compile sharing the ' \
                 f'boot\'s target/ can wedge it; stop that build and rerun.' if overridden else ''
        sys.exit(f'error: evolutions never reached {latest}. Check the boot log: {log_hint} — then rerun.{blamed}')
    finally:
        subprocess.run(['docker', 'exec', WEB_CONTAINER, 'pkill', '-f', BOOT_MARKER], capture_output=True)
        print('  One-shot app stopped; :9000 is free again.')


def run_imagery_scan(schema, city_id, pano_type):
    """Scans the exported street endpoints for imagery (in the web container), hides the no-imagery streets, and
    imports the imagery-age summary."""
    if pano_type not in PROVIDERS:
        print(f'  No imagery scan for pano type "{pano_type}"; skipping.')
        return
    flag, env_vars = PROVIDERS[pano_type]
    missing = [name for name in env_vars if not web_env(name)]
    if missing:
        print(f'  {", ".join(missing)} not set in the web container; skipping the scan. Set it in '
              f'docker-compose.override.yml, recreate the container, and rerun (the fill is done, so the rerun '
              'jumps straight here).')
        return

    export = docker_db('psql', '-U', schema, '-d', 'sidewalk', '-c',
                       'COPY (SELECT street_edge.street_edge_id, street_edge_region.region_id, x1, y1, x2, y2, geom '
                       'FROM street_edge JOIN street_edge_region '
                       'ON street_edge.street_edge_id = street_edge_region.street_edge_id '
                       'WHERE street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)) '
                       'TO STDOUT WITH (FORMAT csv, HEADER)',
                       capture_output=True, text=True, check=True)
    city_dir = REPO_ROOT / 'db' / 'onboarding' / city_id
    city_dir.mkdir(parents=True, exist_ok=True)
    (city_dir / 'street_edge_endpoints.csv').write_text(export.stdout)
    print(f'  Scanning {export.stdout.count(chr(10)) - 1} streets for {pano_type} imagery (resumes this city\'s '
          'own checkpoint if interrupted)...')
    # A TTY (when we have one to give) lets the scan's tqdm progress bar render; over a plain pipe it auto-hides.
    tty = ['-t'] if sys.stdin.isatty() else []
    subprocess.run(['docker', 'exec', '-i', *tty, WEB_CONTAINER, 'python3.13',
                    'scripts/check_streets_for_imagery.py', '--city-id', city_id, flag], check=True)

    no_imagery = city_dir / 'streets_with_no_imagery.csv'
    n_hidden = max(0, len(no_imagery.read_text().strip().split('\n')) - 1) if no_imagery.exists() else 0
    print(f'  {n_hidden} street(s) without imagery; marking them no_imagery...')
    docker_db('/opt/scripts/hide-streets-without-imagery.sh', schema,
              f'onboarding/{city_id}/streets_with_no_imagery.csv', check=True)

    # On a fresh city the automatic street_imagery feeder (pano_data, via labels) has nothing yet, so the scan's
    # summary is the only source of imagery-age data (#4348).
    print('  Importing the imagery-age summary into street_imagery...')
    docker_db('/opt/scripts/import-street-imagery.sh', schema,
              f'onboarding/{city_id}/street_imagery_summary.csv', check=True)


# The tables onboarding itself fills, and so the only ones a finished-but-unused city holds rows in: the seed rows
# the clone copies (create-new-schema.sh), the streets and regions the fill derives (fill-new-schema.sh), the scan's
# imagery-age summary and the status trail of the streets it hides (import-street-imagery.sh, helpers.sh), and
# region_completion, which the app computes from the streets on first use. Every other table in the schema has to
# be empty: a local QA pass fills some (one walk in Explore writes an audit_task and thousands of
# audit_task_interaction rows), the nightly jobs fill others (intersection, cluster, sidewalk_presence, osm_way,
# background_job_run — an admin forcing them from /clustering, or an app left running as the city, produces the
# same), and all of it would ride into the launched city inside the dump. Naming what is allowed rather than what is
# forbidden is the point: a denylist has to know every table a QA pass or a job can reach, and the first one here
# missed sixteen. test_setup_new_city.py pins this list against the scripts' own INSERTs (#5297).
ONBOARDING_TABLES = frozenset((
    'play_evolutions', 'version', 'tag', 'survey_question', 'survey_option', 'street_edge', 'config',
    'region', 'street_edge_region', 'street_edge_priority', 'osm_way_street_edge',
    'street_imagery', 'street_edge_status_change', 'region_completion',
))

# Two columns a QA walk changes in place, which no row count sees: walking a street moves audited_distance off zero
# (RegionTable divides by it for the landing page's completion figure, so the launched city would open showing
# someone's local progress) and street_edge_priority off the 1 the fill assigns. Each is paired with the statement
# that puts it back; region_completion is recomputed by the app, which is how helpers.sh resets it too (#5297).
QA_RESIDUE_COLUMNS = (
    ('region_completion.audited_distance > 0',
     'SELECT count(*) FROM {schema}.region_completion WHERE audited_distance > 0', 'TRUNCATE region_completion'),
    ('street_edge_priority.priority <> 1',
     'SELECT count(*) FROM {schema}.street_edge_priority WHERE priority <> 1',
     'UPDATE street_edge_priority SET priority = 1'),
)


def qa_residue(schema):
    """
    What the schema holds that onboarding did not put there, as ``[(what, rows), ...]`` for the non-empty ones.

    The tables come from the catalog rather than a list here, so one added by a later evolution is covered the day
    it lands and a schema old enough to lack one cannot break the count. QA_RESIDUE_COLUMNS is checked alongside.

    Returns:
        (what, row count) pairs, empty for a schema nothing has been done in, or None when the counts could not
        be read at all — "couldn't tell" must not read as "clean".
    """
    tables = db_query(f"SELECT tablename FROM pg_tables WHERE schemaname = '{schema}' ORDER BY tablename")
    if tables is None:
        return None
    probes = [(table, f'SELECT count(*) FROM {schema}.{table}')
              for table in tables.split('\n') if table and table not in ONBOARDING_TABLES]
    probes += [(what, count_sql.format(schema=schema)) for what, count_sql, _ in QA_RESIDUE_COLUMNS]
    counts = db_query(' UNION ALL '.join(f"SELECT '{what}', ({count_sql})" for what, count_sql in probes))
    if counts is None:
        return None
    rows = []
    for line in counts.split('\n'):
        what, _, n = line.strip().partition('|')
        if n.isdigit() and int(n):
            rows.append((what, int(n)))
    return rows


def residue_cleanup_sql(residue):
    """
    The statements that clear what qa_residue found, in the order they must run, for a person or dump_schema.

    Every table is named outright rather than left to CASCADE: CASCADE reaches only the tables that *reference* a
    truncated one, so `cluster` alone would leave `intersection` (which cluster references) behind. It cannot reach
    the onboarding tables either — none of them references anything outside their own set (#5297).
    """
    tables = [what for what, _ in residue if '.' not in what]
    statements = [f'TRUNCATE {", ".join(tables)} RESTART IDENTITY CASCADE'] if tables else []
    found = {what for what, _ in residue}
    statements += [reset for what, _, reset in QA_RESIDUE_COLUMNS if what in found]
    return statements


def dump_schema(schema):
    """
    Dumps the finished schema to db/<schema>-dump in the format import-dump.sh and the server restore (-Fc), once it
    holds nothing but what onboarding put there.

    Returns:
        The number of objects the dump lists (a sanity check that it isn't empty).
    """
    residue = qa_residue(schema)
    if residue is None:
        sys.exit(f'error: could not check {schema} for data onboarding did not write, and "couldn\'t tell" must '
                 f'not ship as "clean". Is the db container up and the schema there? Rerun with --dump-only.')
    if residue:
        print('  This schema holds data onboarding did not put there — a local QA pass, or a job that ran as the '
              'city — which the dump would carry into the launched site:')
        for what, n_rows in residue:
            print(f'    {what}: {n_rows}')
        statements = residue_cleanup_sql(residue)
        print(f'  Clearing it means, as {schema}:')
        for statement in statements:
            print(f'    {statement};')
        if prompt('  Clear it now, then dump? (y/n)', 'n', cautious=True) != 'y':
            sys.exit('Stopped before writing the dump. Clear it (the statements above), then rerun with '
                     '--dump-only.')
        # A lock timeout, because TRUNCATE waits for ACCESS EXCLUSIVE and an app left running as the city with an
        # open transaction would otherwise hang this step without a word.
        run_or_exit(['psql', '-v', 'ON_ERROR_STOP=1', '-U', schema, '-d', 'sidewalk',
                     '-c', "SET lock_timeout = '30s'; " + '; '.join(statements) + ';'],
                    f'clearing {schema} failed',
                    f'Stop any app running as the city, or clear it by hand as postgres (docker exec -i '
                    f'{DB_CONTAINER} psql -U postgres -d sidewalk, with search_path set to {schema}), then rerun '
                    'with --dump-only.')
        residue = qa_residue(schema)
        if residue:
            left = '; '.join(f'{what}: {n}' for what, n in residue)
            sys.exit(f'error: {schema} still holds data after clearing it ({left}); look before dumping by hand.')
        print('  Cleared.')

    dump_path = f'/opt/{schema}-dump'
    docker_db('pg_dump', '-U', 'sidewalk', '-d', 'sidewalk', '-Fc', '-n', schema, '-f', dump_path, check=True)
    listing = docker_db('pg_restore', '--list', dump_path, capture_output=True, text=True, check=True)
    n_objects = sum(1 for line in listing.stdout.split('\n') if line and not line.startswith(';'))
    size = docker_db('stat', '-c', '%s', dump_path, capture_output=True, text=True, check=True).stdout.strip()
    print(f'  Wrote db/{schema}-dump ({int(size) / 1e6:.1f} MB, {n_objects} objects).')
    return n_objects


def parse_report(city_id):
    """Pulls the region table out of the onboarding run's report.md, for the tutorial-region prompt."""
    report = (REPO_ROOT / 'db' / 'onboarding' / city_id / 'report.md').read_text()
    return re.findall(r'^\| (\d+) \| (.+?) \|', report, re.MULTILINE)


REGIONS_SPEC_RE = r'all|(include|exclude):\d+( \d+)*'


def region_opens_at_launch(region_id, regions_spec):
    """
    Whether ``regions_spec`` (``all``, ``include:<ids>`` or ``exclude:<ids>``) leaves ``region_id`` open.

    Asked before the fill runs: fill-new-schema.sh refuses a tutorial region that the spec closes, and asking here
    lets the answer be corrected instead of the whole step failing (#5297).
    """
    mode, _, ids = regions_spec.partition(':')
    return mode == 'all' or (region_id in ids.split()) == (mode == 'include')


def regions_problem(tutorial_region, regions_spec):
    """What is wrong with a regions-to-open answer, as the question to ask again, or None when it can be used."""
    if not re.fullmatch(REGIONS_SPEC_RE, regions_spec):
        return 'Invalid — use "all", "include:1 2 3", or "exclude:4 5"'
    if not region_opens_at_launch(tutorial_region, regions_spec):
        return (f'Tutorial region {tutorial_region} must be open at launch, and "{regions_spec}" closes it. '
                'Regions to open')
    return None


def cityparams_landing_urls(city_id):
    """
    The city's prod and test landing-page URLs as cityparams.conf carries them, for a --dump-only run, which asks
    none of the questions the handoff is otherwise built from.

    Returns:
        ``(prod_url, test_url)``, each a placeholder naming the gap where the file has no entry.
    """
    lines = CITYPARAMS.read_text().split('\n')
    urls = []
    for stage in ('prod', 'test'):
        start = 0
        for name in ('landing-page-url', stage):
            start, close = find_block(lines, name, start)
            start += 1
        found = [match.group(1) for match in
                 (re.match(rf'^\s*{re.escape(city_id)}\s*=\s*"([^"]*)"', line) for line in lines[start:close])
                 if match]
        urls.append(found[0] if found else f'<{stage} URL: not in cityparams.conf>')
    return tuple(urls)


def main(argv=None):
    global ASSUME_DEFAULTS
    parser = argparse.ArgumentParser(description='Guided end-to-end new-city setup from onboarding artifacts.')
    parser.add_argument('city_id', type=valid_city_id,
                        help='The cityparams city id, e.g. "laurens-ia" (must match the scripts/onboard_city.py '
                             '--city-id used to generate the artifacts).')
    parser.add_argument('--dry-run', action='store_true',
                        help='Preview the config-file edits and stop before any docker/db step.')
    parser.add_argument('--yes', action='store_true',
                        help='Take every default without asking, the review of the build report included. '
                             'Without it a run with nothing on stdin stops at the first question that is a '
                             'choice; the cautious ones (keep an existing schema, stop before a dirty dump) take '
                             'their default either way.')
    parser.add_argument('--donor', help='City schema to clone the structure from (default: the dev container\'s '
                                        'DATABASE_USER). Refused if it sits ahead of this checkout\'s evolutions.')
    parser.add_argument('--country', help='Country id (e.g. usa, mexico, france); asked for otherwise, and the one '
                                          'answer a non-US city has no default for.')
    parser.add_argument('--pano-type', choices=sorted(PROVIDERS),
                        help='Pano viewer type (default: gsv; asked for otherwise).')
    parser.add_argument('--tutorial-region', type=int,
                        help='Region id of the tutorial region (step 6; asked for otherwise).')
    parser.add_argument('--regions', help='Regions to open at launch (step 6; asked for otherwise): "all", '
                                          '"include:1 2 3", or "exclude:4 5".')
    parser.add_argument('--skip-scan', action='store_true',
                        help='Skip the imagery scan (step 7); a later rerun picks it up.')
    parser.add_argument('--dump-only', action='store_true',
                        help='Run only step 8 — the leftover-data check, the dump, and the handoff — for a city '
                             'that was cleaned up or QA\'d after its first dump.')
    parser.add_argument('--allow-running-apps', action='store_true',
                        help="Boot for the evolutions even with a build running in the web container's checkout, "
                             'when you know it is idle. Without it, an interactive run waits for you to stop that '
                             'build and an unattended one stops with its pid. A taken :9000 is never overridden.')
    args = parser.parse_args(argv)
    ASSUME_DEFAULTS = args.yes
    city_id = args.city_id
    schema = schema_name(city_id)
    if args.regions and not re.fullmatch(REGIONS_SPEC_RE, args.regions):
        parser.error('--regions must be "all", "include:1 2 3", or "exclude:4 5"')
    if args.regions and args.tutorial_region and not region_opens_at_launch(str(args.tutorial_region), args.regions):
        parser.error(f'--regions "{args.regions}" closes the tutorial region {args.tutorial_region}, which has to '
                     'be open at launch')
    if args.dry_run and args.dump_only:
        parser.error('--dry-run drives no container and --dump-only does nothing else; pick one')

    # The db container mounts the MAIN checkout's db/ at /opt, and the boot compiles CHECKOUT_IN_CONTAINER, so a
    # worktree's artifacts, evolutions and scripts are none of them what the steps below would actually use (#5297).
    git_dirs = subprocess.run(['git', '-C', str(REPO_ROOT), 'rev-parse', '--git-dir', '--git-common-dir'],
                              capture_output=True, text=True)
    paths = git_dirs.stdout.splitlines()
    if not args.dry_run and git_dirs.returncode == 0 and len(paths) == 2 \
            and Path(paths[0]).resolve() != Path(paths[1]).resolve():
        sys.exit(f'error: {REPO_ROOT} is a git worktree, and this must run from the main checkout — the db '
                 f"container mounts the main checkout's db/ at /opt and the app boot compiles "
                 f"{CHECKOUT_IN_CONTAINER}, so a worktree's onboarding artifacts and evolutions are not the ones "
                 'that would be used.\n  Check this branch out in the main checkout and rerun there.')

    if args.dump_only:
        if subprocess.run(['docker', 'exec', DB_CONTAINER, 'true'], capture_output=True).returncode != 0:
            sys.exit(f'error: the {DB_CONTAINER} container is not running (make docker-up / make dev).')
        if not db_query(f"SELECT 1 FROM pg_namespace WHERE nspname = '{schema}'"):
            sys.exit(f'error: there is no schema {schema} to dump; run without --dump-only to build it.')
        print(f'Step 8/8 — dump the finished schema {schema} for the server...')
        dump_schema(schema)
        print(handoff_checklist(city_id, schema, *cityparams_landing_urls(city_id)))
        return

    city_dir = REPO_ROOT / 'db' / 'onboarding' / city_id
    sql_file = city_dir / 'qgis_tables.sql'
    if not sql_file.exists():
        sys.exit(f'error: {sql_file} not found — run `make build-city-data id={city_id} ...` first.')
    regions = parse_report(city_id)

    print(f'Step 0/8 — what the build produced for {city_id}:')
    for line in report_headlines((city_dir / 'report.md').read_text()):
        print(f'  {line}')
    preflight_path = city_dir / 'preflight_report.md'
    rows = preflight_table(preflight_path.read_text()) if preflight_path.exists() else []
    if rows:
        print('  Imagery preflight:')
        for line in rows:
            print(f'    {line}')
    else:
        print(f'  No imagery preflight yet — `make check-imagery id={city_id} args="--sample --<provider>"` answers '
              '"does this city have imagery?" in a few minutes, before any database work.')
    if args.yes:
        print('Continue with this data? (y/n): y  (--yes)')
    elif prompt('Continue with this data? (y/n)') != 'y':
        sys.exit('Stopped; rerun the build (or --from-gpkg after QGIS edits) and come back.')

    display_default, us_state = split_city_id(city_id)
    display_name = prompt('City display name', display_default)
    country = args.country or prompt('Country id (e.g. usa, mexico, france)', 'usa' if us_state else None)
    state = prompt('State id', us_state) if country == 'usa' else None
    pano_type = args.pano_type or prompt('Pano viewer type (gsv, mapillary, panoramax, infra3d)', 'gsv')
    while pano_type not in PROVIDERS:
        pano_type = prompt(f'Unknown viewer type; one of {", ".join(PROVIDERS)}', 'gsv')
    status = prompt('Visibility status (public, private)', 'private')
    launch_date = prompt('Launch date (convention: the Friday of the following week)',
                         default_launch_date(date.today()))
    prod_url = prompt('Prod landing-page URL', default_prod_url(city_id, us_state))
    test_url = test_url_for(prod_url)
    new_country = None
    if not message_key_exists('messages', f'country.name.{country}'):
        new_country = country
        country_name = prompt('Country display name (new to the platform)', country.replace('-', ' ').title())

    print('\nStep 1/8 — register the city in conf/...')
    registered = add_cityparams_entries(city_id, [
        (['db-schema'], f'"{schema}"'),
        (['city-short-name'], 'null'),
        (['state-id'], f'"{state}"' if state else 'null'),
        (['country-id'], f'"{country}"'),
        (['status'], f'"{status}"'),
        (['launch-date'], f'"{launch_date}"'),
        (['skyline-img'], '"skyline1.png"'),
        (['logo-img'], '"sidewalk-logo.png"'),
        (['landing-page-url', 'prod'], f'"{prod_url}"'),
        (['landing-page-url', 'test'], f'"{test_url}"'),
        # Empty, not "TODO": the layout skips the gtag block for an empty id. Step 2 fills them.
        (['google-analytics-4-id', 'prod'], '""'),
        (['google-analytics-4-id', 'test'], '""'),
        (['ai-tag-suggestions-enabled'], 'true'),
        (['ai-validation-enabled'], 'true'),
        (['ai-validation-min-accuracy'], '"0.92"'),
        (['pano-viewer-type'], f'"{pano_type}"'),
    ], args.dry_run)
    if registered:
        print(f'  Left unset (false by default; opt in by hand if wanted): {", ".join(OPTIONAL_FLAG_MAPS)}.')
    added = set()
    if add_message_line('messages', f'city.name.{city_id}', display_name, args.dry_run):
        added.add(f'city.name.{city_id}')
    if state and state in US_STATES.values():
        if add_message_line('messages', f'state.name.{state}', state.replace('-', ' ').title(), args.dry_run):
            added.add(f'state.name.{state}')
        # Asked of its own file, not tied to the base line: a run that added the base line and then died at a db
        # step would otherwise never write the abbreviation, and nothing else checks messages.en for it (#5297).
        abbrev = {name: code for code, name in US_STATES.items()}[state].upper()
        add_message_line('messages.en', f'state.name.{state}', abbrev, args.dry_run)
    if new_country and add_message_line('messages', f'country.name.{country}', country_name, args.dry_run):
        added.add(f'country.name.{country}')
    add_docs_city_row(city_id, schema, args.dry_run)
    owed = translation_todo(city_id, state, country, added)
    if owed:
        print('  Translations still missing (conf/messages/; zh-TW is owed, the others only where the name differs '
              'from English):')
        for line in owed:
            print(line)
    else:
        print('  Translations: every locale file already carries the city, state, and country names.')

    if args.dry_run:
        print('\n[dry-run] stopping before the docker/db steps.')
        return

    print('\nStep 2/8 — create the Google Analytics properties...')
    import create_ga_properties
    if not create_ga_properties.KEY_FILE.is_file():
        print(f'  No {create_ga_properties.KEY_FILE.name} in the repo root; skipping — see '
              'tools/create_ga_properties.py for the one-time setup, then run it standalone.')
    elif not create_ga_properties.ids_are_placeholders(city_id):
        print('  GA measurement ids are already filled in; skipping.')
    else:
        create_ga_properties.create_for_city(city_id)

    for container in (DB_CONTAINER, WEB_CONTAINER):
        if subprocess.run(['docker', 'exec', container, 'true'], capture_output=True).returncode != 0:
            sys.exit(f'error: the {container} container is not running (make docker-up / make dev).')

    print(f'\nStep 3/8 — create the empty schema {schema} by cloning a donor city...')
    cloned = False
    if db_query(f"SELECT 1 FROM pg_namespace WHERE nspname = '{schema}'") and \
            prompt(f'Schema {schema} already exists. Drop and recreate it? (y/n)', 'n', cautious=True) != 'y':
        print('  Keeping the existing schema.')
    else:
        donor = args.donor or web_env('DATABASE_USER') or prompt('Donor schema to clone (e.g. sidewalk_richmond)')
        run_or_exit(['/opt/scripts/create-new-schema.sh', schema, donor, str(highest_evolution()),
                     highest_evolution_hash()],
                    f'create-new-schema.sh would not clone {donor} into {schema}',
                    'Name an eligible donor with --donor <schema>; docs/onboarding-a-city.md says what makes one '
                    'eligible (a city at this checkout\'s evolution level, carrying this checkout\'s hashes).')
        cloned = True

    # A schema kept from an earlier run that stopped before the fill still holds only its clone's seed rows, so its
    # donor's evolution hashes have never been checked against this checkout — verify it as if it were fresh (#5297).
    streets = db_query(f'SELECT count(*) FROM {schema}.street_edge')
    if streets is None:
        # A clone interrupted mid-restore has the schema and only a prefix of its tables; "couldn't count" must
        # not read as "unfilled" any more than it may read as "clean" at the dump.
        sys.exit(f'error: could not count {schema}.street_edge — the kept schema may be a clone that never '
                 'finished. Rerun and answer "y" to drop and recreate it.')
    unfilled = streets in ('0', '1')
    if unfilled and not cloned:
        print('  The kept schema is still an unfilled clone, so its evolutions have never been verified against this '
              'checkout; verifying now.')

    print('\nStep 4/8 — apply evolutions via a one-shot app boot...')
    apply_evolutions(schema, city_id, verify=cloned or unfilled, allow_running_apps=args.allow_running_apps)

    # A filled schema means steps 5-6 already ran (a fresh clone holds just the tutorial street); rerunning the fill
    # would collide on street_edge ids.
    streets = db_query(f'SELECT count(*) FROM {schema}.street_edge')
    if streets and int(streets) > 1:
        print(f'\nSteps 5-6/8 — skipped: {schema} already holds {streets} streets.')
    else:
        print(f'\nStep 5/8 — load the staging tables from {sql_file.name}...')
        run_or_exit(['psql', '-v', 'ON_ERROR_STOP=1', '-U', schema, '-d', 'sidewalk',
                     '-f', f'/opt/onboarding/{city_id}/qgis_tables.sql'],
                    f'loading {sql_file.name} into {schema} failed',
                    'The db container reads /opt from the MAIN checkout\'s db/, so a file only a worktree has is '
                    'invisible there.')

        print('\nStep 6/8 — fill the schema from the staging tables. Regions:')
        for region_id, name in regions:
            print(f'  {region_id}: {name}')
        tutorial_region = str(args.tutorial_region) if args.tutorial_region else \
            prompt('Tutorial region id (a central region with imagery)', '1')
        while not tutorial_region.isdigit():
            tutorial_region = prompt('Invalid — the tutorial region is a region id from the list above')
        # Phased launches start with only some regions open (streets in the others are seeded 'closed'; open them
        # later with reveal-or-hide-neighborhoods.sh). The imagery scan below covers the whole city either way.
        regions_spec = args.regions or prompt('Regions to open at launch ("all", "include:<ids>", or '
                                              '"exclude:<ids>", ids space-separated)', 'all')
        # No default on the re-ask: under --yes a default is taken without asking, and "all" in place of the
        # phased launch that was typed would run the one fill nobody can undo with every region open.
        problem = regions_problem(tutorial_region, regions_spec)
        while problem:
            regions_spec = prompt(problem)
            problem = regions_problem(tutorial_region, regions_spec)
        run_or_exit(['/opt/scripts/fill-new-schema.sh', schema, tutorial_region, regions_spec],
                    f'fill-new-schema.sh failed on {schema}',
                    'The fill runs in one transaction, so nothing was committed and the schema is still the '
                    'unfilled clone: fix the cause and rerun, and the rerun comes straight back to this step.')

    print('\nStep 7/8 — imagery scan (finds streets with no street-view imagery and hides them)...')
    if args.skip_scan:
        print('  Skipped (--skip-scan); a rerun without the flag picks it up.')
    elif db_query(f"SELECT count(*) FROM {schema}.street_imagery WHERE data_source = 'imagery_scan'") not in (None,
                                                                                                             '0'):
        print('  A scan was already imported into street_imagery; skipping.')
    else:
        run_imagery_scan(schema, city_id, pano_type)

    print('\nStep 8/8 — dump the finished schema for the server...')
    dump_schema(schema)

    print(f'''
Done — {display_name}'s schema is populated. To develop against it, set SIDEWALK_CITY_ID={city_id} and
DATABASE_USER={schema} in docker-compose.override.yml and recreate the container (make docker-stop, then make dev) —
a running container's environment can't be changed in place.
{handoff_checklist(city_id, schema, prod_url, test_url)}
Still on a human: the translations listed under step 1; the donor's values the clone carried in the city's config row
— `excluded_tags`, `update_offset_hours`, `make_crops` (the fill printed them; `mapathon_event_link` was cleared);
and the GA ids if step 2 was skipped. The `/onboard-city` skill walks through all of it.''')


if __name__ == '__main__':
    main()
