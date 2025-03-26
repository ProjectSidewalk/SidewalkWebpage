package models.attribute
//
import com.google.inject.ImplementedBy
import controllers.{APIBBox, APIType, StreamingAPIType}
import formats.json.APIFormats
import models.label.{LocationXY, POV}
import play.api.libs.json.JsObject

import controllers.APIType.APIType
import models.label._
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.GSVDataService
import slick.jdbc.GetResult
import slick.sql.SqlStreamingAction

import java.time.{OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}
import scala.language.postfixOps

case class GlobalAttribute(globalAttributeId: Int, globalClusteringSessionId: Int, clusteringThreshold: Float,
                           labelTypeId: Int, streetEdgeId: Int, regionId: Int, lat: Float, lng: Float,
                           severity: Option[Int], temporary: Boolean)

case class GlobalAttributeForAPI(globalAttributeId: Int, labelType: String, lat: Float, lng: Float,
                                 severity: Option[Int], temporary: Boolean, agreeCount: Int, disagreeCount: Int,
                                 unsureCount: Int, streetEdgeId: Int, osmStreetId: Long, neighborhoodName: String,
                                 avgImageCaptureDate: OffsetDateTime, avgLabelDate: OffsetDateTime, imageCount: Int,
                                 labelCount: Int, usersList: List[String]) extends StreamingAPIType {
  def toJSON: JsObject = APIFormats.globalAttributeToJSON(this)
  def toCSVRow: String = APIFormats.globalAttributeToCSVRow(this)
}
object GlobalAttributeForAPI {
  val csvHeader: String = {
    "Attribute ID,Label Type,Street ID,OSM Street ID,Neighborhood Name,Attribute Latitude,Attribute Longitude," +
      "Avg Image Capture Date,Avg Label Date,Severity,Temporary,Agree Count,Disagree Count,Unsure Count,Cluster Size," +
      "User IDs\n"
  }
}

case class GlobalAttributeWithLabelForAPI(globalAttributeId: Int, labelType: String, attributeLatLng: (Float, Float),
                                          attributeSeverity: Option[Int], attributeTemporary: Boolean,
                                          streetEdgeId: Int, osmStreetId: Long, neighborhoodName: String, labelId: Int,
                                          labelLatLng: (Float, Float), gsvPanoramaId: String, pov: POV,
                                          canvasXY: LocationXY, agreeDisagreeUnsureCount: (Int, Int, Int),
                                          labelSeverity: Option[Int], labelTemporary: Boolean,
                                          imageLabelDates: (String, OffsetDateTime), labelTags: List[String],
                                          labelDescription: Option[String], userId: String) extends StreamingAPIType {
  val gsvUrl = s"""https://maps.googleapis.com/maps/api/streetview?
                  |size=${LabelPointTable.canvasWidth}x${LabelPointTable.canvasHeight}
                  |&pano=${gsvPanoramaId}
                  |&heading=${pov.heading}
                  |&pitch=${pov.pitch}
                  |&fov=${GSVDataService.getFov(pov.zoom)}
                  |&key=YOUR_API_KEY
                  |&signature=YOUR_SIGNATURE""".stripMargin.replaceAll("\n", "")
  def toJSON: JsObject = APIFormats.globalAttributeWithLabelToJSON(this)
  def toCSVRow: String = APIFormats.globalAttributeWithLabelToCSVRow(this)
}
object GlobalAttributeWithLabelForAPI {
  val csvHeader: String = {
    "Attribute ID,Label Type,Attribute Severity,Attribute Temporary,Street ID,OSM Street ID,Neighborhood Name," +
      "Label ID,Panorama ID,Attribute Latitude,Attribute Longitude,Label Latitude,Label Longitude,Heading,Pitch,Zoom," +
      "Canvas X,Canvas Y,Canvas Width,Canvas Height,GSV URL,Image Capture Date,Label Date,Label Severity," +
      "Label Temporary,Agree Count,Disagree Count,Unsure Count,Label Tags,Label Description,User ID\n"
  }
}

