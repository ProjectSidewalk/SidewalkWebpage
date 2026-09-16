"""
Adds a city's test and prod hostnames to the production Google Maps key's allowed referrers, or checks that every city
in cityparams.conf is already on it (#5339).

The key only answers pages whose hostname is on its referrer list, so a city left off it loads with a broken map and
no panos. `make onboard-city` offers to run this in step 2; standalone:

    python3 tools/maps_key_referrers.py newport-ky            # add the city's two hostnames
    python3 tools/maps_key_referrers.py newport-ky --dry-run  # show what would be added, change nothing
    python3 tools/maps_key_referrers.py --check               # list every city missing from the key

Exit status: 0 on success (for --check, nothing missing), 1 when --check finds hostnames missing, 2 on an error.

One-time setup: install the gcloud CLI and `gcloud auth login` as a Google identity that can edit API keys in the
production GCP project (docs/google-cloud.md). The project and key are found by their console names, so no ids live in
this repo. Adding is the only write, and it appends: existing referrers and the key's API restrictions are never
touched. It needs a gcloud recent enough to have `api-keys update --append` (`gcloud components update`).
"""

import argparse
import json
import re
import subprocess
import sys
from urllib.parse import urlparse

import setup_new_city

PROJECT_NAME = 'Project Sidewalk'
KEY_NAME = 'main API key'
GCLOUD_TIMEOUT_SECONDS = 120

CITYPARAMS = setup_new_city.CITYPARAMS


class MapsKeyError(Exception):
    """The key could not be read or edited; the message says why."""


def gcloud(*args):
    """
    Runs a gcloud command without letting it ask anything, since its output is captured and a question would hang.

    Returns:
        Its trimmed stdout.

    Raises:
        MapsKeyError: gcloud is missing, failed (with its own error text), or ran past the timeout.
    """
    try:
        result = subprocess.run(['gcloud', *args, '--quiet'], capture_output=True, text=True,
                                stdin=subprocess.DEVNULL, timeout=GCLOUD_TIMEOUT_SECONDS)
    except FileNotFoundError:
        raise MapsKeyError('gcloud is not installed')
    except subprocess.TimeoutExpired:
        raise MapsKeyError(f'`gcloud {" ".join(args[:3])}` took over {GCLOUD_TIMEOUT_SECONDS} seconds')
    if result.returncode != 0:
        raise MapsKeyError(f'`gcloud {" ".join(args[:3])}` failed: {result.stderr.strip()}')
    return result.stdout.strip()


def find_key():
    """
    Finds the production Maps key by the console names of its project and key.

    Returns:
        ``(project_id, key)``, where ``key`` is the API Keys resource as gcloud lists it.
    """
    projects = gcloud('projects', 'list', f'--filter=name="{PROJECT_NAME}"', '--format=value(projectId)').split()
    if len(projects) != 1:
        raise MapsKeyError(f'expected one GCP project named "{PROJECT_NAME}" visible to the signed-in gcloud account '
                           f'(gcloud auth login), found {len(projects)}')
    keys = json.loads(gcloud('services', 'api-keys', 'list', f'--project={projects[0]}',
                             f'--filter=displayName="{KEY_NAME}"', '--format=json') or '[]')
    if len(keys) != 1:
        raise MapsKeyError(f'expected one key named "{KEY_NAME}" in {PROJECT_NAME}, found {len(keys)}')
    return projects[0], keys[0]


def referrers_of(key):
    """The key's allowed referrers; an empty list would mean an unrestricted key, which is not the one we expect."""
    referrers = key.get('restrictions', {}).get('browserKeyRestrictions', {}).get('allowedReferrers', [])
    if not referrers:
        raise MapsKeyError(f'"{KEY_NAME}" has no referrer restrictions; refusing to use it')
    return referrers


def covered_hosts(referrers):
    """
    The hostnames a referrer list lets load every page of.

    The list mixes `https://host`, `host` and `host/*`. All three cover a whole site because our pages send only their
    origin to Google (Play's Referrer-Policy is origin-when-cross-origin), and cities listed the first two ways load
    fine. An entry pinned to a deeper path covers just that path, so it doesn't count. A `*.` wildcard stays in the
    set as written, and ``is_covered`` matches it.
    """
    hosts = set()
    for referrer in referrers:
        match = re.fullmatch(r'(?:https?://)?([^/]+)(?:/\*?)?', referrer.strip())
        if match:
            hosts.add(match.group(1).lower())
    return hosts


