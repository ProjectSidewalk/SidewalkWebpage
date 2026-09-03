#!/usr/bin/env python3
"""Regenerates test/e2e/fixtures/ci-seed.sql from a prod slice pulled by tools/ci_seed_slice.sql (#5115).

    python3 tools/gen_ci_seed.py [path/to/ci-seed-slice.csv]

The seed is real prod data, so it cannot be edited freely: the derived caches it writes have to keep agreeing with
the recomputes GeodesicDistanceSpec re-runs, label ids have to stay inside a window the share and phone-viewport
specs both depend on, and label_point.pano_x has to stay in the same pixel space as the downscaled imagery in
test/e2e/fixtures/media. Those rules live here, as code, so a refresh re-derives them instead of a reader having to
rediscover them in 500 lines of INSERTs.

Getting the slice (the maintainer runs this; see CLAUDE.local.md):

    scp tools/ci_seed_slice.sql saugstad@makelab1.cs.washington.edu:sidewalk-server-tools/current-query.sql
    ./run-query-in-every-city.sh -p -m -c "teaneck richmond" -o "ci-seed-slice"
    scp saugstad@makelab1.cs.washington.edu:sidewalk-server-tools/ci-seed-slice.csv scratchpad/

Imagery is NOT produced here: the panoramas and crops under test/e2e/fixtures/media are downloaded and downscaled by
hand. KEPT_PANOS is the list the two halves share, so changing it means refreshing those files too.
"""
import collections
import csv
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SLICE = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / 'scratchpad' / 'ci-seed-slice.csv'
OUTPUT = REPO_ROOT / 'test' / 'e2e' / 'fixtures' / 'ci-seed.sql'

# The panoramas whose imagery we hold a downscaled copy of, and so the ones whose labels can be seeded: a label is
# kept exactly when it sits on one of these. Chosen for coverage rather than for label count -- between them they
# carry six label types across three of the region's four streets, which is what makes a validation mission
# deterministic (ten of one type) while still giving the gallery and share specs something of every other shape.
KEPT_PANOS = ['60Fy6udfNJjDILZZ79n7Bg', 'HGiN2VdenH5bj760gRIvPw', 'gQIxyDH1bxP1In5JOau-mg',
              'joksJLXQppwg9OlymTrkmQ', 'oi_myNRB0_p9VSsqsnmj-g', 'piBGpWaR_-QRyi6Yhjsmwg']
# An unlabelled, unexpired pano, kept as the fixture for the imagery-reuse rule -- pinned rather than "whichever the
# slice lists first", so a re-run picks the same row.
SPARE_PANO = '3PGU6QVdqdLy-qy3vZ8hQw'
# The size every panorama under test/e2e/fixtures/media was downscaled to. pano_data.width/height say so, and
# label_point.pano_x/pano_y are rescaled into the same space below.
BACKUP_W, BACKUP_H = 1024, 512
# Groups the label block by type, so the file reads as one type at a time. Any total order will do; this one is
# fixed only so a regeneration doesn't reshuffle ids for no reason.
TYPE_ORDER = ['CurbRamp', 'Crosswalk', 'NoCurbRamp', 'NoSidewalk', 'Obstacle', 'SurfaceProblem']

rows = {r['city']: json.loads(r['slice']) for r in csv.DictReader(open(SLICE))}
tn, rich = rows['teaneck'], rows['richmond']
kept = set(KEPT_PANOS)
panos = {p['pano_id']: p for p in tn['panos']}
spare = panos[SPARE_PANO]
mp = next(p for p in rich['panos'] if p['source'] == 'mapillary')
mlbl = next(l for l in rich['labels'] if l['pano_id'] == mp['pano_id'])

# Every label on a pano we hold imagery for, grouped by type and then in prod id order.
labels = sorted((l for l in tn['labels'] if l['pano_id'] in kept),
                key=lambda l: (TYPE_ORDER.index(l['label_type']), l['label_id']))

