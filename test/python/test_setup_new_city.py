"""
Unit tests for tools/setup_new_city.py — the derivations, the config-file edits, and the docker-backed steps
`make onboard-city` performs.

The file edits run against copies of the real conf/cityparams.conf, conf/messages/*, and docs/dev-environment.md, so
a structural change to those files that would break the orchestrator fails here first. The docker/DB steps run with
`subprocess.run`, the app's HTTP port, and the clock faked, and `main` end to end with its prompts scripted.
"""

import shutil
import urllib.error
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

import create_ga_properties as ga
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


def test_evolution_hash_is_plays_sha1_of_the_trimmed_sections(tmp_path):
    import hashlib
    (tmp_path / '7.sql').write_text('# a header line before the first marker is not part of either section\n'
                                    '# --- !Ups\n\nCREATE TABLE x (id int);\n\n# --- !Downs\nDROP TABLE x;\n\n')
    (tmp_path / '8.sql').write_text('-- !Ups\nSELECT 1;\n-- !Downs\nSELECT 2;\n')
    assert snc.evolution_hash(tmp_path / '7.sql') == hashlib.sha1(b'DROP TABLE x;CREATE TABLE x (id int);').hexdigest()
    assert snc.highest_evolution_hash(tmp_path) == hashlib.sha1(b'SELECT 2;SELECT 1;').hexdigest()
    assert len(snc.highest_evolution_hash()) == 40


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


def test_find_block_reports_a_missing_or_unclosed_block(repo_copy):
    with pytest.raises(SystemExit, match='no-such-block'):
        snc.find_block(['a {', '}'], 'no-such-block')
    with pytest.raises(SystemExit, match='could not find block "a"'):
        snc.find_block(['a {', '  b = 1'], 'a')


def test_insert_entry_indents_like_its_neighbours_or_four_spaces_in_an_empty_block():
    lines = ['x {', '  a = 1', '}', 'y = [', '', ']']
    snc.insert_entry(lines, ['x'], 'b = 2')
    snc.insert_entry(lines, ['y'], '"c"')
    assert lines == ['x {', '  a = 1', '  b = 2', '}', 'y = [', '', '    "c"', ']']


def test_valid_city_id_accepts_kebab_case_only():
    assert snc.valid_city_id('laurens-ia') == 'laurens-ia'
    with pytest.raises(snc.argparse.ArgumentTypeError):
        snc.valid_city_id('Laurens_IA')


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
    """
    Answers subprocess.run from ``responses`` ({substring-of-command: (returncode, stdout)}), recording calls. A
    value may also be a list of such pairs, handed out in order (the last one repeats), for a query whose answer
    changes as the run progresses.
    """
    calls = []

    def run(cmd, **kwargs):
        calls.append(cmd)
        joined = ' '.join(str(part) for part in cmd)
        for needle, response in responses.items():
            if needle in joined:
                if isinstance(response, list):
                    code, out = response.pop(0) if len(response) > 1 else response[0]
                else:
                    code, out = response
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


