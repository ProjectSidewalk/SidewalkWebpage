"""
Unit tests for tools/setup_new_city.py — the derivations and the config-file edits `make onboard-city` performs.

The file edits run against copies of the real conf/cityparams.conf, conf/messages/*, and docs/dev-environment.md, so
a structural change to those files that would break the orchestrator fails here first. Docker/DB steps are not
exercised (they need the containers); their helpers are covered where a subprocess can be faked.
"""

import shutil
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

import setup_new_city as snc

REPO_ROOT = Path(__file__).resolve().parents[2]


# --------------------------------------------------------------------------------------------------------------------
# Pure derivations
# --------------------------------------------------------------------------------------------------------------------

def test_schema_name_keeps_the_full_city_id():
    assert snc.schema_name('laurens-ia') == 'sidewalk_laurens_ia'
    assert snc.schema_name('bayonne') == 'sidewalk_bayonne'


def test_split_city_id_recognises_a_us_state_suffix():
    assert snc.split_city_id('laurens-ia') == ('Laurens', 'iowa')
    assert snc.split_city_id('walla-walla-wa') == ('Walla Walla', 'washington')
    assert snc.split_city_id('bayonne') == ('Bayonne', None)
    assert snc.split_city_id('sao-paulo-brazil') == ('Sao Paulo Brazil', None)


def test_default_urls_follow_the_server_naming_convention():
    assert snc.default_prod_url('laurens-ia', 'iowa') == 'https://sidewalk-laurens.cs.washington.edu'
    assert snc.default_prod_url('bayonne', None) == 'https://sidewalk-bayonne.cs.washington.edu'
    assert snc.test_url_for('https://sidewalk-laurens.cs.washington.edu/') == \
        'https://sidewalk-laurens-test.cs.washington.edu'
    assert snc.test_url_for('https://laurens.example') == 'https://laurens-test.example'
    assert snc.test_url_for('https://laurens') == 'https://laurens-test'


def test_default_launch_date_is_the_friday_of_next_week():
    assert snc.default_launch_date(date(2026, 9, 5)) == '2026-09-11'    # a Saturday -> next Friday
    assert snc.default_launch_date(date(2026, 9, 7)) == '2026-09-18'    # a Monday -> the Friday after this week's
    assert snc.default_launch_date(date(2026, 9, 11)) == '2026-09-18'   # a Friday -> next Friday


def test_highest_evolution_reads_the_numbered_files(tmp_path):
    for name in ('374.sql', '375.sql', '9.sql', 'README.md'):
        (tmp_path / name).write_text('')
    assert snc.highest_evolution(tmp_path) == 375
    assert snc.highest_evolution() == snc.highest_evolution(REPO_ROOT / 'conf' / 'evolutions' / 'default')


def test_report_headlines_keep_the_summary_and_flagged_regions():
    report = '\n'.join([
        '# City onboarding report — x', '', '- Generated: now', '- Streets: **3**', '- Regions: **2**', '',
        '| region_id | name | streets | street km | flag |', '|---|---|---|---|---|',
        '| 1 | west | 2 | 1.0 |  |', '| 2 | east | 0 | 0.0 | EMPTY — no streets |',
        '| 3 | big | 9 | 70.0 | OVERSIZED — consider splitting |',
    ])
    assert snc.report_headlines(report) == ['- Streets: **3**', '- Regions: **2**',
                                            '| 2 | east | 0 | 0.0 | EMPTY — no streets |',
                                            '| 3 | big | 9 | 70.0 | OVERSIZED — consider splitting |']


def test_preflight_table_returns_rows_only_when_a_provider_was_sampled():
    header = ['| provider | sample |', '|---|---|']
    assert snc.preflight_table('\n'.join(['# Imagery preflight', ''] + header)) == []
    assert snc.preflight_table('\n'.join(header + ['| gsv | 150 |'])) == header + ['| gsv | 150 |']


def test_translation_todo_lists_only_the_keys_that_were_added():
    lines = snc.translation_todo('laurens-ia', None, None)
    assert len(lines) == len(snc.TRANSLATED_MESSAGE_FILES)
    assert lines[0] == '  conf/messages/messages.zh-TW: city.name.laurens-ia'
    assert snc.translation_todo('x', 'iowa', 'france')[0].endswith('city.name.x, state.name.iowa, country.name.france')


def test_handoff_checklist_names_the_dump_and_both_urls():
    text = snc.handoff_checklist('laurens-ia', 'sidewalk_laurens_ia', 'https://p', 'https://t')
    assert 'scp db/sidewalk_laurens_ia-dump' in text
    assert 'https://t and https://p' in text
    assert 'make import-dump db=sidewalk_laurens_ia' in text


# --------------------------------------------------------------------------------------------------------------------
# Config-file edits, on copies of the real files
# --------------------------------------------------------------------------------------------------------------------