# The Mapillary label sits at the FRONT of its type group, which is the only position that satisfies both specs
# reading the ends of this block: the share and story specs take the highest label id and need its pano to carry GSV
# metadata, and phone-viewport takes the lowest one near the city centre and needs imagery that resolves (this label
# deliberately has neither a crop nor a backup). Anywhere in the middle would do; the front of its own type keeps it
# beside the labels it is most like.
ordered = list(labels)
ordered.insert(next(i for i, l in enumerate(ordered) if l['label_type'] == mlbl['label_type']), mlbl)
id_map = {l['label_id']: 900002 + i for i, l in enumerate(ordered)}
MAP_ID = id_map[mlbl['label_id']]

U = {i: f"00000000-5115-4000-8000-00000000000{i}" for i in range(1, 5)}
STREETS = {s['street_edge_id']: s for s in tn['streets']}
# Labeler 2 walks the whole region (so one user has it finished) and owns the labels on two of its streets;
# labeler 3 walks the long street and labels it sparsely, which is what puts a low-quality user in the fixture.
OWNER = {479: 2, 1334: 2, 1141: 3, 842: 2}
MISSION = {2: 900001, 3: 900002}
TASK = {479: 900001, 842: 900002, 1141: 900003, 1334: 900004}
EXTRA_TASK = 900005          # labeler 1's fourth walk, so one user has finished the region
MAP_TASK, MAP_MISSION = 900003, MISSION[3]

def q(v):
    if v is None: return 'NULL'
    if isinstance(v, bool): return 'TRUE' if v else 'FALSE'
    if isinstance(v, (int, float)): return repr(v)
    return "'" + str(v).replace("'", "''") + "'"

def rows_sql(items, last=';'):
    # A row may carry a trailing `-- note`; the separating comma has to go before it, not after.
    out = []
    for i, row in enumerate(items):
        sep = ',' if i < len(items) - 1 else ''
        lines = row.split('\n')
        head, mark, note = lines[-1].rpartition('  -- ')
        lines[-1] = f"{head}{sep}  -- {note}" if mark else lines[-1] + sep
        out.append('\n'.join(lines))
    return '\n'.join(out) + '\n' + last

out = []
w = out.append

w(f"""-- =====================================================================================================================
-- The test city CI runs against (sidewalk_teaneck): real prod rows for region {tn['region']['region_id']} ({tn['region']['name']}) -- its
-- streets, labels and panoramas. GENERATED: edit tools/gen_ci_seed.py and re-run it, not this file (#5115). The
-- slice it reads comes from tools/ci_seed_slice.sql, which records which rows were taken and why those.
--
-- Real data, because a fixture that invents its own coordinates and panorama ids can only show that the code runs,
-- not that it runs on the shape of data it will meet.
--
-- Applied by ci.yml in BOTH the e2e-smoke job (after the app boots) and backend-tests (after its evolutions step),
-- always once the schema is at evolution HEAD: it writes street_edge.status and its ON CONFLICT targets need
-- constraints the committed template lacks. Idempotent, so a job retry can re-run it.
--
-- Four deliberate departures from prod:
--   * NO FREE TEXT. Label descriptions and validator comments are contributor-authored and this repo is public, so
--     the slice query never selected them; the strings below are written here instead.
--   * USERS ARE SYNTHETIC. A contributor's account is not ours to copy, and nothing here reads more than its role.
--   * GEOMETRY IS SIMPLIFIED (topology-preserving, so endpoints still agree with x1/y1/x2/y2): ~50 m for the region
--     boundary, ~2 m for the streets. A raw boundary is thousands of vertices no one can read in a diff.
--   * IMAGERY IS DOWNSCALED to 1024x512 and pano_data.width/height say so, because that is the size of the copy in
--     test/e2e/fixtures/media: those columns describe the imagery we hold, and a full-resolution one is ~15 MB.
--     label_point.pano_x/pano_y are rescaled by the same factor, since they index that same panorama -- rawLabels
--     publishes the four side by side for clients to use together, so a mismatched row would be a broken one.
--
-- EVERY PANORAMA IS EXPIRED, which is what keeps the server side hermetic: an expired pano is never fetched from a
-- provider, so nothing here depends on Google still serving a 2022 panorama or on a GOOGLE_MAPS_SECRET CI does not
-- have (#4948). What stands in is on disk, via install-media.sh -- keep the two in step.
--
-- Label ids are renumbered into a 900000 block and the sequences are deliberately NOT advanced past them: specs
-- insert from those same low sequences all run long, and `getRecentLabelsMetadata` orders by `label_id DESC`, so a
-- seeded label is only visible to the share and story specs while its id sits above every id the suite mints. The
-- prod id beside each one is also what its crop file was renamed from.
--
-- Cached columns (user_stat.meters_audited, labels_per_meter, high_quality, region_completion,
-- route.distance_meters) are COMPUTED at the end by the same rules their runtime recomputes use, never hardcoded:
-- GeodesicDistanceSpec asserts exactly that agreement.
-- =====================================================================================================================

-- With zero region rows /explore is a server error before any JS runs (#4748). With one, a fresh anonymous user
-- deterministically starts the audit TUTORIAL, whose panorama tiles are local assets.
INSERT INTO sidewalk_teaneck.region (region_id, data_source, name, geom, deleted)
VALUES ({tn['region']['region_id']}, {q(tn['region']['data_source'])}, {q(tn['region']['name'])},
        ST_Multi(ST_GeomFromText(
          {q(tn['region']['geom_wkt'])}, 4326)),
        FALSE)
ON CONFLICT (region_id) DO NOTHING;

-- The template's own street 1 stays out of the region: it is the tutorial street, which region completion excludes,
-- so a region holding only it counts as vacuously complete for everyone and is never assigned -- the same 500 as
-- having no region at all.""")

