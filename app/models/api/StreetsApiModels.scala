/**
 * Models for the Project Sidewalk Streets API.
 * 
 * This file contains the data structures used for API requests, responses,
 * and error handling related to Project Sidewalk streets.
 */

package models.api

import java.time.OffsetDateTime
import play.api.libs.json.{Json, OFormat, Writes, JsObject, JsValue}
import models.computation.StreamingApiType
import models.utils.LatLngBBox
import org.locationtech.jts.geom.LineString

/**
 * Represents a street segment with associated metadata for the Streets API.
 * Implements StreamingApiType to support streaming output formats like GeoJSON and CSV.
 *
 * @param streetEdgeId Project Sidewalk's street segment identifier
 * @param osmStreetId OpenStreetMap street identifier
 * @param regionId Region ID where the street is located
 * @param regionName Name of the region where the street is located
 * @param wayType Type of way (e.g., "residential", "primary", etc.)
 * @param userIds List of user IDs who have applied labels to this street
 * @param labelCount Number of labels applied to this street
 * @param auditCount Number of times this street has been audited
 * @param firstLabelDate Timestamp of the first label applied to this street (if any)
 * @param lastLabelDate Timestamp of the most recent label applied to this street (if any)
 * @param geometry The LineString geometry representing the street segment
 */
case class StreetDataForApi(
  streetEdgeId: Int,
  osmStreetId: Long,
  regionId: Int,
  regionName: String,
  wayType: String,
  userIds: Seq[String],
  labelCount: Int,
  auditCount: Int,
  firstLabelDate: Option[OffsetDateTime] = None,
  lastLabelDate: Option[OffsetDateTime] = None,
  geometry: LineString
) extends StreamingApiType {

  /**
   * Converts this StreetData object to a GeoJSON Feature object.
   * The GeoJSON structure follows RFC 7946 and includes:
   * - A LineString geometry
   * - Properties containing all street metadata
   *
   * @return A JsObject containing the GeoJSON Feature representation
   */
  override def toJSON: JsObject = {
    // Convert LineString to GeoJSON coordinates array
    // We need to extract the coordinates as an array of [lng, lat] pairs
    val coordinates = (0 until geometry.getNumPoints).map { i =>
      val point = geometry.getPointN(i)
      Json.arr(point.getX, point.getY)
    }

    // Format dates in ISO-8601 format if present
    val firstLabelDateStr = firstLabelDate.map(_.toString)
    val lastLabelDateStr = lastLabelDate.map(_.toString)

    Json.obj(
      "type" -> "Feature",
      "geometry" -> Json.obj(
        "type" -> "LineString",
        "coordinates" -> Json.toJson(coordinates)
      ),
      "properties" -> Json.obj(
        "street_edge_id" -> streetEdgeId,
        "osm_street_id" -> osmStreetId,
        "region_id" -> regionId,
        "region_name" -> regionName,
        "way_type" -> wayType,
        "user_ids" -> userIds,
        "label_count" -> labelCount,
        "audit_count" -> auditCount,
        "user_count" -> userIds.size,
        "first_label_date" -> firstLabelDateStr,
        "last_label_date" -> lastLabelDateStr
      )
    )
  }

  /**
   * Converts this StreetData object to a CSV row string.
   * The fields are ordered to match the header defined in the companion object.
   * Complex fields like arrays are serialized as JSON strings.
   *
   * @return A comma-separated string representing this street's data
   */
  override def toCSVRow: String = {
    // Helper to safely quote CSV fields containing commas, quotes, or newlines
    def escapeCsv(field: String): String = {
      val needsQuotes = field.contains(",") || field.contains("\"") || field.contains("\n")
      val escapedField = field.replace("\"", "\"\"")
      if (needsQuotes) s""""$escapedField"""" else escapedField
    }

    // Helper to safely handle null user IDs and escape them for JSON
    def escapeUserIdForJson(id: String): String = {
      if (id == null) {
        "null"
      } else {
        s"""\"${id.replace("\"", "\"\"")}\""""
      }
    }

    val fields = Seq(
      streetEdgeId.toString,
      osmStreetId.toString,
      regionId.toString,
      escapeCsv(regionName),
      escapeCsv(wayType),
      s""""[${userIds.map(escapeUserIdForJson).mkString(",")}]"""",
      labelCount.toString,
      auditCount.toString,
      userIds.size.toString,
      firstLabelDate.map(_.toString).getOrElse(""),
      lastLabelDate.map(_.toString).getOrElse(""),
      // We're skipping the actual geometry in the CSV as it's too complex
      // Instead we provide the first and last points as a simplified representation
      s"${geometry.getStartPoint.getX},${geometry.getStartPoint.getY}",
      s"${geometry.getEndPoint.getX},${geometry.getEndPoint.getY}"
    )
    fields.mkString(",")
  }
}

/**
 * Companion object for StreetDataForApi containing CSV header definition
 */
object StreetDataForApi {
  /**
   * CSV header string with field names in the same order as the toCSVRow output.
   * This should be included as the first line when generating CSV output.
   */
  val csvHeader: String = "street_edge_id,osm_street_id,region_id,region_name,way_type," +
    "user_ids,label_count,audit_count,user_count,first_label_date,last_label_date,start_point,end_point"
    
  /**
   * Implicit JSON writer for StreetDataForApi that uses the toJSON method.
   */
  implicit val streetDataWrites: Writes[StreetDataForApi] = (street: StreetDataForApi) => street.toJSON
}

/**
 * Represents filter criteria for the Streets API (v3).
 *
 * @param bbox Optional bounding box to filter streets by geographic location
 * @param regionId Optional region ID to filter streets by geographic region
 * @param regionName Optional region name to filter streets by geographic region
 * @param minLabelCount Optional minimum number of labels on the street
 * @param minAuditCount Optional minimum number of audits for the street
 * @param minUserCount Optional minimum number of users who audited the street
 * @param wayTypes Optional list of way types to include (e.g., "residential", "primary")
 */
case class StreetFiltersForApi(
  bbox: Option[LatLngBBox] = None,
  regionId: Option[Int] = None,
  regionName: Option[String] = None,
  minLabelCount: Option[Int] = None,
  minAuditCount: Option[Int] = None,
  minUserCount: Option[Int] = None,
  wayTypes: Option[Seq[String]] = None
)

/**
 * Represents complete information about a street type for API responses.
 *
 * @param name The string identifier for the way type (e.g., "residential", "primary")
 * @param description Human-readable description of this street type
 * @param count Number of streets of this type in the database
 */
case class StreetTypeForApi(
  name: String,
  description: String,
  count: Int
)

/**
 * Companion object for StreetTypeForApi containing JSON formatter
 */
object StreetTypeForApi {
  implicit val format: OFormat[StreetTypeForApi] = Json.format[StreetTypeForApi]
}