@pytest.fixture
def repo_copy(tmp_path, monkeypatch):
    """Copies the files the orchestrator edits into tmp_path and points the module at them."""
    (tmp_path / 'conf' / 'messages').mkdir(parents=True)
    (tmp_path / 'docs').mkdir()
    shutil.copy(REPO_ROOT / 'conf' / 'cityparams.conf', tmp_path / 'conf' / 'cityparams.conf')
    for name in ('messages', 'messages.en'):
        shutil.copy(REPO_ROOT / 'conf' / 'messages' / name, tmp_path / 'conf' / 'messages' / name)
    shutil.copy(REPO_ROOT / 'docs' / 'dev-environment.md', tmp_path / 'docs' / 'dev-environment.md')
    monkeypatch.setattr(snc, 'REPO_ROOT', tmp_path)
    monkeypatch.setattr(snc, 'CITYPARAMS', tmp_path / 'conf' / 'cityparams.conf')
    monkeypatch.setattr(snc, 'MESSAGES_DIR', tmp_path / 'conf' / 'messages')
    return tmp_path


_ENTRIES = [
    (['db-schema'], '"sidewalk_testville_wa"'),
    (['state-id'], '"washington"'),
    (['landing-page-url', 'prod'], '"https://sidewalk-testville.cs.washington.edu"'),
    (['google-analytics-4-id', 'test'], '""'),
    (['pano-viewer-type'], '"mapillary"'),
]


def test_add_cityparams_entries_registers_every_map_once(repo_copy, capsys):
    assert snc.add_cityparams_entries('testville-wa', _ENTRIES, dry_run=False) is True
    text = snc.CITYPARAMS.read_text()
    assert '    "testville-wa"\n' in text
    assert '    testville-wa = "sidewalk_testville_wa"\n' in text
    assert '      testville-wa = "https://sidewalk-testville.cs.washington.edu"\n' in text   # nested block indent
    assert '      testville-wa = ""\n' in text
    # A second run is a no-op.
    assert snc.add_cityparams_entries('testville-wa', _ENTRIES, dry_run=False) is False
    assert snc.CITYPARAMS.read_text() == text
    assert 'already knows testville-wa' in capsys.readouterr().out


def test_add_cityparams_entries_dry_run_writes_nothing(repo_copy, capsys):
    before = snc.CITYPARAMS.read_text()
    assert snc.add_cityparams_entries('testville-wa', _ENTRIES, dry_run=True) is True
    assert snc.CITYPARAMS.read_text() == before
    assert '[dry-run] would add 6 entries' in capsys.readouterr().out


def test_find_block_reports_a_missing_block(repo_copy):
    with pytest.raises(SystemExit, match='no-such-block'):
        snc.find_block(['a {', '}'], 'no-such-block')


def test_add_message_line_appends_after_the_key_family(repo_copy):
    assert snc.add_message_line('messages', 'city.name.testville-wa', 'Testville', dry_run=False) is True
    lines = snc.MESSAGES_DIR.joinpath('messages').read_text().split('\n')
    idx = lines.index('city.name.testville-wa = Testville')
    assert lines[idx - 1].startswith('city.name.')
    assert not lines[idx + 1].startswith('city.name.')
    assert snc.message_key_exists('messages', 'city.name.testville-wa')
    assert snc.add_message_line('messages', 'city.name.testville-wa', 'Other', dry_run=False) is False
    assert 'city.name.testville-wa = Other' not in snc.MESSAGES_DIR.joinpath('messages').read_text()


def test_add_message_line_dry_run_and_country_family(repo_copy, capsys):
    before = snc.MESSAGES_DIR.joinpath('messages').read_text()
    assert snc.add_message_line('messages', 'country.name.atlantis', 'Atlantis', dry_run=True) is True
    assert snc.MESSAGES_DIR.joinpath('messages').read_text() == before
    assert 'would add "country.name.atlantis = Atlantis"' in capsys.readouterr().out
    assert not snc.message_key_exists('messages', 'country.name.atlantis')
    assert snc.message_key_exists('messages', 'country.name.france')


def test_add_docs_city_row_fills_the_open_slot_then_starts_a_new_row(repo_copy):
    docs = repo_copy / 'docs' / 'dev-environment.md'
    snc.add_docs_city_row('one-wa', 'sidewalk_one', dry_run=False)
    snc.add_docs_city_row('two-wa', 'sidewalk_two', dry_run=False)
    snc.add_docs_city_row('one-wa', 'sidewalk_one', dry_run=False)   # already there: no-op
    table = [line for line in docs.read_text().split('\n') if '| one-wa |' in line or '| two-wa |' in line]
    assert len(table) <= 2
    assert docs.read_text().count('| one-wa |') == 1
    assert '| two-wa | sidewalk_two |' in docs.read_text()


def test_add_docs_city_row_without_a_table_says_so(repo_copy, capsys):
    (repo_copy / 'docs' / 'dev-environment.md').write_text('# no table here\n')
    snc.add_docs_city_row('x', 'sidewalk_x', dry_run=False)
    assert 'add x there by hand' in capsys.readouterr().out