street_rows = [
    f"  ({s['street_edge_id']}, ST_GeomFromText({q(s['geom_wkt'])}, 4326),\n"
    f"   {s['x1']}, {s['y1']}, {s['x2']}, {s['y2']}, '{s['way_type']}', '{s['status']}')  -- {s['length_m']} m"
    for s in tn['streets']]
w("INSERT INTO sidewalk_teaneck.street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)\nVALUES\n"
  + rows_sql(street_rows, "ON CONFLICT (street_edge_id) DO NOTHING;"))

w("\nINSERT INTO sidewalk_teaneck.street_edge_region (street_edge_id, region_id)\nSELECT s.street_edge_id, "
  f"{tn['region']['region_id']}\nFROM (VALUES " + ", ".join(f"({s})" for s in sorted(STREETS)) +
  ") AS s(street_edge_id)\nWHERE NOT EXISTS (\n  SELECT 1 FROM sidewalk_teaneck.street_edge_region "
  "WHERE street_edge_id = s.street_edge_id\n);\n")

w("-- Priorities below 1.0 mark a street as explored at least once, which is what gives region_completion a non-zero\n"
  "-- audited distance and the API and landing page a completion percentage that is not flat zero.")
prio = {479: 0.4, 842: 1.0, 1141: 0.7, 1334: 0.55}
w("INSERT INTO sidewalk_teaneck.street_edge_priority (street_edge_id, priority)\nVALUES "
  + ", ".join(f"({s}, {prio[s]})" for s in sorted(STREETS)) + "\nON CONFLICT (street_edge_id) DO NOTHING;\n")

w("""-- Users. `sidewalk_login` is shared across every city schema, not this city's -- fine only because CI's database is
-- thrown away with the job, and this file runs nowhere else. The Administrator is for RouteAuthPostureSpec, which
-- reads an existing admin's email and mints its own session cookie, so no password rows are needed.""")
w("INSERT INTO sidewalk_login.sidewalk_user (user_id, username, email)\nVALUES\n" + rows_sql([
    f"  ({q(U[1])}, 'ciSeedAdmin',    'ci-seed-admin@example.test')",
    f"  ({q(U[2])}, 'ciSeedLabeler1', 'ci-seed-labeler-1@example.test')",
    f"  ({q(U[3])}, 'ciSeedLabeler2', 'ci-seed-labeler-2@example.test')",
    f"  ({q(U[4])}, 'ciSeedLabeler3', 'ci-seed-labeler-3@example.test')",
], "ON CONFLICT (user_id) DO NOTHING;"))

w("\n-- user_role's only unique key is its own id, so this guards on the user instead of ON CONFLICT.")
w("INSERT INTO sidewalk_login.user_role (user_role_id, user_id, role)\n"
  "SELECT r.user_role_id, r.user_id, r.role::sidewalk_login.role\nFROM (VALUES "
  + ",\n             ".join(f"(90000{i}, {q(U[i])}, {q('Administrator' if i == 1 else 'Registered')})"
                            for i in range(1, 5))
  + ") AS r(user_role_id, user_id, role)\n"
  "WHERE NOT EXISTS (SELECT 1 FROM sidewalk_login.user_role WHERE user_role.user_id = r.user_id);\n")

