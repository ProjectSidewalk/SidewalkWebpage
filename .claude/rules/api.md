---
paths:
  - "app/models/api/**"
  - "app/controllers/api/**"
  - "app/views/apiDocs/**"
  - "public/js/api-docs/**"
---

# The public `/v3` API

Full convention: `docs/architecture.md` → "The public API (`/v3`)". The parts that get missed:

- **Parameters are camelCase; every output field name is snake_case** across JSON, GeoJSON `properties`, CSV
  headers, and GeoPackage fields. Shapefile/DBF is the one exception (camelCase, abbreviated, 10-char limit).
  `ApiError.parameter` names a query param, so it stays camelCase.
- **One name per field, across every format.** A CSV column and its JSON key are the same string, never a re-cased
  or re-worded version of each other. Each companion extends `ApiFields[T]` and declares one `fields` list; the JSON
  keys, CSV header, and CSV cells all come from it, so renaming a field there renames it everywhere. Dotted names
  (`labels.CurbRamp.count`) nest in the JSON and are flat columns in the CSV. The two single-object endpoints
  (`overallStats`, `aggregateStats`) flatten their own JSON instead, via `ApiModelUtils.toCsvKeyValueRows`.
  GeoPackage is the one format still on its own names, pending #5273.
- **DTOs live in `app/models/api/*ApiModels.scala`** (`package models.api`), never in a `*Table.scala`. Response
  types are `*ForApi`, parsed filters `*FiltersForApi`. Response DTOs extend `StreamingApiType` and delegate
  `toJson` / `toCsvRow` to the companion's `ApiFields` list, which also supplies `csvHeader`.
- **No API serialization in a controller or in `app/formats/json/*Formats.scala`** (those serve internal endpoints
  only). Reuse `ApiModelUtils` (`escapeCsvField`, `createGeoJsonPointGeometry`, `toCsvKeyValueRows`, …).
- v3 is a preview surface: breaking changes are made in place, not by minting a new version.
- A change to an endpoint's output covers every format it serves (JSON, CSV, GeoJSON, Shapefile, GeoPackage), its
  `/api-docs` page and preview, and the specs in `test/controllers/api/`.
