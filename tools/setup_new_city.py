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
     the donor defaults to the active dev city and is refused if it sits ahead of this checkout's evolutions).
  4. Boots the app one-shot inside the web container with DATABASE_USER/SIDEWALK_CITY_ID overridden via
     `docker exec -e` (a running container's env is fixed at creation, so editing docker-compose.override.yml can't
     retarget it), and watches play_evolutions until the schema is current. A no-op when the donor was current.
  5. Loads db/onboarding/<city-id>/qgis_tables.sql into the schema.
  6. Runs fill-new-schema.sh non-interactively (you pick the tutorial region and which regions open at launch).
  7. Runs the scripts/check_streets_for_imagery.py scan for the city's imagery provider in the web container (which
     holds the API keys and the python3.13 deps) against a freshly exported endpoints CSV, hides the no-imagery
     streets, and imports the imagery-age summary into street_imagery.
  8. Dumps the finished schema to db/<schema>-dump — the file import-dump.sh and the server both restore — and
     prints the server handoff checklist.

A rerun skips whatever already happened: registered configs, an existing schema (answer "n"), applied evolutions,
a filled schema (jumping straight to the imagery scan), and a scan already applied. `--skip-scan` defers step 7.

Host-side and stdlib-only (it edits repo files and drives docker), unlike scripts/, which runs in the web container.
Config edits are idempotent — a city already present in cityparams.conf is left alone — and `--dry-run` previews the
file edits and stops before any docker/db step. The pure helpers are unit-tested in test/python/test_setup_new_city.py.
"""

import argparse
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

# The same sbt invocation `npm start` uses, minus `~` (one-shot, no watch). The tail pipe keeps stdin open — Play's
# dev server stops on stdin EOF, which a detached `docker exec` would deliver immediately.
BOOT_CMD = ("cd /home && tail -f /dev/null | sbt -Dconfig.file=/home/conf/application.local.conf "
            "-Dsbt.coursier.home='.coursier' -Dsbt.global.base='.sbt' -Dsbt.boot.directory='.sbt/boot' "
            "-Dsbt.repository.config='.sbt/repositories' -J-Xmx1536m run > /tmp/onboard-city-boot.log 2>&1")

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
TRANSLATED_MESSAGE_FILES = ('messages.zh-TW', 'messages.es', 'messages.nl', 'messages.de', 'messages.pt-BR',
                            'messages.fr')


def schema_name(city_id):
    """Same derivation as scripts/onboard_city.py: full city id, hyphens as underscores."""
    return 'sidewalk_' + city_id.replace('-', '_')


def prompt(text, default=None):
    """Prompts on the terminal; empty input takes the default (re-prompts when there is none)."""
    suffix = f' [{default}]' if default is not None else ''
    while True:
        value = input(f'{text}{suffix}: ').strip()
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
        city_id: e.g. ``laurens-ia`` or ``bayonne``.

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


def translation_todo(city_id, state, new_country):
    """
    The message keys a human still has to translate after the English lines are in.

    Args:
        city_id:     The city id (its ``city.name.<id>`` key).
        state:       The US state id whose ``state.name.<state>`` line was just added, or None.
        new_country: The country id whose ``country.name.<country>`` line was just added, or None.

    Returns:
        Human-readable lines, one per file, naming the keys to add where the language renders them differently
        (zh-TW always transliterates; Latin-script languages only for well-known exonyms).
    """
    keys = [f'city.name.{city_id}']
    if state:
        keys.append(f'state.name.{state}')
    if new_country:
        keys.append(f'country.name.{new_country}')
    return [f'  conf/messages/{file_name}: {", ".join(keys)}' for file_name in TRANSLATED_MESSAGE_FILES]


def handoff_checklist(city_id, schema, prod_url, test_url):
    """The steps outside this repo that stand between a finished local schema and a live city."""
    return f'''
Server handoff for {city_id}:
  1. Copy the dump to the server:  scp db/{schema}-dump makelab1.cs.washington.edu:/www/sidewalk/new-city-dumps/
  2. On the server, register the city with the IT tooling (uwcseit-sidewalk-tools: bin/setup-new.pl), which creates the
     DB role, restores the dump into sidewalk_test / sidewalk_prod, and writes the vhost — test stage first.
  3. DNS + Google Cloud: add {test_url} and {prod_url} as referrers on the Maps API key (docs/google-cloud.md).
  4. Open the PR with the config, message, and docs changes; the auto-deploy picks the city up once it lands on
     develop (test) and in a release (prod).
  5. Round-trip check any time: make import-dump db={schema} restores db/{schema}-dump into the dev DB.
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


def sbt_running():
    return subprocess.run(['docker', 'exec', WEB_CONTAINER, 'pgrep', '-f', 'sbt-launch'],
                          capture_output=True).returncode == 0


def apply_evolutions(schema, city_id):
    """Boots the app one-shot as the new city and blocks until play_evolutions reaches the repo's latest."""
    latest = highest_evolution()
    applied = db_query(f'SELECT max(id) FROM {schema}.play_evolutions')
    if applied and int(applied) >= latest:
        print(f'  Schema is already at evolution {applied}; no app boot needed.')
        return
    while sbt_running():
        input('  An app/sbt is already running in the web container; it would fight the one-shot boot over :9000 '
              'and the build locks. Ctrl-C your `npm start`, then press Enter... ')
    subprocess.run(['docker', 'exec', '-d', '-e', f'DATABASE_USER={schema}', '-e', f'SIDEWALK_CITY_ID={city_id}',
                    WEB_CONTAINER, 'bash', '-c', BOOT_CMD], check=True)
    print(f'  Booting the app as {city_id} to apply evolutions (needs {latest}; the dev compile takes a while)...')
    try:
        deadline = time.monotonic() + 30 * 60
        while time.monotonic() < deadline:
            # Any HTTP response (even an error page) means the app booted; the evolutions check is the real gate.
            try:
                urllib.request.urlopen('http://localhost:9000/', timeout=240).close()
            except urllib.error.HTTPError:
                pass
            except (urllib.error.URLError, OSError):
                time.sleep(10)
                continue
            applied = db_query(f'SELECT max(id) FROM {schema}.play_evolutions')
            if applied and int(applied) >= latest:
                print(f'  Evolutions applied (at {applied}).')
                return
            print(f'  ...at {applied or "?"} of {latest}')
            time.sleep(10)
        sys.exit(f'error: evolutions never reached {latest}. Check the boot log: '
                 f'docker exec {WEB_CONTAINER} tail -50 /tmp/onboard-city-boot.log — then rerun.')
    finally:
        for pattern in ('sbt-launch', 'tail -f /dev/null'):
            subprocess.run(['docker', 'exec', WEB_CONTAINER, 'pkill', '-f', pattern], capture_output=True)
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


