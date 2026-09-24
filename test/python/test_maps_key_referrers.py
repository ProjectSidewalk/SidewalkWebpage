"""
Unit tests for tools/city/maps_key_referrers.py, which adds a city's hostnames to the production Maps key (#5339).

gcloud is faked at the ``subprocess.run`` seam and cityparams.conf is read from a copy, so nothing here reaches Google.
Stdlib-only, so it runs in both interpreter halves.
"""

import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

import maps_key_referrers as mkr
import setup_new_city as snc

REPO_ROOT = Path(__file__).resolve().parents[2]

REFERRERS = ['https://sidewalk-a.cs.washington.edu', 'sidewalk-a-test.cs.washington.edu/*',
             'sidewalk-b.cs.washington.edu', 'sidewalk-c.cs.washington.edu/admin']
KEY = {'name': 'projects/1/locations/global/keys/k',
       'restrictions': {'browserKeyRestrictions': {'allowedReferrers': REFERRERS},
                        'apiTargets': [{'service': 'maps-backend.googleapis.com'}]}}


def _fake_run(monkeypatch, answers):
    """Answers gcloud by its first argument (``projects`` or ``services``) and records every call."""
    calls = []

    def run(argv, **kwargs):
        calls.append(argv)
        answer = answers.get(argv[3] if argv[1] == 'services' else argv[1], '')
        if isinstance(answer, BaseException):
            raise answer
        code, out = answer if isinstance(answer, tuple) else (0, answer)
        return SimpleNamespace(returncode=code, stdout=out, stderr='boom' if code else '')

    monkeypatch.setattr(mkr.subprocess, 'run', run)
    return calls


@pytest.fixture
def fake_gcloud(monkeypatch):
    return _fake_run(monkeypatch, {'projects': 'proj-1', 'list': json.dumps([KEY])})


@pytest.fixture
def cityparams_copy(tmp_path, monkeypatch):
    """A copy of cityparams.conf with testville-wa registered, which the key does not cover yet."""
    (tmp_path / 'conf').mkdir()
    shutil.copy(REPO_ROOT / 'conf' / 'cityparams.conf', tmp_path / 'conf' / 'cityparams.conf')
    monkeypatch.setattr(snc, 'CITYPARAMS', tmp_path / 'conf' / 'cityparams.conf')
    monkeypatch.setattr(mkr, 'CITYPARAMS', tmp_path / 'conf' / 'cityparams.conf')
    snc.add_cityparams_entries('testville-wa', [
        (['landing-page-url', 'prod'], '"https://sidewalk-testville.cs.washington.edu"'),
        (['landing-page-url', 'test'], '"https://sidewalk-testville-test.cs.washington.edu"'),
    ], dry_run=False)


def test_every_referrer_form_that_covers_a_whole_site_counts():
    assert mkr.covered_hosts(REFERRERS) == {'sidewalk-a.cs.washington.edu', 'sidewalk-a-test.cs.washington.edu',
                                            'sidewalk-b.cs.washington.edu'}


def test_missing_referrers_skips_covered_hosts_and_repeats_and_refuses_a_non_url():
    urls = ['https://sidewalk-a.cs.washington.edu', 'https://sidewalk-b.cs.washington.edu/',
            'https://sidewalk-c.cs.washington.edu', 'https://sidewalk-c.cs.washington.edu']
    assert mkr.missing_referrers(REFERRERS, urls) == ['sidewalk-c.cs.washington.edu/*']
    assert mkr.missing_referrers(['*.cs.washington.edu/*'], urls) == []
    with pytest.raises(mkr.MapsKeyError, match='not a URL'):
        mkr.missing_referrers(REFERRERS, ['sidewalk-d.cs.washington.edu'])


def test_all_city_urls_reads_both_stages():
    pairs = mkr.all_city_urls()
    assert ('laurens-ia', 'https://sidewalk-laurens.cs.washington.edu') in pairs
    assert ('laurens-ia', 'https://sidewalk-laurens-test.cs.washington.edu') in pairs


