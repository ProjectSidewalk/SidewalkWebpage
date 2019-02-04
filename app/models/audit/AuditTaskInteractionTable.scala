package models.audit

import java.util.UUID

import models.label._
import models.mission.{Mission, MissionTable}
import models.utils.MyPostgresDriver.api._
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}
import play.extras.geojson

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

import slick.jdbc.GetResult

case class AuditTaskInteraction(auditTaskInteractionId: Int,
                                auditTaskId: Int,
                                missionId: Int,
                                action: String,
                                gsvPanoramaId: Option[String],
                                lat: Option[Float],
                                lng: Option[Float],
                                heading: Option[Float],
                                pitch: Option[Float],
                                zoom: Option[Int],
                                note: Option[String],
                                temporaryLabelId: Option[Int],
                                timestamp: java.sql.Timestamp)

case class InteractionWithLabel(auditTaskInteractionId: Int, auditTaskId: Int, missionId: Int, action: String,
                                gsvPanoramaId: Option[String], lat: Option[Float], lng: Option[Float],
                                heading: Option[Float], pitch: Option[Float], zoom: Option[Int],
                                note: Option[String], timestamp: java.sql.Timestamp,
                                labelType: Option[String], labelLat: Option[Float], labelLng: Option[Float],
                                canvasX: Int, canvasY: Int, canvasWidth: Int, canvasHeight: Int)


