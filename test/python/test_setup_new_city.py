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


def _append_key(file_name, key, value='x'):
    path = snc.MESSAGES_DIR / file_name
    path.write_text(path.read_text() + f'{key} = {value}\n')


def test_the_build_review_gate_has_no_default_to_fall_back_on(monkeypatch, repo_copy):
    """
    Step 0 is a person reading the build report. Every other question can take a cautious default unattended, but
    this one has nothing cautious to take: skipping it would let a run clone, evolve and irreversibly fill a schema
    with choices nobody made (#5297).
    """
    _city_artifacts(repo_copy)
    _stub_steps(monkeypatch, repo_copy)
    _fake_run(monkeypatch, {})

    def no_stdin(text):
        assert '[' not in text, 'the build-review gate must not offer a default'
        raise EOFError

    monkeypatch.setattr('builtins.input', no_stdin)
    with pytest.raises(SystemExit, match='has no default and there is nothing on stdin'):
        snc.main(['testville-wa'])


def test_prompt_takes_the_cautious_default_when_nothing_can_answer(monkeypatch, capsys):
    """
    An unattended run must not die on an EOFError traceback — the failure this whole PR removed from the boot gate,
    which the dump step's "dump it anyway?" would otherwise reintroduce (#5297).
    """
    def no_stdin(text):
        raise EOFError

    monkeypatch.setattr('builtins.input', no_stdin)
    assert snc.prompt('Drop and recreate it? (y/n)', 'n') == 'n'
    assert 'taking the default: n' in capsys.readouterr().out
    with pytest.raises(SystemExit, match='has no default and there is nothing on stdin'):
        snc.prompt('Donor schema to clone')


def test_dump_schema_will_not_write_a_dirty_dump_unattended(monkeypatch, capsys):
    """The cautious default means an unattended run stops rather than shipping the QA data (#5297)."""
    calls = _dump_env(monkeypatch, (0, 'label|5\n'))

    def no_stdin(text):
        raise EOFError

    monkeypatch.setattr('builtins.input', no_stdin)
    with pytest.raises(SystemExit, match='Stopped before writing the dump'):
        snc.dump_schema('sidewalk_bayonne')
    assert not any('pg_dump' in ' '.join(map(str, cmd)) for cmd in calls)


def test_translation_todo_asks_only_for_what_english_defines(repo_copy):
    """A key with no base line has nothing to translate from, so it is never owed (#5297)."""
    assert snc.translation_todo('nowhere-xx', None, None) == []
    # A territory outside US_STATES gets no base state.name line, so it stays unasked even alongside a real city.
    _append_key('messages', 'city.name.nowhere-xx', 'Nowhere')
    owed = snc.translation_todo('nowhere-xx', 'guam', None, added={'city.name.nowhere-xx'})
    assert len(owed) == len(snc.TRANSLATED_MESSAGE_FILES)
    assert all(line.endswith('city.name.nowhere-xx') for line in owed)


def test_translation_todo_asks_every_file_for_a_brand_new_name(repo_copy):
    """Nothing carries it yet, so whether each language renders it differently is still a person's call."""
    _append_key('messages', 'city.name.nowhere-xx', 'Nowhere')
    owed = snc.translation_todo('nowhere-xx', None, None, added={'city.name.nowhere-xx'})
    assert len(owed) == len(snc.TRANSLATED_MESSAGE_FILES)
    _append_key(snc.ZH_TW_MESSAGES, 'city.name.nowhere-xx', '無處')
    # Still new to the Latin-script files, so still their call — zh-TW having it settles only zh-TW.
    owed = snc.translation_todo('nowhere-xx', None, None, added={'city.name.nowhere-xx'})
    assert not any(snc.ZH_TW_MESSAGES in line for line in owed)
    assert len(owed) == len(snc.TRANSLATED_MESSAGE_FILES) - 1