def test_gcloud_never_prompts_and_reports_why_it_failed(monkeypatch):
    calls = _fake_run(monkeypatch, {'projects': (1, '')})
    with pytest.raises(mkr.MapsKeyError, match='failed: boom'):
        mkr.gcloud('projects', 'list')
    assert calls[-1][-1] == '--quiet'
    _fake_run(monkeypatch, {'projects': FileNotFoundError()})
    with pytest.raises(mkr.MapsKeyError, match='not installed'):
        mkr.gcloud('projects', 'list')
    _fake_run(monkeypatch, {'projects': subprocess.TimeoutExpired('gcloud', 1)})
    with pytest.raises(mkr.MapsKeyError, match='took over'):
        mkr.gcloud('projects', 'list')


def test_find_key_wants_exactly_one_project_and_key(monkeypatch):
    _fake_run(monkeypatch, {'projects': 'proj-1\nproj-2'})
    with pytest.raises(mkr.MapsKeyError, match='found 2'):
        mkr.find_key()
    _fake_run(monkeypatch, {'projects': 'proj-1', 'list': ''})
    with pytest.raises(mkr.MapsKeyError, match='key named "main API key" in Project Sidewalk, found 0'):
        mkr.find_key()
    _fake_run(monkeypatch, {'projects': 'proj-1', 'list': json.dumps([KEY])})
    assert mkr.find_key() == ('proj-1', KEY)


def test_an_unrestricted_key_is_refused():
    with pytest.raises(mkr.MapsKeyError, match='no referrer restrictions'):
        mkr.referrers_of({'name': 'k'})


def test_add_for_city_appends_only_the_missing_hostnames(fake_gcloud, cityparams_copy, capsys):
    mkr.add_for_city('testville-wa')
    update = fake_gcloud[-1]
    assert update[1:4] == ['services', 'api-keys', 'update']
    assert '--append' in update and '--project=proj-1' in update
    assert '--allowed-referrers=sidewalk-testville.cs.washington.edu/*,sidewalk-testville-test.cs.washington.edu/*' \
        in update
    assert 'Added to the Maps key' in capsys.readouterr().out


def test_add_for_city_dry_run_and_covered_city_change_nothing(fake_gcloud, cityparams_copy, capsys, monkeypatch):
    mkr.add_for_city('testville-wa', dry_run=True)
    assert 'would add' in capsys.readouterr().out
    monkeypatch.setattr(snc, 'cityparams_landing_urls', lambda city_id: ['https://sidewalk-a.cs.washington.edu'])
    mkr.add_for_city('a')
    assert 'already on the Maps key' in capsys.readouterr().out
    assert not any('update' in call for call in fake_gcloud)


def test_a_city_missing_from_cityparams_is_an_error(fake_gcloud, cityparams_copy):
    with pytest.raises(mkr.MapsKeyError, match='not in cityparams.conf'):
        mkr.add_for_city('nowhere')


def test_check_all_counts_each_missing_hostname_once(fake_gcloud, cityparams_copy, capsys, monkeypatch):
    assert mkr.check_all() > 2
    assert 'testville-wa: sidewalk-testville.cs.washington.edu/*' in capsys.readouterr().out
    shared = 'https://sidewalk-staging.cs.washington.edu'
    monkeypatch.setattr(mkr, 'all_city_urls', lambda: [('staging', shared), ('staging', shared)])
    assert mkr.check_all() == 1
    monkeypatch.setattr(mkr, 'all_city_urls', lambda: [('a', 'https://sidewalk-a.cs.washington.edu')])
    assert mkr.check_all() == 0
    assert 'Every landing-page URL' in capsys.readouterr().out


def test_main_arguments_and_exit_codes(fake_gcloud, cityparams_copy, monkeypatch, capsys):
    for argv in ([], ['testville-wa', '--check'], ['--check', '--dry-run']):
        with pytest.raises(SystemExit, match='2'):
            mkr.main(argv)
    with pytest.raises(SystemExit, match='1'):
        mkr.main(['--check'])
    monkeypatch.setattr(mkr, 'check_all', lambda: 0)
    with pytest.raises(SystemExit, match='0'):
        mkr.main(['--check'])
    mkr.main(['testville-wa', '--dry-run'])
    assert not any('update' in call for call in fake_gcloud)
    with pytest.raises(SystemExit, match='2'):
        mkr.main(['nowhere'])
    assert 'error: ' in capsys.readouterr().err
