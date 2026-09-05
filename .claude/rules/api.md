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
- **DTOs live in `app/models/api/*ApiModels.scala`** (`package models.api`), never in a `*Table.scala`. Response
  types are `*ForApi`, parsed filters `*FiltersForApi`. Response DTOs extend `StreamingApiType` and implement
  `toJson` / `toCsvRow` inline on the case class; the companion holds `csvHeader` next to `toCsvRow` and the JSON
  writers, derived with a scoped `JsonConfiguration(JsonNaming.SnakeCase)`.
- **No API serialization in a controller or in `app/formats/json/*Formats.scala`** (those serve internal endpoints
  only). Reuse `ApiModelUtils` (`escapeCsvField`, `createGeoJsonPointGeometry`, `toSnakeKey`, …).
- v3 is a preview surface: breaking changes are made in place, not by minting a new version.
- A change to an endpoint's output covers every format it serves (JSON, CSV, GeoJSON, Shapefile, GeoPackage), its
  `/api-docs` page and preview, and the specs in `test/controllers/api/`.