def test_translation_todo_leaves_a_name_no_language_translates_alone(repo_copy):
    """
    `state.name.washington` is in the base file and zh-TW and in no Latin-script file, because it is the same word
    in all of them. Reporting it on every Washington city would be five lines of noise on every run (#5297).
    """
    _append_key('messages', 'city.name.nowhere-wa', 'Nowhere')
    _append_key(snc.ZH_TW_MESSAGES, 'city.name.nowhere-wa', '無處')
    assert snc.translation_todo('nowhere-wa', 'washington', 'usa') == []


def test_translation_todo_spots_a_gap_another_language_proves_is_real(repo_copy):
    """
    The evidence that a name differs from English is another Latin-script file having translated it.
    `state.name.california` is in fr, de and nl but missing from pt-BR, which wants "Califórnia" — a real gap that
    a rule keyed on zh-TW alone hides, since zh-TW carries it (#5297).
    """
    _append_key('messages', 'city.name.nowhere-ca', 'Nowhere')
    _append_key(snc.ZH_TW_MESSAGES, 'city.name.nowhere-ca', '無處')
    owed = snc.translation_todo('nowhere-ca', 'california', 'usa')
    assert [line.split(': ')[1] for line in owed] == ['state.name.california'] * len(owed)
    assert {line.split('/')[-1].split(':')[0] for line in owed} == {'messages.es', 'messages.pt-BR'}


def test_translation_todo_survives_a_run_that_died_after_adding_the_english_line(repo_copy):
    """
    The English line being present is not evidence the translations were done: an earlier run can add it and then
    fail at the schema step. Asking the files, rather than remembering what this run added, keeps the key owed.
    """
    _append_key('messages', 'city.name.somewhere-ia', 'Somewhere')
    _append_key('messages.fr', 'city.name.somewhere-ia', 'Quelquepart')
    owed = snc.translation_todo('somewhere-ia', None, None)
    assert owed[0] == f'  conf/messages/{snc.ZH_TW_MESSAGES}: city.name.somewhere-ia'
    assert len(owed) == len(snc.TRANSLATED_MESSAGE_FILES) - 1  # fr has it; the rest are owed because fr proves it


def test_handoff_checklist_names_the_dump_both_urls_and_what_the_nightly_jobs_owe():
    text = snc.handoff_checklist('laurens-ia', 'sidewalk_laurens_ia', 'https://p', 'https://t')
    assert 'scp db/sidewalk_laurens_ia-dump' in text
    assert 'https://t and https://p' in text
    # The dump ships with these empty; saying so is the whole fix for #5297.
    assert 'intersection' in text and 'cluster' in text and 'osm_way' in text
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
    for name in ('messages', 'messages.en', *snc.TRANSLATED_MESSAGE_FILES):
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

def _fake_run(monkeypatch, responses, kwargs_seen=None):
    """
    Answers subprocess.run from ``responses`` ({substring-of-command: (returncode, stdout[, stderr])}), recording
    calls. A value may also be a list of such tuples, handed out in order (the last one repeats), for a query whose
    answer changes as the run progresses. Pass ``kwargs_seen`` to also collect each call's keyword arguments.
    """
    calls = []

    def run(cmd, **kwargs):
        calls.append(cmd)
        if kwargs_seen is not None:
            kwargs_seen.append((cmd, kwargs))
        joined = ' '.join(str(part) for part in cmd)
        for needle, response in responses.items():
            if needle in joined:
                if isinstance(response, list):
                    response = response.pop(0) if len(response) > 1 else response[0]
                code, out, err = (*response, '')[:3]
                return SimpleNamespace(returncode=code, stdout=out, stderr=err)
        return SimpleNamespace(returncode=0, stdout='', stderr='')

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


def _dump_env(monkeypatch, residue):
    """Fakes the dump step's three docker calls, with ``residue`` as the QA-residue query's raw psql output."""
    return _fake_run(monkeypatch, {'pg_restore --list': (0, ';\n; Archive header\n1; 0 0 TABLE x\n2; 0 0 TABLE y\n'),
                                   'stat -c %s': (0, '2500000\n'),
                                   'UNION ALL': residue})


