"""
Creates a new city's Google Analytics 4 properties (prod + test) and writes the measurement ids into cityparams.conf.

Run after `make onboard-city` has registered the city (its GA ids are "TODO" placeholders until this runs):

    GA_OAUTH_CLIENT_JSON=~/secrets/ga-oauth-client.json python3 tools/create_ga_properties.py newport-ky

For each of the two GA accounts (prod and test) it creates, via the Analytics Admin API, a property named per our
convention — "<City Name>, <ST>" for US cities, "<City Name>, <Country>" otherwise — with the team's standard
settings (Los Angeles time zone, USD, industry Science), plus a web data stream of the same name pointing at that
stage's landing-page URL, with enhanced measurement on. The stream's G- measurement id replaces the "TODO" in
cityparams.conf. Business size/objectives are UI-wizard-only fields with no API equivalent — they only shape the
default report collection, so they're skipped.

One-time OAuth setup (the API needs a signed-in user with edit rights on the GA accounts — we use
makeability.sidewalk@gmail.com):

  1. In any GCP project (console.cloud.google.com), enable the "Google Analytics Admin API".
  2. Under APIs & Services → Credentials, create an OAuth client ID of type "Desktop app" and download its JSON.
  3. Point GA_OAUTH_CLIENT_JSON at that file. First run opens a browser sign-in (choose the makeability account);
     the refresh token is cached in ~/.config/sidewalk-ga-oauth.json, so later runs are non-interactive.

`--dry-run` prints the derived names/payloads and stops before any auth, API call, or file write.
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import setup_new_city

PROD_ACCOUNT = '405043145'
TEST_ACCOUNT = '405079387'
OAUTH_SCOPE = 'https://www.googleapis.com/auth/analytics.edit'
TOKEN_CACHE = Path.home() / '.config' / 'sidewalk-ga-oauth.json'
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


def oauth_access_token():
    client_path = Path(os.environ.get('GA_OAUTH_CLIENT_JSON', ''))
    if not client_path.is_file():
        sys.exit('error: set GA_OAUTH_CLIENT_JSON to the downloaded OAuth client JSON (see the module docstring).')
    client = json.loads(client_path.read_text())['installed']

    def exchange(params):
        data = urllib.parse.urlencode({'client_id': client['client_id'], 'client_secret': client['client_secret'],
                                       **params}).encode()
        with urllib.request.urlopen('https://oauth2.googleapis.com/token', data=data) as resp:
            return json.load(resp)

    if TOKEN_CACHE.is_file():
        refresh_token = json.loads(TOKEN_CACHE.read_text()).get('refresh_token')
        if refresh_token:
            try:
                return exchange({'grant_type': 'refresh_token', 'refresh_token': refresh_token})['access_token']
            except urllib.error.HTTPError:
                print('  Cached token no longer works; re-authorizing.')

    code_holder = {}

    class Catcher(BaseHTTPRequestHandler):
        def do_GET(self):
            code_holder['code'] = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('code', [''])[0]
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'Authorized - you can close this tab and return to the terminal.')

        def log_message(self, *args):
            pass

    server = HTTPServer(('localhost', 0), Catcher)
    redirect_uri = f'http://localhost:{server.server_address[1]}'
    auth_url = 'https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode({
        'client_id': client['client_id'], 'redirect_uri': redirect_uri, 'response_type': 'code',
        'scope': OAUTH_SCOPE, 'access_type': 'offline', 'prompt': 'consent'})
    print(f'\nAuthorize as makeability.sidewalk@gmail.com:\n  {auth_url}\n')
    webbrowser.open(auth_url)
    while 'code' not in code_holder:
        server.handle_request()
    tokens = exchange({'grant_type': 'authorization_code', 'code': code_holder['code'],
                       'redirect_uri': redirect_uri})
    TOKEN_CACHE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_CACHE.write_text(json.dumps({'refresh_token': tokens['refresh_token']}))
    TOKEN_CACHE.chmod(0o600)
    return tokens['access_token']


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

    token = oauth_access_token()
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