def test_run_imagery_scan_handles_no_hidden_streets_and_a_terminal(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(snc, 'REPO_ROOT', tmp_path)
    monkeypatch.setattr(snc.sys, 'stdin', SimpleNamespace(isatty=lambda: True))
    calls = _fake_run(monkeypatch, {'COPY (SELECT': (0, 'street_edge_id,region_id\n1,1\n')})
    snc.run_imagery_scan('sidewalk_x', 'x', 'panoramax')
    scan = next(cmd for cmd in calls if 'scripts/check_streets_for_imagery.py' in cmd)
    assert '-t' in scan   # the progress bar gets a TTY when there is one
    assert '0 street(s) without imagery' in capsys.readouterr().out


# --------------------------------------------------------------------------------------------------------------------
# The one-shot evolutions boot
# --------------------------------------------------------------------------------------------------------------------

def _boot_env(monkeypatch, responses, urlopen_results):
    """Fakes everything apply_evolutions touches: docker (subprocess), the app's HTTP port, and the clock."""
    calls = _fake_run(monkeypatch, responses)
    monkeypatch.setattr(snc, 'highest_evolution', lambda: 375)
    results = list(urlopen_results)

    def urlopen(url, timeout=None):
        result = results.pop(0)
        if isinstance(result, Exception):
            raise result
        return SimpleNamespace(close=lambda: None)

    monkeypatch.setattr(snc.urllib.request, 'urlopen', urlopen)
    monkeypatch.setattr(snc.time, 'sleep', lambda seconds: None)
    return calls


def test_apply_evolutions_skips_the_boot_for_a_current_schema_unless_verifying(monkeypatch, capsys):
    calls = _boot_env(monkeypatch, {'max(id)': (0, '375\n'), 'pgrep': (1, ''), 'last_problem': (0, '')}, [None])
    snc.apply_evolutions('sidewalk_x', 'x')
    assert 'no app boot needed' in capsys.readouterr().out
    assert not any('bash' in cmd for cmd in calls)
    # Right after a clone the boot runs anyway: Play is the check that the donor's evolutions are this checkout's.
    snc.apply_evolutions('sidewalk_x', 'x', verify=True)
    out = capsys.readouterr().out
    assert 'booting the app as x once anyway' in out and 'applied and verified (at 375)' in out
    boot = next(cmd for cmd in calls if 'bash' in cmd)
    assert boot[boot.index('-e') + 1] == 'DATABASE_USER=sidewalk_x' and snc.BOOT_CMD in boot
    assert any('pkill' in cmd and snc.BOOT_MARKER in cmd for cmd in calls)
    # The stop can only hit this boot's processes, never another tail -f /dev/null in the container.
    assert snc.BOOT_MARKER in snc.BOOT_CMD and 'exec -a' in snc.BOOT_CMD


def test_apply_evolutions_waits_for_the_app_then_for_the_evolutions(monkeypatch, capsys):
    calls = _boot_env(monkeypatch, {'max(id)': [(0, '370\n'), (0, '374\n'), (0, '375\n')],
                                    'pgrep': [(0, ''), (1, '')], 'last_problem': (0, '')},
                      [urllib.error.URLError('refused'), urllib.error.HTTPError('u', 500, 'x', {}, None), None])
    prompts = []
    monkeypatch.setattr('builtins.input', lambda text: prompts.append(text) or '')
    snc.apply_evolutions('sidewalk_x', 'x')
    out = capsys.readouterr().out
    assert '...at 374 of 375' in out and 'applied and verified (at 375)' in out
    assert len(prompts) == 1 and 'already running' in prompts[0]
    assert sum(1 for cmd in calls if 'pkill' in cmd) == 1


def test_apply_evolutions_stops_on_a_failed_evolution_and_on_timeout(monkeypatch):
    _boot_env(monkeypatch, {'max(id)': (0, '370\n'), 'pgrep': (1, ''), 'last_problem': (0, '375: relation x\n')},
              [None])
    with pytest.raises(SystemExit, match='could not apply evolution 375: relation x'):
        snc.apply_evolutions('sidewalk_x', 'x')
    _boot_env(monkeypatch, {'max(id)': (0, '370\n'), 'pgrep': (1, ''), 'last_problem': (0, '')}, [None] * 5)
    clock = iter([0, 1, 10_000])
    monkeypatch.setattr(snc.time, 'monotonic', lambda: next(clock))
    with pytest.raises(SystemExit, match='never reached 375'):
        snc.apply_evolutions('sidewalk_x', 'x')


# --------------------------------------------------------------------------------------------------------------------
# main, end to end, with the prompts scripted and the docker steps faked
# --------------------------------------------------------------------------------------------------------------------

def _city_artifacts(repo_copy, city_id='testville-wa', preflight=True):
    city_dir = repo_copy / 'db' / 'onboarding' / city_id
    city_dir.mkdir(parents=True)
    (city_dir / 'qgis_tables.sql').write_text('BEGIN; COMMIT;\n')
    (city_dir / 'report.md').write_text('# City onboarding report\n\n- Generated: now\n- Streets: **3**\n\n'
                                        '| region_id | name | streets | street km | flag |\n|---|---|---|---|---|\n'
                                        '| 1 | West | 2 | 1.0 |  |\n| 2 | East | 1 | 0.5 |  |\n')
    if preflight:
        (city_dir / 'preflight_report.md').write_text('| provider | sample |\n|---|---|\n| mapillary | 60 |\n')
    return city_dir


def _answers(monkeypatch, *answers):
    """Scripts input(): each prompt takes the next answer ('' accepts the default)."""
    queue = list(answers)
    monkeypatch.setattr('builtins.input', lambda text: queue.pop(0))
    return queue


def _stub_steps(monkeypatch, repo_copy):
    """Replaces the long-running steps with recorders and points the GA step at the copied files."""
    record = {'evolutions': []}
    monkeypatch.setattr(snc, 'apply_evolutions',
                        lambda schema, city_id, verify=False: record['evolutions'].append((schema, verify)))
    monkeypatch.setattr(snc, 'run_imagery_scan',
                        lambda schema, city_id, pano_type: record.__setitem__('scan', pano_type))
    monkeypatch.setattr(snc, 'dump_schema', lambda schema: record.__setitem__('dump', schema))
    monkeypatch.setattr(snc, 'highest_evolution', lambda: 375)
    monkeypatch.setattr(snc, 'highest_evolution_hash', lambda: 'hash375')
    monkeypatch.setattr(ga, 'CITYPARAMS', snc.CITYPARAMS)
    monkeypatch.setattr(ga, 'KEY_FILE', repo_copy / 'ga-service-account.json')
    monkeypatch.setattr(ga, 'create_for_city', lambda city_id, dry_run=False: record.__setitem__('ga', city_id))
    return record


# The docker answers for a first, clean run: containers up, no schema yet, the dev city is the donor, a fresh clone
# holds only the tutorial street, and no scan has been imported.
_FRESH_DB = {'true': (0, ''), 'pg_namespace': (0, ''), 'printenv DATABASE_USER': (0, 'sidewalk_richmond\n'),
             'street_edge': (0, '1\n'), 'street_imagery': (0, '0\n')}


def test_main_dry_run_registers_nothing_and_stops_before_docker(repo_copy, monkeypatch, capsys):
    _city_artifacts(repo_copy, preflight=False)
    _stub_steps(monkeypatch, repo_copy)
    calls = _fake_run(monkeypatch, {})
    _answers(monkeypatch, 'y', '', '', '', '', '', '', '')
    before = snc.CITYPARAMS.read_text()
    snc.main(['testville-wa', '--dry-run'])
    out = capsys.readouterr().out
    assert 'No imagery preflight yet' in out
    assert 'would add 17 entries' in out and '[dry-run] stopping' in out
    assert snc.CITYPARAMS.read_text() == before and calls == []


def test_main_stops_when_the_data_is_refused(repo_copy, monkeypatch):
    _city_artifacts(repo_copy)
    _answers(monkeypatch, 'n')
    with pytest.raises(SystemExit, match='Stopped'):
        snc.main(['testville-wa'])


def test_main_needs_the_build_artifacts_and_running_containers(repo_copy, monkeypatch):
    with pytest.raises(SystemExit, match='make build-city-data'):
        snc.main(['testville-wa'])
    _city_artifacts(repo_copy)
    _stub_steps(monkeypatch, repo_copy)
    _fake_run(monkeypatch, {'true': (1, '')})
    _answers(monkeypatch, 'y', '', '', '', '', '', '', '')
    with pytest.raises(SystemExit, match='container is not running'):
        snc.main(['testville-wa'])


def test_main_first_run_walks_every_step(repo_copy, monkeypatch, capsys):
    _city_artifacts(repo_copy)
    record = _stub_steps(monkeypatch, repo_copy)
    calls = _fake_run(monkeypatch, dict(_FRESH_DB))
    # Prompts: continue; display name, country, state (defaults); a bad then a good viewer type; status, launch date,
    # URL (defaults); tutorial region; a bad then a good regions spec.
    _answers(monkeypatch, 'y', '', '', '', 'hologram', 'mapillary', '', '', '', '2', 'include:2 x', 'include:1 2')
    snc.main(['testville-wa'])
    out = capsys.readouterr().out
    text = snc.CITYPARAMS.read_text()
    assert 'testville-wa = "mapillary"' in text and 'testville-wa = "sidewalk_testville_wa"' in text
    assert 'Left unset' in out and 'No ga-service-account.json' in out
    assert any(cmd[-5:] == ['/opt/scripts/create-new-schema.sh', 'sidewalk_testville_wa', 'sidewalk_richmond', '375',
                            'hash375'] for cmd in calls)
    assert record['evolutions'] == [('sidewalk_testville_wa', True)]
    assert any('/opt/onboarding/testville-wa/qgis_tables.sql' in cmd for cmd in calls)
    assert any(cmd[-4:] == ['/opt/scripts/fill-new-schema.sh', 'sidewalk_testville_wa', '2', 'include:1 2']
               for cmd in calls)
    assert record['scan'] == 'mapillary' and record['dump'] == 'sidewalk_testville_wa'
    assert 'Server handoff for testville-wa' in out and 'mapathon_event_link` was cleared' in out


def test_main_rerun_skips_what_already_happened(repo_copy, monkeypatch, capsys):
    _city_artifacts(repo_copy)
    record = _stub_steps(monkeypatch, repo_copy)
    _fake_run(monkeypatch, {'true': (0, ''), 'pg_namespace': (0, '1\n'), 'street_edge': (0, '170\n'),
                            'street_imagery': (0, '167\n')})
    snc.add_cityparams_entries('testville-wa', [(['db-schema'], '"sidewalk_testville_wa"')], dry_run=False)
    (repo_copy / 'ga-service-account.json').write_text('{}')
    monkeypatch.setattr(ga, 'ids_are_placeholders', lambda city_id: False)
    _answers(monkeypatch, 'y', '', '', '', 'gsv', '', '', '', 'n')
    snc.main(['testville-wa'])
    out = capsys.readouterr().out
    assert 'already knows testville-wa' in out and 'Left unset' not in out
    assert 'GA measurement ids are already filled in' in out
    assert 'Keeping the existing schema' in out
    assert record['evolutions'] == [('sidewalk_testville_wa', False)]
    assert 'Steps 5-6/8 — skipped: sidewalk_testville_wa already holds 170 streets' in out
    assert 'A scan was already imported' in out and 'scan' not in record


def test_main_recreates_a_schema_on_request_and_can_defer_the_scan(repo_copy, monkeypatch, capsys):
    _city_artifacts(repo_copy)
    record = _stub_steps(monkeypatch, repo_copy)
    calls = _fake_run(monkeypatch, dict(_FRESH_DB, **{'pg_namespace': (0, '1\n')}))
    (repo_copy / 'ga-service-account.json').write_text('{}')
    monkeypatch.setattr(ga, 'ids_are_placeholders', lambda city_id: True)
    _answers(monkeypatch, 'y', '', '', '', '', '', '', '', 'y', '1', 'all')
    snc.main(['testville-wa', '--donor', 'sidewalk_seattle', '--skip-scan'])
    out = capsys.readouterr().out
    assert record['ga'] == 'testville-wa'
    assert any(cmd[-4:] == ['sidewalk_testville_wa', 'sidewalk_seattle', '375', 'hash375'] for cmd in calls)
    assert record['evolutions'] == [('sidewalk_testville_wa', True)]
    assert 'Skipped (--skip-scan)' in out and 'scan' not in record


def test_main_registers_a_new_country_and_a_new_state(repo_copy, monkeypatch, capsys):
    _city_artifacts(repo_copy, 'atlantis-city')
    _stub_steps(monkeypatch, repo_copy)
    # No US-state suffix, so the country has no default: an empty answer re-prompts. The country is new to the
    # platform, so its display name is asked for last.
    _answers(monkeypatch, 'y', '', '', 'atlantis', '', '', '', '', 'Atlantis')
    snc.main(['atlantis-city', '--dry-run'])
    out = capsys.readouterr().out
    assert 'would add "country.name.atlantis = Atlantis"' in out
    assert 'country.name.atlantis' in out and 'state.name' not in out
    _city_artifacts(repo_copy, 'testville-wy')
    _answers(monkeypatch, 'y', '', '', '', '', '', '', '')
    snc.main(['testville-wy', '--dry-run'])
    out = capsys.readouterr().out
    assert 'would add "state.name.wyoming = Wyoming" to messages' in out
    assert 'would add "state.name.wyoming = WY" to messages.en' in out
    assert 'city.name.testville-wy, state.name.wyoming' in out
    # A state id outside the map gets no message lines.
    _city_artifacts(repo_copy, 'somewhere-xx')
    _answers(monkeypatch, 'y', '', 'usa', 'guam', '', '', '', '')
    snc.main(['somewhere-xx', '--dry-run'])
    assert 'state.name' not in capsys.readouterr().out
