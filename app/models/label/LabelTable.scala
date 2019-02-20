package models.label

import java.net.{ConnectException, HttpURLConnection, SocketException, URL}
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

import models.daos.slickdaos.DBTableDefinitions.UserTable
import models.utils.MyPostgresDriver.api._
import com.vividsolutions.jts.geom.LineString
import models.audit.{AuditTask, AuditTaskEnvironmentTable, AuditTaskInteraction, AuditTaskTable}
import models.gsv.GSVDataTable
import models.mission.MissionTable
import models.region.RegionTable
import models.user.{RoleTable, UserRoleTable}
import org.joda.time.{DateTime, DateTimeZone}
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}
import play.api.Play
import play.api.db.slick.DatabaseConfigProvider

import slick.driver.JdbcProfile
import scala.concurrent.{Await, Future}
import scala.concurrent.ExecutionContext.Implicits.global
import slick.jdbc.GetResult
import scala.collection.mutable.ListBuffer
import scala.concurrent.duration.Duration

case class Label(labelId: Int,
                 auditTaskId: Int,
                 missionId: Int,
                 gsvPanoramaId: String,
                 labelTypeId: Int,
                 photographerHeading: Float,
                 photographerPitch: Float,
                 panoramaLat: Float,
                 panoramaLng: Float,
                 deleted: Boolean,
                 temporaryLabelId: Option[Int],
                 timeCreated: Option[Timestamp],
                 turorial: Boolean)

case class LabelLocation(labelId: Int,
                         auditTaskId: Int,
                         gsvPanoramaId: String,
                         labelType: String,
                         lat: Float,
                         lng: Float)

case class LabelLocationWithSeverity(labelId: Int,
                                     auditTaskId: Int,
                                     gsvPanoramaId: String,
                                     labelType: String,
                                     severity: Int,
                                     lat: Float,
                                     lng: Float)


case class LabelValidationLocation(labelId: Int, labelType: String, gsvPanoramaId: String,
                                   heading: Float, pitch: Float, zoom: Float, canvasX: Int,
                                   canvasY: Int, canvasWidth: Int, canvasHeight: Int)

/**
 *
 */