w("-- meters_audited / labels_per_meter / high_quality are filled in at the end, once their inputs exist.")
w("INSERT INTO sidewalk_teaneck.user_stat (user_stat_id, user_id, meters_audited, high_quality, excluded)\nVALUES\n"
  + rows_sql([f"  (90000{i}, {q(U[i])}, 0, TRUE, FALSE)" for i in range(1, 5)],
             "ON CONFLICT (user_stat_id) DO NOTHING;"))

w("""
-- Panoramas, as prod recorded them. Expired with a backup on disk is the combination `imageryViewable` admits and
-- the one that makes LabelService.checkImageryBatch answer from the file system instead of a provider -- and a real
-- state a city reaches once imagery ages out and the backup job has run.
--
-- The unlabelled rows are the sweep specs' fixtures, with fixed past timestamps so they only get truer with time.""")
pano_cols = ("pano_id, source, capture_date, width, height, tile_width, tile_height, lat, lng,\n"
             "                                        camera_heading, camera_pitch, camera_roll, copyright,\n"
             "                                        expired, expired_at, last_checked, has_backup")
def pano_row(p, *, width, height, expired, backup, checked, expired_at):
    return (f"  ({q(p['pano_id'])}, '{p['source']}', {q(p['capture_date'])}, {width}, {height}, "
            f"{p['tile_width']}, {p['tile_height']},\n   {p['lat']}, {p['lng']}, {p['camera_heading']}, "
            f"{p['camera_pitch']}, {q(p['camera_roll'])}, {q(p['copyright'])},\n   {q(expired)}, {q(expired_at)}, "
            f"{q(checked)}, {q(backup)})")
OLD = '2020-01-01 00:00:00+00'
pano_rows = [pano_row(panos[pid], width=BACKUP_W, height=BACKUP_H, expired=True, backup=True, checked=OLD,
                      expired_at=OLD)
             for pid in sorted(kept)]
pano_rows.append("  -- Unexpired, and last checked well before the TTL cutoff: the one row the reuse rule must not answer for.\n"
                 + pano_row(spare, width=spare['width'], height=spare['height'], expired=False,
                            backup=False, checked=OLD, expired_at=None))
pano_rows.append("  -- A LABELED Mapillary pano due for a check, so the nightly sweep's sampling query sees a non-gsv\n"
                 "  -- source. Real, from Richmond -- the one city on Mapillary imagery. Expired and unbacked, so it\n"
                 "  -- stays out of the Gallery; Validate and Explore already filter it out on the city's pano source.\n"
                 + pano_row(mp, width=mp['width'], height=mp['height'], expired=True, backup=False,
                            checked=OLD, expired_at=OLD))
w(f"INSERT INTO sidewalk_teaneck.pano_data ({pano_cols})\nVALUES\n"
  + rows_sql(pano_rows, "ON CONFLICT (pano_id) DO NOTHING;"))

w("""
-- Labeler 1 walks every street in the region because the outdated-imagery routing spec needs a user who has
-- finished one: it flags one of their audits and asserts the region re-opens, and there is nothing to re-open for a
-- user who never finished it. Completed and unflagged is what makes an audit count toward up-to-date coverage and
-- toward its user's audited distance.""")
w("INSERT INTO sidewalk_teaneck.mission (mission_id, mission_type, user_id, mission_start, mission_end, completed,\n"
  "                                      pay, paid, distance_meters, distance_progress, region_id, skipped)\nVALUES\n"
  + rows_sql([
      f"  ({MISSION[2]}, 'audit', {q(U[2])}, now() - INTERVAL '30 days', now() - INTERVAL '30 days',\n"
      f"   TRUE, 0.0, FALSE, 606.0, 606.0, {tn['region']['region_id']}, FALSE)",
      f"  ({MISSION[3]}, 'audit', {q(U[3])}, now() - INTERVAL '20 days', now() - INTERVAL '20 days',\n"
      f"   TRUE, 0.0, FALSE, 310.7, 310.7, {tn['region']['region_id']}, FALSE)",
  ], "ON CONFLICT (mission_id) DO NOTHING;"))