def test_dump_schema_counts_the_objects(monkeypatch, capsys):
    clean = '\n'.join(f'{table}|0' for table in snc.QA_RESIDUE_TABLES) + '\n'
    calls = _dump_env(monkeypatch, (0, clean))
    assert snc.dump_schema('sidewalk_testville_wa') == 2
    assert any('pg_dump' in ' '.join(map(str, cmd)) and '/opt/sidewalk_testville_wa-dump' in cmd for cmd in calls)
    out = capsys.readouterr().out
    assert 'db/sidewalk_testville_wa-dump (2.5 MB, 2 objects)' in out
    assert 'QA pass' not in out


def test_dump_schema_stops_before_writing_a_dump_full_of_qa_data(monkeypatch, capsys):
    """
    A city QA'd locally carries session data the dump would hand to the launched site, so the check runs *before*
    pg_dump: a warning printed afterwards leaves the bad file on disk and buries itself under the handoff (#5297).
    """
    calls = _dump_env(monkeypatch, (0, 'label|5\naudit_task|7\nmission|0\ncluster|5\nwebpage_activity|155\n'))
    monkeypatch.setattr('builtins.input', lambda text: 'n')
    with pytest.raises(SystemExit, match='Stopped before writing the dump'):
        snc.dump_schema('sidewalk_bayonne')
    out = capsys.readouterr().out
    assert 'holds data from a local QA pass' in out
    assert 'label: 5' in out and 'audit_task: 7' in out and 'webpage_activity: 155' in out
    assert '    mission:' not in out  # zero rows, so it gets no count line (it is still in the TRUNCATE below)
    assert 'TRUNCATE label, label_history' in out and 'RESTART IDENTITY CASCADE' in out
    assert not any('pg_dump' in ' '.join(map(str, cmd)) for cmd in calls)


def test_dump_schema_can_be_told_to_dump_the_qa_data_anyway(monkeypatch, capsys):
    calls = _dump_env(monkeypatch, (0, 'label|5\n'))
    monkeypatch.setattr('builtins.input', lambda text: 'y')
    assert snc.dump_schema('sidewalk_bayonne') == 2
    assert any('pg_dump' in ' '.join(map(str, cmd)) for cmd in calls)


def test_dump_schema_does_not_read_an_unreadable_schema_as_clean(monkeypatch, capsys):
    """A schema too old to have one of the tables fails the whole count; that must not pass as an all-clear."""
    calls = _dump_env(monkeypatch, (1, ''))
    snc.dump_schema('sidewalk_ancient')
    assert 'Could not check the schema' in capsys.readouterr().out
    assert any('pg_dump' in ' '.join(map(str, cmd)) for cmd in calls)


def test_qa_residue_counts_every_table_the_documented_truncate_clears(monkeypatch):
    """
    The counted list and the TRUNCATE the operator is handed have to be the same list — the message builds the
    TRUNCATE from QA_RESIDUE_TABLES for exactly that reason, since two hand-maintained lists drift (#5297).
    """
    doc = (Path(snc.REPO_ROOT) / 'docs' / 'onboarding-a-city.md').read_text()
    truncate = doc.split('`TRUNCATE ', 1)[1].split('RESTART IDENTITY CASCADE', 1)[0]
    documented = {name.strip() for name in truncate.replace('\n', ' ').split(',') if name.strip()}
    assert documented == set(snc.QA_RESIDUE_TABLES)


def test_handoff_renames_the_dump_to_the_servers_convention():
    """The local name is what import-dump.sh restores; the server's own files are all `-empty-dump` (#5297)."""
    text = snc.handoff_checklist('bayonne', 'sidewalk_bayonne', 'https://p', 'https://t')
    assert 'scp db/sidewalk_bayonne-dump makelab1:' in text
    assert text.count('sidewalk_bayonne-empty-dump') == 1
    assert 'makelab1.cs.washington.edu:/www/sidewalk' not in text


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
    # The port probe is its own question; tests that care about it patch this themselves.
    monkeypatch.setattr(snc, 'boot_port_taken', lambda: False)
    return calls


