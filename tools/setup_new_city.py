"""
Guided end-to-end setup of a new city from its onboarding artifacts (issue #4291).

Run after scripts/onboard_city.py has produced db/onboarding/<city-id>/ and the GeoPackage has been QA'd:

    make onboard-city id=newport-ky        (host-side; wraps `python3 tools/setup_new_city.py newport-ky`)

It chains every remaining setup step, pausing only where a human is required:

  1. Registers the city in conf/cityparams.conf (all the per-city maps, with derived defaults and placeholder GA
     ids), conf/messages (city name; state name if it's a US state we haven't seen before), and the City IDs table
     in docs/dev-environment.md.
  2. Creates the city's GA4 properties and fills the real measurement ids (tools/create_ga_properties.py) — when
     the repo-root ga-service-account.json key exists and the ids are still placeholders; skipped with a pointer
     otherwise.
  3. Creates the empty city schema from the template (db/scripts/create-new-schema.sh).
  4. Boots the app one-shot inside the web container with DATABASE_USER/SIDEWALK_CITY_ID overridden via
     `docker exec -e` (a running container's env is fixed at creation, so editing docker-compose.override.yml can't
     retarget it), and watches play_evolutions until the schema is current — the template dump is far behind, and
     fill-new-schema.sh needs current columns. The boot is stopped once evolutions land.
  5. Loads db/onboarding/<city-id>/qgis_tables.sql into the schema.
  6. Runs fill-new-schema.sh non-interactively (you pick the tutorial region).
  7. Runs the scripts/check_streets_for_imagery.py scan in the web container (which holds the API keys and the
     python3.13 deps) against a freshly exported endpoints CSV, hides the no-imagery streets, and imports the
     imagery-age summary into street_imagery.

A rerun skips whatever already happened: registered configs, an existing schema (answer "n"), applied evolutions,
and a filled schema (jumping straight to the imagery scan).

Host-side and stdlib-only (it edits repo files and drives docker), unlike scripts/, which runs in the web container.
Config edits are idempotent — a city already present in cityparams.conf is left alone — and `--dry-run` previews the
file edits and stops before any docker/db step.
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
        return
    lines = text.split('\n')
    insert_entry(lines, ['city-ids'], f'"{city_id}"')
    for path, value in values:
        insert_entry(lines, path, f'{city_id} = {value}')
    if dry_run:
        print(f'  [dry-run] would add {1 + len(values)} entries to {CITYPARAMS}')
        return
    CITYPARAMS.write_text('\n'.join(lines))
    print(f'  Registered {city_id} in {CITYPARAMS.name} ({1 + len(values)} entries).')


def add_message_line(file_name, key, value, dry_run):
    """Appends `key = value` right after the file's last key of the same family; no-op if the key exists."""
    path = MESSAGES_DIR / file_name
    lines = path.read_text().split('\n')
    if any(line.startswith(f'{key} ') or line.startswith(f'{key}=') for line in lines):
        return
    family = key.rsplit('.', 1)[0] + '.'
    last = max(i for i, line in enumerate(lines) if line.startswith(family))
    lines.insert(last + 1, f'{key} = {value}')
    if dry_run:
        print(f'  [dry-run] would add "{key} = {value}" to {file_name}')
        return
    path.write_text('\n'.join(lines))
    print(f'  Added "{key} = {value}" to {file_name}.')


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


def docker_db(*args, **kwargs):
    return subprocess.run(['docker', 'exec', '-i', DB_CONTAINER, *args], **kwargs)