def task_row(tid, u, st, days, note=''):
    return (f"  ({tid}, {q(U[u])}, {st}, now() - INTERVAL '{days} days', now() - INTERVAL '{days} days',\n"
            f"   TRUE, {STREETS[st]['y2']}, {STREETS[st]['x2']}, FALSE, {MISSION[u]}, FALSE, FALSE, FALSE, FALSE)"
            + note)
task_rows = [task_row(TASK[st], OWNER[st], st, 30 - OWNER[st] * 2) for st in sorted(STREETS)]
task_rows.append('  -- Labeler 1 covering the one street in the region they did not label.\n'
                 + task_row(EXTRA_TASK, 2, 1141, 25))
w("INSERT INTO sidewalk_teaneck.audit_task (audit_task_id, user_id, street_edge_id, task_start, task_end, completed,\n"
  "                                         current_lat, current_lng, start_point_reversed, current_mission_id,\n"
  "                                         low_quality, incomplete, stale, outdated_imagery)\nVALUES\n"
  + rows_sql(task_rows, "ON CONFLICT (audit_task_id) DO NOTHING;"))

w("""
-- A validation mission is ten labels of ONE type, chosen at random among the types with that many available, so
-- giving exactly one type enough makes the choice deterministic without pinning anything in application code. The
-- rest cover the forks the share, gallery and edit specs read. `correct` stays NULL, so all still need validating.
--
-- The two NoSidewalk labels have no crop, as prod has none for them either: still validatable (Validate reads the
-- backup panorama, not crops), just absent from the Gallery -- which is what that state means in production.""")
tmp = collections.Counter()
label_rows = []
for l in ordered:
    if l is mlbl:
        label_rows.append(
            f"  -- The Mapillary pano's label. Neither the newest nor the oldest on purpose: the share and story\n"
            f"  -- specs read the HIGHEST label id and need a pano carrying GSV metadata, and phone-viewport reads\n"
            f"  -- the LOWEST near the city centre and needs imagery that resolves. This one has neither a crop nor\n"
            f"  -- a backup, which is exactly the case those two must not land on.\n"
            f"  ({MAP_ID}, {MAP_TASK}, {MAP_MISSION}, {q(U[3])}, {q(mp['pano_id'])}, "
            f"{q(mlbl['label_type'])}, {1141}, 99,\n   now() - INTERVAL '14 days', FALSE, FALSE, "
            f"{q(mlbl['severity'])}, '{{}}')  -- {mlbl['label_type']}, Richmond label {mlbl['label_id']}")
        continue
    st = l['street_edge_id']; u = OWNER[st]; t = TASK[st]
    tmp[t] += 1
    tags = '{' + ','.join('"%s"' % x for x in l['tags']) + '}'
    label_rows.append(
        f"  ({id_map[l['label_id']]}, {t}, {MISSION[u]}, {q(U[u])}, {q(l['pano_id'])}, {q(l['label_type'])}, "
        f"{st}, {tmp[t]},\n   now() - INTERVAL '{30 - u * 2} days', FALSE, FALSE, {q(l['severity'])}, "
        f"{q(tags)})  -- {l['label_type']}, prod label {l['label_id']}")
w("INSERT INTO sidewalk_teaneck.label (label_id, audit_task_id, mission_id, user_id, pano_id, label_type,\n"
  "                                    street_edge_id, temporary_label_id, time_created, deleted, tutorial,\n"
  "                                    severity, tags)\nVALUES\n"
  + rows_sql(label_rows, "ON CONFLICT (label_id) DO NOTHING;"))

w("""
-- Validate, the LabelMap, the clustering queries and the metadata serializer all join label_point, so a label
-- without one is invisible to every one of them.""")
def point_xy(l):
    """Rescales a label's panorama pixel position into the space of the imagery the fixture actually holds.

    pano_x/pano_y index the panorama that pano_data.width/height describe -- /v3/api/rawLabels publishes all four in
    one row for clients to use together, and PanoDataService reads them as a pair. The backups here were downscaled,
    pano_data says so, so these have to move with them or the row contradicts itself. The Mapillary pano keeps its
    prod size (no backup was made), so its label needs no rescaling.

    @param l: a label from the slice.
    @return: (pano_x, pano_y) in the seeded panorama's pixel space.
    """
    if l['pano_id'] not in panos:
        return l['pano_x'], l['pano_y']
    prod = panos[l['pano_id']]
    return (round(l['pano_x'] * BACKUP_W / prod['width']), round(l['pano_y'] * BACKUP_H / prod['height']))

