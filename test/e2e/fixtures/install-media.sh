#!/usr/bin/env bash
#
# Copies the committed panorama backups and label crops into the media directories the app reads.
#
# WHY: every panorama ci-seed.sql names is expired, so the app never asks a provider for its imagery -- nothing
# depends on Google still serving it, or on a GOOGLE_MAPS_SECRET CI does not have (#4948). It reads these instead:
#   * panos/  -> what PanoManager renders through Pannellum when the primary viewer can't load a pano.
#   * crops/  -> the Gallery and landing grid pass useCrops=true precisely so a label with expired imagery still
#               appears if a crop exists (LabelService.findValidLabelsForType). Without these those pages are empty.
#
# HOW IT'S RUN: from the repo root, in ci.yml, after the seed. Safe to re-run.
#
# GOTCHA: media/ mirrors the runtime layout, so this is a plain recursive copy and the pano and label ids live only
# in the fixture filenames rather than being repeated here. That layout is PanoDataService.localBackupImageFile's
# and .cropFile's; the city must match cityparams.conf's teaneck-nj entry.
set -euo pipefail

CITY=teaneck-nj
FIXTURES=$(dirname "$0")/media
PANO_DIR=${SIDEWALK_PANO_DIR:-.panos}/$CITY
CROP_DIR=${SIDEWALK_IMAGES_DIR:-.crops}/$CITY

[ -d "$FIXTURES/panos" ] || { echo "error: no media/panos beside $0" >&2; exit 1; }

mkdir -p "$PANO_DIR" "$CROP_DIR"
cp -R "$FIXTURES/panos/." "$PANO_DIR/"
cp -R "$FIXTURES/crops/." "$CROP_DIR/"
echo "installed $(find "$FIXTURES/panos" -type f | wc -l) panos into $PANO_DIR"
echo "installed $(find "$FIXTURES/crops" -type f | wc -l) crops into $CROP_DIR"
