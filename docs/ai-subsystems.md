# AI subsystems in Project Sidewalk

Project Sidewalk's AI/CV work spans ~13 repositories since 2018, plus a hosted inference service and a HuggingFace org.
This page maps what is **in production**, what each repo does, and which repos are historical (written July 2026).

## The one-paragraph version

There are two different AI tasks, reflecting our finding that **validating an existing human label is much easier than
finding and labeling panoramas**:

1. **AI as a validator/tagger** (mature, ~55 cities): hosted models judge whether an existing human label is correct
   and suggest tags. Validator models are trained in `sidewalk-validator-ai`, tagger models in `sidewalk-tagger-ai`;
   `sidewalk-ai-api` serves both, and a daily actor in this repo calls it.
2. **AI as a labeler** (piloting): a detection model (RampNet) scans every GSV panorama in a city and submits
   curb-ramp labels from scratch, via `sidewalk-auto-labeler` and this repo's `/ai/submitLabelsOnPano`.

Plus a smaller third feature, **AI Guidance**: auditing tips from Google Gemini at audit-task start (Aug 2025).

## Production subsystems

### Subsystem A — AI validator / tagger

**What it does:** validates existing human labels (Agree/Disagree/Unsure) and suggests tags, for CurbRamp,
NoCurbRamp, Obstacle, SurfaceProblem, Crosswalk.