class LabelTable(tag: slick.lifted.Tag) extends Table[Label](tag, Some("sidewalk"), "label") {
  def labelId = column[Int]("label_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId = column[Int]("audit_task_id")
  def missionId = column[Int]("mission_id")
  def gsvPanoramaId = column[String]("gsv_panorama_id")
  def labelTypeId = column[Int]("label_type_id")
  def photographerHeading = column[Float]("photographer_heading")
  def photographerPitch = column[Float]("photographer_pitch")
  def panoramaLat = column[Float]("panorama_lat")
  def panoramaLng = column[Float]("panorama_lng")
  def deleted = column[Boolean]("deleted")
  def temporaryLabelId = column[Option[Int]]("temporary_label_id")
  def timeCreated = column[Option[Timestamp]]("time_created")
  def tutorial = column[Boolean]("tutorial")

  def * = (labelId, auditTaskId, missionId, gsvPanoramaId, labelTypeId, photographerHeading, photographerPitch,
    panoramaLat, panoramaLng, deleted, temporaryLabelId, timeCreated, tutorial) <> ((Label.apply _).tupled, Label.unapply)

  def auditTask = foreignKey("label_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)

  def mission = foreignKey("label_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)

  def labelType = foreignKey("label_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTable])(_.labelTypeId)
}

/**
 * Data access object for the label table
 */
object LabelTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val labels = TableQuery[LabelTable]
  val auditTasks = TableQuery[AuditTaskTable]
  val completedAudits = auditTasks.filter(_.completed === true)
  val auditTaskEnvironments = TableQuery[AuditTaskEnvironmentTable]
  val labelTypes = TableQuery[LabelTypeTable]
  val labelPoints = TableQuery[LabelPointTable]
  val regions = TableQuery[RegionTable]
  val severities = TableQuery[LabelSeverityTable]
  val users = TableQuery[UserTable]
  val userRoles = TableQuery[UserRoleTable]
  val roleTable = TableQuery[RoleTable]

  val labelsWithoutDeleted = labels.filter(_.deleted === false)
  val neighborhoods = regions.filter(_.deleted === false).filter(_.regionTypeId === 2)

  // Filters out the labels placed during onboarding (aka panoramas that are used during onboarding
  // Onboarding labels have to be filtered out before a user's labeling frequency is computed
  val labelsWithoutDeletedOrOnboarding = labelsWithoutDeleted.filter(_.tutorial === false)

  case class LabelCountPerDay(date: String, count: Int)

  case class LabelMetadataWithoutTags(labelId: Int, gsvPanoramaId: String, tutorial: Boolean, heading: Float,
                                      pitch: Float, zoom: Int,
                                      canvasX: Int, canvasY: Int, canvasWidth: Int, canvasHeight: Int,
                                      auditTaskId: Int,
                                      userId: String, username: String,
                                      timestamp: Option[java.sql.Timestamp],
                                      labelTypeKey:String, labelTypeValue: String, severity: Option[Int],
                                      temporary: Boolean, description: Option[String])

  case class LabelMetadata(labelId: Int, gsvPanoramaId: String, tutorial: Boolean, heading: Float, pitch: Float,
                           zoom: Int, canvasX: Int, canvasY: Int, canvasWidth: Int, canvasHeight: Int,
                           auditTaskId: Int,
                           userId: String, username: String,
                           timestamp: Option[java.sql.Timestamp],
                           labelTypeKey:String, labelTypeValue: String, severity: Option[Int],
                           temporary: Boolean, description: Option[String], tags: List[String])

  case class LabelValidationMetadata(labelId: Int, labelType: String, gsvPanoramaId: String,
                                     heading: Float, pitch: Float, zoom: Int, canvasX: Int,
                                     canvasY: Int, canvasWidth: Int, canvasHeight: Int)

  implicit val labelLocationConverter = GetResult[LabelLocation](r =>
    LabelLocation(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextFloat, r.nextFloat))

  implicit val labelSeverityConverter = GetResult[LabelLocationWithSeverity](r =>
    LabelLocationWithSeverity(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextInt, r.nextFloat, r.nextFloat))

  /**
    * Find a label
    *
    * @param labelId
    * @return
    */
  def find(labelId: Int): Future[Option[Label]] = db.run(
    labels.filter(_.labelId === labelId).result.headOption
  )

  /**
    * Find a label based on temp_label_id and audit_task_id.
    *
    * @param tempLabelId
    * @param auditTaskId
    * @return
    */
  def find(tempLabelId: Int, auditTaskId: Int): Future[Option[Int]] = db.run(
    labels.filter(
      x => x.temporaryLabelId === tempLabelId && x.auditTaskId === auditTaskId
    ).map(_.labelId).result.headOption
  )

  def countLabels: Future[Int] = db.run(
    labels.filter(_.deleted === false).length.result
  )

  def countLabelsBasedOnType(labelTypeString: String): Future[Int] = {
    LabelTypeTable.labelTypeToId(labelTypeString).flatMap { labelTypeId =>
      db.run(
        labels.filter(_.deleted === false).filter(
          _.labelTypeId === labelTypeId
        ).length.result
      )
    }
  }

  /*
  * Counts the number of labels added today.
  * If the task goes over two days, then all labels for that audit task
  * will be added for the task end date
  * Date: Aug 28, 2016
  */
  def countTodayLabels: Future[Int] = {
    val sql = sql"""
        SELECT count(label.label_id)
        FROM sidewalk.audit_task
        INNER JOIN sidewalk.label ON label.audit_task_id = audit_task.audit_task_id
        WHERE audit_task.task_end::date = now()::date
            AND label.deleted = false
      """.as[Int]

    db.run(sql.head)
  }

  /*
  * Counts the number of specific label types added today.
  * If the task goes over two days, then all labels for that audit task
  * will be added for the task end date
  * Date: Aug 28, 2016
  */
  def countTodayLabelsBasedOnType(labelType: String): Future[Int] = {
    def countQuery(labelType: String) =
      sql"""SELECT count(label.label_id)
             FROM sidewalk.audit_task
                INNER JOIN sidewalk.label
                  ON label.audit_task_id = audit_task.audit_task_id
             WHERE audit_task.task_end::date = now()::date
                AND label.deleted = false AND label.label_type_id = (SELECT label_type_id
                    FROM sidewalk.label_type as lt
         						WHERE lt.label_type='#$labelType')
        """.as[Int]

    db.run(countQuery(labelType).head)
  }

  /*
  * Counts the number of labels added yesterday
  * Date: Aug 28, 2016
  */
  def countYesterdayLabels: Future[Int] = {
    val sql =
      sql"""SELECT count(label.label_id)
             FROM sidewalk.audit_task
                INNER JOIN sidewalk.label ON label.audit_task_id = audit_task.audit_task_id
             WHERE audit_task.task_end::date = now()::date - interval '1' day
              AND label.deleted = false
        """.as[Int]

    db.run(sql.head)
  }

  /*
  * Counts the number of specific label types added yesterday
  * Date: Aug 28, 2016
  */
  def countYesterdayLabelsBasedOnType(labelType: String): Future[Int] = {
    def countQuery(labelType: String) =
      sql"""SELECT count(label.label_id)
              FROM sidewalk.audit_task
                INNER JOIN sidewalk.label
                  ON label.audit_task_id = audit_task.audit_task_id
              WHERE audit_task.task_end::date = now()::date - interval '1' day
                AND label.deleted = false AND label.label_type_id = (SELECT label_type_id
            														FROM sidewalk.label_type as lt
            														WHERE lt.label_type='#$labelType')
        """.as[Int]

    db.run(countQuery(labelType).head)
  }


  /**
    * This method returns the number of labels submitted by the given user
    *
    * @param userId User id
    * @return A number of labels submitted by the user
    */
  def countLabelsByUserId(userId: UUID): Future[Int] = db.run({
    val tasks = auditTasks.filter(_.userId === userId.toString)
    val _labels = for {
      (_, _labels) <- tasks.join(labelsWithoutDeleted).on(_.auditTaskId === _.auditTaskId)
    } yield _labels
    _labels.length.result
  })

  def updateDeleted(labelId: Int, deleted: Boolean): Future[Int] = {
    db.run(
      labels.filter(_.labelId === labelId).map(lab => lab.deleted).update(deleted).transactionally
    )
  }

  /**
   * Saves a new label in the table
    *
    * @param label
   * @return
   */
  def save(label: Label): Future[Int] = db.run(
    ((labels returning labels.map(_.labelId)) += label).transactionally
  )

  // TODO translate the following three queries to Slick
  def retrieveLabelMetadata(takeN: Int): Future[List[LabelMetadata]] = {
    def selectQuery(takeN: Int) =
      sql"""SELECT lb1.label_id,
                   lb1.gsv_panorama_id,
                   lb1.tutorial,
                   lp.heading,
                   lb.pitch,
                   lp.zoom,
                   lp.canvas_x,
                   lp.canvas_y,
                   lp.canvas_width,
                   lp.canvas_height,
                   lb1.audit_task_id,
                   u.user_id,
                   u.username,
                   lb1.time_created,
                   lb_big.label_type,
                   lb_big.label_type_desc,
                   lb_big.severity,
                   lb_big.temp,
                   lb_big.description
            FROM sidewalk.label AS lb1,
                 sidewalk.audit_task AS at,
                 sidewalk_user AS u,
                 sidewalk.label_point AS lp,
            			(
                     SELECT lb.label_id,
                            lb.gsv_panorama_id,
                            lbt.label_type,
                            lbt.description AS label_type_desc,
                            sev.severity,
                            COALESCE(lab_temp.temporary, 'FALSE') AS temp,
                            lab_desc.description
            					FROM label AS lb
            				  LEFT JOIN sidewalk.label_type as lbt ON lb.label_type_id = lbt.label_type_id
              				LEFT JOIN sidewalk.label_severity as sev ON lb.label_id = sev.label_id
            				  LEFT JOIN sidewalk.label_description as lab_desc ON lb.label_id = lab_desc.label_id
            				  LEFT JOIN sidewalk.label_temporariness as lab_temp ON lb.label_id = lab_temp.label_id
            		  ) AS lb_big
            WHERE lb1.deleted = FALSE
                AND lb1.audit_task_id = at.audit_task_id
                AND lb1.label_id = lb_big.label_id
                AND at.user_id = u.user_id
                AND lb1.label_id = lp.label_id
            ORDER BY lb1.label_id DESC
            LIMIT #$takeN
        """.as[(Int, String, Boolean, Float, Float, Int, Int, Int, Int, Int,
        Int, String, String, Option[java.sql.Timestamp], String, String, Option[Int], Boolean,
        Option[String])]

    db.run(selectQuery(takeN)).flatMap { ret =>
      val futures = ret.toList.map(LabelMetadataWithoutTags.tupled).map { label =>
        getTagsFromLabelId(label.labelId).map { tags =>
          labelAndTagsToLabelMetadata(label, tags.toList)
        }
      }
      Future.sequence(futures)
    }
  }

  def retrieveLabelMetadata(takeN: Int, userId: String): Future[List[LabelMetadata]] = {
    def selectQuery(takeN: Int, userId: String) =
      sql"""SELECT lb1.label_id,
                   lb1.gsv_panorama_id,
                   lb1.tutorial,
                   lp.heading,
                   lp.pitch,
                   lp.zoom,
                   lp.canvas_x,
                   lp.canvas_y,
                   lp.canvas_width,
                   lp.canvas_height,
                   lb1.audit_task_id,
                   u.user_id,
                   u.username,
                   lb1.time_created,
                   lb_big.label_type,
                   lb_big.label_type_desc,
                   lb_big.severity,
                   lb_big.temp,
                   lb_big.description
            FROM sidewalk.label AS lb1,
                 sidewalk.audit_task AS at,
                 sidewalk_user AS u,
                 sidewalk.label_point AS lp,
            			(
                     SELECT lb.label_id,
                            lb.gsv_panorama_id,
                            lbt.label_type,
                            lbt.description AS label_type_desc,
                            sev.severity,
                            COALESCE(lab_temp.temporary, 'FALSE') AS temp,
                            lab_desc.description
            					FROM label AS lb
            		  		LEFT JOIN sidewalk.label_type AS lbt ON lb.label_type_id = lbt.label_type_id
            			  	LEFT JOIN sidewalk.label_severity AS sev ON lb.label_id = sev.label_id
            			  	LEFT JOIN sidewalk.label_description AS lab_desc ON lb.label_id = lab_desc.label_id
            				  LEFT JOIN sidewalk.label_temporariness AS lab_temp ON lb.label_id = lab_temp.label_id
            			) AS lb_big
            WHERE u.user_id = #$userId
                  AND lb1.deleted = FALSE
                  AND lb1.audit_task_id = at.audit_task_id
                  AND lb1.label_id = lb_big.label_id
                  AND at.user_id = u.user_id
                  AND lb1.label_id = lp.label_id
            ORDER BY lb1.label_id DESC
            LIMIT #$takeN
            """.as[(Int, String, Boolean, Float, Float, Int, Int, Int, Int, Int,
                    Int, String, String, Option[java.sql.Timestamp], String, String, Option[Int], Boolean,
                    Option[String])]

    db.run(selectQuery(takeN, userId)).flatMap { ret =>
      val futures = ret.toList.map(LabelMetadataWithoutTags.tupled).map { label =>
        getTagsFromLabelId(label.labelId).map { tags =>
          labelAndTagsToLabelMetadata(label, tags.toList)
        }
      }
      Future.sequence(futures)
    }
  }

  def retrieveSingleLabelMetadata(labelId: Int): Future[LabelMetadata] = {
    implicit val mkLabelMetadataWithoutTags = GetResult[LabelMetadataWithoutTags](r =>
      LabelMetadataWithoutTags(
        r.nextInt(), // labelId
        r.nextString(),
        r.nextFloat(),
        r.nextFloat(),
        r.nextInt(),
        r.nextInt(),  //canvasX
        r.nextInt(),
        r.nextInt(),
        r.nextInt(),
        r.nextInt(),  //auditTaskId
        r.nextString(),
        r.nextString(), //userId
        r.nextTimestampOption(),
        r.nextString(), //labelTypeKey
        r.nextString(),
        r.nextIntOption(),
        r.nextBoolean(),  //temporary
        r.nextStringOption()
      ))

    val selectQuery =
      sql"""SELECT lb1.label_id,
                lb1.gsv_panorama_id,
                lp.heading,
                lb1.tutorial,
                lp.pitch,
                lp.zoom,
                lp.canvas_x,
                lp.canvas_y,
                lp.canvas_width,
                lp.canvas_height,
                lb1.audit_task_id,
                u.user_id,
                u.username,
                lb1.time_created,
                lb_big.label_type,
                lb_big.label_type_desc,
                lb_big.severity,
                lb_big.temp,
                lb_big.description
         FROM sidewalk.label AS lb1,
              sidewalk.audit_task AS at,
              sidewalk_user AS u,
              sidewalk.label_point AS lp,
              (
                  SELECT lb.label_id,
                         lb.gsv_panorama_id,
                         lbt.label_type,
                         lbt.description AS label_type_desc,
                         sev.severity,
                         COALESCE(lab_temp.temporary, 'FALSE') AS temp,
                         lab_desc.description
                  FROM label AS lb
                  LEFT JOIN sidewalk.label_type AS lbt ON lb.label_type_id = lbt.label_type_id
                  LEFT JOIN sidewalk.label_severity AS sev ON lb.label_id = sev.label_id
                  LEFT JOIN sidewalk.label_description AS lab_desc ON lb.label_id = lab_desc.label_id
                  LEFT JOIN sidewalk.label_temporariness AS lab_temp ON lb.label_id = lab_temp.label_id
              ) AS lb_big
         WHERE lb1.label_id = #${labelId}
               AND lb1.audit_task_id = at.audit_task_id
               AND lb1.label_id = lb_big.label_id
               AND at.user_id = u.user_id
               AND lb1.label_id = lp.label_id
         ORDER BY lb1.label_id DESC""".as[LabelMetadataWithoutTags]

    for {
      labelMetadata <- db.run(selectQuery)
      labelTags <- getTagsFromLabelId(labelId)
    } yield {
      labelAndTagsToLabelMetadata(labelMetadata.head, labelTags.toList)
    }
  }

  /**
    * Retrieves a label with a given labelID for validation.
    * @param labelId  Label ID for label to retrieve.
    * @return         LabelValidationMetadata object.
    */
  def retrieveSingleLabelForValidation(labelId: Int): Future[LabelValidationMetadata] = {
    val validationLabels = for {
      _lb <- labels if _lb.labelId === labelId
      _lt <- labelTypes if _lb.labelTypeId === _lt.labelTypeId
      _lp <- labelPoints if _lb.labelId === _lp.labelId
    } yield (_lb.labelId, _lt.labelType, _lb.gsvPanoramaId, _lp.heading, _lp.pitch, _lp.zoom,
      _lp.canvasX, _lp.canvasY, _lp.canvasWidth, _lp.canvasHeight)
    db.run(validationLabels.result.head).map(LabelValidationMetadata.tupled(_))
  }

  /**
    * Retrieves a random label that has an existing GSVPanorama.
    * Will keep querying for a random label until a suitable label has been found.
    * @return LabelValidationMetadata of this label.
    */
  def retrieveSingleRandomLabelForValidation() : LabelValidationMetadata = {
    var exists: Boolean = false
    var labelToValidate: List[(Int, String, String, Float, Float, Int, Int, Int, Int, Int)] = null
    while (!exists) {
      val selectQuery =
        sql"""SELECT lb.label_id,
                    lt.label_type,
                    lb.gsv_panorama_id,
                    lp.heading,
                    lp.pitch,
                    lp.zoom,
                    lp.canvas_x,
                    lp.canvas_y,
                    lp.canvas_width,
                    lp.canvas_height
        FROM sidewalk.label AS lb,
             sidewalk.label_type AS lt,
             sidewalk.label_point AS lp,
             sidewalk.gsv_data AS gd
        WHERE lp.label_id = lb.label_id
              AND lt.label_type_id = lb.label_type_id
              AND lb.label_type_id <> 5
              AND lb.label_type_id <> 6
              AND lb.deleted = false
              AND lb.tutorial = false
              AND gd.gsv_panorama_id = lb.gsv_panorama_id
              AND gd.expired = false
        OFFSET floor(random() *
              (
                  SELECT COUNT(*)
                  FROM sidewalk.label AS lb
                  WHERE lb.deleted = false
                      AND lb.tutorial = false
                      AND lb.label_type_id <> 5
                      AND lb.label_type_id <> 6
              )
        )
        LIMIT 1""".as[(Int, String, String, Float, Float, Int, Int, Int, Int, Int)]
      val singleLabel = Await.result(db.run(selectQuery), Duration.Inf) // FIXME
      // Uses panorama ID to check if this panorama exists
      exists = panoExists(singleLabel(0)._3)

      if (exists) {
        labelToValidate = singleLabel
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        GSVDataTable.markLastViewedForPanorama(singleLabel(0)._3, timestamp)
      } else {
        println("Panorama " + singleLabel(0)._3 + " doesn't exist")
        GSVDataTable.markExpired(singleLabel(0)._3, true)
      }
    }
    labelToValidate.map(label => LabelValidationMetadata.tupled(label)).head
  }

  /**
    * Retrieves a list of labels to be validated
    * @param count  Length of list
    * @return       Seq[LabelValidationMetadata]
    */
  def retrieveRandomLabelListForValidation(count: Int) : Seq[LabelValidationMetadata] = {
    var labelList = new ListBuffer[LabelValidationMetadata]()
    for (a <- 1 to count) {
      labelList += retrieveSingleRandomLabelForValidation()
    }
    val labelSeq: Seq[LabelValidationMetadata] = labelList
    labelSeq
  }

  /**
    * Checks if the panorama associated with a label eixsts by pinging Google Maps.
    * @param gsvPanoId  Panorama ID
    * @return           True if the panorama exists, false otherwise
    */
  def panoExists(gsvPanoId: String): Boolean = {
    try {
      val now = new DateTime(DateTimeZone.UTC)
      val urlString : String = "http://maps.google.com/cbk?output=tile&panoid=" + gsvPanoId + "&zoom=1&x=0&y=0&date=" + now.getMillis
      // println("URL: " + urlString)
      val panoURL : URL = new java.net.URL(urlString)
      val connection : HttpURLConnection = panoURL.openConnection.asInstanceOf[HttpURLConnection]
      connection.setConnectTimeout(5000)
      connection.setReadTimeout(5000)
      connection.setRequestMethod("GET")
      val responseCode: Int = connection.getResponseCode
      // println("Response Code: " + responseCode)

      // URL is only valid if the response code is between 200 and 399.
      200 <= responseCode && responseCode <= 399
    } catch {
      case e: ConnectException => false
      case e: SocketException => false
      case e: Exception => false
    }

  }

  def validationLabelMetadataToJson(labelMetadata: LabelValidationMetadata): JsObject = {
    Json.obj(
      "label_id" -> labelMetadata.labelId,
      "label_type" -> labelMetadata.labelType,
      "gsv_panorama_id" -> labelMetadata.gsvPanoramaId,
      "heading" -> labelMetadata.heading,
      "pitch" -> labelMetadata.pitch,
      "zoom" -> labelMetadata.zoom,
      "canvas_x" -> labelMetadata.canvasX,
      "canvas_y" -> labelMetadata.canvasY,
      "canvas_width" -> labelMetadata.canvasWidth,
      "canvas_height" -> labelMetadata.canvasHeight
    )
  }

  /**
    * Returns a LabelMetadata object that has the label properties as well as the tags.
    *
    * @param label label from query
    * @param tags list of tags as strings
    * @return LabelMetadata object
    */
  def labelAndTagsToLabelMetadata(label: LabelMetadataWithoutTags, tags: List[String]): LabelMetadata = {
      LabelMetadata(
        label.labelId, label.gsvPanoramaId, label.heading, label.pitch, label.zoom, label.canvasX, label.canvasY,
        label.canvasWidth, label.canvasHeight ,label.auditTaskId ,label.userId ,label.username, label.timestamp,
        label.labelTypeKey, label.labelTypeValue, label.severity, label.temporary, label.description, tags)
  }

//  case class LabelMetadata(labelId: Int, gsvPanoramaId: String, tutorial: Boolean, heading: Float, pitch: Float,
//                           zoom: Int, canvasX: Int, canvasY: Int, canvasWidth: Int, canvasHeight: Int,
//                           auditTaskId: Int,
//                           userId: String, username: String,
//                           timestamp: java.sql.Timestamp,
//                           labelTypeKey:String, labelTypeValue: String, severity: Option[Int],
//                           temporary: Boolean, description: Option[String])
  def labelMetadataToJson(labelMetadata: LabelMetadata): JsObject = {
    Json.obj(
      "label_id" -> labelMetadata.labelId,
      "gsv_panorama_id" -> labelMetadata.gsvPanoramaId,
      "tutorial" -> labelMetadata.tutorial,
      "heading" -> labelMetadata.heading,
      "pitch" -> labelMetadata.pitch,
      "zoom" -> labelMetadata.zoom,
      "canvas_x" -> labelMetadata.canvasX,
      "canvas_y" -> labelMetadata.canvasY,
      "canvas_width" -> labelMetadata.canvasWidth,
      "canvas_height" -> labelMetadata.canvasHeight,
      "audit_task_id" -> labelMetadata.auditTaskId,
      "user_id" -> labelMetadata.userId,
      "username" -> labelMetadata.username,
      "timestamp" -> labelMetadata.timestamp,
      "label_type_key" -> labelMetadata.labelTypeKey,
      "label_type_value" -> labelMetadata.labelTypeValue,
      "severity" -> labelMetadata.severity,
      "temporary" -> labelMetadata.temporary,
      "description" -> labelMetadata.description,
      "tags" -> labelMetadata.tags
    )
  }

  /**
    * This method returns a list of strings with all the tags associated with a label
    *
    * @param userId Label id
    * @return A list of strings with all the tags asscociated with a label
    */
  def getTagsFromLabelId(labelId: Int): Future[Seq[String]] = {
      val getTagsQuery = sql"""
           SELECT tag
           FROM sidewalk.tag
           WHERE tag.tag_id IN
           (
               SELECT tag_id
               FROM sidewalk.label_tag
               WHERE label_tag.label_id = #${labelId}
           )""".as[String]
      db.run(getTagsQuery)
  }

  /**
    * Returns all the labels submitted by the given user
    * @param userId
    * @return
    */
  def selectLabelsByUserId(userId: UUID): Future[List[Label]] = db.run(
    (for {
      (_labels, _auditTasks) <- labelsWithoutDeleted.join(auditTasks).on(_.auditTaskId === _.auditTaskId)
      if _auditTasks.userId === userId.toString
    } yield _labels).to[List].result
  )

  /**
    * Returns all the labels of the given user that are associated with the given interactions
    * @param userId
    * @param interactions
    * @return
    */
  def selectLabelsByInteractions(userId: UUID, interactions: List[AuditTaskInteraction]): Future[List[Label]] = {
    selectLabelsByUserId(userId).map { labels =>
      for {
        l <- labels.filter(_.temporaryLabelId.isDefined)
        i <- interactions
        if l.auditTaskId == i.auditTaskId && l.temporaryLabelId == i.temporaryLabelId
      } yield l
    }
  }

  /*
   * Retrieves label and its metadata
   * Date: Sep 1, 2016
   */
  def selectTopLabelsAndMetadata(n: Int): Future[List[LabelMetadata]] = retrieveLabelMetadata(n)

  /*
   * Retrieves label by user and its metadata
   * Date: Sep 2, 2016
   */
  def selectTopLabelsAndMetadataByUser(n: Int, userId: UUID): Future[List[LabelMetadata]] =
    retrieveLabelMetadata(n, userId.toString)

  /**
    * This method returns all the submitted labels
    *
    * @return
    */
  def selectLocationsOfLabels: Future[Seq[LabelLocation]] = {
    val _labels = for {
      (_labels, _labelTypes) <- labelsWithoutDeleted.join(labelTypes).on(_.labelTypeId === _.labelTypeId)
    } yield (_labels.labelId, _labels.auditTaskId, _labels.gsvPanoramaId, _labelTypes.labelType, _labels.panoramaLat, _labels.panoramaLng)

    val _points = for {
      (l, p) <- _labels.join(labelPoints).on(_._1 === _.labelId)
    } yield (l._1, l._2, l._3, l._4, p.lat.getOrElse(0.toFloat), p.lng.getOrElse(0.toFloat))

    db.run(_points.result).map(_.map(LabelLocation.tupled))
  }

  /**
    * This method returns all the submitted labels with their severities included.
    *
    * @return
    */
  def selectLocationsAndSeveritiesOfLabels: Future[Seq[LabelLocationWithSeverity]] = {
    val _labels = for {
      (_labels, _labelTypes) <- labelsWithoutDeleted.join(labelTypes).on(_.labelTypeId === _.labelTypeId)
    } yield (_labels.labelId, _labels.auditTaskId, _labels.gsvPanoramaId, _labelTypes.labelType, _labels.panoramaLat, _labels.panoramaLng)

    val _slabels = for {
      (l, s) <- _labels.join(severities).on(_._1 === _.labelId)
    } yield (l._1, l._2, l._3, l._4, s.severity)

    val _points = for {
      (l, p) <- _slabels.join(labelPoints).on(_._1 === _.labelId)
    } yield (l._1, l._2, l._3, l._4, l._5, p.lat.getOrElse(0.toFloat), p.lng.getOrElse(0.toFloat))

    db.run(_points.result).map(_.map(LabelLocationWithSeverity.tupled))
  }

  /**
    * Retrieve Label Locations within a given bounding box
    *
    * @param minLat
    * @param minLng
    * @param maxLat
    * @param maxLng
    * @return
    */
  def selectLocationsOfLabelsIn(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): Future[List[LabelLocation]] = {
    def selectLabelLocationQuery(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double) =
      sql"""
            |SELECT label.label_id,
            |       label.audit_task_id,
            |       label.gsv_panorama_id,
            |       label_type.label_type,
            |       label_point.lat,
            |       label_point.lng
            |FROM sidewalk.label
            |INNER JOIN sidewalk.label_type ON label.label_type_id = label_type.label_type_id
            |INNER JOIN sidewalk.label_point ON label.label_id = label_point.label_id
            |WHERE label.deleted = false
            |    AND label_point.lat IS NOT NULL
            |    AND ST_Intersects(label_point.geom, ST_MakeEnvelope($minLng, $minLat, $maxLng, $maxLat, 4326))
        """.as[(Int, Int, String, String, Float, Float)]

    db.run(selectLabelLocationQuery(minLng, minLat, maxLng, maxLat))
        .map(_.toList.map(LabelLocation.tupled))
  }

  /**
   * This method returns a list of labels submitted by the given user.
    *
    * @param userId
   * @return
   */
  def selectLocationsOfLabelsByUserId(userId: UUID): Future[List[LabelLocation]] = {
    val _labels = for {
      ((_auditTasks, _labels), _labelTypes) <- auditTasks join labelsWithoutDeleted on(_.auditTaskId === _.auditTaskId) join labelTypes on (_._2.labelTypeId === _.labelTypeId)
      if _auditTasks.userId === userId.toString
    } yield (_labels.labelId, _labels.auditTaskId, _labels.gsvPanoramaId, _labelTypes.labelType, _labels.panoramaLat, _labels.panoramaLng)

    val _points = for {
      (l, p) <- _labels.join(labelPoints).on(_._1 === _.labelId)
    } yield (l._1, l._2, l._3, l._4, p.lat.getOrElse(0.toFloat), p.lng.getOrElse(0.toFloat))

    db.run(_points.to[List].result).map(_.map(LabelLocation.tupled))
  }

  def selectLocationsOfLabelsByUserIdAndRegionId(userId: UUID, regionId: Int): Future[Seq[LabelLocation]] = {
    val selectQuery = sql"""SELECT label.label_id,
                label.audit_task_id,
                label.gsv_panorama_id,
                label_type.label_type,
                label_point.lat,
                label_point.lng,
                region.region_id
         FROM sidewalk.label
         INNER JOIN sidewalk.label_type ON label.label_type_id = label_type.label_type_id
         INNER JOIN sidewalk.label_point ON label.label_id = label_point.label_id
         INNER JOIN sidewalk.audit_task ON audit_task.audit_task_id = label.audit_task_id
         INNER JOIN sidewalk.region ON ST_Intersects(region.geom, label_point.geom)
         WHERE label.deleted = FALSE
             AND label_point.lat IS NOT NULL
             AND region.deleted = FALSE
             AND region.region_type_id = 2
             AND audit_task.user_id = #${userId.toString}
             AND region_id = #${regionId}""".as[LabelLocation]

    db.run(selectQuery)
  }

  /**
    * Returns a count of the number of labels placed on each day since the tool was launched (11/17/2015).
    *
    * @return
    */
  def selectLabelCountsPerDay: Future[List[LabelCountPerDay]] = {
    val selectLabelCountQuery =
      sql"""SELECT calendar_date::date, COUNT(label_id)
            FROM
            (
            SELECT current_date - (n || ' day')::INTERVAL AS calendar_date
            FROM generate_series(0, current_date - '11/17/2015') n
            ) AS calendar
              LEFT JOIN sidewalk.audit_task ON audit_task.task_start::date = calendar_date::date
              LEFT JOIN sidewalk.label ON label.audit_task_id = audit_task.audit_task_id
            GROUP BY calendar_date
            ORDER BY calendar_date
        """.as[(String, Int)]

    db.run(selectLabelCountQuery)
      .map(_.toList.map(LabelCountPerDay.tupled))
  }


  /**
    * Select label counts per user.
    *
    * @return list of tuples of (user_id, role, label_count)
    */
  def getLabelCountsPerUser: Future[Seq[(String, String, Int)]] = {
    val audits = for {
      _user <- users if _user.username =!= "anonymous"
      _userRole <- userRoles if _user.userId === _userRole.userId
      _role <- roleTable if _userRole.roleId === _role.roleId
      _audit <- auditTasks if _user.userId === _audit.userId
      _label <- labelsWithoutDeleted if _audit.auditTaskId === _label.auditTaskId
    } yield (_user.userId, _role.role, _label.labelId)

    // Counts the number of labels for each user by grouping by user_id and role.
    db.run(audits.groupBy(l => (l._1, l._2)).map{ case ((uId, role), group) => (uId, role, group.length) }.result)
  }
}