def test_apply_evolutions_skips_the_boot_for_a_current_schema_unless_verifying(monkeypatch, capsys):
    calls = _boot_env(monkeypatch, {'max(id)': (0, '375\n'), 'pgrep': (0, ''), 'last_problem': (0, '')}, [None])
    snc.apply_evolutions('sidewalk_x', 'x')
    assert 'no app boot needed' in capsys.readouterr().out
    assert not any(snc.BOOT_CMD in cmd for cmd in calls)
    # Right after a clone the boot runs anyway: Play is the check that the donor's evolutions are this checkout's.
    snc.apply_evolutions('sidewalk_x', 'x', verify=True)
    out = capsys.readouterr().out
    assert 'booting the app as x once anyway' in out and 'applied and verified (at 375)' in out
    boot = next(cmd for cmd in calls if snc.BOOT_CMD in cmd)
    assert boot[boot.index('-e') + 1] == 'DATABASE_USER=sidewalk_x' and snc.BOOT_CMD in boot
    assert any('pkill' in cmd and snc.BOOT_MARKER in cmd for cmd in calls)
    # The stop can only hit this boot's processes, never another tail -f /dev/null in the container.
    assert snc.BOOT_MARKER in snc.BOOT_CMD and 'exec -a' in snc.BOOT_CMD


def test_apply_evolutions_waits_for_the_app_then_for_the_evolutions(monkeypatch, capsys):
    calls = _boot_env(monkeypatch, {'max(id)': [(0, '370\n'), (0, '374\n'), (0, '375\n')],
                                    'pgrep': [(0, '4242 /home\n'), (0, '')], 'last_problem': (0, '')},
                      [urllib.error.URLError('refused'), urllib.error.HTTPError('u', 500, 'x', {}, None), None])
    prompts = []
    monkeypatch.setattr(snc.sys, 'stdin', SimpleNamespace(isatty=lambda: True))
    monkeypatch.setattr('builtins.input', lambda text: prompts.append(text) or '')
    snc.apply_evolutions('sidewalk_x', 'x')
    out = capsys.readouterr().out
    assert '...at 374 of 375' in out and 'applied and verified (at 375)' in out
    assert len(prompts) == 1 and 'pid 4242 is building in /home' in prompts[0]
    assert 'Clear it' in prompts[0]
    assert sum(1 for cmd in calls if 'pkill' in cmd) == 1


def test_apply_evolutions_stops_on_a_failed_evolution_and_on_timeout(monkeypatch):
    _boot_env(monkeypatch, {'max(id)': (0, '370\n'), 'pgrep': (0, ''), 'last_problem': (0, '375: relation x\n')},
              [None])
    with pytest.raises(SystemExit, match='could not apply evolution 375: relation x'):
        snc.apply_evolutions('sidewalk_x', 'x')
    _boot_env(monkeypatch, {'max(id)': (0, '370\n'), 'pgrep': (0, ''), 'last_problem': (0, '')}, [None] * 5)
    clock = iter([0, 1, 10_000])
    monkeypatch.setattr(snc.time, 'monotonic', lambda: next(clock))
    with pytest.raises(SystemExit, match='never reached 375'):
        snc.apply_evolutions('sidewalk_x', 'x')


def test_boot_conflicts_probe_cannot_report_the_shell_running_it(monkeypatch):
    """
    Two independent guards, because this defect shipped once already (#5297).

    `docker exec` starts the probe shell in CHECKOUT_IN_CONTAINER with the pattern on its own command line, so a
    plain `sbt-launch` makes every call report a fresh phantom pid there and the wait can never clear. Bracketing
    the pattern fixes that, but only for as long as nobody widens it — `[s]bt-launch|sbtn`, the alternation
    qa-worktree.sh already uses, matches the shell again. Skipping `$$` holds whatever the pattern becomes, so both
    are asserted: one of them surviving a future edit is enough.
    """
    calls = _fake_run(monkeypatch, {'pgrep': (0, '')})
    monkeypatch.setattr(snc, 'boot_port_taken', lambda: False)
    snc.boot_conflicts()
    probe = next(' '.join(map(str, cmd)) for cmd in calls if 'pgrep' in ' '.join(map(str, cmd)))
    assert '[s]bt-launch' in probe, 'the pattern must not match this shell\'s own command line'
    assert '"$pid" = "$$"' in probe and 'continue' in probe, 'the probe must skip its own pid whatever the pattern'


