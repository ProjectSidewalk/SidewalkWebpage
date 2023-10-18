package models.audit

import models.mission.{Mission, MissionTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}
import play.extras.geojson
import java.sql.Timestamp
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
                                note: Option[String], timestamp: java.sql.Timestamp, labelId: Option[Int],
                                labelType: Option[String], labelLat: Option[Float], labelLng: Option[Float],
                                canvasX: Int, canvasY: Int)


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
  def temporaryLabelId = column[Option[Int]]("temporary_label_id", O.NotNull)
  def timestamp = column[java.sql.Timestamp]("timestamp", O.NotNull)

  def * = (auditTaskInteractionId, auditTaskId, missionId, action, gsvPanoramaId, lat, lng, heading, pitch, zoom, note,
    temporaryLabelId, timestamp) <> ((AuditTaskInteraction.apply _).tupled, AuditTaskInteraction.unapply)

  def mission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("audit_task_interaction_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)
}

/**
 * Data access object for the audit_task_interaction table.
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
      r.nextIntOption, // label_id
      r.nextStringOption, // label_type
      r.nextFloatOption, // label_lat
      r.nextFloatOption, // label_lng
      r.nextInt, // canvas_x
      r.nextInt // canvas_y
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
  val auditTaskInteractions = TableQuery[AuditTaskInteractionTable]

  /**
    * Inserts a sequence of interactions into the audit_task_interaction table.
    */
  def saveMultiple(interactions: Seq[AuditTaskInteraction]): Seq[Int] = db.withTransaction { implicit session =>
    (auditTaskInteractions returning auditTaskInteractions.map(_.auditTaskInteractionId)) ++= interactions
  }

  /**
    * Get a list of audit task interactions with corresponding labels.
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
        |       label.label_id,
        |       label_type.label_type,
        |       label_point.lat AS label_lat,
        |       label_point.lng AS label_lng,
        |       label_point.canvas_x AS canvas_x,
        |       label_point.canvas_y AS canvas_y
        |FROM audit_task_interaction AS interaction
        |LEFT JOIN label ON interaction.temporary_label_id = label.temporary_label_id
        |                         AND interaction.audit_task_id = label.audit_task_id
        |LEFT JOIN label_type ON label.label_type_id = label_type.label_type_id
        |LEFT JOIN label_point ON label.label_id = label_point.label_id
        |WHERE interaction.audit_task_id = ?
        |    AND interaction.action NOT IN (
        |        'LowLevelEvent_mousemove', 'LowLevelEvent_mouseover', 'LowLevelEvent_mouseout', 'LowLevelEvent_click',
        |        'LowLevelEvent_mouseup', 'LowLevelEvent_mousedown', 'ViewControl_MouseDown', 'ViewControl_MouseUp',
        |        'RefreshTracker', 'ModeSwitch_Walk', 'LowLevelEvent_keydown', 'LabelingCanvas_MouseOut'
        |    )
        |ORDER BY interaction.timestamp""".stripMargin
    )
    val interactions: List[InteractionWithLabel] = selectInteractionWithLabelQuery(auditTaskId).list
    interactions
  }

  /**
    * This method takes an output of the method `selectAuditInteractionsWithLabels` and returns GeoJSON.
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
          "action" -> interaction.action,
          "note" -> interaction.note,
          "label" -> Json.obj(
            "label_id" -> interaction.labelId,
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

  /**
   * Calculate combined time spent auditing and validating for the given user using interaction logs.
   *
   * To do this, we take the important events from the audit_task_interaction and validation_task_interaction tables,
   * get the difference between each consecutive timestamp, filter out the timestamp diffs that are greater than five
   * minutes, and then sum those time diffs.
   */
  def getHoursAuditingAndValidating(userId: String): Float = db.withSession { implicit session =>
    Q.queryNA[Float](
      s"""SELECT CAST(extract( second from SUM(diff) ) / 60 +
         |            extract( minute from SUM(diff) ) +
         |            extract( hour from SUM(diff) ) * 60 AS decimal(10,2)) / 60.0 AS hours_volunteered
         |FROM (
         |    SELECT (timestamp - LAG(timestamp, 1) OVER(PARTITION BY user_id ORDER BY timestamp)) AS diff
         |    FROM (
         |        SELECT user_id, end_timestamp AS timestamp
         |        FROM label_validation
         |        WHERE end_timestamp IS NOT NULL
         |            AND user_id = '$userId'
         |        UNION
         |        SELECT user_id, timestamp
         |        FROM audit_task_interaction
         |        INNER JOIN audit_task ON audit_task.audit_task_id = audit_task_interaction.audit_task_id
         |        WHERE action IN ('ViewControl_MouseDown', 'LabelingCanvas_MouseDown')
         |            AND audit_task.user_id = '$userId'
         |        UNION
         |        SELECT user_id, timestamp
         |        FROM webpage_activity
         |        WHERE user_id = '$userId'
         |            AND (
         |                activity LIKE 'Visit_Labeling_Guide%'
         |                OR activity = 'Visit_ServiceHourInstructions'
         |                OR activity = 'Visit_TimeCheck'
         |                OR activity = 'Visit_UserDashboard'
         |                OR activity = 'Visit_Help'
         |            )
         |    )"timestamps"
         |) "time_diffs"
         |WHERE diff < '00:05:00.000' AND diff > '00:00:00.000';""".stripMargin
    ).first
  }

  /**
   * Calculate the time spent auditing by the given user for a specified time range, starting at a label creation time.
   *
   * To do this, we take the important events from the audit_task_interaction table, get the difference between each
   * consecutive timestamp, filter out the timestamp diffs that are greater than five minutes, and then sum those time
   * diffs.
   *
   * @param userId
   * @param timeRangeStartLabelId Label_id for the label whose `time_created` field marks the start of the time range.
   * @param timeRangeEnd A timestamp representing the end of the time range; should be the time when a label was placed.
   * @return
   */
  def secondsAudited(userId: String, timeRangeStartLabelId: Int, timeRangeEnd: Timestamp): Float = db.withSession { implicit session =>
    Q.queryNA[Float](
      s"""SELECT extract( epoch FROM SUM(diff) ) AS seconds_contributed
         |FROM (
         |    SELECT (timestamp - LAG(timestamp, 1) OVER(PARTITION BY user_id ORDER BY timestamp)) AS diff
         |    FROM audit_task_interaction
         |    INNER JOIN audit_task ON audit_task.audit_task_id = audit_task_interaction.audit_task_id
         |    WHERE action IN ('ViewControl_MouseDown', 'LabelingCanvas_MouseDown')
         |        AND audit_task.user_id = '$userId'
         |        AND audit_task_interaction.timestamp < '$timeRangeEnd'
         |        AND audit_task_interaction.timestamp > (
         |            SELECT COALESCE(MAX(time_created), TIMESTAMP 'epoch')
         |            FROM label
         |            INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
         |            WHERE audit_task.user_id = '$userId'
         |                AND label.label_id < $timeRangeStartLabelId
         |    )
         |) "time_diffs"
         |WHERE diff < '00:05:00.000' AND diff > '00:00:00.000';""".stripMargin
    ).first
  }

}
