"""
Adds a city's test and prod hostnames to the production Google Maps key's allowed referrers, or checks that every city
in cityparams.conf is already on it (#5339).

The key only answers pages whose hostname is on its referrer list, so a city left off it loads with a broken map and
no panos. `make onboard-city` runs this as part of step 2 when gcloud is signed in to an account that can see the
key; standalone:

    python3 tools/maps_key_referrers.py newport-ky            # add the city's two hostnames
    python3 tools/maps_key_referrers.py newport-ky --dry-run  # show what would be added, change nothing
    python3 tools/maps_key_referrers.py --check               # list every city missing from the key

One-time setup: install the gcloud CLI and `gcloud auth login` as the Google identity that owns the production GCP
project (docs/google-cloud.md). The project and key are found by their console names, so no ids live in this repo.
Adding is the only write, and it appends: existing referrers and the key's API restrictions are never touched. It
needs a gcloud recent enough to have `api-keys update --append` (`gcloud components update`).
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
from urllib.parse import urlparse

import setup_new_city

PROJECT_NAME = 'Project Sidewalk'
KEY_NAME = 'main API key'

CITYPARAMS = setup_new_city.CITYPARAMS


def gcloud(*args, required=False):
    """
    Runs a gcloud command.

    Args:
        required: Stop the run, showing gcloud's error, when the command fails.

    Returns:
        Its trimmed stdout, or None when the command fails.
    """
    result = subprocess.run(['gcloud', *args], capture_output=True, text=True)
    if result.returncode != 0 and required:
        sys.exit(f'error: `gcloud {" ".join(args[:3])} ...` failed:\n{result.stderr.strip()}')
    return result.stdout.strip() if result.returncode == 0 else None


def find_key():
    """
    Finds the production Maps key by the console names of its project and key.

    Returns:
        ``(project_id, key_resource_name)``, or a string saying why the key could not be reached.
    """
    if shutil.which('gcloud') is None:
        return 'gcloud is not installed'
    projects = gcloud('projects', 'list', f'--filter=name="{PROJECT_NAME}"', '--format=value(projectId)')
    if not projects:
        return f'the signed-in gcloud account cannot see a GCP project named "{PROJECT_NAME}" (gcloud auth login)'
    if len(projects.split()) > 1:
        return f'more than one GCP project is named "{PROJECT_NAME}"'
    keys = gcloud('services', 'api-keys', 'list', f'--project={projects}', f'--filter=displayName="{KEY_NAME}"',
                  '--format=value(name)')
    if not keys or len(keys.split()) > 1:
        return f'expected exactly one key named "{KEY_NAME}" in {PROJECT_NAME}, found {len((keys or "").split())}'
    return projects, keys


def reachable_key():
    """``find_key()``'s result for a caller that cannot go on without the key."""
    key = find_key()
    if isinstance(key, str):
        sys.exit(f'error: {key}.')
    return key


def current_referrers(key):
    """The key's allowed referrers; stops the run when the key has none, since that means it is unrestricted."""
    project_id, key_name = key
    described = json.loads(gcloud('services', 'api-keys', 'describe', key_name, f'--project={project_id}',
                                  '--format=json', required=True))
    referrers = described.get('restrictions', {}).get('browserKeyRestrictions', {}).get('allowedReferrers', [])
    if not referrers:
        sys.exit(f'error: "{KEY_NAME}" has no referrer restrictions; refusing to use it.')
    return referrers


def covered_hosts(referrers):
    """
    The hostnames a referrer list lets load every page of.

    The list mixes `https://host`, `host` and `host/*`; all three cover a whole site because browsers send only the
    origin to Google. An entry pinned to a deeper path covers just that path, so it doesn't count. A `*.` wildcard
    stays in the set as written, and ``is_covered`` matches it.
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
    """The `host/*` entries to add so that every URL's hostname is covered, in the order given, without repeats."""
    hosts = covered_hosts(referrers)
    missing = []
    for url in urls:
        host = urlparse(url).hostname
        entry = f'{host}/*'
        if host and not is_covered(host, hosts) and entry not in missing:
            missing.append(entry)
    return missing


def city_urls(city_id):
    """The city's prod and test landing-page URLs; stops the run when cityparams.conf has no entry for either."""
    lines = CITYPARAMS.read_text().split('\n')
    return [setup_new_city.cityparams_value(lines, ['landing-page-url', stage], city_id) for stage in ('prod', 'test')]


def all_city_urls():
    """Every city's landing-page URLs, as ``[(city_id, url), ...]``."""
    lines = CITYPARAMS.read_text().split('\n')
    pairs = []
    for stage in ('prod', 'test'):
        start, close = setup_new_city.find_block(lines, 'landing-page-url')
        start, close = setup_new_city.find_block(lines, stage, start)
        pairs += re.findall(r'^\s*([a-z0-9-]+)\s*=\s*"(https?://[^"]+)"', '\n'.join(lines[start + 1:close]), re.M)
    return pairs


def add_for_city(city_id, dry_run=False, key=None):
    """
    Adds the city's missing hostnames to the key.

    Args:
        city_id: A city already registered in cityparams.conf.
        dry_run: Print what would be added and change nothing.
        key:     ``find_key()``'s result, when the caller already looked it up.
    """
    urls = city_urls(city_id)
    key = key or reachable_key()
    to_add = missing_referrers(current_referrers(key), urls)
    if not to_add:
        print(f'  Both of {city_id}\'s hostnames are already on the Maps key.')
        return
    if dry_run:
        print(f'  [dry-run] would add to the Maps key: {", ".join(to_add)}')
        return
    # Without --append, gcloud replaces the whole list, dropping every other city.
    project_id, key_name = key
    gcloud('services', 'api-keys', 'update', key_name, f'--project={project_id}', '--append',
           f'--allowed-referrers={",".join(to_add)}', required=True)
    print(f'  Added to the Maps key: {", ".join(to_add)} (Google can take a few minutes to apply it).')


def check_all():
    """
    Prints every city hostname missing from the key.

    Returns:
        The number of missing hostnames.
    """
    referrers = current_referrers(reachable_key())
    missing = [(city_id, entry) for city_id, url in all_city_urls() for entry in missing_referrers(referrers, [url])]
    for city_id, entry in missing:
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
        parser.error('pass a city id or --check, not both')
    if args.check:
        sys.exit(1 if check_all() else 0)
    add_for_city(args.city_id, args.dry_run)


if __name__ == '__main__':
    main()