class GlobalAttributeTableDef(tag: slick.lifted.Tag) extends Table[GlobalAttribute](tag, "global_attribute") {
  def globalAttributeId: Rep[Int] = column[Int]("global_attribute_id", O.PrimaryKey, O.AutoInc)
  def globalClusteringSessionId: Rep[Int] = column[Int]("global_clustering_session_id")
  def clusteringThreshold: Rep[Float] = column[Float]("clustering_threshold")
  def labelTypeId: Rep[Int] = column[Int]("label_type_id")
  def streetEdgeId: Rep[Int] = column[Int]("street_edge_id")
  def regionId: Rep[Int] = column[Int]("region_id")
  def lat: Rep[Float] = column[Float]("lat")
  def lng: Rep[Float] = column[Float]("lng")
  def severity: Rep[Option[Int]] = column[Option[Int]]("severity")
  def temporary: Rep[Boolean] = column[Boolean]("temporary")

  def * = (globalAttributeId, globalClusteringSessionId, clusteringThreshold, labelTypeId, streetEdgeId, regionId,
    lat, lng, severity, temporary) <> ((GlobalAttribute.apply _).tupled, GlobalAttribute.unapply)

//  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
//    foreignKey("global_attribute_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTableDef])(_.labelTypeId)
//
//  def region: ForeignKeyQuery[RegionTable, Region] =
//    foreignKey("global_attribute_region_id_fkey", regionId, TableQuery[RegionTableDef])(_.regionId)
//
//  def globalClusteringSession: ForeignKeyQuery[GlobalClusteringSessionTable, GlobalClusteringSession] =
//    foreignKey("global_attribute_global_clustering_session_id_fkey", globalClusteringSessionId, TableQuery[GlobalClusteringSessionTableDef])(_.globalClusteringSessionId)
}

@ImplementedBy(classOf[GlobalAttributeTable])
trait GlobalAttributeTableRepository {
  def insert(newSess: GlobalAttribute): DBIO[Int]
}

@Singleton
class GlobalAttributeTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends GlobalAttributeTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val globalAttributes: TableQuery[GlobalAttributeTableDef] = TableQuery[GlobalAttributeTableDef]

  implicit val GlobalAttributeForAPIConverter = GetResult[GlobalAttributeForAPI](r =>
    GlobalAttributeForAPI(
      r.nextInt, r.nextString, r.nextFloat, r.nextFloat, r.nextIntOption, r.nextBoolean, r.nextInt, r.nextInt,
      r.nextInt, r.nextInt, r.nextLong, r.nextString,
      OffsetDateTime.ofInstant(r.nextTimestamp.toInstant, ZoneOffset.UTC),
      OffsetDateTime.ofInstant(r.nextTimestamp.toInstant, ZoneOffset.UTC), r.nextInt, r.nextInt,
      r.nextString.split(",").toList.distinct
    )
  )

  implicit val GlobalAttributeWithLabelForAPIConverter = GetResult[GlobalAttributeWithLabelForAPI](r =>
    GlobalAttributeWithLabelForAPI(
      r.nextInt, r.nextString, (r.nextFloat, r.nextFloat), r.nextIntOption, r.nextBoolean, r.nextInt, r.nextLong,
      r.nextString, r.nextInt, (r.nextFloat, r.nextFloat), r.nextString, POV(r.nextDouble, r.nextDouble, r.nextInt),
      LocationXY(r.nextInt, r.nextInt), (r.nextInt, r.nextInt, r.nextInt), r.nextIntOption, r.nextBoolean,
      (r.nextString, OffsetDateTime.ofInstant(r.nextTimestamp.toInstant, ZoneOffset.UTC)),
      r.nextStringOption.map(tags => tags.split(",").toList).getOrElse(List()), r.nextStringOption(), r.nextString
    )
  )

