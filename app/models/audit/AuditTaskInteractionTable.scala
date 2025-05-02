package models.audit

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.TimeInterval
import service.TimeInterval.TimeInterval
import slick.jdbc.GetResult

import java.time.{OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class AuditTaskInteraction(auditTaskInteractionId: Long, auditTaskId: Int, missionId: Int, action: String,
                                gsvPanoramaId: Option[String], lat: Option[Float], lng: Option[Float],
                                heading: Option[Float], pitch: Option[Float], zoom: Option[Int], note: Option[String],
                                temporaryLabelId: Option[Int], timestamp: OffsetDateTime)

case class InteractionWithLabel(auditTaskInteractionId: Long, auditTaskId: Int, missionId: Int, action: String,
                                gsvPanoramaId: Option[String], lat: Option[Float], lng: Option[Float],
                                heading: Option[Float], pitch: Option[Float], zoom: Option[Int],
                                note: Option[String], timestamp: OffsetDateTime, labelId: Option[Int],
                                labelType: Option[String], labelLat: Option[Float], labelLng: Option[Float],
                                canvasX: Int, canvasY: Int)

case class ContributionTimeStat(time: Option[Float], stat: String, timeInterval: TimeInterval) {
  require(Seq("explore_total", "validate_total", "explore_per_100m").contains(stat.toLowerCase()))
}

class AuditTaskInteractionTableDef(tag: slick.lifted.Tag) extends Table[AuditTaskInteraction](tag, "audit_task_interaction") {
  def auditTaskInteractionId: Rep[Long] = column[Long]("audit_task_interaction_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId: Rep[Int] = column[Int]("audit_task_id")
  def missionId: Rep[Int] = column[Int]("mission_id")
  def action: Rep[String] = column[String]("action")
  def gsvPanoramaId: Rep[Option[String]] = column[Option[String]]("gsv_panorama_id")
  def lat: Rep[Option[Float]] = column[Option[Float]]("lat")
  def lng: Rep[Option[Float]] = column[Option[Float]]("lng")
  def heading: Rep[Option[Float]] = column[Option[Float]]("heading")
  def pitch: Rep[Option[Float]] = column[Option[Float]]("pitch")
  def zoom: Rep[Option[Int]] = column[Option[Int]]("zoom")
  def note: Rep[Option[String]] = column[Option[String]]("note")
  def temporaryLabelId: Rep[Option[Int]] = column[Option[Int]]("temporary_label_id")
  def timestamp: Rep[OffsetDateTime] = column[OffsetDateTime]("timestamp")

  def * = (auditTaskInteractionId, auditTaskId, missionId, action, gsvPanoramaId, lat, lng, heading, pitch, zoom, note,
    temporaryLabelId, timestamp) <> ((AuditTaskInteraction.apply _).tupled, AuditTaskInteraction.unapply)

//  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] =
//    foreignKey("audit_task_interaction_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTableDef])(_.auditTaskId)
//  def mission: ForeignKeyQuery[MissionTable, Mission] =
//    foreignKey("audit_task_interaction_mission_id_fkey", missionId, TableQuery[MissionTableDef])(_.missionId)
}

// A copy of the audit_task_interaction table that holds only a subset of the records for fast SELECT queries.
class AuditTaskInteractionSmallTableDef(tag: slick.lifted.Tag) extends Table[AuditTaskInteraction](tag, "audit_task_interaction_small") {
  def auditTaskInteractionId: Rep[Long] = column[Long]("audit_task_interaction_id", O.PrimaryKey)
  def auditTaskId: Rep[Int] = column[Int]("audit_task_id")
  def missionId: Rep[Int] = column[Int]("mission_id")
  def action: Rep[String] = column[String]("action")
  def gsvPanoramaId: Rep[Option[String]] = column[Option[String]]("gsv_panorama_id")
  def lat: Rep[Option[Float]] = column[Option[Float]]("lat")
  def lng: Rep[Option[Float]] = column[Option[Float]]("lng")
  def heading: Rep[Option[Float]] = column[Option[Float]]("heading")
  def pitch: Rep[Option[Float]] = column[Option[Float]]("pitch")
  def zoom: Rep[Option[Int]] = column[Option[Int]]("zoom")
  def note: Rep[Option[String]] = column[Option[String]]("note")
  def temporaryLabelId: Rep[Option[Int]] = column[Option[Int]]("temporary_label_id")
  def timestamp: Rep[OffsetDateTime] = column[OffsetDateTime]("timestamp")

  def * = (auditTaskInteractionId, auditTaskId, missionId, action, gsvPanoramaId, lat, lng, heading, pitch, zoom, note,
    temporaryLabelId, timestamp) <> ((AuditTaskInteraction.apply _).tupled, AuditTaskInteraction.unapply)

//  def auditTaskInteraction: ForeignKeyQuery[AuditTaskInteractionTable, AuditTaskInteraction] =
//    foreignKey("audit_task_interaction_small_audit_task_interaction_id_fkey", auditTaskInteractionId, TableQuery[AuditTaskInteractionTableDef])(_.auditTaskInteractionId)
//  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] =
//    foreignKey("audit_task_interaction_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTableDef])(_.auditTaskId)
//  def mission: ForeignKeyQuery[MissionTable, Mission] =
//    foreignKey("audit_task_interaction_mission_id_fkey", missionId, TableQuery[MissionTableDef])(_.missionId)
}

@ImplementedBy(classOf[AuditTaskInteractionTable])
trait AuditTaskInteractionTableRepository { }

@Singleton
class AuditTaskInteractionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
  extends AuditTaskInteractionTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {

  implicit val floatConverter = GetResult(r => r.nextFloat())

  implicit val interactionWithLabelConverter = GetResult[InteractionWithLabel](r => {
    InteractionWithLabel(
      r.nextLong, // audit_task_interaction_id
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
      OffsetDateTime.ofInstant(r.nextTimestamp.toInstant, ZoneOffset.UTC), // timestamp
      r.nextIntOption, // label_id
      r.nextStringOption, // label_type
      r.nextFloatOption, // label_lat
      r.nextFloatOption, // label_lng
      r.nextInt, // canvas_x
      r.nextInt // canvas_y
    )
  })

  val auditTaskInteractions = TableQuery[AuditTaskInteractionTableDef]
  val auditTaskInteractionsSmall = TableQuery[AuditTaskInteractionSmallTableDef]
  val actionSubsetForSmallTable: Seq[String] = Seq("ViewControl_MouseDown", "LabelingCanvas_MouseDown", "NextSlideButton_Click", "PreviousSlideButton_Click")

  /**
   * Inserts a sequence of interactions into the audit_task_interaction and audit_task_interaction_small tables.
   */
  def insertMultiple(interactions: Seq[AuditTaskInteraction]): DBIO[Unit] = {
    val subsetToSave: Seq[AuditTaskInteraction] = interactions.filter(action =>  actionSubsetForSmallTable.contains(action.action))
    for {
      savedActions <- (auditTaskInteractions returning auditTaskInteractions) ++= interactions
      subsetToSave = savedActions.filter(action =>  actionSubsetForSmallTable.contains(action.action))
      subsetSaved <- auditTaskInteractionsSmall ++= subsetToSave
    } yield ()
  }

  /**
   * Get a list of audit task interactions with corresponding labels.
   */
  def getAuditInteractionsWithLabels(auditTaskId: Int): DBIO[Seq[InteractionWithLabel]] = {
    sql"""
      SELECT interaction.audit_task_interaction_id,
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
             label.label_id,
             label_type.label_type,
             label_point.lat AS label_lat,
             label_point.lng AS label_lng,
             label_point.canvas_x AS canvas_x,
             label_point.canvas_y AS canvas_y
      FROM audit_task_interaction AS interaction
      LEFT JOIN label ON interaction.temporary_label_id = label.temporary_label_id
                               AND interaction.audit_task_id = label.audit_task_id
      LEFT JOIN label_type ON label.label_type_id = label_type.label_type_id
      LEFT JOIN label_point ON label.label_id = label_point.label_id
      WHERE interaction.audit_task_id = $auditTaskId
          AND interaction.action NOT IN (
              'LowLevelEvent_mousemove', 'LowLevelEvent_mouseover', 'LowLevelEvent_mouseout', 'LowLevelEvent_click',
              'LowLevelEvent_mouseup', 'LowLevelEvent_mousedown', 'ViewControl_MouseDown', 'ViewControl_MouseUp',
              'RefreshTracker', 'ModeSwitch_Walk', 'LowLevelEvent_keydown', 'LabelingCanvas_MouseOut'
          )
      ORDER BY interaction.timestamp""".as[InteractionWithLabel].map(_.toSeq)
  }

  /**
   * Calculate combined time spent auditing and validating for the given user using interaction logs.
   *
   * To do this, we take the important events from the audit_task_interaction and validation_task_interaction tables,
   * get the difference between each consecutive timestamp, filter out the timestamp diffs that are greater than five
   * minutes, and then sum those time diffs.
   */
  def getHoursAuditingAndValidating(userId: String): DBIO[Float] = {
    sql"""
      SELECT CAST(extract( second from SUM(diff) ) / 60 +
             extract( minute from SUM(diff) ) +
             extract( hour from SUM(diff) ) * 60 AS decimal(10,2)) / 60.0 AS hours_volunteered
      FROM (
      SELECT (timestamp - LAG(timestamp, 1) OVER(PARTITION BY user_id ORDER BY timestamp)) AS diff
      FROM (
          SELECT user_id, end_timestamp AS timestamp
          FROM label_validation
          WHERE user_id = $userId
          UNION
          SELECT user_id, timestamp
          FROM audit_task_interaction_small
          INNER JOIN audit_task ON audit_task.audit_task_id = audit_task_interaction_small.audit_task_id
          WHERE audit_task.user_id = $userId
          UNION
          SELECT user_id, timestamp
          FROM webpage_activity
          WHERE user_id = $userId
              AND (
                  activity LIKE 'Visit_Labeling_Guide%'
                  OR activity = 'Visit_ServiceHourInstructions'
                  OR activity = 'Visit_TimeCheck'
                  OR activity = 'Visit_UserDashboard'
                  OR activity = 'Visit_Help'
              )
          ) timestamps
      ) time_diffs
      WHERE diff < '00:05:00.000' AND diff > '00:00:00.000'
    """.as[Float].head
  }

  /**
   * Calculate combined hours spent exploring across all users using interaction logs.
   *
   * To do this, we take the events from the audit_task_interaction_small table, get the difference between each
   * consecutive timestamp (grouped by user), filter out the timestamp diffs that are greater than five minutes, and
   * then sum those time diffs.
   *
   * @param timeInterval can be "today" or "week". If anything else, defaults to "all_time".
   */
  def calculateTimeExploring(timeInterval: TimeInterval = TimeInterval.AllTime): DBIO[ContributionTimeStat] = {
    val timeIntervalFilter = timeInterval match {
        case TimeInterval.Today => "(timestamp AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date"
        case TimeInterval.Week => "(timestamp AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'"
        case _ => "TRUE"
    }
    sql"""
      SELECT CAST(extract(second from SUM(diff)) / 60 +
                  extract(minute from SUM(diff)) +
                  extract(hour from SUM(diff)) * 60 AS decimal(10,2)) / 60.0 AS hours_audited
      FROM (
          SELECT user_id, (timestamp - LAG(timestamp, 1) OVER(PARTITION BY user_id ORDER BY timestamp)) AS diff
          FROM audit_task_interaction_small
          INNER JOIN mission ON audit_task_interaction_small.mission_id = mission.mission_id
          WHERE #$timeIntervalFilter
      ) "time_diffs"
      WHERE diff < '00:05:00.000' AND diff > '00:00:00.000';
    """.as[Option[Float]].head.map(hours => ContributionTimeStat(hours, "explore_total", timeInterval))
  }

  /**
   * Calculate combined hours spent validating across all users.
   *
   * To do this, entries from the label_validation table, get the difference between each consecutive timestamp
   * (grouped by user), filter out the timestamp diffs that are greater than five minutes, and sum those time diffs.
   *
   * @param timeInterval can be "today" or "week". If anything else, defaults to "all_time".
   */
  def calculateTimeValidating(timeInterval: TimeInterval = TimeInterval.AllTime): DBIO[ContributionTimeStat] = {
    val timeIntervalFilter = timeInterval match {
      case TimeInterval.Today => "(end_timestamp AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date"
      case TimeInterval.Week => "(end_timestamp AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'"
      case _ => "TRUE"
    }

    sql"""
      SELECT CAST(extract(second from SUM(diff)) / 60 +
                      extract(minute from SUM(diff)) +
                      extract(hour from SUM(diff)) * 60 AS decimal(10,2)) / 60.0 AS hours_validated
      FROM (
          SELECT user_id, (end_timestamp - LAG(end_timestamp, 1) OVER(PARTITION BY user_id ORDER BY end_timestamp)) AS diff
          FROM label_validation
          WHERE #$timeIntervalFilter
      ) "time_diffs"
      WHERE diff < '00:05:00.000' AND diff > '00:00:00.000';
    """.as[Option[Float]].head.map(hours => ContributionTimeStat(hours, "validate_total", timeInterval))
  }

  /**
   * Calculate median exploring speed (in minutes per 100 meters) across all users using interaction logs.
   *
   * To do this, get the total time spent auditing by each user, using the same method as for
   * `calculateTimeExploring()`, and divide that by their audited distance in the `user_stat` table.
   *
   * @param timeInterval can be "today" or "week". If anything else, defaults to "all_time".
   */
  def calculateMedianExploringTime(timeInterval: TimeInterval = TimeInterval.AllTime): DBIO[ContributionTimeStat] = {
    val (timeIntervalFilter, metersFilter, minutesFilter) = timeInterval match {
        case TimeInterval.Today => ("(timestamp AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date", 50, 15)
        case TimeInterval.Week => ("(timestamp AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'", 50, 15)
        case _ => ("TRUE", 100, 30)
    }
    sql"""
      SELECT percentile_CONT(0.5) WITHIN GROUP (ORDER BY minutes_per_100m)
      FROM (
          SELECT user_stat.user_id, minutes_audited / (meters_audited / 100) AS minutes_per_100m
          FROM user_stat
          INNER JOIN (
              SELECT user_id,
                     CAST(extract(second from SUM(diff)) / 60 +
                          extract(minute from SUM(diff)) +
                          extract(hour from SUM(diff)) * 60 AS decimal(10,2)) AS minutes_audited
              FROM (
                  SELECT mission.user_id, timestamp,
                         (timestamp - LAG(timestamp, 1) OVER(PARTITION BY user_id ORDER BY timestamp)) AS diff
                  FROM audit_task_interaction_small
                  INNER JOIN mission ON audit_task_interaction_small.mission_id = mission.mission_id
                  WHERE mission_type_id <> 1 -- exclude tutorials
                      AND #$timeIntervalFilter
              ) "time_diffs"
              WHERE diff < '00:05:00.000' AND diff > '00:00:00.000'
              GROUP BY user_id
          ) "audit_times" ON user_stat.user_id = audit_times.user_id
          WHERE user_stat.meters_audited > $metersFilter
              AND audit_times.minutes_audited > $minutesFilter
      ) AS filtered_data;
    """.as[Option[Float]].head.map(minutes => ContributionTimeStat(minutes, "explore_per_100m", timeInterval))
  }

  /**
   * Calculate the time spent auditing by the given user for a specified time range, starting at a label creation time.
   *
   * To do this, we take the important events from the audit_task_interaction table, get the difference between each
   * consecutive timestamp, filter out the timestamp diffs that are greater than five minutes, and then sum the diffs.
   *
   * NOTE We're actually using the label placed _before_ `timeRangeStartLabelId` as the start time, since we're finding
   * the time spent auditing up to the point when the label was placed.
   *
   * TODO We should update the POST request to guarantee that we only send one label at a time. We can then remove the
   *      `timeRangeEnd` parameter and use the label's `time_created` field directly.
   *
   * @param userId
   * @param timeRangeStartLabelId Label_id for the label whose `time_created` field marks the start of the time range.
   * @param timeRangeEnd A timestamp representing the end of the time range; should be the time when a label was placed.
   */
  def secondsSpentAuditing(userId: String, timeRangeStartLabelId: Int, timeRangeEnd: OffsetDateTime): DBIO[Float] = {
    sql"""
      SELECT extract( epoch FROM SUM(diff) ) AS seconds_contributed
      FROM (
          SELECT (timestamp - LAG(timestamp, 1) OVER(PARTITION BY user_id ORDER BY timestamp)) AS diff
          FROM audit_task_interaction_small
          INNER JOIN audit_task ON audit_task.audit_task_id = audit_task_interaction_small.audit_task_id
          WHERE audit_task.user_id = $userId
              AND audit_task_interaction_small.timestamp < '#${timeRangeEnd.toString}'
              AND audit_task_interaction_small.timestamp > (
                  SELECT COALESCE(MAX(time_created), TIMESTAMP 'epoch')
                  FROM label
                  WHERE label.user_id = $userId
                      AND label.label_id < $timeRangeStartLabelId
          )
      ) "time_diffs"
      WHERE diff < '00:05:00.000' AND diff > '00:00:00.000';
    """.as[Float].head
  }
}
