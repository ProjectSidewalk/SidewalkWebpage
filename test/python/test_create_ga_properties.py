"""
Unit tests for tools/create_ga_properties.py — the GA4 property/stream creation `make onboard-city` runs as step 2.

The cityparams/messages lookups run against copies of the real files with a test city registered through
setup_new_city (so the two scripts' view of the file agrees); the Analytics Admin API and the OAuth token exchange are
faked at the `urllib` seam. Stdlib-only, so it runs in both interpreter halves.
"""

import io
import json
import shutil
import sys
import urllib.error
from pathlib import Path
from types import SimpleNamespace

import pytest

import create_ga_properties as ga
import setup_new_city as snc

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def repo_copy(tmp_path, monkeypatch):
    """Copies the config files, points both scripts at them, and registers testville-wa with empty GA ids."""
    (tmp_path / 'conf' / 'messages').mkdir(parents=True)
    shutil.copy(REPO_ROOT / 'conf' / 'cityparams.conf', tmp_path / 'conf' / 'cityparams.conf')
    for name in ('messages', 'messages.en'):
        shutil.copy(REPO_ROOT / 'conf' / 'messages' / name, tmp_path / 'conf' / 'messages' / name)
    for module in (snc, ga):
        monkeypatch.setattr(module, 'REPO_ROOT', tmp_path)
        monkeypatch.setattr(module, 'CITYPARAMS', tmp_path / 'conf' / 'cityparams.conf')
    monkeypatch.setattr(snc, 'MESSAGES_DIR', tmp_path / 'conf' / 'messages')
    monkeypatch.setattr(ga, 'KEY_FILE', tmp_path / 'ga-service-account.json')
    snc.add_cityparams_entries('testville-wa', [
        (['db-schema'], '"sidewalk_testville_wa"'), (['state-id'], '"washington"'), (['country-id'], '"usa"'),
        (['landing-page-url', 'prod'], '"https://sidewalk-testville.cs.washington.edu"'),
        (['landing-page-url', 'test'], '"https://sidewalk-testville-test.cs.washington.edu"'),
        (['google-analytics-4-id', 'prod'], '""'), (['google-analytics-4-id', 'test'], '""'),
    ], dry_run=False)
    snc.add_message_line('messages', 'city.name.testville-wa', 'Testville', dry_run=False)
    return tmp_path


def _lines():
    return ga.CITYPARAMS.read_text().split('\n')


def test_property_display_name_follows_the_convention(repo_copy):
    assert ga.property_display_name(_lines(), 'testville-wa') == 'Testville, WA'
    assert ga.property_display_name(_lines(), 'bayonne') == 'Bayonne, France'


def test_config_lookups_fail_loudly_for_an_unregistered_city(repo_copy):
    assert ga.cityparams_value(_lines(), ['landing-page-url', 'test'], 'testville-wa') == \
        'https://sidewalk-testville-test.cs.washington.edu'
    with pytest.raises(SystemExit, match='no country-id entry'):
        ga.cityparams_value(_lines(), ['country-id'], 'nowhere')
    with pytest.raises(SystemExit, match='not found in conf/messages/messages'):
        ga.message_value('messages', 'city.name.nowhere')


def test_placeholder_detection(repo_copy):
    assert ga.ids_are_placeholders('testville-wa') is True
    assert ga.ids_are_placeholders('houston-tx') is False
    assert ga.find_placeholder_line(_lines(), 'prod', 'houston-tx') is None
    block = ga.cityparams_block_lines(_lines(), ['google-analytics-4-id', 'test'])
    assert any('testville-wa = ""' in line for line in block)


def test_find_property_pages_until_it_finds_the_name(monkeypatch):
    base = f'{ga.API}/v1beta/properties?filter=parent:accounts/1&pageSize=200'
    pages = {base: {'properties': [{'name': 'properties/9', 'displayName': 'Other'}], 'nextPageToken': 'p2'},
             base + '&pageToken=p2': {'properties': [{'name': 'properties/42', 'displayName': 'Testville, WA'}]}}
    monkeypatch.setattr(ga, 'api_call', lambda method, url, token, payload=None: pages[url])
    assert ga.find_property('t', '1', 'Testville, WA') == 'properties/42'
    assert ga.find_property('t', '1', 'Nobody') is None