class AuditTaskInteractionTable(tag: slick.lifted.Tag) extends Table[AuditTaskInteraction](tag, Some("sidewalk"), "audit_task_interaction") {
  def auditTaskInteractionId = column[Int]("audit_task_interaction_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId = column[Int]("audit_task_id")
  def missionId = column[Int]("mission_id")
  def action = column[String]("action")
  def gsvPanoramaId = column[Option[String]]("gsv_panorama_id")
  def lat = column[Option[Float]]("lat")
  def lng = column[Option[Float]]("lng")
  def heading = column[Option[Float]]("heading")
  def pitch = column[Option[Float]]("pitch")
  def zoom = column[Option[Int]]("zoom")
  def note = column[Option[String]]("note")
  def temporaryLabelId = column[Option[Int]]("temporary_label_id")
  def timestamp = column[java.sql.Timestamp]("timestamp")

  def * = (auditTaskInteractionId, auditTaskId, missionId, action, gsvPanoramaId, lat, lng, heading, pitch, zoom, note,
    temporaryLabelId, timestamp) <> ((AuditTaskInteraction.apply _).tupled, AuditTaskInteraction.unapply)

  def mission = foreignKey("audit_task_interaction_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)
}

/**
 * Data access object for the audit_task_environment table
 */
object AuditTaskInteractionTable {
  implicit val interactionWithLabelConverter = GetResult[InteractionWithLabel](r => {
    InteractionWithLabel(
      r.nextInt, // audit_task_interaction_id
      r.nextInt, // audit_task_id
      r.nextInt, // mission_id
      r.nextString, // action
      r.nextStringOption, // gsv_panorama_id
      r.nextFloatOption, // lat
      r.nextFloatOption, // lng
      r.nextFloatOption, // heading
      r.nextFloatOption, // pitch
      r.nextIntOption, // zoom
      r.nextStringOption, // note
      r.nextTimestamp, // timestamp
      r.nextStringOption, // label_type
      r.nextFloatOption, // label_lat
      r.nextFloatOption, // label_lng
      r.nextInt, // canvas_x
      r.nextInt, // canvas_y
      r.nextInt, // canvas_width
      r.nextInt // canvas_height
    )
  })

  implicit val auditTaskInteraction = GetResult[AuditTaskInteraction](r => {
    AuditTaskInteraction(
      r.nextInt, // audit_task_interaction_id
      r.nextInt, // audit_task_id
      r.nextInt, // mission_id
      r.nextString, // action
      r.nextStringOption, // gsv_panorama_id
      r.nextFloatOption, // lat
      r.nextFloatOption, // lng
      r.nextFloatOption, // heading
      r.nextFloatOption, // pitch
      r.nextIntOption, // zoom
      r.nextStringOption, // note
      r.nextIntOption, // temporary_label_id
      r.nextTimestamp // timestamp
    )
  })

  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db

  val auditTasks = TableQuery[AuditTaskTable]
  val auditTaskInteractions = TableQuery[AuditTaskInteractionTable]
  val labels = TableQuery[LabelTable]
  val labelPoints = TableQuery[LabelPointTable]


  def save(interaction: AuditTaskInteraction): Future[Int] = db.run {
    (auditTaskInteractions returning auditTaskInteractions.map(_.auditTaskInteractionId)) += interaction
  }

  /**
    * Select all audit task interaction records of the specified action
    * @param actionType
    * @return
    */
  def selectAuditTaskInteractionsOfAnActionType(actionType: String): Future[Seq[AuditTaskInteraction]] = db.run {
    auditTaskInteractions.filter(_.action === actionType).result
  }

  /**
    * Select all the audit task interactions of the specified user
    * @param userId User id
    * @return
    */
  def selectAuditTaskInteractionsOfAUser(userId: UUID): Future[Seq[AuditTaskInteraction]] = db.run {
    auditTasks.filter(_.userId === userId.toString)
      .join(auditTaskInteractions).on(_.auditTaskId === _.auditTaskId)
      .map(_._2).result
  }

  def selectAuditTaskInteractionsOfAUser(regionId: Int, userId: UUID): Future[Seq[AuditTaskInteraction]] = db.run {
    sql"""SELECT audit_task_interaction.audit_task_interaction_id,
                 audit_task_interaction.audit_task_id,
                 audit_task_interaction.mission_id,
                 audit_task_interaction.action,
                 audit_task_interaction.gsv_panorama_id,
                 audit_task_interaction.lat,
                 audit_task_interaction.lng,
                 audit_task_interaction.heading,
                 audit_task_interaction.pitch,
                 audit_task_interaction.zoom,
                 audit_task_interaction.note,
                 audit_task_interaction.temporary_label_id,
                 audit_task_interaction.timestamp
         FROM "sidewalk"."audit_task"
         INNER JOIN "sidewalk"."street_edge"
             ON street_edge.street_edge_id = audit_task.street_edge_id
         INNER JOIN "sidewalk"."region"
             ON region.region_id = ${regionId}
             AND ST_Intersects(region.geom, street_edge.geom)
         INNER JOIN "sidewalk"."audit_task_interaction"
             ON audit_task_interaction.audit_task_id = audit_task.audit_task_id
         WHERE "audit_task".user_id = ${userId.toString}
             AND (
                 audit_task_interaction.action = 'MissionComplete'
                 OR (
                     audit_task_interaction.action = 'LabelingCanvas_FinishLabeling'
                     AND audit_task.completed = TRUE
                 )
             )
         ORDER BY audit_task_interaction.audit_task_interaction_id""".as[AuditTaskInteraction]
  }

  /**
    * Get a list of audit task interactions with corresponding labels.
    * It would be faster to do this with a raw sql query. Update if too slow.
    *
    * @param auditTaskId
    * @return
    */
  def selectAuditInteractionsWithLabels(auditTaskId: Int): Future[Seq[InteractionWithLabel]] = db.run {
    sql"""SELECT interaction.audit_task_interaction_id,
                 interaction.audit_task_id,
                 interaction.mission_id,
                 interaction.action,
                 interaction.gsv_panorama_id,
                 interaction.lat,
                 interaction.lng,
                 interaction.heading,
                 interaction.pitch,
                 interaction.zoom,
                 interaction.note,
                 interaction.timestamp,
                 label_type.label_type,
                 label_point.lat AS label_lat,
                 label_point.lng AS label_lng,
                 label_point.canvas_x AS canvas_x,
                 label_point.canvas_y AS canvas_y,
                 label_point.canvas_width AS canvas_width,
                 label_point.canvas_height AS canvas_height
         FROM sidewalk.audit_task_interaction AS interaction
         LEFT JOIN sidewalk.label ON interaction.temporary_label_id = label.temporary_label_id
                                  AND interaction.audit_task_id = label.audit_task_id
         LEFT JOIN sidewalk.label_type ON label.label_type_id = label_type.label_type_id
         LEFT JOIN sidewalk.label_point ON label.label_id = label_point.label_id
         WHERE interaction.audit_task_id =#${auditTaskId}
         ORDER BY interaction.timestamp""".as[InteractionWithLabel]
  }


  // Helper methods

  /**
    * This method takes an output of the method `selectAuditInteractionsWithLabels` and
    * returns a GeoJSON feature collection
    * @param interactions
    */
  def auditTaskInteractionsToGeoJSON(interactions: Seq[InteractionWithLabel]): JsObject = {
    val features: Seq[JsObject] = interactions.filter(_.lat.isDefined).sortBy(_.timestamp.getTime).map { interaction =>
      val point = geojson.Point(geojson.LatLng(interaction.lat.get.toDouble, interaction.lng.get.toDouble))
      val properties = if (interaction.labelType.isEmpty) {
        Json.obj(
          "panoId" -> interaction.gsvPanoramaId,
          "heading" -> interaction.heading.get.toDouble,
          "pitch" -> interaction.pitch,
          "zoom" -> interaction.zoom,
          "timestamp" -> interaction.timestamp.getTime,
          "canvasHeight" -> interaction.canvasHeight,
          "canvasWidth" -> interaction.canvasWidth,
          "action" -> interaction.action,
          "note" -> interaction.note
        )
      } else {
        Json.obj(
          "panoId" -> interaction.gsvPanoramaId,
          "heading" -> interaction.heading.get.toDouble,
          "pitch" -> interaction.pitch,
          "zoom" -> interaction.zoom,
          "timestamp" -> interaction.timestamp.getTime,
          "canvasHeight" -> interaction.canvasHeight,
          "canvasWidth" -> interaction.canvasWidth,
          "action" -> interaction.action,
          "note" -> interaction.note,
          "label" -> Json.obj(
            "label_type" -> interaction.labelType,
            "coordinates" -> Seq(interaction.labelLng, interaction.labelLat),
            "canvasX" -> interaction.canvasX,
            "canvasY" -> interaction.canvasY
          )
        )
      }
      Json.obj("type" -> "Feature", "geometry" -> point, "properties" -> properties)
    }
    Json.obj("type" -> "FeatureCollection", "features" -> features)
  }
}
