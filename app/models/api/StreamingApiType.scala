package models.api

import play.api.libs.json.JsValue

/**
 * Common interface for public-API data structures (DTOs) that are streamed to clients.
 *
 * Every type returned by a `/v3` API endpoint implements this so `BaseApiController`'s output helpers
 * (`outputJSON`, `outputCSV`, `outputGeoJSON`, ...) can serialize a heterogeneous stream uniformly. By
 * convention each implementer defines these inline and pairs them with a companion `csvHeader` so the
 * header and row columns stay in sync.
 */
trait StreamingApiType {

  /** Serializes this record to JSON (a GeoJSON `Feature` for geospatial types, a plain object otherwise). */
  def toJson: JsValue

  /** Serializes this record to a single CSV row matching the companion object's `csvHeader`. */
  def toCsvRow: String
}
