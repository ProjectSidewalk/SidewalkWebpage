---
applyTo: "app/**/*.scala, conf/routes, test/**/*.scala"
---
# Backend / v3 API review

- **v3 API casing (`/v3/api/...`):** query/REST **parameters are camelCase**
  (`minSeverity`, `regionId`); **all output field names are snake_case** — JSON
  bodies, GeoJSON `properties`, CSV headers, GeoPackage fields (`label_id`,
  `region_name`). Flag a snake_case query param or a camelCase output field. Use a
  scoped `JsonConfiguration(JsonNaming.SnakeCase)` for macro writers. EXCEPTION:
  Shapefile/DBF fields stay camelCase + abbreviated (DBF truncates names to 10 chars).
- **API DTO home:** new response/filter DTOs go in `app/models/api/`
  (`package models.api`), named `*ForApi` / `*FiltersForApi`, extending
  `StreamingApiType` with inline `toJson`/`toCsvRow` and `csvHeader` in the
  companion. Flag new API DTOs defined inside a `*Table.scala` file.
- **Layering:** controllers stay thin — business logic in `app/service/`, DB access
  in `app/models/*Table.scala`. Flag a controller querying tables directly.
- **SQL:** no table aliases in Slick/plain SQL.
- **ScalaDoc:** `/** */` on every class/trait/object and non-trivial method
  (including private). Use `@return` (not `@returns`); don't repeat the type in
  `@param`. Flag comments that narrate a change rather than state current behavior.
- **`-Xfatal-warnings` is on:** flag unused imports/params, dead code, and discarded
  non-Unit results — they fail the build.