class _FakeSocket:
    """The little of a socket that boot_port_taken() uses: opening it is the whole answer."""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_boot_port_taken_asks_tcp_not_http(monkeypatch):
    """
    A connect answers "can the boot bind this port" for any listener, in milliseconds.

    An HTTP probe gets it wrong twice: a Play app that has bound the port but not finished compiling holds the
    connection open, so a short timeout reads a busy port as free; and a non-HTTP listener — this box runs socat
    forwarders on neighbouring ports — raises BadStatusLine, which is neither HTTPError nor OSError (#5297).
    """
    asked = []

    def connect(address, timeout=None):
        asked.append((address, timeout))
        if len(asked) == 1:
            return _FakeSocket()
        raise ConnectionRefusedError

    monkeypatch.setattr(snc.socket, 'create_connection', connect)
    assert snc.boot_port_taken() is True
    assert snc.boot_port_taken() is False
    assert [address for address, _ in asked] == [('localhost', snc.BOOT_PORT)] * 2
    assert all(timeout and timeout <= 5 for _, timeout in asked), 'the connect must answer fast'


def test_boot_conflicts_names_a_boot_this_script_left_behind(monkeypatch):
    """A run killed outright never reaches the stop, and the advice to Ctrl-C an npm start cannot apply (#5297)."""
    _fake_run(monkeypatch, {'pgrep -f onboard-city-boot': (0, '4242\n'), 'pgrep': (0, '4242 /home\n')})
    monkeypatch.setattr(snc, 'boot_port_taken', lambda: True)
    conflicts = snc.boot_conflicts()
    assert any('left behind' in line and f'pkill -f {snc.BOOT_MARKER}' in line for line in conflicts)
    # Someone else's app on the port is not this script's to reap, so it gets no such advice.
    _fake_run(monkeypatch, {'pgrep -f onboard-city-boot': (1, ''), 'pgrep': (0, '')})
    assert not any('left behind' in line for line in snc.boot_conflicts())


def test_boot_conflicts_counts_only_builds_in_the_boots_own_checkout(monkeypatch):
    """A worktree's build has its own target/, so only the checkout the boot compiles shares locks with it."""
    _fake_run(monkeypatch, {'pgrep -f onboard-city-boot': (1, ''),
                            'pgrep': (0, '10 /home\n'
                                        '11 /home/.claude/worktrees/some-branch\n'
                                        '12 /home/.claude/worktrees/other\n'
                                        'not-a-pid /home\n')})
    monkeypatch.setattr(snc, 'boot_port_taken', lambda: False)
    assert snc.boot_conflicts() == ["pid 10 is building in /home (shares the boot's build locks)"]
    _fake_run(monkeypatch, {'pgrep': (0, '')})
    assert snc.boot_conflicts() == []


def test_boot_conflicts_catches_a_worktree_app_on_9000(monkeypatch):
    """
    `make qa-worktree` serves a worktree's app on :9000 and passes no -Dhttp.port, so its cwd says nothing about
    whether it is in the way. The port is asked directly instead (#5297).
    """
    _fake_run(monkeypatch, {'pgrep -f onboard-city-boot': (1, ''),
                            'pgrep': (0, '11 /home/.claude/worktrees/some-branch\n')})
    monkeypatch.setattr(snc, 'boot_port_taken', lambda: True)
    assert snc.boot_conflicts() == [':9000 is already taken (the boot needs it)']


def test_boot_conflicts_reports_a_container_it_cannot_inspect(monkeypatch):
    """Not knowing is not the same as being clear."""
    _fake_run(monkeypatch, {'pgrep': (1, '', 'Error: No such container\n')})
    monkeypatch.setattr(snc, 'boot_port_taken', lambda: False)
    assert snc.boot_conflicts() == ['could not inspect projectsidewalk-web for running builds '
                                    '(Error: No such container)']


