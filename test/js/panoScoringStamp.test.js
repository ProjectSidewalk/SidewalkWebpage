/**
 * Tests for the browser half of the shared pano-ranking contract (#4411).
 *
 * `conf/pano-scoring.json` is read three ways: `models.utils.PanoScoring` parses it and `main.scala.html` stamps it
 * onto `<html data-pano-scoring>`, `MapillaryViewer.#scorePano` and `PanoramaxViewer.#scorePano` read it back through
 * `util.pano.scoring()`, and `score_pano` in `scripts/check_streets_for_imagery.py` reads the file off disk. The two
 * viewers must rank a location's candidates the way the scan does, or a street records the capture date of a pano
 * Explore never shows — the failure the shared file exists to prevent.
 *
 * The Scala side is pinned by `PanoScoringSpec` (the file parses, the stamp carries every key) and the Python side by
 * `test_pano_scoring_config_matches_the_values_the_viewers_document`. What neither covers is the reader in between:
 * a renamed attribute, a reshaped file, or a provider dropped from `providers` leaves `undefined` weights in the
 * browser and every score `NaN`, which loses every `>` comparison in `#selectBestPano` and reads as "no imagery here"
 * rather than as an error. These assert the same numbers the other two suites do, through the stamp.
 */

const fs = require('fs');
const path = require('path');
const { loadGlobalScript } = require('./loadGlobalScript');

const CONFIG_PATH = path.resolve(__dirname, '..', '..', 'conf/pano-scoring.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// What main.scala.html stamps: the parsed params, minus the file's own `_`-prefixed documentation.
const stamped = Object.fromEntries(Object.entries(config).filter(([key]) => !key.startsWith('_')));
document.documentElement.dataset.panoScoring = JSON.stringify(stamped);

loadGlobalScript('public/js/common/pano-viewer/src/panoUtilities.js');

const scoring = window.util.pano.scoring;

describe('util.pano.scoring', () => {
    it('reads the shared weights back off the layout stamp', () => {
        const mapillary = scoring('mapillary');
        expect(mapillary.distanceWeight).toBe(0.45);
        expect(mapillary.resolutionWeight).toBe(0.25);
        expect(mapillary.recencyWeight).toBe(0.25);
        expect(mapillary.sequenceWeight).toBe(0.05);
        expect(mapillary.distanceDecayMeters).toBe(10);
        expect(mapillary.recencyDecayYears).toBe(5);
    });

    it('weights the four terms so a score lands in [0, 1]', () => {
        const { distanceWeight, resolutionWeight, recencyWeight, sequenceWeight } = scoring('mapillary');
        expect(distanceWeight + resolutionWeight + recencyWeight + sequenceWeight).toBeCloseTo(1, 9);
    });

    it('merges each provider\'s own parameters over the shared ones', () => {
        // The one term the two providers don't share: their camera fleets cap at different widths.
        expect(scoring('mapillary').maxImageWidthPx).toBe(16384);
        expect(scoring('panoramax').maxImageWidthPx).toBe(12288);
        expect(scoring('panoramax').distanceWeight).toBe(scoring('mapillary').distanceWeight);
    });

    it('gives every provider that ranks its own candidates a defined resolution cap', () => {
        // An undefined cap makes every resolutionScore NaN, which #selectBestPano reads as "no viable pano".
        for (const provider of ['mapillary', 'panoramax']) {
            expect(Number.isFinite(scoring(provider).maxImageWidthPx)).toBe(true);
        }
    });

    it('gives Panoramax the undated-picture age its recency term falls back to', () => {
        // Panoramax datetimes are ISO strings that can fail to parse; Mapillary's captured_at is epoch ms and the
        // Python port drops an unparseable one instead, so only Panoramax needs this.
        expect(scoring('panoramax').unknownDateAgeYears).toBe(3);
    });
});
