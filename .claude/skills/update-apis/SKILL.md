---
name: update-apis
description: Makes updates to any of our /v3/api/ routes.
---

Read `docs/architecture.md` → "The public API (`/v3`)" first: it holds the naming contract (camelCase parameters,
snake_case output everywhere except Shapefile), the DTO layout in `app/models/api/`, and the `StreamingApiType`
serialization shape. `.claude/rules/api.md` is the short version.

The set of updates that are likely to be involved:
1. Updating the database queries to incorporate the new/updated data (in the `app/models/` files). The DTO
   definitions themselves belong in `app/models/api/*ApiModels.scala`, not in the `*Table.scala` that produces them.
2. Making sure the API is updated for every output file type it serves (JSON, CSV, GeoJSON, Shapefile, GeoPackage),
   with the serialization on the DTO (`toJson` / `toCsvRow`, `csvHeader` in the companion).
3. Updating the relevant documentation in the `app/views/apiDocs/` files and the matching `public/js/api-docs/*Preview.js`.
4. Updating or adding the functional spec in `test/controllers/api/`.

A few things to keep in mind:
* Combine common code where it makes sense to do so; reuse `ApiModelUtils` rather than re-rolling CSV/GeoJSON logic.
* Run the queries both before and after your updates to check for any regressions.
* v3 is a preview surface: breaking changes are made in place rather than minting a new version.