def dump_schema(schema):
    """
    Dumps the finished schema to db/<schema>-dump in the format import-dump.sh and the server restore (-Fc).

    Returns:
        The number of objects the dump lists (a sanity check that it isn't empty).
    """
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


def main(argv=None):
    parser = argparse.ArgumentParser(description='Guided end-to-end new-city setup from onboarding artifacts.')
    parser.add_argument('city_id', help='The cityparams city id, e.g. "laurens-ia" (must match the '
                                        'scripts/onboard_city.py --city-id used to generate the artifacts).')
    parser.add_argument('--dry-run', action='store_true',
                        help='Preview the config-file edits and stop before any docker/db step.')
    parser.add_argument('--donor', help='City schema to clone the structure from (default: the dev container\'s '
                                        'DATABASE_USER). Refused if it sits ahead of this checkout\'s evolutions.')
    parser.add_argument('--skip-scan', action='store_true',
                        help='Skip the imagery scan (step 7); a later rerun picks it up.')
    args = parser.parse_args(argv)
    city_id = args.city_id
    schema = schema_name(city_id)

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
    if prompt('Continue with this data? (y/n)', 'y') != 'y':
        sys.exit('Stopped; rerun the build (or --from-gpkg after QGIS edits) and come back.')

    display_default, us_state = split_city_id(city_id)
    display_name = prompt('City display name', display_default)
    country = prompt('Country id (e.g. usa, mexico, france)', 'usa' if us_state else None)
    state = prompt('State id', us_state) if country == 'usa' else None
    pano_type = prompt('Pano viewer type (gsv, mapillary, panoramax, infra3d)', 'gsv')
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
    add_message_line('messages', f'city.name.{city_id}', display_name, args.dry_run)
    new_state = None
    if state and state in US_STATES.values() and not message_key_exists('messages', f'state.name.{state}'):
        new_state = state
        add_message_line('messages', f'state.name.{state}', state.replace('-', ' ').title(), args.dry_run)
        abbrev = next(k for k, v in US_STATES.items() if v == state).upper()
        add_message_line('messages.en', f'state.name.{state}', abbrev, args.dry_run)
    if new_country:
        add_message_line('messages', f'country.name.{country}', country_name, args.dry_run)
    add_docs_city_row(city_id, schema, args.dry_run)
    print('  Translations still owed (zh-TW always; the others only where the name differs from English):')
    for line in translation_todo(city_id, new_state, new_country):
        print(line)

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
    if db_query(f"SELECT 1 FROM pg_namespace WHERE nspname = '{schema}'") and \
            prompt(f'Schema {schema} already exists. Drop and recreate it? (y/n)', 'n') != 'y':
        print('  Keeping the existing schema.')
    else:
        donor = args.donor or web_env('DATABASE_USER') or prompt('Donor schema to clone (e.g. sidewalk_richmond)')
        docker_db('/opt/scripts/create-new-schema.sh', schema, donor, str(highest_evolution()), check=True)

    print('\nStep 4/8 — apply evolutions via a one-shot app boot...')
    apply_evolutions(schema, city_id)

    # A filled schema means steps 5-6 already ran (a fresh clone holds just the tutorial street); rerunning the fill
    # would collide on street_edge ids.
    streets = db_query(f'SELECT count(*) FROM {schema}.street_edge')
    if streets and int(streets) > 1:
        print(f'\nSteps 5-6/8 — skipped: {schema} already holds {streets} streets.')
    else:
        print(f'\nStep 5/8 — load the staging tables from {sql_file.name}...')
        docker_db('psql', '-v', 'ON_ERROR_STOP=1', '-U', schema, '-d', 'sidewalk',
                  '-f', f'/opt/onboarding/{city_id}/qgis_tables.sql', check=True)

        print('\nStep 6/8 — fill the schema from the staging tables. Regions:')
        for region_id, name in regions:
            print(f'  {region_id}: {name}')
        tutorial_region = prompt('Tutorial region id (a central region with imagery)', '1')
        # Phased launches start with only some regions open (streets in the others are seeded 'closed'; open them
        # later with reveal-or-hide-neighborhoods.sh). The imagery scan below covers the whole city either way.
        regions_spec = prompt('Regions to open at launch ("all", "include:<ids>", or "exclude:<ids>", '
                              'ids space-separated)', 'all')
        while not re.fullmatch(r'all|(include|exclude):\d+( \d+)*', regions_spec):
            regions_spec = prompt('Invalid — use "all", "include:1 2 3", or "exclude:4 5"', 'all')
        docker_db('/opt/scripts/fill-new-schema.sh', schema, tutorial_region, regions_spec, check=True)

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
Still on a human: the translations listed under step 1, a look at `excluded_tags` and `update_offset_hours` in the
city's config row (the clone carries the donor's), and the GA ids if step 2 was skipped. The `/onboard-city` skill
walks through all of it.''')


if __name__ == '__main__':
    main()