point_rows = []
for l in ordered:
    lid = MAP_ID if l is mlbl else id_map[l['label_id']]
    lat, lng = (labels[0]['lat'], labels[0]['lng']) if l is mlbl else (l['lat'], l['lng'])
    px, py = point_xy(l)
    point_rows.append(
        f"  ({lid}, {lid}, {px}, {py}, "
        f"{l['canvas_x']}, {l['canvas_y']},\n"
        f"   {l['heading']}, {l['pitch']}, {l['zoom']}, {lat}, {lng},\n"
        f"   ST_SetSRID(ST_MakePoint({lng}, {lat}), 4326),\n"
        f"   'depth'::sidewalk_teaneck.computation_method)")
w("INSERT INTO sidewalk_teaneck.label_point (label_point_id, label_id, pano_x, pano_y, canvas_x, canvas_y,\n"
  "                                          heading, pitch, zoom, lat, lng, geom, computation_method)\n"
  "SELECT p.* FROM (VALUES\n" + ',\n'.join(point_rows) + "\n) AS p(label_point_id, label_id, pano_x, pano_y, "
  "canvas_x, canvas_y,\n        heading, pitch, zoom, lat, lng, geom, computation_method)\n"
  "WHERE NOT EXISTS (SELECT 1 FROM sidewalk_teaneck.label_point WHERE label_id = p.label_id);\n")

validated = id_map[labels[0]['label_id']]
# Validate never shows a user their own label (`getAvailableValidationsLabelsByType` filters `_lb.userId =!= userId`),
# so a row stamped source = 'Validate' has to come from someone else. Labeler 1 audited this label's street too.
validator = U[2]
assert validator != U[OWNER[labels[0]['street_edge_id']]], 'the seeded validation would be a self-validation'
w(f"""-- One label carries a full validation -- the vote, its effect on the label's counts, and the comment beside it --
-- because the share page takes a different branch for a label with no validator comments.
INSERT INTO sidewalk_teaneck.mission (mission_id, mission_type, user_id, mission_start, mission_end, completed,
                                      pay, paid, region_id, labels_validated, labels_progress, label_type, skipped)
VALUES (900004, 'validation', {q(validator)},
        now() - INTERVAL '5 days', now() - INTERVAL '5 days',
        TRUE, 0.0, FALSE, {tn['region']['region_id']}, 1, 1, 'CurbRamp', FALSE)
ON CONFLICT (mission_id) DO NOTHING;

INSERT INTO sidewalk_teaneck.label_validation (label_validation_id, label_id, validation_result, user_id, mission_id,
                                               canvas_x, canvas_y, heading, pitch, zoom, canvas_height, canvas_width,
                                               start_timestamp, end_timestamp, source, viewer_type)
VALUES (900001, {validated}, 'Agree', {q(validator)}, 900004, 300, 200, 120.0, -10.0, 1.0,
        480, 720, now() - INTERVAL '5 days', now() - INTERVAL '5 days', 'Validate', 'Default')
ON CONFLICT (label_validation_id) DO NOTHING;

INSERT INTO sidewalk_teaneck.validation_task_comment (validation_task_comment_id, mission_id, label_id, user_id,
                                                      ip_address, pano_id, heading, pitch, zoom, lat, lng,
                                                      timestamp, comment)
VALUES (900001, 900004, {validated}, {q(validator)}, '127.0.0.1', {q(labels[0]['pano_id'])},
        120.0, -10.0, 1.0, {labels[0]['lat']}, {labels[0]['lng']}, now() - INTERVAL '5 days',
        'Agreed, the ramp is there and usable.')
ON CONFLICT (validation_task_comment_id) DO NOTHING;

-- What a real Agree leaves behind on the label itself.
UPDATE sidewalk_teaneck.label SET agree_count = 1, correct = TRUE
WHERE label_id = {validated} AND agree_count = 0;

-- A route over the region's streets. distance_meters is computed the way RouteTable.updateStats does, because
-- GeodesicDistanceSpec re-runs that recompute and demands the cached value already match.
INSERT INTO sidewalk_teaneck.route (route_id, user_id, region_id, name, public, deleted, created_at, slug,
                                    description, distance_meters, street_count)
VALUES (900001, {q(U[2])}, {tn['region']['region_id']}, 'CI seed route', TRUE, FALSE,
        now() - INTERVAL '15 days', 'ci-seed-route', 'Every street in the seeded region, in order.', 0, 0)
ON CONFLICT (route_id) DO NOTHING;
""")
w("INSERT INTO sidewalk_teaneck.route_street (route_street_id, route_id, street_edge_id, reverse, position)\n"
  "VALUES\n" + rows_sql([f"  ({900000 + i}, 900001, {st}, FALSE, {i - 1})"
                          for i, st in enumerate(sorted(STREETS), start=1)],
                         "ON CONFLICT (route_street_id) DO NOTHING;") + "\n")