//  def getAllGlobalAttributes: List[GlobalAttribute] = {
//    globalAttributes.list
//  }

  def toInt(s: Option[String]): Option[Int] = {
    try {
      Some(s.getOrElse("-1").toInt)
    } catch {
      case e: Exception => None
    }
  }

  /**
   * Gets global attributes within a bounding box for the public API.
   */
  def getAttributesInBoundingBox(apiType: APIType, bbox: APIBBox, severity: Option[String]): SqlStreamingAction[Vector[GlobalAttributeForAPI], GlobalAttributeForAPI, Effect] = {
    val locationFilter: String = if (apiType == APIType.Neighborhood) {
      s"ST_Within(region.geom, ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326))"
    } else if (apiType == APIType.Street) {
      s"ST_Intersects(street_edge.geom, ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326))"
    } else {
      s"global_attribute.lat > ${bbox.minLat} AND global_attribute.lat < ${bbox.maxLat} AND global_attribute.lng > ${bbox.minLng} AND global_attribute.lng < ${bbox.maxLng}"
    }

    // Sum the validations counts, average date, and the number of the labels that make up each global attribute.
    val validationCounts =
      """SELECT global_attribute.global_attribute_id AS global_attribute_id,
        |       SUM(label.agree_count) AS agree_count,
        |       SUM(label.disagree_count) AS disagree_count,
        |       SUM(label.unsure_count) AS unsure_count,
        |       TO_TIMESTAMP(AVG(extract(epoch from label.time_created))) AS avg_label_date,
        |       COUNT(label.label_id) AS label_count
        |FROM global_attribute
        |INNER JOIN global_attribute_user_attribute ON global_attribute.global_attribute_id = global_attribute_user_attribute.global_attribute_id
        |INNER JOIN user_attribute_label ON global_attribute_user_attribute.user_attribute_id = user_attribute_label.user_attribute_id
        |INNER JOIN label ON user_attribute_label.label_id = label.label_id
        |GROUP BY global_attribute.global_attribute_id""".stripMargin
    // Select the average image date and number of images for each attribute. Subquery selects the dates of all images
    // of interest and a list of user_ids associated with the attribute, once per attribute. The users_list might have
    // duplicate id's, but we fix this in the `GlobalAttributeForAPIConverter`.
    val imageCaptureDatesAndUserIds =
      """SELECT capture_dates.global_attribute_id AS global_attribute_id,
        |       TO_TIMESTAMP(AVG(EXTRACT(epoch from capture_dates.capture_date))) AS avg_capture_date,
        |       COUNT(capture_dates.capture_date) AS image_count,
        |       string_agg(capture_dates.users_list, ',') AS users_list
        |FROM (
        |    SELECT global_attribute.global_attribute_id,
        |           TO_TIMESTAMP(AVG(EXTRACT(epoch from CAST(gsv_data.capture_date || '-01' AS DATE)))) AS capture_date,
        |           array_to_string(array_agg(DISTINCT label.user_id), ',') AS users_list
        |    FROM global_attribute
        |    INNER JOIN global_attribute_user_attribute ON global_attribute.global_attribute_id = global_attribute_user_attribute.global_attribute_id
        |    INNER JOIN user_attribute_label ON global_attribute_user_attribute.user_attribute_id = user_attribute_label.user_attribute_id
        |    INNER JOIN label ON user_attribute_label.label_id = label.label_id
        |    INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
        |    GROUP BY global_attribute.global_attribute_id, gsv_data.gsv_panorama_id
        |) capture_dates
        |GROUP BY capture_dates.global_attribute_id""".stripMargin

    sql"""
      SELECT global_attribute.global_attribute_id,
             label_type.label_type,
             global_attribute.lat,
             global_attribute.lng,
             global_attribute.severity,
             global_attribute.temporary,
             validation_counts.agree_count,
             validation_counts.disagree_count,
             validation_counts.unsure_count,
             global_attribute.street_edge_id,
             osm_way_street_edge.osm_way_id,
             region.name,
             image_capture_dates.avg_capture_date,
             validation_counts.avg_label_date,
             validation_counts.label_count,
             image_capture_dates.image_count,
             image_capture_dates.users_list
      FROM global_attribute
      INNER JOIN label_type ON global_attribute.label_type_id = label_type.label_type_id
      INNER JOIN street_edge ON global_attribute.street_edge_id = street_edge.street_edge_id
      INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
      INNER JOIN region ON street_edge_region.region_id = region.region_id
      INNER JOIN osm_way_street_edge ON global_attribute.street_edge_id = osm_way_street_edge.street_edge_id
      INNER JOIN (#$validationCounts) validation_counts ON global_attribute.global_attribute_id = validation_counts.global_attribute_id
      INNER JOIN (#$imageCaptureDatesAndUserIds) image_capture_dates ON global_attribute.global_attribute_id = image_capture_dates.global_attribute_id
      WHERE label_type.label_type <> 'Problem'
          AND #$locationFilter
          AND (
              global_attribute.severity IS NULL
                  AND #${severity.getOrElse("") == "none"}
                  OR #${severity.isEmpty}
                  OR global_attribute.severity = #${toInt(severity).getOrElse(-1)}
              );
    """.as[GlobalAttributeForAPI]
  }

  /**
    * Gets global attributes within a bounding box with the labels that make up those attributes for the public API.
    */
  def getGlobalAttributesWithLabelsInBoundingBox(bbox: APIBBox, severity: Option[String]): SqlStreamingAction[Vector[GlobalAttributeWithLabelForAPI], GlobalAttributeWithLabelForAPI, Effect] = {
    sql"""
      SELECT global_attribute.global_attribute_id,
             label_type.label_type,
             global_attribute.lat,
             global_attribute.lng,
             global_attribute.severity,
             global_attribute.temporary,
             global_attribute.street_edge_id,
             osm_way_street_edge.osm_way_id,
             region.name,
             label.label_id,
             label_point.lat,
             label_point.lng,
             label.gsv_panorama_id,
             label_point.heading,
             label_point.pitch,
             label_point.zoom,
             label_point.canvas_x,
             label_point.canvas_y,
             label.agree_count,
             label.disagree_count,
             label.unsure_count,
             label.severity,
             label.temporary,
             gsv_data.capture_date,
             label.time_created,
             array_to_string(label.tags, ','),
             label.description,
             label.user_id
      FROM global_attribute
      INNER JOIN label_type ON global_attribute.label_type_id = label_type.label_type_id
      INNER JOIN region ON global_attribute.region_id = region.region_id
      INNER JOIN global_attribute_user_attribute ON global_attribute.global_attribute_id = global_attribute_user_attribute.global_attribute_id
      INNER JOIN user_attribute_label ON global_attribute_user_attribute.user_attribute_id = user_attribute_label.user_attribute_id
      INNER JOIN label ON user_attribute_label.label_id = label.label_id
      INNER JOIN label_point ON label.label_id = label_point.label_id
      INNER JOIN osm_way_street_edge ON global_attribute.street_edge_id = osm_way_street_edge.street_edge_id
      INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
      WHERE label_type.label_type <> 'Problem'
          AND global_attribute.lat > #${bbox.minLat}
          AND global_attribute.lat < #${bbox.maxLat}
          AND global_attribute.lng > #${bbox.minLng}
          AND global_attribute.lng < #${bbox.maxLng}
          AND (global_attribute.severity IS NULL
               AND #${severity.getOrElse("") == "none"}
               OR #${severity.isEmpty}
               OR global_attribute.severity = #${toInt(severity).getOrElse(-1)}
              )
      ORDER BY user_attribute_label_id;""".as[GlobalAttributeWithLabelForAPI]
  }

//  def countGlobalAttributes: Int = {
//    globalAttributes.size.run
//  }

  def insert(newSess: GlobalAttribute): DBIO[Int] = {
      (globalAttributes returning globalAttributes.map(_.globalAttributeId)) += newSess
  }

  def saveMultiple(attributes: Seq[GlobalAttribute]): DBIO[Seq[Int]] = {
    (globalAttributes returning globalAttributes.map(_.globalAttributeId)) ++= attributes
  }
}
