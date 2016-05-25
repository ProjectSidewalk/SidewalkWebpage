package formats.json

import play.api.libs.json.{JsPath, Reads}
import scala.collection.immutable.Seq
import play.api.libs.functional.syntax._

/**
 * A set of case classes and Reads that defines the API receiving JSON
 */
object SidewalkFormats {
  case class LineStringGeometry(geometryType: String, coordinates: Seq[Seq[Float]])
  case class LineStringProperties(sidewalkEdgeId: Option[Int], source: Option[Int], target: Option[Int], parentSidewalkEdgeId: Option[Int], wayType: String)
  case class Feature(featureType: String, geometry: LineStringGeometry, properties: LineStringProperties)
  case class FeatureCollection(featureType: String, features: Seq[Feature])

  implicit val lineStringGeometryReads: Reads[LineStringGeometry] = (
    (JsPath \ "type").read[String] and
      (JsPath \ "coordinates").read[Seq[Seq[Float]]]
    )(LineStringGeometry.apply _)

  implicit val lineStringPropertiesReads: Reads[LineStringProperties] = (
    (JsPath \ "sidewalk_edge_id").read[Option[Int]] and
      (JsPath \ "source").read[Option[Int]] and
      (JsPath \ "target").read[Option[Int]] and
      (JsPath \ "parent_sidewalk_edge_id").read[Option[Int]] and
      (JsPath \ "way_type").read[String]
    )(LineStringProperties.apply _)

  implicit val featureReads: Reads[Feature] = (
    (JsPath \ "type").read[String] and
      (JsPath \ "geometry").read[LineStringGeometry] and
      (JsPath \ "properties").read[LineStringProperties]
    )(Feature.apply _)

  implicit val featureCollectionReads: Reads[FeatureCollection] = (
    (JsPath \ "type").read[String] and
      (JsPath \ "features").read[Seq[Feature]]
    )(FeatureCollection.apply _)
}