def test_ensure_property_reuses_an_existing_property_or_creates_one(monkeypatch, capsys):
    calls = []

    def api_call(method, url, token, payload=None):
        calls.append((method, url, payload))
        if 'pageSize=200' in url:
            return ({'properties': [{'name': 'properties/42', 'displayName': 'Testville, WA'}]}
                    if 'accounts/1' in url else {})
        if url.endswith('/dataStreams') and method == 'GET':
            return ({'dataStreams': [{'type': 'WEB_DATA_STREAM', 'webStreamData': {'measurementId': 'G-OLD'}}]}
                    if 'properties/42' in url else {'dataStreams': []})
        if url.endswith('/properties') and method == 'POST':
            return {'name': 'properties/77'}
        if url.endswith('/dataStreams') and method == 'POST':
            return {'name': 'properties/77/dataStreams/5', 'webStreamData': {'measurementId': 'G-NEW'}}
        raise AssertionError(url)

    monkeypatch.setattr(ga, 'api_call', api_call)
    monkeypatch.setattr(ga, 'assert_enhanced_measurement', lambda token, stream: calls.append(('PATCH', stream, None)))
    assert ga.ensure_property('t', '1', 'Testville, WA', 'https://x') == ('G-OLD', '42')
    assert 'reusing it' in capsys.readouterr().out
    assert ga.ensure_property('t', '2', 'Testville, WA', 'https://x') == ('G-NEW', '77')
    assert ('PATCH', 'properties/77/dataStreams/5', None) in calls
    created = next(payload for method, url, payload in calls if method == 'POST' and url.endswith('/properties'))
    assert created['displayName'] == 'Testville, WA' and created['parent'] == 'accounts/2'
    stream = next(payload for method, url, payload in calls if method == 'POST' and url.endswith('/dataStreams'))
    assert stream['webStreamData'] == {'defaultUri': 'https://x'}


def test_assert_enhanced_measurement_warns_instead_of_stopping(monkeypatch, capsys):
    monkeypatch.setattr(ga.urllib.request, 'urlopen', lambda req: SimpleNamespace(close=lambda: None))
    ga.assert_enhanced_measurement('t', 'properties/1/dataStreams/2')
    assert capsys.readouterr().out == ''

    def deny(req):
        raise urllib.error.HTTPError(req.full_url, 403, 'no', {}, None)

    monkeypatch.setattr(ga.urllib.request, 'urlopen', deny)
    ga.assert_enhanced_measurement('t', 'properties/1/dataStreams/2')
    assert 'could not confirm enhanced measurement (403)' in capsys.readouterr().out


class _Response:
    def __init__(self, body):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def read(self):
        return self._body


def test_api_call_sends_json_with_the_bearer_token_and_exits_on_http_errors(monkeypatch):
    seen = {}

    def urlopen(request):
        seen['method'] = request.get_method()
        seen['data'] = request.data
        seen['auth'] = request.get_header('Authorization')
        return _Response(b'{"ok": true}')

    monkeypatch.setattr(ga.urllib.request, 'urlopen', urlopen)
    assert ga.api_call('POST', 'https://api/x', 'tok', {'a': 1}) == {'ok': True}
    assert seen == {'method': 'POST', 'data': b'{"a": 1}', 'auth': 'Bearer tok'}

    def fail(request):
        raise urllib.error.HTTPError('https://api/x', 400, 'bad', {}, io.BytesIO(b'nope'))

    monkeypatch.setattr(ga.urllib.request, 'urlopen', fail)
    with pytest.raises(SystemExit, match='failed with 400'):
        ga.api_call('GET', 'https://api/x', 'tok')