def test_boot_url_matches_no_route(monkeypatch):
    """
    The poll must reach no controller. Play's dev mode starts the app — and so applies evolutions — for any
    request including one it 404s, but every route that reaches a controller logs a webpage_activity row, which the
    dump step then counts as leftover QA data and stops on. Measured against a schema at 382 with the repo at 384:
    polling this path alone took it to 384 and left webpage_activity untouched (#5297).
    """
    routes = (Path(snc.REPO_ROOT) / 'conf' / 'routes').read_text()
    path = snc.BOOT_URL.split(str(snc.BOOT_PORT), 1)[1]
    assert path.startswith('/__')
    assert path not in routes


def test_apply_evolutions_will_not_block_on_a_prompt_nothing_can_answer(monkeypatch, capsys):
    """Unattended, with no terminal to answer a prompt, the gate names what is in the way and stops (#5297)."""
    _boot_env(monkeypatch, {'max(id)': (0, '370\n'), 'pgrep': (0, '4242 /home\n'), 'last_problem': (0, '')}, [None])
    monkeypatch.setattr(snc.sys, 'stdin', SimpleNamespace(isatty=lambda: False))
    with pytest.raises(SystemExit, match='4242'):
        snc.apply_evolutions('sidewalk_x', 'x')
    # --allow-running-apps boots anyway, whether or not there is a terminal to ask.
    calls = _boot_env(monkeypatch, {'max(id)': [(0, '370\n'), (0, '375\n')], 'pgrep': (0, '4242 /home\n'),
                                    'last_problem': (0, '')}, [None, None])
    snc.apply_evolutions('sidewalk_x', 'x', allow_running_apps=True)
    assert '--allow-running-apps' in capsys.readouterr().out
    assert any(snc.BOOT_CMD in cmd for cmd in calls)


def test_apply_evolutions_stops_when_the_terminal_runs_out_of_answers(monkeypatch):
    """Ctrl-D at a real terminal is the one way this wait can still raise, and it must not be a traceback (#5297)."""
    _boot_env(monkeypatch, {'max(id)': (0, '370\n'), 'pgrep': (0, '4242 /home\n'), 'last_problem': (0, '')}, [None])
    monkeypatch.setattr(snc.sys, 'stdin', SimpleNamespace(isatty=lambda: True))

    def ctrl_d(text):
        raise EOFError

    monkeypatch.setattr('builtins.input', ctrl_d)
    with pytest.raises(SystemExit, match='nothing left on stdin'):
        snc.apply_evolutions('sidewalk_x', 'x')


def test_apply_evolutions_blames_the_override_when_it_then_times_out(monkeypatch):
    """After --allow-running-apps, a timeout is far more likely the conflict than the evolutions themselves."""
    _boot_env(monkeypatch, {'max(id)': (0, '370\n'), 'pgrep': (0, '4242 /home\n'), 'last_problem': (0, '')},
              [None] * 5)
    clock = iter([0, 1, 10_000])
    monkeypatch.setattr(snc.time, 'monotonic', lambda: next(clock))
    with pytest.raises(SystemExit) as timed_out:
        snc.apply_evolutions('sidewalk_x', 'x', allow_running_apps=True)
    assert '--allow-running-apps was passed over' in str(timed_out.value) and '4242' in str(timed_out.value)


