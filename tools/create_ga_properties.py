"""
Creates a new city's Google Analytics 4 properties (prod + test) and writes the measurement ids into cityparams.conf.

Run after `make onboard-city` has registered the city (its GA ids are "TODO" placeholders until this runs):

    GA_SERVICE_ACCOUNT_JSON=~/secrets/sidewalk-ga.json python3 tools/create_ga_properties.py newport-ky

For each of the two GA accounts (prod and test) it creates, via the Analytics Admin API, a property named per our
convention — "<City Name>, <ST>" for US cities, "<City Name>, <Country>" otherwise — with the team's standard
settings (Los Angeles time zone, USD, industry Science), plus a web data stream of the same name pointing at that
stage's landing-page URL, with enhanced measurement on. The stream's G- measurement id replaces the "TODO" in
cityparams.conf. Business size/objectives are UI-wizard-only fields with no API equivalent — they only shape the
default report collection, so they're skipped.

One-time setup (fully headless afterward — no GCP roles needed, the service account is authorized on the GA side):

  1. In any GCP project (console.cloud.google.com), enable the "Google Analytics Admin API" and create a service
     account (skip both optional access-grant steps); under its Keys tab, create + download a JSON key. Store it
     outside the repo (e.g. ~/secrets/, chmod 600) and point GA_SERVICE_ACCOUNT_JSON at it.
  2. In GA (Admin → Account access management), add the service account's email as Editor on both accounts.
  3. `pip install google-auth` (signs the service-account JWT; everything else is stdlib).

`--dry-run` prints the derived names/payloads and stops before any auth, API call, or file write.
"""

import argparse
import json
import os
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
    key_path = Path(os.environ.get('GA_SERVICE_ACCOUNT_JSON', ''))
    if not key_path.is_file():
        sys.exit('error: set GA_SERVICE_ACCOUNT_JSON to the service-account key file (see the module docstring).')
    try:
        from google.auth import crypt, jwt
    except ImportError:
        sys.exit('error: google-auth is not installed (`pip install google-auth`) — it signs the service-account '
                 'JWT, which the stdlib cannot.')
    key = json.loads(key_path.read_text())
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


def create_property(token, account, display_name, default_uri):
    prop = api_call('POST', f'{API}/v1beta/properties', token, {
        'parent': f'accounts/{account}',
        'displayName': display_name,
        'timeZone': 'America/Los_Angeles',
        'currencyCode': 'USD',
        'industryCategory': 'SCIENCE',
    })
    stream = api_call('POST', f'{API}/v1beta/{prop["name"]}/dataStreams', token, {
        'type': 'WEB_DATA_STREAM',
        'displayName': display_name,
        'webStreamData': {'defaultUri': default_uri},
    })
    # Enhanced measurement defaults on for new web streams; assert it anyway. The endpoint is v1alpha-only, so a
    # failure here is a warning, not a stop.
    try:
        api_url = f'{API}/v1alpha/{stream["name"]}/enhancedMeasurementSettings?updateMask=streamEnabled'
        request = urllib.request.Request(api_url, data=json.dumps({'streamEnabled': True}).encode(), method='PATCH',
                                         headers={'Authorization': f'Bearer {token}',
                                                  'Content-Type': 'application/json'})
        urllib.request.urlopen(request).close()
    except urllib.error.HTTPError as err:
        print(f'  warning: could not confirm enhanced measurement ({err.code}); check it in the GA UI.')
    return stream['webStreamData']['measurementId']


def todo_line(lines, stage, city_id):
    """Index of the city's `= "TODO"` GA-id line for the stage; exits when it's absent (already filled in)."""
    start, close = setup_new_city.find_block(lines, 'google-analytics-4-id')
    start, close = setup_new_city.find_block(lines, stage, start)
    for i in range(start, close):
        if re.match(rf'\s*{re.escape(city_id)}\s*=\s*"TODO"\s*$', lines[i]):
            return i
    sys.exit(f'error: no `{city_id} = "TODO"` line in google-analytics-4-id.{stage} — already filled in? '
             'Refusing to create duplicate GA properties.')


def main():
    parser = argparse.ArgumentParser(description="Create a city's GA4 properties and fill its cityparams ids.")
    parser.add_argument('city_id', help='The cityparams city id, e.g. "newport-ky" (must already be registered).')
    parser.add_argument('--dry-run', action='store_true',
                        help='Print the derived names/payloads and stop before auth, API calls, or file writes.')
    args = parser.parse_args()
    city_id = args.city_id

    lines = CITYPARAMS.read_text().split('\n')
    display_name = property_display_name(lines, city_id)
    stages = [('prod', PROD_ACCOUNT, cityparams_value(lines, ['landing-page-url', 'prod'], city_id)),
              ('test', TEST_ACCOUNT, cityparams_value(lines, ['landing-page-url', 'test'], city_id))]
    for stage, account, url in stages:
        if not args.dry_run:
            todo_line(lines, stage, city_id)  # Fail loudly on an already-filled id BEFORE anything is created.
        print(f'  {stage}: property "{display_name}" under accounts/{account}, web stream -> {url}')
    if args.dry_run:
        print('[dry-run] stopping before auth and API calls.')
        return

    token = access_token()
    for stage, account, url in stages:
        measurement_id = create_property(token, account, display_name, url)
        i = todo_line(lines, stage, city_id)
        lines[i] = lines[i].replace('"TODO"', f'"{measurement_id}"')
        print(f'  {stage}: created — measurement id {measurement_id}')
    CITYPARAMS.write_text('\n'.join(lines))
    print(f'\nWrote both measurement ids into {CITYPARAMS}. Business size/objectives have no API equivalent; '
          'set them in the GA UI if you care about the default report collections.')


if __name__ == '__main__':
    main()
