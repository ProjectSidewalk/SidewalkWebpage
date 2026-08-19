"""
Creates a new city's Google Analytics 4 properties (prod + test) and writes the measurement ids into cityparams.conf.

`make onboard-city` runs this as its GA step when the key file (below) is present; standalone, for a city whose ids
are still "TODO" placeholders:

    python3 tools/create_ga_properties.py newport-ky

For each of the two GA accounts (prod and test) it creates, via the Analytics Admin API, a property named per our
convention — "<City Name>, <ST>" for US cities, "<City Name>, <Country>" otherwise — with the team's standard
settings (Los Angeles time zone, USD, industry Science), plus a web data stream of the same name pointing at that
stage's landing-page URL, with enhanced measurement on. The stream's G- measurement id replaces the "TODO" in
cityparams.conf. Business size/objectives are UI-wizard-only fields with no API equivalent — they only shape the
default report collection, so they're skipped. Reruns are safe: an existing property or stream with the convention
name is reused rather than duplicated.

One-time setup (fully headless afterward — no GCP roles needed, the service account is authorized on the GA side):

  1. In any GCP project (console.cloud.google.com), enable the "Google Analytics Admin API" and create a service
     account (skip both optional access-grant steps); under its Keys tab, create + download a JSON key and save it
     as ga-service-account.json in the repo root (git-ignored, and deny-listed from Claude, like
     docker-compose.override.yml).
  2. In GA (Admin → Account access management), add the service account's email as Editor on both accounts.
  3. `pip install google-auth` (signs the service-account JWT; everything else is stdlib).

`--dry-run` prints the derived names/payloads and stops before any auth, API call, or file write.
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import setup_new_city

PROD_ACCOUNT = '405043145'
TEST_ACCOUNT = '405079387'
SCOPE = 'https://www.googleapis.com/auth/analytics.edit'
API = 'https://analyticsadmin.googleapis.com'

REPO_ROOT = setup_new_city.REPO_ROOT
CITYPARAMS = setup_new_city.CITYPARAMS
KEY_FILE = REPO_ROOT / 'ga-service-account.json'


def cityparams_value(lines, path, city_id):
    """The city's raw value (quotes stripped) inside the (possibly nested) cityparams block at ``path``."""
    start = 0
    close = None
    for name in path:
        start, close = setup_new_city.find_block(lines, name, start)
        start += 1
    for line in lines[start - 1:close]:
        match = re.match(rf'\s*{re.escape(city_id)}\s*=\s*(.+?)\s*$', line)
        if match:
            return match.group(1).strip('"')
    sys.exit(f'error: {city_id} has no {".".join(path)} entry in cityparams.conf — run `make onboard-city` first.')


def message_value(file_name, key):
    for line in (REPO_ROOT / 'conf' / 'messages' / file_name).read_text().split('\n'):
        if line.startswith(f'{key} ') or line.startswith(f'{key}='):
            return line.split('=', 1)[1].strip()
    sys.exit(f'error: "{key}" not found in conf/messages/{file_name} — run `make onboard-city` first.')


def property_display_name(lines, city_id):
    """Our GA naming convention: "<City Name>, <ST>" for US cities, "<City Name>, <Country>" otherwise."""
    city_name = message_value('messages', f'city.name.{city_id}')
    country = cityparams_value(lines, ['country-id'], city_id)
    if country == 'usa':
        state = cityparams_value(lines, ['state-id'], city_id)
        return f'{city_name}, {message_value("messages.en", f"state.name.{state}")}'
    return f'{city_name}, {country.replace("-", " ").title()}'


