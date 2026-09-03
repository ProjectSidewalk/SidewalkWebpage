# Google Cloud and Google Maps Platform

How Project Sidewalk uses Google Cloud, what it costs, and how to read usage when a bill looks wrong. The
identifying details (which Google identity owns what, billing-account ids, the referrer lists) are deliberately
not here; they live in the private Planning repo. This page is the *mechanism*.

## What we use Google for

Everything is Google Maps Platform. Three GCP projects, one per environment, so that a runaway in one place
never hides inside another's numbers:

| Project (console name) | Serves | Key restrictions |
|---|---|---|
| **Project Sidewalk** | Every production and `-test` stage on `cs.washington.edu` | One browser key, referrer-restricted to the stage hostnames — a new city's hostname must be added or its map and panos fail to load. Maps JS API + Street View Static API only. |
| **Project Sidewalk Dev Env** | `localhost:9000` development (`GOOGLE_MAPS_API_KEY` in `docker-compose.override.yml`) | Referrer-restricted to localhost. |
| **Project Sidewalk CI Env** | Nothing, by design: the browser suite stubs Google Maps (#5129), so no CI job carries a real key — `GOOGLE_MAPS_API_KEY` is a dummy string in every job. | The project still holds one browser key, restricted to localhost referrers and capped at **zero map loads per day**, kept only as a break-glass way to re-run the suite against the real API when the stub is suspected of having drifted from it. Created 2026-08-03 with phase 2 of #4504, when the suite carried a real key. |

`GOOGLE_MAPS_SECRET` (URL signing for the Street View Static and metadata calls the *server* makes) is a separate
credential from the same project as the key it signs for.

### Which calls cost money

Google bills per SKU with a monthly free cap per SKU, then a per-1,000 rate (prices as of 2026-09; check
[Google's pricing page](https://developers.google.com/maps/billing-and-pricing/pricing) before relying on them):

| SKU | Fired by | Free / month | Then |
|---|---|---|---|
| **Dynamic Street View** | Instantiating a `google.maps.StreetViewPanorama` — `GsvViewer.initialize()`, i.e. every Explore, Validate, mobile-Validate, Gallery card, LabelMap popup and admin pano. **The tutorial's custom, locally tiled panos count too**; the SKU is per panorama object, not per tile. | 5,000 | $14 |
| **Dynamic Maps** | Instantiating a `google.maps.Map` — Explore's minimap (`Minimap.js`). Every other map in the app is Mapbox. | 10,000 | $7 |
| **Street View Static** | The server-side `PanoDataService.getImageUrl` crops behind share images, story cards, and the admin/user-profile label previews. | 10,000 | $7 |
| **Street View Metadata** | `PanoDataService` / `ImageryFreshnessService` polling; the frontend's `StreetViewService.getPanorama` | unlimited | free |

Loading the Maps JS API script itself is not a SKU. Dynamic Street View is the one that matters: it is the most
expensive SKU we touch and it fires on the pages people spend all their time on.

## Reading usage without the console

Nobody on the team gets dollar figures from an API: the billing account has no BigQuery export, and the Cloud
Billing API only lists projects. Two things *are* queryable per project with the owning identity logged in
(`gcloud auth login`), and they were enough to reconstruct August 2026 to the day:

```bash
# Requests per API method and per key, one point per day. resource.labels.credential_id tells keys apart.
TOK=$(gcloud auth print-access-token)
curl -s -G "https://monitoring.googleapis.com/v3/projects/$PROJECT/timeSeries" -H "Authorization: Bearer $TOK" \
  --data-urlencode 'filter=metric.type="serviceruntime.googleapis.com/api/request_count" AND resource.type="consumed_api"' \
  --data-urlencode "interval.startTime=2026-08-01T00:00:00Z" --data-urlencode "interval.endTime=2026-09-01T00:00:00Z" \
  --data-urlencode "aggregation.alignmentPeriod=86400s" --data-urlencode "aggregation.perSeriesAligner=ALIGN_SUM" \
  --data-urlencode "aggregation.crossSeriesReducer=REDUCE_SUM" \
  --data-urlencode "aggregation.groupByFields=resource.labels.service" \
  --data-urlencode "aggregation.groupByFields=resource.labels.method" \
  --data-urlencode "aggregation.groupByFields=resource.labels.credential_id" | jq '.timeSeries[] | {r: .resource.labels, n: [.points[].value.int64Value]}'

# Google's own "billable" counter for the Maps JS API (the quota the console's Quotas page charts).
#   metric.labels.quota_metric = "maps-backend.googleapis.com/billable_default"
#   metric.type = "serviceruntime.googleapis.com/quota/rate/net_usage", resource.type = "consumer_quota"
```

Drop the alignment period to `600s` to see individual bursts — that is how the CI key's traffic was matched,
bucket by bucket, to `e2e-smoke` job windows. The SKU-level *quantity* (how many Dynamic Street View loads Google
actually charged) is only in the console: Billing → Reports → table view → group by Project › Service › SKU and
enable the **Usage** column. Do that first when a bill is surprising; the metrics above then explain *where* the
usage came from.

Method names worth knowing: `google.maps.BaseMap.Javascript` on `maps-backend` is the Maps JS API (the bootstrap
plus one request per `importLibrary` module — an Explore load makes ~13); `google.maps.StreetView.Http` is the
Street View Static API; `google.maps.StreetViewMetadata.Http` is the free metadata endpoint.

## CI's Google usage

None, since #5129 — but the month before that (August 2026), when the `e2e-smoke` job carried a real key so
`/explore` could initialize, the CI project cost more than production. Two things billed, and neither was
"fetching imagery":

- **`/explore`'s tutorial** instantiates a `StreetViewPanorama` even though its tiles are local assets and the
  pano id does not exist at Google. One Dynamic Street View event plus one Dynamic Maps event per load — measured,
  not inferred.
- **The label-detail popup builds its pano viewer at page load** (`LabelPopup` → `LabelDetail` →
  `PopupPanoManager.create`; Gallery's `ExpandedView` likewise), so every load of `/labelMap`, `/gallery`,
  `/dashboard`, `/stories`, the public profile, or an admin page is a billable panorama whether or not a label is
  ever opened. The smoke suite loads those pages ~18 times a run, which is where most of the CI usage came from;
  #5128 makes that lazy.

The rule, therefore: **CI never instantiates a Google map or panorama, and never fetches a Google image.** Two
layers enforce it, and neither is a quota. In the suite, `test/e2e/fixtures.js` routes the Maps JS API bootstrap to
a local fake (`test/e2e/fixtures/google-maps-stub.js`) on every context, serves a transparent pixel for Street View
Static images, and through the `googleMapsLeaks` auto-fixture both aborts-and-reports any other request to a Google
map host and checks that the `google.maps` each page ended up with is the stub's — so a page that builds a real map
or panorama, or loads the API from somewhere the host list doesn't name, cannot merge. Outside the suite, no CI job
has a key to bill with: `GOOGLE_MAPS_API_KEY` is the literal `DUMMY_GOOGLE_API_KEY` in `ci.yml`, and the CI
project's own break-glass key is capped at zero map loads per day. A leak would therefore fail on an invalid key,
or be refused by the quota if it somehow found the real one — but the fixture is what turns either into a named
test failure rather than a console error to puzzle over.

Budget alerts are the second line. The account-wide budget was a leftover of Google's retired $200 monthly credit,
$200 with alerts at 75/95/100%, so a $100 month never tripped it and August was discovered on the invoice. Size
budgets to a small multiple of the *normal* monthly bill, one per project so a runaway is attributable.

## Also billed here

Gemini (`GEMINI_API_KEY`, `generativelanguage.googleapis.com`) is enabled in the production project for the
Chandigarh stages; its usage in 2026 has been a few hundred calls a month, mostly rejected. Google Analytics
reporting for the admin traffic panel uses a service account in the Dev Env project and is free.