def db_query(sql):
    """One value from psql as postgres (readonly_user may lack rights on a brand-new schema)."""
    result = docker_db('psql', '-U', 'postgres', '-d', 'sidewalk', '-tAc', sql, capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


def sbt_running():
    return subprocess.run(['docker', 'exec', WEB_CONTAINER, 'pgrep', '-f', 'sbt-launch'],
                          capture_output=True).returncode == 0


def apply_evolutions(schema, city_id):
    """Boots the app one-shot as the new city and blocks until play_evolutions reaches the repo's latest."""
    latest = max(int(p.stem) for p in (REPO_ROOT / 'conf' / 'evolutions' / 'default').glob('*.sql')
                 if p.stem.isdigit())
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
    flag = {'gsv': '--gsv', 'mapillary': '--mapillary'}.get(pano_type)
    if flag is None:
        print(f'  No imagery scan for pano type "{pano_type}"; skipping.')
        return
    env_var = 'GOOGLE_MAPS_API_KEY' if flag == '--gsv' else 'MAPILLARY_ACCESS_TOKEN'
    key = subprocess.run(['docker', 'exec', WEB_CONTAINER, 'printenv', env_var], capture_output=True, text=True)
    if key.returncode != 0 or not key.stdout.strip():
        print(f'  {env_var} is not set in the web container; skipping the scan (run it manually later).')
        return

    export = docker_db('psql', '-U', schema, '-d', 'sidewalk', '-c',
                       'COPY (SELECT street_edge.street_edge_id, street_edge_region.region_id, x1, y1, x2, y2, geom '
                       'FROM street_edge JOIN street_edge_region '
                       'ON street_edge.street_edge_id = street_edge_region.street_edge_id '
                       'WHERE street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)) '
                       'TO STDOUT WITH (FORMAT csv, HEADER)',
                       capture_output=True, text=True, check=True)
    (REPO_ROOT / 'db' / 'onboarding' / city_id / 'street_edge_endpoints.csv').write_text(export.stdout)
    print(f'  Scanning {export.stdout.count(chr(10)) - 1} streets for {pano_type} imagery (resumes this city\'s '
          'own checkpoint if interrupted)...')
    # A TTY (when we have one to give) lets the scan's tqdm progress bar render; over a plain pipe it auto-hides.
    tty = ['-t'] if sys.stdin.isatty() else []
    subprocess.run(['docker', 'exec', '-i', *tty, WEB_CONTAINER, 'python3.13',
                    'scripts/check_streets_for_imagery.py', '--city-id', city_id, flag], check=True)

    no_imagery = REPO_ROOT / 'db' / 'onboarding' / city_id / 'streets_with_no_imagery.csv'
    n_hidden = max(0, len(no_imagery.read_text().strip().split('\n')) - 1) if no_imagery.exists() else 0
    print(f'  {n_hidden} street(s) without imagery; marking them no_imagery...')
    docker_db('/opt/scripts/hide-streets-without-imagery.sh', schema,
              f'onboarding/{city_id}/streets_with_no_imagery.csv', check=True)

    # On a fresh city the automatic street_imagery feeder (pano_data, via labels) has nothing yet, so the scan's
    # summary is the only source of imagery-age data (#4348).
    print('  Importing the imagery-age summary into street_imagery...')
    docker_db('/opt/scripts/import-street-imagery.sh', schema,
              f'onboarding/{city_id}/street_imagery_summary.csv', check=True)


def parse_report(city_id):
    """Pulls the region table out of the onboarding run's report.md, for the tutorial-region prompt."""
    report = (REPO_ROOT / 'db' / 'onboarding' / city_id / 'report.md').read_text()
    return re.findall(r'^\| (\d+) \| (.+?) \|', report, re.MULTILINE)


def main():
    parser = argparse.ArgumentParser(description='Guided end-to-end new-city setup from onboarding artifacts.')
    parser.add_argument('city_id', help='The cityparams city id, e.g. "newport-ky" (must match the '
                                        'scripts/onboard_city.py --city-id used to generate the artifacts).')
    parser.add_argument('--dry-run', action='store_true',
                        help='Preview the config-file edits and stop before any docker/db step.')
    args = parser.parse_args()
    city_id = args.city_id
    schema = schema_name(city_id)

    sql_file = REPO_ROOT / 'db' / 'onboarding' / city_id / 'qgis_tables.sql'
    if not sql_file.exists():
        sys.exit(f'error: {sql_file} not found — run scripts/onboard_city.py --city-id {city_id} first.')
    regions = parse_report(city_id)

    tokens = city_id.split('-')
    us_state = US_STATES.get(tokens[-1]) if len(tokens) > 1 else None
    display_default = ' '.join(tokens[:-1] if us_state else tokens).title()
    display_name = prompt('City display name', display_default)
    country = prompt('Country id (e.g. usa, mexico, taiwan)', 'usa' if us_state else None)
    state = prompt('State id', us_state) if country == 'usa' else None
    pano_type = prompt('Pano viewer type (gsv, mapillary, infra3d)', 'gsv')
    status = prompt('Visibility status (public, private)', 'public')
    # 11 - weekday() lands on the Friday of the next calendar week (weekday(): Monday = 0).
    launch_default = (date.today() + timedelta(days=11 - date.today().weekday())).isoformat()
    launch_date = prompt('Launch date (convention: the Friday of the following week)', launch_default)
    # The convention drops the state/country qualifier from server names (teaneck-nj -> sidewalk-teaneck).
    url_base = '-'.join(tokens[:-1]) if us_state else city_id
    prod_url = prompt('Prod landing-page URL', f'https://sidewalk-{url_base}.cs.washington.edu')
    scheme, host = prod_url.rstrip('/').split('://', 1)
    first_label, _, rest = host.partition('.')
    test_url = f'{scheme}://{first_label}-test' + (f'.{rest}' if rest else '')

    print('\nStep 1/7 — register the city in conf/...')
    add_cityparams_entries(city_id, [
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
        (['google-analytics-4-id', 'prod'], '"TODO"'),
        (['google-analytics-4-id', 'test'], '"TODO"'),
        (['ai-tag-suggestions-enabled'], 'true'),
        (['ai-validation-enabled'], 'true'),
        (['ai-validation-min-accuracy'], '"0.92"'),
        (['pano-viewer-type'], f'"{pano_type}"'),
    ], args.dry_run)
    add_message_line('messages', f'city.name.{city_id}', display_name, args.dry_run)
    if state and state in US_STATES.values():
        add_message_line('messages', f'state.name.{state}', state.replace('-', ' ').title(), args.dry_run)
        abbrev = next(k for k, v in US_STATES.items() if v == state).upper()
        add_message_line('messages.en', f'state.name.{state}', abbrev, args.dry_run)
    add_docs_city_row(city_id, schema, args.dry_run)

    if args.dry_run:
        print('\n[dry-run] stopping before the docker/db steps.')
        return

    print('\nStep 2/7 — create the Google Analytics properties...')
    import create_ga_properties
    if not create_ga_properties.KEY_FILE.is_file():
        print(f'  No {create_ga_properties.KEY_FILE.name} in the repo root; skipping — see '
              'tools/create_ga_properties.py for the one-time setup, then run it standalone.')
    elif not create_ga_properties.ids_are_todo(city_id):
        print('  GA measurement ids are already filled in; skipping.')
    else:
        create_ga_properties.create_for_city(city_id)

    for container in (DB_CONTAINER, WEB_CONTAINER):
        if subprocess.run(['docker', 'exec', container, 'true'], capture_output=True).returncode != 0:
            sys.exit(f'error: the {container} container is not running (make docker-up / make dev).')

    print(f'\nStep 3/7 — create the empty schema {schema}...')
    if db_query(f"SELECT 1 FROM pg_namespace WHERE nspname = '{schema}'"):
        if prompt(f'Schema {schema} already exists. Drop and recreate it? (y/n)', 'n') != 'y':
            print('  Keeping the existing schema.')
        else:
            docker_db('/opt/scripts/create-new-schema.sh', schema, check=True)
    else:
        docker_db('/opt/scripts/create-new-schema.sh', schema, check=True)

    print('\nStep 4/7 — apply evolutions via a one-shot app boot...')
    apply_evolutions(schema, city_id)

    # A filled schema means steps 5-6 already ran (the template alone holds just the tutorial street); rerunning the
    # fill would collide on street_edge ids.
    streets = db_query(f'SELECT count(*) FROM {schema}.street_edge')
    if streets and int(streets) > 1:
        print(f'\nSteps 5-6/7 — skipped: {schema} already holds {streets} streets.')
    else:
        print(f'\nStep 5/7 — load the staging tables from {sql_file.name}...')
        docker_db('psql', '-v', 'ON_ERROR_STOP=1', '-U', schema, '-d', 'sidewalk',
                  '-f', f'/opt/onboarding/{city_id}/qgis_tables.sql', check=True)

        print('\nStep 6/7 — fill the schema from the staging tables. Regions:')
        for region_id, name in regions:
            print(f'  {region_id}: {name}')
        tutorial_region = prompt('Tutorial region id (a central region with imagery)', '1')
        docker_db('/opt/scripts/fill-new-schema.sh', schema, tutorial_region, 'all', check=True)

    print('\nStep 7/7 — imagery scan (finds streets with no street-view imagery and hides them)...')
    run_imagery_scan(schema, city_id, pano_type)

    print(f'''
Done — {display_name}'s schema is populated. To develop against it, set SIDEWALK_CITY_ID={city_id} and
DATABASE_USER={schema} in docker-compose.override.yml and recreate the container (make docker-stop, then make dev) —
a running container's environment can't be changed in place.

Last step: run the `add-city-configs` skill in a Claude Code session (it finishes what a script can't — non-English
name translations, a review of the derived cityparams values, and the Google Analytics ids if step 2 was skipped).''')


if __name__ == '__main__':
    main()
