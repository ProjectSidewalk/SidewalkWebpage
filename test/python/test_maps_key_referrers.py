"""
Unit tests for tools/maps_key_referrers.py, which adds a city's hostnames to the production Maps key (#5339).

gcloud is faked at the ``subprocess.run`` seam and cityparams.conf is read from a copy, so nothing here reaches Google.
Stdlib-only, so it runs in both interpreter halves.
"""

import json
import shutil
from pathlib import Path
from types import SimpleNamespace

import pytest

import maps_key_referrers as mkr
import setup_new_city as snc

REPO_ROOT = Path(__file__).resolve().parents[2]

REFERRERS = ['https://sidewalk-a.cs.washington.edu', 'sidewalk-a-test.cs.washington.edu/*',
             'sidewalk-b.cs.washington.edu', 'sidewalk-c.cs.washington.edu/admin']


@pytest.fixture
def fake_gcloud(monkeypatch):
    """Answers gcloud with one project, one key carrying ``REFERRERS``, and records every call."""
    calls = []

    def run(argv, capture_output, text):
        calls.append(argv)
        args = argv[1:]
        if args[:2] == ['projects', 'list']:
            out = 'proj-1'
        elif args[:3] == ['services', 'api-keys', 'list']:
            out = 'projects/1/locations/global/keys/k'
        elif args[:3] == ['services', 'api-keys', 'describe']:
            out = json.dumps({'restrictions': {'browserKeyRestrictions': {'allowedReferrers': REFERRERS},
                                               'apiTargets': [{'service': 'maps-backend.googleapis.com'}]}})
        else:
            out = ''
        return SimpleNamespace(returncode=0, stdout=out, stderr='')

    monkeypatch.setattr(mkr.shutil, 'which', lambda name: '/usr/bin/gcloud')
    monkeypatch.setattr(mkr.subprocess, 'run', run)
    return calls


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


def test_missing_referrers_skips_covered_hosts_and_repeats():
    urls = ['https://sidewalk-a.cs.washington.edu', 'https://sidewalk-b.cs.washington.edu/',
            'https://sidewalk-c.cs.washington.edu', 'https://sidewalk-c.cs.washington.edu']
    assert mkr.missing_referrers(REFERRERS, urls) == ['sidewalk-c.cs.washington.edu/*']
    assert mkr.missing_referrers(['*.cs.washington.edu/*'], urls) == []


def test_all_city_urls_reads_both_stages_and_skips_the_local_alias():
    pairs = mkr.all_city_urls()
    assert ('laurens-ia', 'https://sidewalk-laurens.cs.washington.edu') in pairs
    assert ('laurens-ia', 'https://sidewalk-laurens-test.cs.washington.edu') in pairs
    assert all(url.startswith('https://') for _, url in pairs)


def test_find_key_explains_what_it_could_not_reach(monkeypatch):
    monkeypatch.setattr(mkr.shutil, 'which', lambda name: None)
    assert mkr.find_key() == 'gcloud is not installed'
    monkeypatch.setattr(mkr.shutil, 'which', lambda name: '/usr/bin/gcloud')
    monkeypatch.setattr(mkr.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=1, stdout='', stderr='no'))
    assert 'cannot see a GCP project' in mkr.find_key()
    answers = {'projects': 'proj-1\nproj-2'}
    monkeypatch.setattr(mkr.subprocess, 'run', lambda argv, **k: SimpleNamespace(
        returncode=0, stdout=answers.get(argv[1], ''), stderr=''))
    assert 'more than one' in mkr.find_key()
    answers['projects'] = 'proj-1'
    assert 'found 0' in mkr.find_key()
    with pytest.raises(SystemExit, match='found 0'):
        mkr.reachable_key()


def test_a_failed_required_command_stops_with_gclouds_error(monkeypatch):
    monkeypatch.setattr(mkr.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=1, stdout='', stderr='boom'))
    assert mkr.gcloud('projects', 'list') is None
    with pytest.raises(SystemExit, match='boom'):
        mkr.gcloud('services', 'api-keys', 'update', required=True)


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
    monkeypatch.setattr(mkr, 'city_urls', lambda city_id: ['https://sidewalk-a.cs.washington.edu'])
    mkr.add_for_city('a')
    assert 'already on the Maps key' in capsys.readouterr().out
    assert not any('update' in call for call in fake_gcloud)


def test_an_unrestricted_key_is_refused(fake_gcloud, cityparams_copy, monkeypatch):
    monkeypatch.setattr(mkr.subprocess, 'run', lambda argv, **k: SimpleNamespace(returncode=0, stdout='{}', stderr=''))
    with pytest.raises(SystemExit, match='no referrer restrictions'):
        mkr.current_referrers(('proj-1', 'keys/k'))


def test_check_all_counts_every_uncovered_city(fake_gcloud, cityparams_copy, capsys, monkeypatch):
    assert mkr.check_all() > 2
    assert 'testville-wa: sidewalk-testville.cs.washington.edu/*' in capsys.readouterr().out
    monkeypatch.setattr(mkr, 'all_city_urls', lambda: [('a', 'https://sidewalk-a.cs.washington.edu')])
    assert mkr.check_all() == 0
    assert 'Every landing-page URL' in capsys.readouterr().out


def test_main_takes_a_city_or_check_but_not_both(fake_gcloud, cityparams_copy, monkeypatch):
    for argv in ([], ['testville-wa', '--check']):
        with pytest.raises(SystemExit, match='2'):
            mkr.main(argv)
    with pytest.raises(SystemExit, match='1'):
        mkr.main(['--check'])
    monkeypatch.setattr(mkr, 'check_all', lambda: 0)
    with pytest.raises(SystemExit, match='0'):
        mkr.main(['--check'])
    mkr.main(['testville-wa', '--dry-run'])
    assert not any('update' in call for call in fake_gcloud)