def test_apply_evolutions_polls_only_the_boot_url(monkeypatch):
    """
    Nothing in the wait loop may reach a controller: every route that does logs a webpage_activity row, which the
    dump step counts as leftover QA data and stops on, so a clean onboarding would flag itself (#5297).
    """
    polled = []
    _boot_env(monkeypatch, {'max(id)': [(0, '370\n'), (0, '375\n')], 'pgrep': (0, ''), 'last_problem': (0, '')},
              [None, None])
    real_urlopen = snc.urllib.request.urlopen
    monkeypatch.setattr(snc.urllib.request, 'urlopen',
                        lambda url, timeout=None: (polled.append(url), real_urlopen(url, timeout))[1])
    snc.apply_evolutions('sidewalk_x', 'x')
    assert polled and all(url == snc.BOOT_URL for url in polled)


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
                        lambda schema, city_id, verify=False, allow_running_apps=False:
                        record['evolutions'].append((schema, verify)))
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
    assert snc.CITYPARAMS.read_text() == before
    assert not any('docker' in cmd for cmd in calls)


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
    for name in ('messages', *snc.TRANSLATED_MESSAGE_FILES):
        path = snc.MESSAGES_DIR / name
        path.write_text(path.read_text() + 'city.name.testville-wa = Testville\n')
    (repo_copy / 'ga-service-account.json').write_text('{}')
    monkeypatch.setattr(ga, 'ids_are_placeholders', lambda city_id: False)
    _answers(monkeypatch, 'y', '', '', '', 'gsv', '', '', '', 'n')
    snc.main(['testville-wa'])
    out = capsys.readouterr().out
    assert 'already knows testville-wa' in out and 'Left unset' not in out
    assert 'every locale file already carries' in out and 'Translations still owed' not in out
    assert 'GA measurement ids are already filled in' in out
    assert 'Keeping the existing schema' in out
    assert record['evolutions'] == [('sidewalk_testville_wa', False)]
    assert 'Steps 5-6/8 — skipped: sidewalk_testville_wa already holds 170 streets' in out
    assert 'A scan was already imported' in out and 'scan' not in record


def test_main_refuses_to_run_from_a_worktree(repo_copy, monkeypatch):
    """
    The db container mounts the MAIN checkout's db/ at /opt and the boot compiles CHECKOUT_IN_CONTAINER, so from a
    worktree the script would check its own artifacts and evolutions while the steps used the other copy (#5297).
    """
    _city_artifacts(repo_copy)
    _stub_steps(monkeypatch, repo_copy)
    # A path with a space in it: splitting the two lines on whitespace gives four fields, and a gate that reads
    # that as "not a worktree" fails open — the wrong direction for a safety check (#5297).
    spaced = f'{repo_copy}/my repo'
    _fake_run(monkeypatch, {'rev-parse': (0, f'{spaced}/.git/worktrees/wt\n{spaced}/.git\n')})
    with pytest.raises(SystemExit, match='is a git worktree'):
        snc.main(['testville-wa'])
    # --dry-run only previews edits to this checkout's own conf/ files and drives no container, so it is allowed.
    _answers(monkeypatch, 'y', '', '', '', '', '', '', '')
    _fake_run(monkeypatch, {'rev-parse': (0, f'{spaced}/.git/worktrees/wt\n{spaced}/.git\n')})
    snc.main(['testville-wa', '--dry-run'])
    # The main checkout answers with the same path twice, and is allowed through.
    _answers(monkeypatch, 'n')
    _fake_run(monkeypatch, {'rev-parse': (0, f'{repo_copy}/.git\n{repo_copy}/.git\n')})
    with pytest.raises(SystemExit, match='Stopped'):
        snc.main(['testville-wa'])
    # A directory git knows nothing about (an export, a tarball) is not a worktree either.
    _answers(monkeypatch, 'n')
    _fake_run(monkeypatch, {'rev-parse': (128, '')})
    with pytest.raises(SystemExit, match='Stopped'):
        snc.main(['testville-wa'])


def test_main_quotes_the_reason_a_load_or_fill_failed(repo_copy, monkeypatch):
    """Both steps fail for data reasons, and psql's own message is the useful part of the failure (#5297)."""
    _city_artifacts(repo_copy)
    _stub_steps(monkeypatch, repo_copy)
    _fake_run(monkeypatch, dict(_FRESH_DB, **{
        'qgis_tables.sql': (1, '', 'psql:qgis_tables.sql:5: ERROR:  relation "qgis_road" does not exist\n')}))
    _answers(monkeypatch, 'y', '', '', '', '', '', '', '')
    with pytest.raises(SystemExit) as failed:
        snc.main(['testville-wa'])
    assert 'loading qgis_tables.sql into sidewalk_testville_wa failed (exit 1)' in str(failed.value)
    assert 'relation "qgis_road" does not exist' in str(failed.value)
    assert 'reads /opt from the MAIN checkout' in str(failed.value)

    _fake_run(monkeypatch, dict(_FRESH_DB, **{
        'fill-new-schema.sh': (1, '', 'ERROR:  duplicate key value violates unique constraint\n')}))
    _answers(monkeypatch, 'y', '', '', '', '', '', '', '', '1', 'all')
    with pytest.raises(SystemExit) as failed:
        snc.main(['testville-wa'])
    assert 'fill-new-schema.sh failed on sidewalk_testville_wa (exit 1)' in str(failed.value)
    assert 'duplicate key value' in str(failed.value)
    assert 'drop and recreate it (step 3)' in str(failed.value)


