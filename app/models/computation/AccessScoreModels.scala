package models.computation

import models.street.StreetEdge
import formats.json.ApiFormats._
import org.locationtech.jts.geom.MultiPolygon
import play.api.libs.json.{JsObject, JsValue}

import java.time.OffsetDateTime
import scala.collection.mutable

/**
 * Holds label counting information for a street
 */
case class StreetLabelCounter(
    streetEdgeId: Int,
    var nLabels: Int,
    var nImages: Int,
    var labelAgeSum: Long,
    var imageAgeSum: Long,
    labelCounter: mutable.Map[String, Int]
)

/**
 * Trait for streaming API types that can be converted to JSON and CSV
 */
trait StreamingApiType {
  def toJSON: JsValue
  def toCSVRow: String
}

/**
 * Access score information for a street
 */
case class StreetScore(
    streetEdge: StreetEdge,
    osmId: Long,
    regionId: Int,
    score: Double,
    auditCount: Int,
    attributes: Array[Int],
    significance: Array[Double],
    avgImageCaptureDate: Option[OffsetDateTime],
    avgLabelDate: Option[OffsetDateTime],
    imageCount: Int,
    labelCount: Int
) extends StreamingApiType {
  def toJSON: JsObject = streetScoreToJSON(this)
  def toCSVRow: String = streetScoreToCSVRow(this)
}

/**
 * Companion object for AccessScoreStreet
 */
object StreetScore {
  val csvHeader: String =
    "Street ID,OSM ID,Neighborhood ID,Access Score,Coordinates,Audit Count,Avg Curb Ramp Score," +
      "Avg No Curb Ramp Score,Avg Obstacle Score,Avg Surface Problem Score,Curb Ramp Significance," +
      "No Curb Ramp Significance,Obstacle Significance,Surface Problem Significance,Avg Image Capture Date," +
      "Avg Label Date\n"
}

/**
 * Access score information for a neighborhood
 */
case class RegionScore(
    name: String,
    geom: MultiPolygon,
    regionId: Int,
    coverage: Double,
    score: Double,
    attributeScores: Array[Double],
    significanceScores: Array[Double],
    avgImageCaptureDate: Option[OffsetDateTime],
    avgLabelDate: Option[OffsetDateTime]
) extends StreamingApiType {
  def toJSON: JsObject = regionScoreToJson(this)
  def toCSVRow: String = regionScoreToCSVRow(this)
}

/**
 * Companion object for AccessScoreNeighborhood
 */
object RegionScore {
  val csvHeader: String =
    "Neighborhood Name,Neighborhood ID,Access Score,Coordinates,Coverage,Avg Curb Ramp Count," +
      "Avg No Curb Ramp Count,Avg Obstacle Count,Avg Surface Problem Count,Curb Ramp Significance," +
      "No Curb Ramp Significance,Obstacle Significance,Surface Problem Significance,Avg Image Capture Date," +
      "Avg Label Date\n"
}
