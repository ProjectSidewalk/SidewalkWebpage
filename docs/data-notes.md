# Data notes for analysis

Caveats and gotchas to keep in mind when **analyzing Project Sidewalk data** — historical conditions in specific
releases that affect how certain columns should be interpreted. If you're working with a database dump or the public
[data API](https://projectsidewalk.org/api), check whether any of these apply to the time range you're analyzing.

This is an **append-only log**: when a release changes data semantics or fixes a data bug with lasting analytical
impact, add a dated, version-tagged entry here (newest first) so future analysts aren't caught out.

## Data caveats by release

### Washington, DC re-launch (#4700) — the 2015–2021 pilot data migrated into a normal city schema

DC's original deployment (2015-10-17 → 2021-04-08) ran on a mid-2018 fork of the schema and was frozen. It has been
migrated by replaying the evolutions it missed with a curated patch overlay (`db/dc-migration/`), so it now lives in
`sidewalk_dc` like any city and the hardcoded legacy-DC constants that the aggregate stats used to add on top are
gone. Analysts should know:

- **Missions are reconstructed.** DC's app had per-region cumulative-distance milestones, not modern missions. Its
  `mission` rows were rebuilt from the `MissionComplete` interaction events, the legacy `mission_user` rows (timed by
  replaying distance where no event exists) and, for work before Sept 2016 when nothing logged completions, a
  replay of the milestone ladders. Work after a user's last milestone in a region is one completed mission. Turker
  pay per mission is what the legacy app paid for that milestone.
- **The shared `anonymous` account was split** into one anonymous user per IP address that audited; visit-only
  page views stay on the shared account.
- **Streets keep the 2015 network** and belong to one neighborhood each (largest-overlap pick; DC never split
  streets at boundaries). The original 192-neighborhood set was dropped in favor of the 179 shown since 2016.
- **Label positions are the original client values.** The 179.sql coordinate fix never applied on DC (all pano
  dimensions were NULL); 3,773 positions from the legacy depth code were unusable and are NULL pending a recompute.
  37 labels with an empty pano id were deleted, as 298.sql did elsewhere.
- **Naive timestamps** (`label.time_created`, survey submissions) were US/Eastern before 2018-08-25 and UTC after.
- The public aggregate stats now count DC live: users 823 registered + the split anonymous accounts rather than the
  old fixed 1,395; distance 2,089 km of network rather than the 5,482 km "explored" (which counted repeat audits).

### v7.8.5 — `audit_task.task_start` corrected

Before v7.8.5, the `task_start` column in `audit_task` was incorrectly set to the **session** start time rather than
that individual task's start time. It's correct going forward. Existing rows were back-filled to a close
approximation using the timestamp of the `TaskStart` event in `audit_task_interaction` — but only ~90% of
`audit_task` rows have a corresponding `TaskStart` event, so the remaining ~10% are still approximate. The same fix
was applied to the DC database (which is no longer collecting new data).

### v7.5.0 (May 2022) — gallery interaction tables gained `user_id`

Before v7.5.0, the `gallery_task_interaction` and `gallery_task_environment` tables had **no `user_id` column**, so
rows from before then can't be tied to a specific user. Added in
[#2895](https://github.com/ProjectSidewalk/SidewalkWebpage/pull/2895).

Separately, a small number of labels have a `temporary_label_id` that doesn't match any such ID in the
`audit_task_interaction` logs — most do match. Background in
[#2154 (comment)](https://github.com/ProjectSidewalk/SidewalkWebpage/pull/2154#issuecomment-1128257211).

### v2 — anonymous users and `audit_task.completed`

Up to the v2 release, records for **anonymous users weren't marked as `complete`**, so the `completed` column of
`audit_task` is unreliable for anonymous contributions from that era. Discussion in
[#403](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/403).

## Gallery screenshot tips

Console snippets for staging clean label screenshots in the Gallery's expanded card view:

```js
// Hide the label icon/marker in the expanded view.
sg.cardContainer.getModal().pano.labelMarker.marker.setVisible(false);

// Inspect the marker's current heading/pitch, then reposition it.
sg.cardContainer.getModal().pano.labelMarker.marker.getPosition();           // current { heading, pitch }
sg.cardContainer.getModal().pano.labelMarker.marker.setPosition({ heading: newH, pitch: newP });
```