def test_the_long_db_steps_still_show_their_progress(repo_copy, monkeypatch):
    """
    fill-new-schema.sh prints its configuration summary up front and then runs one long psql heredoc — the longest
    step in the run. Capturing its stdout to quote a failure would leave it silent throughout, so only stderr is
    held back, and that is printed either way: a successful psql still has NOTICEs worth seeing (#5297).
    """
    seen = []
    _city_artifacts(repo_copy)
    _stub_steps(monkeypatch, repo_copy)
    _fake_run(monkeypatch, dict(_FRESH_DB), kwargs_seen=seen)
    _answers(monkeypatch, 'y', '', '', '', '', '', '', '', '1', 'all')
    snc.main(['testville-wa', '--skip-scan'])
    for step in ('create-new-schema.sh', 'qgis_tables.sql', 'fill-new-schema.sh'):
        cmd, kwargs = next((cmd, kw) for cmd, kw in seen if step in ' '.join(map(str, cmd)))
        assert kwargs.get('stderr') is snc.subprocess.PIPE, f'{step} must keep stderr to quote a failure'
        assert not kwargs.get('capture_output') and 'stdout' not in kwargs, f'{step} must stream its progress'


def test_main_passes_the_override_flag_through_to_the_boot(repo_copy, monkeypatch):
    """Without this the flag parses and is silently dropped, which no other test would notice."""
    seen = {}
    _city_artifacts(repo_copy)
    _stub_steps(monkeypatch, repo_copy)
    monkeypatch.setattr(snc, 'apply_evolutions',
                        lambda schema, city_id, verify=False, allow_running_apps=False:
                        seen.__setitem__('allow', allow_running_apps))
    _fake_run(monkeypatch, dict(_FRESH_DB))
    _answers(monkeypatch, 'y', '', '', '', '', '', '', '', '1', 'all')
    snc.main(['testville-wa', '--skip-scan', '--allow-running-apps'])
    assert seen['allow'] is True


def test_main_reports_why_the_donor_was_refused(repo_copy, monkeypatch):
    """The clone script's reason has to reach the operator, not just a CalledProcessError traceback (#5297)."""
    _city_artifacts(repo_copy)
    _stub_steps(monkeypatch, repo_copy)
    refusal = "Error: donor 'sidewalk_teaneck' is at evolution 383, beyond this checkout's highest (382).\n"
    _fake_run(monkeypatch, dict(_FRESH_DB, **{'create-new-schema.sh': (1, '', refusal)}))
    _answers(monkeypatch, 'y', '', '', '', '', '', '', '')
    with pytest.raises(SystemExit) as refused:
        snc.main(['testville-wa'])
    message = str(refused.value)
    assert 'would not clone sidewalk_richmond into sidewalk_testville_wa (exit 1)' in message
    assert 'beyond this checkout' in message and '--donor' in message


def test_main_verifies_a_schema_kept_from_a_run_that_never_filled_it(repo_copy, monkeypatch, capsys):
    """A clone an earlier run left unfilled has never had its donor's hashes checked, so it boots too (#5297)."""
    _city_artifacts(repo_copy)
    record = _stub_steps(monkeypatch, repo_copy)
    _fake_run(monkeypatch, dict(_FRESH_DB, **{'pg_namespace': (0, '1\n')}))
    _answers(monkeypatch, 'y', '', '', '', '', '', '', '', 'n', '1', 'all')
    snc.main(['testville-wa'])
    out = capsys.readouterr().out
    assert 'Keeping the existing schema' in out and 'never been verified' in out
    assert record['evolutions'] == [('sidewalk_testville_wa', True)]


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
    assert 'city.name.atlantis-city' in out
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