w(f"""UPDATE sidewalk_teaneck.route
SET distance_meters = COALESCE(stats.distance_meters, 0), street_count = COALESCE(stats.street_count, 0)
FROM (
  SELECT SUM(ST_Length(street_edge.geom::geography)) AS distance_meters, COUNT(*) AS street_count
  FROM sidewalk_teaneck.route_street
  INNER JOIN sidewalk_teaneck.street_edge USING (street_edge_id)
  WHERE route_street.route_id = 900001
) AS stats
WHERE route.route_id = 900001;

-- Derived caches, last because each reads the rows above. Keep in step with:
--   meters_audited / labels_per_meter / high_quality -> UserStatTable.updateAuditedDistanceHelper,
--                                                       updateLabelsPerMeterHelper, updateHighQuality
--   region_completion                                -> RegionService.initializeRegionCompletionTableAction
-- "Auditable streets" in all of them means open, non-tutorial streets -- StreetEdgeTable's `streets`.
UPDATE sidewalk_teaneck.user_stat
SET meters_audited = COALESCE((
      SELECT SUM(ST_Length(street_edge.geom::geography))
      FROM sidewalk_teaneck.audit_task
      INNER JOIN sidewalk_teaneck.street_edge USING (street_edge_id)
      WHERE audit_task.completed
        AND audit_task.user_id = user_stat.user_id
        AND street_edge.status = 'open'
        AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM sidewalk_teaneck.config)
    ), 0)
WHERE user_stat.user_id LIKE '00000000-5115-%';

-- Counted the way `labelsWithExcludedUsers` counts: every label under one of the user's `audit` missions (not
-- auditOnboarding), minus deleted and tutorial labels and anything on the tutorial street. No seeded label is
-- deleted or tutorial today, so those two predicates change nothing yet -- they are here because the moment one is
-- added, this cache has to move with it or GeodesicDistanceSpec fails pointing at the recompute rather than here.
UPDATE sidewalk_teaneck.user_stat
SET labels_per_meter = CASE
      WHEN meters_audited > 0 THEN (
        SELECT COUNT(*)
        FROM sidewalk_teaneck.label
        INNER JOIN sidewalk_teaneck.mission USING (mission_id)
        INNER JOIN sidewalk_teaneck.audit_task ON audit_task.audit_task_id = label.audit_task_id
        WHERE mission.mission_type = 'audit'
          AND mission.user_id = user_stat.user_id
          AND NOT label.deleted
          AND NOT label.tutorial
          AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM sidewalk_teaneck.config)
          AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM sidewalk_teaneck.config)
      )::double precision / meters_audited
      ELSE NULL
    END
WHERE user_stat.user_id LIKE '00000000-5115-%';

-- What the seeded validation leaves on its author's stats, computed the way UserStatTable.updateAccuracy computes
-- it: over the user's own non-deleted, non-tutorial labels, counting the ones a validator has judged. Users with no
-- labels keep the 0/NULL defaults, which is what the runtime's INNER JOIN leaves them at.
UPDATE sidewalk_teaneck.user_stat
SET own_labels_validated = accuracy_subquery.validated_count, accuracy = accuracy_subquery.accuracy
FROM (
  SELECT label.user_id,
         COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS validated_count,
         CAST(SUM(CASE WHEN correct THEN 1 ELSE 0 END) AS FLOAT)
           / NULLIF(SUM(CASE WHEN correct THEN 1 ELSE 0 END) + SUM(CASE WHEN NOT correct THEN 1 ELSE 0 END), 0)
           AS accuracy
  FROM sidewalk_teaneck.label
  WHERE NOT label.deleted AND NOT label.tutorial
  GROUP BY label.user_id
) AS accuracy_subquery
WHERE user_stat.user_id = accuracy_subquery.user_id
  AND user_stat.user_id LIKE '00000000-5115-%';

-- The quality heuristic, minus only the branches these rows can't reach (none is excluded or manually rated). The
-- two seeded labelers land either side of the 0.0375 labeling-frequency threshold, which exercises the recompute in
-- both directions; the accuracy clause is written out rather than assumed away, so seeding more validations later
-- can't silently diverge from updateHighQuality.
UPDATE sidewalk_teaneck.user_stat
SET high_quality = (meters_audited = 0 OR COALESCE(labels_per_meter, 5) > 0.0375)
                   AND (COALESCE(accuracy, 1.0) > 0.6 OR own_labels_validated < 50)
WHERE user_stat.user_id LIKE '00000000-5115-%';

-- One row per non-deleted region, zeroes included -- and, like the recompute, a street counts only when it is
-- auditable AND carries a priority row, which is also what decides whether it counts as audited.
INSERT INTO sidewalk_teaneck.region_completion (region_id, total_distance, audited_distance)
SELECT region.region_id, COALESCE(distances.total, 0), COALESCE(distances.audited, 0)
FROM sidewalk_teaneck.region
LEFT JOIN (
  SELECT street_edge_region.region_id,
         SUM(ST_Length(street_edge.geom::geography)) AS total,
         SUM(CASE WHEN street_edge_priority.priority < 1.0
                  THEN ST_Length(street_edge.geom::geography) ELSE 0 END) AS audited
  FROM sidewalk_teaneck.street_edge_region
  INNER JOIN sidewalk_teaneck.street_edge USING (street_edge_id)
  INNER JOIN sidewalk_teaneck.street_edge_priority USING (street_edge_id)
  WHERE street_edge.status = 'open'
    AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM sidewalk_teaneck.config)
  GROUP BY street_edge_region.region_id
) AS distances ON distances.region_id = region.region_id
WHERE region.deleted = FALSE
ON CONFLICT (region_id) DO NOTHING;

-- Teaneck's own map parameters. The committed template ships someone else's centre and bounding box, which puts
-- every map hundreds of miles from the only labels there are, so anything reading the centre to decide what to show
-- sees nothing until the two agree. The tutorial street id is deliberately NOT taken from prod -- the tutorial here
-- is the template's own, whose panorama tiles are local assets.
UPDATE sidewalk_teaneck.config
SET city_center_lat = {tn['config']['city_center_lat']}, city_center_lng = {tn['config']['city_center_lng']},
    southwest_boundary_lat = {tn['config']['southwest_boundary_lat']},
    southwest_boundary_lng = {tn['config']['southwest_boundary_lng']},
    northeast_boundary_lat = {tn['config']['northeast_boundary_lat']},
    northeast_boundary_lng = {tn['config']['northeast_boundary_lng']},
    default_map_zoom = {tn['config']['default_map_zoom']}
WHERE city_center_lat <> {tn['config']['city_center_lat']};

-- Tag 86 is real data every city but Zurich hides (evolution 298), and the only tag whose name contains a comma --
-- which is the whole point of the Gallery filter case that reads one back out of a URL. Un-hiding it beats
-- inventing a tag that doesn't exist.
UPDATE sidewalk_teaneck.config
SET excluded_tags = (
  SELECT COALESCE(JSONB_AGG(elem), '[]'::jsonb)
  FROM JSONB_ARRAY_ELEMENTS(excluded_tags) AS elem
  WHERE elem <> '{{"label_type": "Signal", "tag": "yellow box, accessibility features not visible"}}'::jsonb
);
""")

OUTPUT.write_text('\n'.join(out))
print(f'wrote {OUTPUT.relative_to(REPO_ROOT)} ({len(ordered)} labels, {len(kept) + 2} panoramas)')