def test_add_docs_city_row_dry_run(repo_copy, capsys):
    docs = repo_copy / 'docs' / 'dev-environment.md'
    before = docs.read_text()
    snc.add_docs_city_row('dry-wa', 'sidewalk_dry', dry_run=True)
    assert docs.read_text() == before
    assert 'would add dry-wa' in capsys.readouterr().out


# --------------------------------------------------------------------------------------------------------------------
# Docker-backed helpers with the subprocess faked
# --------------------------------------------------------------------------------------------------------------------

def _fake_run(monkeypatch, responses):
    """Answers subprocess.run from ``responses`` ({substring-of-command: (returncode, stdout)}), recording calls."""
    calls = []

    def run(cmd, **kwargs):
        calls.append(cmd)
        joined = ' '.join(str(part) for part in cmd)
        for needle, (code, out) in responses.items():
            if needle in joined:
                return SimpleNamespace(returncode=code, stdout=out)
        return SimpleNamespace(returncode=0, stdout='')

    monkeypatch.setattr(snc.subprocess, 'run', run)
    return calls


def test_web_env_and_db_query_read_through_docker(monkeypatch):
    _fake_run(monkeypatch, {'printenv DATABASE_USER': (0, 'sidewalk_richmond\n'),
                            'printenv MISSING': (1, ''),
                            'SELECT 1': (0, '1\n'), 'SELECT boom': (2, '')})
    assert snc.web_env('DATABASE_USER') == 'sidewalk_richmond'
    assert snc.web_env('MISSING') is None
    assert snc.db_query('SELECT 1') == '1'
    assert snc.db_query('SELECT boom') is None


def test_dump_schema_counts_the_objects(monkeypatch, capsys):
    calls = _fake_run(monkeypatch, {'pg_restore --list': (0, ';\n; Archive header\n1; 0 0 TABLE x\n2; 0 0 TABLE y\n'),
                                    'stat -c %s': (0, '2500000\n')})
    assert snc.dump_schema('sidewalk_testville_wa') == 2
    assert any('pg_dump' in ' '.join(map(str, cmd)) and '/opt/sidewalk_testville_wa-dump' in cmd for cmd in calls)
    assert 'db/sidewalk_testville_wa-dump (2.5 MB, 2 objects)' in capsys.readouterr().out


def test_run_imagery_scan_skips_unknown_providers_and_missing_credentials(monkeypatch, capsys):
    calls = _fake_run(monkeypatch, {'printenv MAPILLARY_ACCESS_TOKEN': (1, '')})
    snc.run_imagery_scan('sidewalk_x', 'x', 'hologram')
    assert 'No imagery scan for pano type "hologram"' in capsys.readouterr().out
    snc.run_imagery_scan('sidewalk_x', 'x', 'mapillary')
    assert 'MAPILLARY_ACCESS_TOKEN not set' in capsys.readouterr().out
    assert not any('check_streets_for_imagery' in ' '.join(map(str, cmd)) for cmd in calls)


def test_run_imagery_scan_exports_scans_hides_and_imports(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(snc, 'REPO_ROOT', tmp_path)
    monkeypatch.setattr(snc.sys, 'stdin', SimpleNamespace(isatty=lambda: False))
    calls = _fake_run(monkeypatch, {'COPY (SELECT': (0, 'street_edge_id,region_id\n1,1\n2,1\n')})
    city_dir = tmp_path / 'db' / 'onboarding' / 'x'
    city_dir.mkdir(parents=True)
    (city_dir / 'streets_with_no_imagery.csv').write_text('street_edge_id\n2\n')
    snc.run_imagery_scan('sidewalk_x', 'x', 'panoramax')
    joined = [' '.join(map(str, cmd)) for cmd in calls]
    assert (city_dir / 'street_edge_endpoints.csv').read_text().startswith('street_edge_id,region_id')
    assert any('check_streets_for_imagery.py --city-id x --panoramax' in cmd for cmd in joined)
    assert any('hide-streets-without-imagery.sh sidewalk_x onboarding/x/streets_with_no_imagery.csv' in cmd
               for cmd in joined)
    assert any('import-street-imagery.sh sidewalk_x onboarding/x/street_imagery_summary.csv' in cmd
               for cmd in joined)
    out = capsys.readouterr().out
    assert 'Scanning 2 streets for panoramax imagery' in out
    assert '1 street(s) without imagery' in out


def test_parse_report_lists_the_regions(monkeypatch, tmp_path):
    monkeypatch.setattr(snc, 'REPO_ROOT', tmp_path)
    city_dir = tmp_path / 'db' / 'onboarding' / 'x'
    city_dir.mkdir(parents=True)
    (city_dir / 'report.md').write_text('| region_id | name | streets |\n|---|---|---|\n| 1 | West | 3 |\n'
                                        '| 2 | East End | 0 |\n')
    assert snc.parse_report('x') == [('1', 'West'), ('2', 'East End')]