**Flow:**
1. `GetAiValidationsActor` runs nightly at the time `app/actor/ScheduledJobs.scala` gives it (staggered per city) and
   picks up to 800 labels via `LabelTable.getLabelsToValidateWithAi` (not yet assessed as their current type,
   GSV-only, prioritized). A label whose type is edited is assessed again right away
   (`AiService.reassessAfterTypeChange`, #3671), with the nightly run as the fallback.
2. `AiService.callAiApi` POSTs `{label_type, panorama_id, x, y, city, coord_frame}` to
   `https://sidewalk-ai-api.cs.washington.edu/process` with the API key as an `Authorization: Bearer` header, plus
   the pano's `camera_pitch` and `camera_roll` (degrees) when known and within ±30°; the API rejects larger ones with
   a 400, so those labels go uncorrected. `coord_frame` is `level` for human labels (clicked in the gravity-levelled
   viewer), so the API uses pitch and roll to centre its crop on the clicked point (#4784/#5788); AI-labeler
   submissions are `rig` and skip that (#5790).
3. The response (result, estimated accuracy, per-tag scores, and provenance: API version plus each model's id,
   training date and HuggingFace revision) goes in `label_ai_assessment` with the label type it was about, so a
   retyped label's assessment counts as stale (#3671). Where the city has AI validations on and estimated accuracy
   ≥ `ai-validation-min-accuracy` (0.92 everywhere today), a real `label_validation` is saved as the `SidewalkAI`
   user; below that it becomes Unsure. An HTTP 502 saves a `label_ai_failure` row, which excludes the label for good.
4. Shown in the *Humans vs AI* admin dashboard (`/admin/humans-vs-ai`) and by the AI icon
   (`frontend/js/common/aiLabelIndicator.js`) in Gallery, Validate and LabelMap. The icon's "AI can make mistakes"
   tooltip moves onto the label card on Validate's marker, since the same hover opens it (`LabelCardView`, #5359).

**Models:**
- *Validator* ([`sidewalk-validator-ai`](https://github.com/ProjectSidewalk/sidewalk-validator-ai)): DINOv2
  fine-tuned per label type as a correct/incorrect classifier, trained on user-agreement data with
  **Depth Anything V2** depth-aware crops. Published to the HF collection `project-sidewalk-validator-models`; trained
  with SLURM on Hyak.
- *Tagger* ([`sidewalk-tagger-ai`](https://github.com/ProjectSidewalk/sidewalk-tagger-ai)): DINOv2 / CLIP multi-label
  classifiers over 640×640 label-centred crops, 33 tag classes (ASSETS'24). `analyze_thresholds.py` sets each tag's
  ADD/REMOVE thresholds for the most recall at precision ≥ 0.92 (Wilson lower bound ≥ 0.90), the same 0.92 as
  `ai-validation-min-accuracy` on purpose.

**Config:** `ai-enabled`, `sidewalk-ai-api-hostname`, `sidewalk-ai-api-key` (`application.conf`; it must match the AI
server's key, so change both at the same time); `ai-tag-suggestions-enabled`, `ai-validation-enabled`,
`ai-validation-min-accuracy` (`cityparams.conf`, per city).

**Deploying the AI server:** its README's
[How production is deployed](https://github.com/ProjectSidewalk/sidewalk-ai-api#how-production-is-deployed). Merging
there deploys nothing.

**DB:** `label_ai_assessment`, `label_ai_failure`, AI user `51b0b927-3c8a-45b2-93de-bd878d1e5cf4` (role `AI`),
mission type `aiValidation` (evolutions 281/282, 321/322; model revisions since 420). `AiSeedRowsRepair` re-creates
the AI user's per-schema rows (its `user_stat` row and one `aiValidation` mission per label type) at boot wherever
they're missing, since a city cloned from a donor or restored from an onboarding dump never ran 281 (#5349).

### Subsystem B — AI-generated labels (RampNet + auto-labeler)

**What it does:** detects curb ramps in *every* GSV panorama inside a city polygon and submits them as new labels from
the `SidewalkAI` user, with no human involved until validation.

**Flow:**
1. [`sidewalk-auto-labeler`](https://github.com/ProjectSidewalk/sidewalk-auto-labeler) (`main.py`) finds every pano
   ID in a GeoJSON area, downloads each pano (via `streetlevel`), runs `projectsidewalk/rampnet-model` (heatmap →
   `peak_local_max`, threshold 0.55), and writes one JSONL record per pano; `send_to_ps.py` converts to pixel coords
   and POSTs to `/ai/submitLabelsOnPano` (`AiController.submitAiLabel`).
2. `ExploreService.submitAiLabelData` computes lat/lng and POV, creates an AI mission and audit task, inserts real
   `label` rows under the AI user, and records provenance in `label_ai_info`. The pano's `copyright` is cut to the
   contributor's bare name (`ImageryAttribution.normalizeCopyright`): the labeler sends a whole
   `© name / Mapillary (CC BY-SA 4.0)` attribution, and the server builds the rest around the name itself (#5360).
3. The labels then go through normal human validation, which is also the feedback for improving the model (roadmap:
   `sidewalk-auto-labeler/docs/design-review-2026-07.md`). A lone AI vote is one short of consensus, so the crowd queue
   keeps serving the label until a human agrees, and one the humans lean against goes to Expert Validate's triage
   queue (`docs/validation-queue.md`).

**Resubmitting a pano (#5382).** A labeler re-run re-POSTs panos it already sent, so a submission with labels gets a
**409**, and nothing is written, when the AI user already has live labels of that `label_type` on the pano. The body
carries `pano_id`, `label_type` and `existing_label_count`. With `"overwrite": true` (default `false`) those labels are
soft-deleted instead (`deleted_by` the AI user, `deleted_source = 'SidewalkAI'`; their points, AI info and
validations stay, so an admin can restore them) in the same transaction as the new inserts; with `labels: []` they're
just retired. The check is per label type, so another type's model neither trips it nor wipes them. Two simultaneous
*first* submissions of one pano could both pass; the labeler submits one at a time.

**Incomplete payloads get a 400 (#4808).** A label's lat/lng and POV come from the pano's `width`, `height`, `lat`,
`lng` and `camera_heading`, so a submission with labels that lacks any of them gets a 400 before anything is written;
they're optional when `labels: []`. A label whose nearest street has no live region is still a 500 (bad data, not a
bad request) and rolls back the whole submission.

**City gate:** `submitAiLabel` only accepts cities whose `ai-label-submission-enabled` flag in `cityparams.conf` is
`true` (default **false**), so onboarding a city to AI labeling (e.g. Bend) means setting it. Submission also needs a
valid `INTERNAL_API_KEY` on that instance, and is refused when the key is unset.

**Model** ([`RampNet`](https://github.com/ProjectSidewalk/RampNet), ICCV'25 workshop paper): ConvNeXtV2-Base with a
heatmap head, input 2048×4096, trained on ~214k panoramas auto-labeled from open-government curb-ramp data (NYC,
Portland, Bend); P=0.938 / R=0.935 on a 1k-pano hand-labeled gold set at the deployed threshold.

### Subsystem C — AI Guidance (Gemini)

**What it does:** at audit-task start, sends two GSV images of the street to Google Gemini (`gemini-2.5-flash-lite`)
and shows the user two lines of auditing tips for that street (added Aug 2025; model updated June 2026).

**Flow:** `AiGuidance.js` (Explore) → `POST /ai/analyzeScene` → `AiController.analyzeScene` → Gemini. On only where
`GEMINI_API_KEY` is set. No PS-trained models, DB tables or validation loop. This is the only subsystem that sends GSV
imagery to a third party; A and B keep it on UW-controlled machines. The images are taken from each end of the street,
facing along it: each end's pano is found with the free metadata call and must be within 25 m, or it's dropped rather
than sent to Gemini (#5464).

## AI project timeline — every AI/CV repo in the org

Chronological by repo creation. Dates are repo-created → last substantive commit.
Status: ✅ **Active** · 🗄 **Archived** (read-only on GitHub; still public and citable —
historical repos were archived in July 2026 to make the active set obvious).

| Years | Repo | What it does / why it exists | Paper | Status |
|---|---|---|---|---|
| 2017– | [`sidewalk-panorama-tools`](https://github.com/ProjectSidewalk/sidewalk-panorama-tools) | GSV panorama download + label-crop scripts (`DownloadRunner`/`CropRunner`, adapted from @kotarohara's code) feeding the training repos. Downloader still in production use; "new version in the works". | — | ✅ Active |
| 2018 | [`Sidewalk_CV`](https://github.com/ProjectSidewalk/Sidewalk_CV) | First CV experiments: classical features (SIFT/HOG) + random forests/SVMs on label crops. Pre-deep-learning exploration. | — | 🗄 Archived (2026-07) |
| 2018–20 | [`sidewalk-cv-assets19`](https://github.com/ProjectSidewalk/sidewalk-cv-assets19) | First deep-learning work: ResNet on GSV crops, multimodal (image + geo features). Tackled **both tasks** — automatic validation of crowd labels *and* automatic labeling of panoramas — establishing that validation is the far easier problem. | [ASSETS'19 (Weld et al.)](https://doi.org/10.1145/3308561.3353798) | 🗄 Archived (2026-07) |
| 2019 | [`label-intersection-proximity`](https://github.com/ProjectSidewalk/label-intersection-proximity) | Supporting tool: distance from a label to the nearest OSM intersection — used as a geo feature in the CV work. | — | 🗄 Archived (2026-07) |
| 2019 | [`sidewalk-cv-tools`](https://github.com/ProjectSidewalk/sidewalk-cv-tools) | First attempt to package CV labeling + validation as reusable functions for production use. **Python 2.7**; superseded by `sidewalk-ai-api`. | — | 🗄 Archived (2026-07) |
| 2019 | [`cv-siamese-network`](https://github.com/ProjectSidewalk/cv-siamese-network) | Experiment: Siamese networks (+ SVM baseline) for sidewalk-feature detection. Exploratory dead end. | — | 🗄 Archived (2026-07) |
| 2021– | [`label-latlng-estimation`](https://github.com/ProjectSidewalk/label-latlng-estimation) | Fits and validates the estimator that places a label's real-world lat/lng from its position in the pano. Its 2026-08 refit is what production runs: a saturating-cotangent distance blend on the label's depression angle over a single camera height, calibrated against depth truth measured on current imagery (0.42 m median on held-out modern truth). Reported under `reports/` and transcribed into `PanoDataService.LatLngEstimation`. | — | ✅ Active |
| 2021–23 | [`sidewalk-cv-2021`](https://github.com/ProjectSidewalk/sidewalk-cv-2021) | Second-generation **automatic label validation** (better crop quality, multi-size crops, cross-city training), with labeling/segmentation experiments alongside (e.g. `citysurfaces/` surface classification). Direct ancestor of `sidewalk-validator-ai`. | [ASSETS'22 (Duan et al.)](https://doi.org/10.1145/3517428.3550381) | 🗄 Archived (2026-07) |
| 2023 | [`BusStopCV`](https://github.com/ProjectSidewalk/BusStopCV) | Sibling crowd+AI project: real-time in-browser CV assistant for labeling bus-stop features (seating, shelter, signage, trash cans). | [ASSETS'23 (Kulkarni et al.)](https://doi.org/10.1145/3597638.3614481) | 🗄 Archived (2026-07) |
| 2024– | [`sidewalk-tagger-ai`](https://github.com/ProjectSidewalk/sidewalk-tagger-ai) | Trains the **tagger** models: DINOv2/CLIP multi-label classifiers, 33 tag classes over label crops; per-tag deployment thresholds at precision ≥ 0.92. | ASSETS'24 (Liu, Wu, et al.) | ✅ Active |
| 2024– | [`sidewalk-ai-api`](https://github.com/ProjectSidewalk/sidewalk-ai-api) | **The serving layer**: Dockerized GPU API (`/process`) hosting the validator + tagger models from HuggingFace; called daily by SidewalkWebpage for ~55 cities. | — | ✅ Active |
| 2025 | [`gsv-location-extraction-analysis`](https://github.com/ProjectSidewalk/gsv-location-extraction-analysis) | Completed one-off study: GSV's `fromContainerPixelToLatLng` vs. the linear regression PS deployed at the time for label lat/lng (verdict: the regression was slightly better; both are beaten by the cotangent blend `label-latlng-estimation` fit in 2026). Conclusions and a decision-record banner in its README. | — | 🗄 Archived (2026-08) |
| 2025– | [`RampNet`](https://github.com/ProjectSidewalk/RampNet) | Trains the curb-ramp **detector** + auto-generates its 214k-pano dataset from open-gov data. ⚠ Tag an ICCV-paper-state release before changing (issue #2). | [ICCV'25 wksp (O'Meara et al.)](https://arxiv.org/abs/2508.09415) | ✅ Active |
| 2025– | [`sidewalk-auto-labeler`](https://github.com/ProjectSidewalk/sidewalk-auto-labeler) | Deploys RampNet at city scale: finds every pano in a polygon, runs detection, submits AI labels to PS. | — | ✅ Active |
| 2025– | [`sidewalk-validator-ai`](https://github.com/ProjectSidewalk/sidewalk-validator-ai) | Trains the **validator** models: DINOv2 binary correct/incorrect per label type, Depth-Anything-V2 depth-aware crops, agreement-based training labels. | — | ✅ Active |
| — | [`SidewalkWebpage`](https://github.com/ProjectSidewalk/SidewalkWebpage) | Production server: AI orchestration (daily validation actor), ingestion endpoints, DB tables, Humans-vs-AI dashboard, Gemini guidance. | — | ✅ Active |

(`SidewalkWebpageMTurk`, the 2017 MTurk experiment fork, is 🗄 already archived.)

Lineage: both of today's threads trace back to **sidewalk-cv-assets19 (2019)**, which
attempted validation *and* auto-labeling with one ResNet approach (after Sidewalk_CV's 2018
classical-CV exploration):

- **Validation/tagging thread** (the easier task — production first): cv-assets19 →
  sidewalk-cv-2021 (ASSETS'22) → validator-ai + tagger-ai + ai-api (in production, ~55
  cities).
- **Labeling/detection thread** (the harder task — human-level only in 2025): cv-assets19's
  auto-labeling experiments → cv-2021's segmentation side experiments → **RampNet**
  (ICCV'25) + auto-labeler (piloting).

`sidewalk-panorama-tools` has supplied imagery to both threads throughout;
`sidewalk-cv-tools` (2019) was an early attempt to package the ResNet-era work for
production, superseded by `sidewalk-ai-api`.

## Artifact flow

```
sidewalk-validator-ai ─┐ (HF: project-sidewalk-validator-models)
sidewalk-tagger-ai ────┤ (HF: sidewalk-tagger-ai-<type>)          RampNet
                       ▼                                             │ (HF: rampnet-model)
                sidewalk-ai-api  /process                            ▼
                       ▲                                   sidewalk-auto-labeler
                       │ daily actor (≤800 labels/city)              │ /ai/submitLabelsOnPano
                       ▼                                             ▼
   SidewalkWebpage: label_ai_assessment + label_validation   SidewalkWebpage: label + label_ai_info
                       └────────── human validations close the loop ─────────┘
```

## Known gaps (July 2026)

- Each pipeline fetches GSV imagery its own way (`streetlevel`, `sidewalk-panorama-tools`,
  RampNet's bespoke scraping, the ai-api's fetch/cache). Google changed these undocumented
  endpoints in June 2026 and broke consumers independently (see
  `sidewalk-auto-labeler/docs/design-review-2026-07.md` §3) — worth consolidating on one
  maintained fetch path.
- Model provenance (`model_id`, training date) is hardcoded in the auto-labeler rather than
  read from the HF model config.
- RampNet must get a tagged ICCV'25-state release before any code changes land
  (RampNet issue #2).