def access_token():
    """A bearer token for the service account, via the signed-JWT grant (no browser, no cached state)."""
    if not KEY_FILE.is_file():
        sys.exit(f'error: no {KEY_FILE.name} in the repo root — save the service-account key there '
                 '(see the module docstring).')
    try:
        from google.auth import crypt, jwt
    except ImportError:
        sys.exit('error: google-auth is not installed (`pip install google-auth`) — it signs the service-account '
                 'JWT, which the stdlib cannot.')
    key = json.loads(KEY_FILE.read_text())
    now = int(time.time())
    assertion = jwt.encode(crypt.RSASigner.from_service_account_info(key), {
        'iss': key['client_email'], 'scope': SCOPE, 'aud': 'https://oauth2.googleapis.com/token',
        'iat': now, 'exp': now + 3600,
    })
    data = urllib.parse.urlencode({'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                                   'assertion': assertion.decode()}).encode()
    try:
        with urllib.request.urlopen('https://oauth2.googleapis.com/token', data=data) as resp:
            return json.load(resp)['access_token']
    except urllib.error.HTTPError as err:
        sys.exit(f'error: token exchange failed with {err.code}:\n{err.read().decode()}')


def api_call(method, url, token, payload=None):
    request = urllib.request.Request(url, data=json.dumps(payload).encode() if payload else None, method=method,
                                     headers={'Authorization': f'Bearer {token}',
                                              'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as err:
        sys.exit(f'error: {method} {url} failed with {err.code}:\n{err.read().decode()}')


def find_property(token, account, display_name):
    """The account's (non-trashed) property named ``display_name``, or None."""
    listing = api_call('GET', f'{API}/v1beta/properties?filter=parent:accounts/{account}&pageSize=200', token)
    return next((p['name'] for p in listing.get('properties', []) if p['displayName'] == display_name), None)


def assert_enhanced_measurement(token, stream_name):
    """Enhanced measurement defaults on for new web streams; assert it anyway. The endpoint is v1alpha-only, so a
    failure is a warning, not a stop."""
    try:
        api_url = f'{API}/v1alpha/{stream_name}/enhancedMeasurementSettings?updateMask=streamEnabled'
        request = urllib.request.Request(api_url, data=json.dumps({'streamEnabled': True}).encode(), method='PATCH',
                                         headers={'Authorization': f'Bearer {token}',
                                                  'Content-Type': 'application/json'})
        urllib.request.urlopen(request).close()
    except urllib.error.HTTPError as err:
        print(f'  warning: could not confirm enhanced measurement ({err.code}); check it in the GA UI.')


def ensure_property(token, account, display_name, default_uri):
    """
    Returns the stage's ``(measurement_id, property_id)``, creating the property and/or web stream only when absent.

    Looking both up by display name first makes reruns idempotent: a crash partway through a previous run can't lead
    to duplicate properties.
    """
    prop_name = find_property(token, account, display_name)
    if prop_name is None:
        prop_name = api_call('POST', f'{API}/v1beta/properties', token, {
            'parent': f'accounts/{account}',
            'displayName': display_name,
            'timeZone': 'America/Los_Angeles',
            'currencyCode': 'USD',
            'industryCategory': 'SCIENCE',
        })['name']
    else:
        print(f'  Found existing property "{display_name}" ({prop_name}); reusing it.')
    streams = api_call('GET', f'{API}/v1beta/{prop_name}/dataStreams', token)
    stream = next((s for s in streams.get('dataStreams', []) if s.get('type') == 'WEB_DATA_STREAM'), None)
    if stream is None:
        stream = api_call('POST', f'{API}/v1beta/{prop_name}/dataStreams', token, {
            'type': 'WEB_DATA_STREAM',
            'displayName': display_name,
            'webStreamData': {'defaultUri': default_uri},
        })
        assert_enhanced_measurement(token, stream['name'])
    return stream['webStreamData']['measurementId'], prop_name.split('/')[1]


def find_todo_line(lines, stage, city_id):
    """Index of the city's `= "TODO"` GA-id line for the stage, or None when it's already filled in."""
    start, close = setup_new_city.find_block(lines, 'google-analytics-4-id')
    start, close = setup_new_city.find_block(lines, stage, start)
    for i in range(start, close):
        if re.match(rf'\s*{re.escape(city_id)}\s*=\s*"TODO"\s*$', lines[i]):
            return i
    return None


def ids_are_todo(city_id):
    lines = CITYPARAMS.read_text().split('\n')
    return all(find_todo_line(lines, stage, city_id) is not None for stage in ('prod', 'test'))


def create_for_city(city_id, dry_run=False):
    """Creates the prod + test properties and fills the city's cityparams ids."""
    lines = CITYPARAMS.read_text().split('\n')
    display_name = property_display_name(lines, city_id)
    stages = [('prod', PROD_ACCOUNT, cityparams_value(lines, ['landing-page-url', 'prod'], city_id)),
              ('test', TEST_ACCOUNT, cityparams_value(lines, ['landing-page-url', 'test'], city_id))]
    for stage, account, url in stages:
        # Fail loudly on an already-filled id BEFORE anything is created.
        if not dry_run and find_todo_line(lines, stage, city_id) is None:
            sys.exit(f'error: no `{city_id} = "TODO"` line in google-analytics-4-id.{stage} — already filled in? '
                     'Nothing to do.')
        print(f'  {stage}: property "{display_name}" under accounts/{account}, web stream -> {url}')
    if dry_run:
        print('[dry-run] stopping before auth and API calls.')
        return

    token = access_token()
    admin_links = []
    for stage, account, url in stages:
        measurement_id, property_id = ensure_property(token, account, display_name, url)
        i = find_todo_line(lines, stage, city_id)
        lines[i] = lines[i].replace('"TODO"', f'"{measurement_id}"')
        # Written per stage so a failure on the second leaves the first's id recorded.
        CITYPARAMS.write_text('\n'.join(lines))
        admin_links.append(f'{stage}: https://analytics.google.com/analytics/web/#/a{account}p{property_id}/admin')
        print(f'  {stage}: measurement id {measurement_id}')
    print(f'  Wrote both measurement ids into {CITYPARAMS}. Business size/objectives have no API equivalent; '
          'set them under Admin -> Property -> Business details if you care about the default report collections:')
    for link in admin_links:
        print(f'    {link}')


def main():
    parser = argparse.ArgumentParser(description="Create a city's GA4 properties and fill its cityparams ids.")
    parser.add_argument('city_id', help='The cityparams city id, e.g. "newport-ky" (must already be registered).')
    parser.add_argument('--dry-run', action='store_true',
                        help='Print the derived names/payloads and stop before auth, API calls, or file writes.')
    args = parser.parse_args()
    create_for_city(args.city_id, args.dry_run)


if __name__ == '__main__':
    main()