def is_covered(host, hosts):
    return host in hosts or any(h.startswith('*.') and host.endswith(h[1:]) for h in hosts)


def missing_referrers(referrers, urls):
    """
    The `host/*` entries to add so that every URL's hostname is covered, in the order given, without repeats.

    Raises:
        MapsKeyError: a URL has no hostname, which would otherwise pass as covered.
    """
    hosts = covered_hosts(referrers)
    missing = []
    for url in urls:
        host = urlparse(url).hostname
        if not host:
            raise MapsKeyError(f'"{url}" is not a URL with a hostname')
        entry = f'{host}/*'
        if not is_covered(host, hosts) and entry not in missing:
            missing.append(entry)
    return missing


def all_city_urls():
    """Every city's landing-page URLs in cityparams.conf, as ``[(city_id, url), ...]``."""
    lines = CITYPARAMS.read_text().split('\n')
    pairs = []
    for stage in ('prod', 'test'):
        start, close = setup_new_city.find_block(lines, 'landing-page-url')
        start, close = setup_new_city.find_block(lines, stage, start)
        text = '\n'.join(lines[start + 1:close])
        pairs += [(city_id, value.strip('"')) for city_id, value in re.findall(r'^\s*([a-z0-9-]+)\s*=\s*(.+?)\s*$',
                                                                               text, re.M)]
    return pairs


def missing_for_city(city_id, key):
    """The entries the city still needs on ``key``; a URL missing from cityparams.conf raises."""
    return missing_referrers(referrers_of(key), setup_new_city.cityparams_landing_urls(city_id))


def append_referrers(project_id, key, entries):
    """Adds ``entries`` to the key."""
    # Without --append, gcloud replaces the whole list, dropping every other city.
    gcloud('services', 'api-keys', 'update', key['name'], f'--project={project_id}', '--append',
           f'--allowed-referrers={",".join(entries)}')
    print(f'  Added to the Maps key: {", ".join(entries)} (Google can take a few minutes to apply it).')


def add_for_city(city_id, dry_run=False):
    """Adds the city's missing hostnames to the key, or with ``dry_run`` only prints them."""
    project_id, key = find_key()
    to_add = missing_for_city(city_id, key)
    if not to_add:
        print(f'  Both of {city_id}\'s hostnames are already on the Maps key.')
    elif dry_run:
        print(f'  [dry-run] would add to the Maps key: {", ".join(to_add)}')
    else:
        append_referrers(project_id, key, to_add)


def check_all():
    """
    Prints every city hostname missing from the key.

    Returns:
        The number of distinct missing hostnames.
    """
    referrers = referrers_of(find_key()[1])
    missing = {}
    for city_id, url in all_city_urls():
        for entry in missing_referrers(referrers, [url]):
            missing.setdefault(entry, city_id)
    for entry, city_id in missing.items():
        print(f'  {city_id}: {entry}')
    if not missing:
        print('  Every landing-page URL in cityparams.conf is on the Maps key.')
    return len(missing)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Add a city's hostnames to the production Maps key's referrers.")
    parser.add_argument('city_id', nargs='?', help='The cityparams city id, e.g. "newport-ky".')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be added and change nothing.')
    parser.add_argument('--check', action='store_true',
                        help='List every city hostname missing from the key, changing nothing; exits 1 if any.')
    args = parser.parse_args(argv)
    if args.check == bool(args.city_id):
        parser.error('pass either a city id or --check')
    if args.check and args.dry_run:
        parser.error('--check never changes anything; drop --dry-run')
    try:
        if args.check:
            sys.exit(1 if check_all() else 0)
        add_for_city(args.city_id, args.dry_run)
    except MapsKeyError as err:
        print(f'error: {err}.', file=sys.stderr)
        sys.exit(2)


if __name__ == '__main__':
    main()
