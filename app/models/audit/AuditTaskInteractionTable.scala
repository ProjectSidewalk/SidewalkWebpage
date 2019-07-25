package models.audit

import java.util.UUID

import models.label._
import models.mission.{Mission, MissionTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}
import play.extras.geojson

import scala.slick.jdbc.{GetResult, StaticQuery => Q}
import scala.slick.lifted.ForeignKeyQuery

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
  def auditTaskId = column[Int]("audit_task_id", O.NotNull)
  def missionId = column[Int]("mission_id", O.NotNull)
  def action = column[String]("action", O.NotNull)
  def gsvPanoramaId = column[Option[String]]("gsv_panorama_id", O.Nullable)
  def lat = column[Option[Float]]("lat", O.Nullable)
  def lng = column[Option[Float]]("lng", O.Nullable)
  def heading = column[Option[Float]]("heading", O.Nullable)
  def pitch = column[Option[Float]]("pitch", O.Nullable)
  def zoom = column[Option[Int]]("zoom", O.Nullable)
  def note = column[Option[String]]("note", O.Nullable)
  def temporaryLabelId = column[Option[Int]]("temporary_label_id", O.Nullable)
  def timestamp = column[java.sql.Timestamp]("timestamp", O.NotNull)

  def * = (auditTaskInteractionId, auditTaskId, missionId, action, gsvPanoramaId, lat, lng, heading, pitch, zoom, note,
    temporaryLabelId, timestamp) <> ((AuditTaskInteraction.apply _).tupled, AuditTaskInteraction.unapply)

  def mission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("audit_task_interaction_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)
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


  val db = play.api.db.slick.DB
  val auditTasks = TableQuery[AuditTaskTable]
  val auditTaskInteractions = TableQuery[AuditTaskInteractionTable]
  val labels = TableQuery[LabelTable]
  val labelPoints = TableQuery[LabelPointTable]



  def save(interaction: AuditTaskInteraction): Int = db.withTransaction { implicit session =>
    val interactionId: Int =
      (auditTaskInteractions returning auditTaskInteractions.map(_.auditTaskInteractionId)).insert(interaction)
    interactionId
  }

  def saveMultiple(interactions: Seq[AuditTaskInteraction]): Seq[Int] = db.withTransaction { implicit session =>
    (auditTaskInteractions returning auditTaskInteractions.map(_.auditTaskInteractionId)) ++= interactions
  }

  /**
    * Select all audit task interaction records of the specified action
    * @param actionType
    * @return
    */
  def selectAuditTaskInteractionsOfAnActionType(actionType: String): List[AuditTaskInteraction] = db.withTransaction { implicit session =>
    auditTaskInteractions.filter(_.action === actionType).list
  }

  /**
    * Select all the audit task interactions of the specified user
    * @param userId User id
    * @return
    */
  def selectAuditTaskInteractionsOfAUser(userId: UUID): List[AuditTaskInteraction] = db.withSession { implicit session =>
    val _auditTaskInteractions = for {
      (_auditTasks, _auditTaskInteractions) <- auditTasks.innerJoin(auditTaskInteractions).on(_.auditTaskId === _.auditTaskId)
      if _auditTasks.userId === userId.toString
    } yield _auditTaskInteractions
    _auditTaskInteractions.list
  }

  /**
    * Get a list of audit task interactions with corresponding labels.
    * It would be faster to do this with a raw sql query. Update if too slow.
    *
    * @param auditTaskId
    * @return
    */
  def selectAuditInteractionsWithLabels(auditTaskId: Int): List[InteractionWithLabel] = db.withSession { implicit session =>
    val selectInteractionWithLabelQuery = Q.query[Int, InteractionWithLabel](
      """SELECT interaction.audit_task_interaction_id,
        |       interaction.audit_task_id,
        |       interaction.mission_id,
        |       interaction.action,
        |       interaction.gsv_panorama_id,
        |       interaction.lat,
        |       interaction.lng,
        |       interaction.heading,
        |       interaction.pitch,
        |       interaction.zoom,
        |       interaction.note,
        |       interaction.timestamp,
        |       label_type.label_type,
        |       label_point.lat AS label_lat,
        |       label_point.lng AS label_lng,
        |       label_point.canvas_x AS canvas_x,
        |       label_point.canvas_y AS canvas_y,
        |       label_point.canvas_width AS canvas_width,
        |       label_point.canvas_height AS canvas_height
        |FROM sidewalk.audit_task_interaction AS interaction
        |LEFT JOIN sidewalk.label ON interaction.temporary_label_id = label.temporary_label_id
        |                         AND interaction.audit_task_id = label.audit_task_id
        |LEFT JOIN sidewalk.label_type ON label.label_type_id = label_type.label_type_id
        |LEFT JOIN sidewalk.label_point ON label.label_id = label_point.label_id
        |WHERE interaction.audit_task_id = ?
        |ORDER BY interaction.timestamp""".stripMargin
    )
    val interactions: List[InteractionWithLabel] = selectInteractionWithLabelQuery(auditTaskId).list
    interactions
  }


  // Helper methods

  /**
    * This method takes an output of the method `selectAuditInteractionsWithLabels` and
    * returns a GeoJSON feature collection
    * @param interactions
    */
  def auditTaskInteractionsToGeoJSON(interactions: List[InteractionWithLabel]): JsObject = {
    val features: List[JsObject] = interactions.filter(_.lat.isDefined).sortBy(_.timestamp.getTime).map { interaction =>
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