def test_access_token_needs_the_key_file_and_google_auth(repo_copy, monkeypatch):
    with pytest.raises(SystemExit, match='no ga-service-account.json'):
        ga.access_token()
    ga.KEY_FILE.write_text(json.dumps({'client_email': 'sa@x', 'private_key': 'k'}))
    monkeypatch.setitem(sys.modules, 'google', None)
    monkeypatch.setitem(sys.modules, 'google.auth', None)
    with pytest.raises(SystemExit, match='google-auth is not installed'):
        ga.access_token()


def test_access_token_exchanges_a_signed_jwt(repo_copy, monkeypatch):
    ga.KEY_FILE.write_text(json.dumps({'client_email': 'sa@x', 'private_key': 'k'}))
    fake_auth = SimpleNamespace(
        crypt=SimpleNamespace(RSASigner=SimpleNamespace(from_service_account_info=lambda key: 'signer')),
        jwt=SimpleNamespace(encode=lambda signer, claims: b'signed.' + claims['iss'].encode()))
    monkeypatch.setitem(sys.modules, 'google', SimpleNamespace(auth=fake_auth))
    monkeypatch.setitem(sys.modules, 'google.auth', fake_auth)
    posted = {}

    def urlopen(url, data=None):
        posted['url'] = url
        posted['data'] = data
        return _Response(b'{"access_token": "tok"}')

    monkeypatch.setattr(ga.urllib.request, 'urlopen', urlopen)
    assert ga.access_token() == 'tok'
    assert posted['url'] == 'https://oauth2.googleapis.com/token' and b'assertion=signed.sa%40x' in posted['data']

    def fail(url, data=None):
        raise urllib.error.HTTPError(url, 401, 'x', {}, io.BytesIO(b'bad grant'))

    monkeypatch.setattr(ga.urllib.request, 'urlopen', fail)
    with pytest.raises(SystemExit, match='token exchange failed with 401'):
        ga.access_token()


def test_create_for_city_dry_run_prints_the_plan_and_a_filled_city_is_refused(repo_copy, capsys):
    ga.create_for_city('testville-wa', dry_run=True)
    out = capsys.readouterr().out
    assert 'prod: property "Testville, WA" under accounts/%s' % ga.PROD_ACCOUNT in out
    assert 'web stream -> https://sidewalk-testville-test.cs.washington.edu' in out
    assert '[dry-run] stopping before auth' in out
    with pytest.raises(SystemExit, match='already filled in'):
        ga.create_for_city('houston-tx')


def test_create_for_city_fills_both_stages_and_is_a_no_op_afterwards(repo_copy, monkeypatch, capsys):
    monkeypatch.setattr(ga, 'access_token', lambda: 'tok')
    monkeypatch.setattr(ga, 'ensure_property',
                        lambda token, account, name, url: (('G-PROD1', '111') if account == ga.PROD_ACCOUNT
                                                           else ('G-TEST1', '222')))
    # The test stage's property id is already registered (a crash after a partial run): it is left alone.
    lines = _lines()
    snc.insert_entry(lines, ['google-analytics-property-id', 'test'], 'testville-wa = "999"')
    ga.CITYPARAMS.write_text('\n'.join(lines))
    ga.create_for_city('testville-wa')
    text = ga.CITYPARAMS.read_text()
    assert 'testville-wa = "G-PROD1"' in text and 'testville-wa = "G-TEST1"' in text
    assert 'testville-wa = "111"' in text and text.count('testville-wa = "999"') == 1
    assert 'testville-wa = "222"' not in text
    assert ga.ids_are_placeholders('testville-wa') is False
    out = capsys.readouterr().out
    assert 'measurement id G-PROD1, property id 111' in out and 'a%sp111/admin' % ga.PROD_ACCOUNT in out
    with pytest.raises(SystemExit, match='already filled in'):
        ga.create_for_city('testville-wa')


def test_main_parses_the_city_id(repo_copy, monkeypatch, capsys):
    monkeypatch.setattr(sys, 'argv', ['create_ga_properties.py', 'testville-wa', '--dry-run'])
    ga.main()
    assert '[dry-run]' in capsys.readouterr().out
