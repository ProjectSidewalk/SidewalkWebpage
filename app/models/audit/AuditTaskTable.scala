package models.audit

import com.vividsolutions.jts.geom.{ Coordinate, LineString }
import java.sql.Timestamp
import java.util.{ Calendar, TimeZone, UUID }

import models.street._
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import models.daos.slickdaos.DBTableDefinitions.UserTable
import models.label.{ LabelTable, LabelTypeTable }
import models.street.StreetEdgePriorityTable
import play.api.libs.json._
import au.id.jazzy.play.geojson

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

import slick.jdbc.GetResult

case class AuditTask(auditTaskId: Int, amtAssignmentId: Option[Int], userId: String, streetEdgeId: Int, taskStart: Timestamp, taskEnd: Option[Timestamp], completed: Boolean)
case class AuditCountPerDay(date: String, count: Int)
case class AuditTaskWithALabel(userId: String, username: String, auditTaskId: Int, streetEdgeId: Int, taskStart: Timestamp, taskEnd: Option[Timestamp], labelId: Option[Int], temporaryLabelId: Option[Int], labelType: Option[String])
case class NewTask(edgeId: Int, geom: LineString, x1: Float, y1: Float, x2: Float, y2: Float, taskStart: Timestamp,
  completedByAnyUser: Boolean, // Has any user has audited this street
  priority: Double,
  completed: Boolean // Has the user audited this street before (null if no corresponding user)
  ) {
  /**
   * This method converts the data into the GeoJSON format
   * @return
   */
  def toJSON: JsObject = {
    val coordinates: Array[Coordinate] = geom.getCoordinates
    val latlngs: List[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList
    val linestring: geojson.LineString[geojson.LatLng] = geojson.LineString(latlngs)
    val properties = Json.obj(
      "street_edge_id" -> edgeId,
      "x1" -> x1,
      "y1" -> y1,
      "x2" -> x2,
      "y2" -> y2,
      "task_start" -> taskStart.toString,
      "completed_by_any_user" -> completedByAnyUser,
      "priority" -> priority,
      "completed" -> completed)
    val feature = Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
    Json.obj("type" -> "FeatureCollection", "features" -> List(feature))
  }
}

/**
 *
 */
class AuditTaskTable(tag: slick.lifted.Tag) extends Table[AuditTask](tag, Some("sidewalk"), "audit_task") {
  def auditTaskId = column[Int]("audit_task_id", O.PrimaryKey, O.AutoInc)
  def amtAssignmentId = column[Option[Int]]("amt_assignment_id")
  def userId = column[String]("user_id")
  def streetEdgeId = column[Int]("street_edge_id")
  def taskStart = column[Timestamp]("task_start")
  def taskEnd = column[Option[Timestamp]]("task_end")
  def completed = column[Boolean]("completed")

  def * = (auditTaskId, amtAssignmentId, userId, streetEdgeId, taskStart, taskEnd, completed) <> ((AuditTask.apply _).tupled, AuditTask.unapply)

  def streetEdge = foreignKey("audit_task_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTable])(_.streetEdgeId)

  def user = foreignKey("audit_task_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}

/**
 * Data access object for the audit_task table
 */
object AuditTaskTable {
  import MyPostgresDriver.api._

  implicit val auditTaskConverter = GetResult[AuditTask](r => {
    AuditTask(r.nextInt, r.nextIntOption, r.nextString, r.nextInt, r.nextTimestamp, r.nextTimestampOption, r.nextBoolean)
  })

  implicit val auditCountPerDayConverter = GetResult[AuditCountPerDay](r => {
    AuditCountPerDay(r.nextString, r.nextInt)
  })

  //  case class NewTask(edgeId: Int, geom: LineString, x1: Float, y1: Float, x2: Float, y2: Float, taskStart: Timestamp, completed: Boolean)

  implicit val newTaskConverter = GetResult[NewTask](r => {
    val edgeId = r.nextInt
    val geom = r.nextGeometry[LineString]
    val x1 = r.nextFloat
    val y1 = r.nextFloat
    val x2 = r.nextFloat
    val y2 = r.nextFloat
    val taskStart = r.nextTimestamp
    val completedByAnyUser = r.nextBoolean
    val priority = r.nextDouble
    val completed = r.nextBooleanOption.getOrElse(false)
    NewTask(edgeId, geom, x1, y1, x2, y2, taskStart, completedByAnyUser, priority, completed)
  })

  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val auditTasks = TableQuery[AuditTaskTable]
  val labels = TableQuery[LabelTable]
  val labelTypes = TableQuery[LabelTypeTable]
  val streetEdges = TableQuery[StreetEdgeTable]
  val streetEdgePriorities = TableQuery[StreetEdgePriorityTable]
  val users = TableQuery[UserTable]

  val completedTasks = auditTasks.filter(_.completed)
  val streetEdgesWithoutDeleted = streetEdges.filterNot(_.deleted)
  val nonDeletedStreetEdgeRegions = StreetEdgeRegionTable.nonDeletedStreetEdgeRegions

  /**
   * This method returns all the tasks
   *
   * @return
   */
  def all: Future[Seq[AuditTask]] = db.run {
    auditTasks.result
  }

  // Sub query with columns (street_edge_id, completed_by_any_user): (Int, Boolean).
  // TODO it would be better to only consier "good user" audits here, but it would take too long to calculate each time.
  def streetCompletedByAnyUser: Query[(Rep[Int], Rep[Boolean]), (Int, Boolean), Seq] = {
    streetEdgesWithoutDeleted.joinLeft(completedTasks).on(_.streetEdgeId === _.streetEdgeId)
      .map { case (_street, _audit) => (_street.streetEdgeId, _audit.map(_.auditTaskId)) }
      .groupBy(_._1).map { case (_street, group) => (_street, group.map(_._2).countDefined > 0) }
  }

  /**
   * Returns a count of the number of audits performed on each day since the tool was launched (11/17/2015).
   *
   * @return
   */
  def auditCounts: Future[Seq[AuditCountPerDay]] = db.run {
    sql"""SELECT calendar_date::date, COUNT(audit_task_id)
          FROM
          (
              SELECT  current_date - (n || ' day')::INTERVAL AS calendar_date
              FROM generate_series(0, current_date - '11/17/2015') n
          ) AS calendar
          LEFT JOIN sidewalk.audit_task ON audit_task.task_start::date = calendar_date::date
          GROUP BY calendar_date
          ORDER BY calendar_date""".as[AuditCountPerDay]
  }

  /**
   * Returns the number of tasks completed
   * @return
   */
  def countCompletedAudits: Future[Int] = db.run {
    completedTasks.length.result
  }

  /**
   * Returns the number of tasks completed today
   *
   * Author: Manaswi Saha
   * Date: Aug 30, 2016
   */
  def countCompletedAuditsToday: Future[Int] = db.run {
    //    val dateFormat = new SimpleDateFormat("Y-mm-dd")
    //    val today = dateFormat.format(Calendar.getInstance().getTime())
    //    auditTasks.filter(_.taskEnd.toString() == today).filter(_.completed).list.size

    sql"""SELECT COUNT(audit_task_id)
          FROM sidewalk.audit_task
          WHERE audit_task.task_end::date = now()::date
              AND audit_task.completed = TRUE""".as[Int].head
  }

  /**
   * Returns the number of tasks completed
   *
   * Author: Manaswi Saha
   * Date: Aug 30, 2016
   */
  def countCompletedAuditsYesterday: Future[Int] = db.run {
    sql"""SELECT COUNT(audit_task_id)
          FROM sidewalk.audit_task
          WHERE audit_task.task_end::date = now()::date - interval '1' day
              AND audit_task.completed = TRUE""".as[Int].head
  }

  /**
   * Returns the number of tasks completed by the given user
   *
   * @param userId
   * @return
   */
  def countCompletedAuditsByUserId(userId: UUID): Future[Int] = db.run {
    completedTasks.filter(_.userId === userId.toString).length.result
  }

  /**
   * Find a task
   *
   * @param auditTaskId
   * @return
   */
  def find(auditTaskId: Int): Future[Option[AuditTask]] = db.run(
    auditTasks.filter(_.auditTaskId === auditTaskId).result.headOption)

  def streetEdgeIdsNotAuditedByUserQuery(user: UUID): Query[Rep[Int], Int, Seq] = {
    val edgesAuditedByUser = completedTasks.filter(_.userId === user.toString)

    streetEdgesWithoutDeleted.joinLeft(edgesAuditedByUser).on(_.streetEdgeId === _.streetEdgeId)
      .filter(_._2.isEmpty).map(_._1.streetEdgeId)
  }

  /**
   * Gets list streets that the user has not audited.
   *
   * @param user
   * @return
   */
  def streetEdgeIdsNotAuditedByUser(user: UUID): Future[Seq[Int]] = db.run {
    streetEdgeIdsNotAuditedByUserQuery(user).result
  }

  /**
   * Gets the list of streets in the specified region that the user has not audited.
   *
   * @param user
   * @param regionId
   * @return
   */
  def streetEdgeIdsNotAuditedByUser(user: UUID, regionId: Int): Future[Seq[Int]] = db.run({
    val edgesAuditedByUser = completedTasks.filter(_.userId === user.toString)

    nonDeletedStreetEdgeRegions.joinLeft(edgesAuditedByUser).on(_.streetEdgeId === _.streetEdgeId)
      .filter(x => x._2.isEmpty && x._1.regionId === regionId).map(_._1.streetEdgeId).result
  })

  /**
   * Verify if there are tasks available for the user in the given region
   *
   * @param user user id
   * @param regionId
   */
  def isTaskAvailable(user: UUID, regionId: Int): Future[Boolean] = {
    streetEdgeIdsNotAuditedByUser(user, regionId).map(_.nonEmpty)
  }

  /**
   * Get a set of regions where the user has not completed all the street edges.
   *
   * @param user UUID for the user
   * @return
   */
  def selectIncompleteRegions(user: UUID): Future[Set[Int]] = {
    db.run {
      nonDeletedStreetEdgeRegions
        .joinLeft(streetEdgeIdsNotAuditedByUserQuery(user)).on(_.streetEdgeId === _)
        .filter(_._2.nonEmpty)
        .groupBy(_._1.regionId).map { case (rId, group) => rId }.result
    }.map(_.toSet)
  }

  /**
   * Return a list of tasks associated with labels
   *
   * @param userId User id
   * @return
   */
  def selectTasksWithLabels(userId: UUID): Future[Seq[AuditTaskWithALabel]] = {
    val userTasks = for {
      (_users, _tasks) <- users.join(auditTasks).on(_.userId === _.userId)
      if _users.userId === userId.toString
    } yield (_users.userId, _users.username, _tasks.auditTaskId, _tasks.streetEdgeId, _tasks.taskStart, _tasks.taskEnd)

    val userTaskLabels = for {
      (_userTasks, _labels) <- userTasks.join(labels).on(_._3 === _.auditTaskId)
      if _labels.deleted === false
    } yield (_userTasks._1, _userTasks._2, _userTasks._3, _userTasks._4, _userTasks._5, _userTasks._6, _labels.labelId, _labels.temporaryLabelId, _labels.labelTypeId)

    val tasksWithLabels = for {
      (_labelTypes, _userTaskLabels) <- labelTypes.join(userTaskLabels).on(_.labelTypeId === _._9)
    } yield (_userTaskLabels._1, _userTaskLabels._2, _userTaskLabels._3, _userTaskLabels._4, _userTaskLabels._5, _userTaskLabels._6, _userTaskLabels._7.?, _userTaskLabels._8, _labelTypes.labelType.?)

    db.run(tasksWithLabels.result).map(tasks => tasks.map(AuditTaskWithALabel.tupled(_)))
  }

  /**
   * Get the last audit task that the user conducted
   *
   * @param userId User id
   * @return
   */
  def lastAuditTask(userId: UUID): Future[Option[AuditTask]] = db.run {
    auditTasks.filter(_.userId === userId.toString).sortBy(_.auditTaskId.desc).result.headOption
  }

  /**
   * Returns a true if the user has a completed audit task for the given street edge, false otherwise.
   *
   * @param streetEdgeId
   * @param user
   * @return
   */
  def userHasAuditedStreet(streetEdgeId: Int, user: UUID): Future[Boolean] = {
    db.run(
      completedTasks.filter(t => t.streetEdgeId === streetEdgeId && t.userId === user.toString).result.headOption).map(_.isDefined)
  }

  /**
   * Returns true if there is a completed audit task for the given street edge, false otherwise.
   *
   * @param streetEdgeId
   * @return
   */
  def anyoneHasAuditedStreet(streetEdgeId: Int): Future[Boolean] = {
    db.run(completedTasks.filter(_.streetEdgeId === streetEdgeId).result).map(_.nonEmpty)
  }

  /**
   * Return audited street edges
   *
   * @return
   */
  def selectStreetsAudited: Future[Seq[StreetEdge]] = db.run({
    val _streetEdges = for {
      (_tasks, _edges) <- completedTasks.join(streetEdgesWithoutDeleted).on(_.streetEdgeId === _.streetEdgeId)
    } yield _edges

    val _edgeIds = _streetEdges.groupBy(_.streetEdgeId).map(_._1)
    streetEdgesWithoutDeleted.join(_edgeIds).on(_.streetEdgeId === _).map(_._1).result
  })

  /**
   * Return street edges audited by the given user
   *
   * @param userId User Id
   * @return
   */
  def selectStreetsAuditedByAUser(userId: UUID): Future[Seq[StreetEdge]] = db.run({
    val _streetEdges = for {
      (_tasks, _edges) <- completedTasks.join(streetEdgesWithoutDeleted).on(_.streetEdgeId === _.streetEdgeId)
      if _tasks.userId === userId.toString
    } yield _edges

    val _edgeIds = _streetEdges.groupBy(_.streetEdgeId).map(_._1)
    streetEdgesWithoutDeleted.join(_edgeIds).on(_.streetEdgeId === _).map(_._1).result
  })

  /**
   * Return audit counts for the last 31 days.
   *
   * @param userId User id
   */
  def selectAuditCountsPerDayByUserId(userId: UUID): Future[Seq[AuditCountPerDay]] = db.run({
    sql"""SELECT calendar_date::date, COUNT(audit_task_id)
          FROM
          (
              SELECT current_date - (n || ' day')::INTERVAL AS calendar_date
              FROM generate_series(0, 30) n
          ) AS calendar
          LEFT JOIN sidewalk.audit_task ON audit_task.task_start::date = calendar_date::date
                                        AND audit_task.user_id = #${userId.toString}
          GROUP BY calendar_date
          ORDER BY calendar_date""".as[AuditCountPerDay]
  })

  /**
   *
   * @param userId
   * @return
   */
  def selectCompletedTasks(userId: UUID): Future[Seq[AuditTask]] = db.run {
    completedTasks.filter(_.userId === userId.toString).result
  }

  /**
   * Get the sum of the line distance of all streets in the region that the user has not audited.
   * TODO not compiling, waiting on stackoverflow question I asked:
   * https://stackoverflow.com/questions/53094473/changes-to-slick-pg-length-function-for-replinestring
   *
   * @param userId
   * @param regionId
   * @return
   */
  def getUnauditedDistance(userId: UUID, regionId: Int): Future[Seq[Float]] = { // TODO NOT A SEQ, SUM THEM
    val edgesAuditedByUser = completedTasks.filter(_.userId === userId.toString)

    val unAuditedEdges = nonDeletedStreetEdgeRegions.joinLeft(edgesAuditedByUser).on(_.streetEdgeId === _.streetEdgeId)
      .filter(x => x._2.isEmpty && x._1.regionId === regionId).map(_._1.streetEdgeId)

    //    db.run {
    //      streetEdgesWithoutDeleted.join(unAuditedEdges).on(_.streetEdgeId === _)
    //        .map(_._1.streetEdgeId).sum.result
    //    }.map(_.getOrElse(0))
    //    db.run(streetEdgesWithoutDeleted.map(_.streetEdgeId).sum.result).map(_.getOrElse(0))
    db.run(streetEdgesWithoutDeleted.map(_.geom.transform(26918).length).result) //.map(_.getOrElse(0F))

    //    val streetsLeft: List[Int] = streetEdgeIdsNotAuditedByUser(userId, regionId)
    //    streetEdgesWithoutDeleted.filter(_.streetEdgeId inSet streetsLeft).map(_.geom.transform(26918).length).list.sum
  }

  /**
   * Get a new task specified by the street edge id. Used when calling the /audit/street route.
   *
   * @param streetEdgeId Street edge id
   * @return
   */
  def selectANewTask(streetEdgeId: Int, user: Option[UUID]): Future[NewTask] = {
    val timestamp: Timestamp = new Timestamp(Calendar.getInstance(TimeZone.getTimeZone("UTC")).getTime.getTime)

    // Set completed to true if the user has already audited this street.
    val userCompletedFuture =
      if (user.isDefined) userHasAuditedStreet(streetEdgeId, user.get)
      else Future.successful(false)

    userCompletedFuture.flatMap { userCompleted =>
      db.run({
        // Join with other queries to get completion count and priority for each of the street edges.
        val edges = for {
          se <- streetEdgesWithoutDeleted if se.streetEdgeId === streetEdgeId
          scau <- streetCompletedByAnyUser if se.streetEdgeId === scau._1
          sep <- streetEdgePriorities if scau._1 === sep.streetEdgeId
        } yield (se.streetEdgeId, se.geom, se.x1, se.y1, se.x2, se.y2, timestamp, scau._2, sep.priority, userCompleted)

        edges.result.head

      }).map(NewTask.tupled)
    }
  }

  /**
   * Get a task that is in a given region. Used if a user has already been assigned a region, or from /audit/region.
   *
   * @param regionId region id
   * @param user User ID.
   * @return
   */
  def selectANewTaskInARegion(regionId: Int, user: UUID): Future[Option[NewTask]] = {
    val timestamp: Timestamp = new Timestamp(Calendar.getInstance(TimeZone.getTimeZone("UTC")).getTime.getTime)

    streetEdgeIdsNotAuditedByUser(user, regionId).flatMap { streetEdgeIds =>
      // Get the streets that the user has not already completed.
      val edgesInRegion = streetEdges.filter(_.streetEdgeId inSet streetEdgeIds)

      // Join with other queries to get completion count and priority for each of the street edges.
      val possibleTasks = for {
        sp <- streetEdgePriorities
        se <- edgesInRegion if sp.streetEdgeId === se.streetEdgeId
        sc <- streetCompletedByAnyUser if se.streetEdgeId === sc._1
      } yield (se.streetEdgeId, se.geom, se.x1, se.y1, se.x2, se.y2, timestamp, sc._2, sp.priority, false)

      // Get the highest priority task.
      db.run(possibleTasks.sortBy(_._9.desc).result.headOption)
        .map(_.map(NewTask.tupled))
    }
  }

  /**
   * Get tasks in the region. Called when a list of tasks is requested through the API.
   *
   * @param regionId Region id
   * @return
   */
  def selectTasksInARegion(regionId: Int): Future[List[NewTask]] = {
    val timestamp = new Timestamp(Calendar.getInstance(TimeZone.getTimeZone("UTC")).getTime.getTime)
    db.run({
      val tasks = for {
        ser <- nonDeletedStreetEdgeRegions if ser.regionId === regionId
        se <- streetEdges if ser.streetEdgeId === se.streetEdgeId
        sep <- streetEdgePriorities if se.streetEdgeId === sep.streetEdgeId
        scau <- streetCompletedByAnyUser if sep.streetEdgeId === scau._1
      } yield (se.streetEdgeId, se.geom, se.x1, se.y1, se.x2, se.y2, timestamp, scau._2, sep.priority, false)

      tasks.to[List].result

    }).map(_.map(NewTask.tupled(_)))
  }

  /**
   * Get tasks in the region. Called when a user begins auditing a region.
   *
   * @param regionId Region id
   * @param user User id
   * @return
   */
  def selectTasksInARegion(regionId: Int, user: UUID): Future[List[NewTask]] = {
    val timestamp = new Timestamp(Calendar.getInstance(TimeZone.getTimeZone("UTC")).getTime.getTime)
    db.run({
      val edgesInRegion = nonDeletedStreetEdgeRegions.filter(_.regionId === regionId)

      // For every street in the region: (street_edge_id: Int, user_audited_street: Boolean)
      val userCompletedStreets: Query[(Rep[Int], Rep[Boolean]), (Int, Boolean), Seq] =
        completedTasks.filter(_.userId === user.toString)
          .joinRight(edgesInRegion).on(_.streetEdgeId === _.streetEdgeId)
          .map { case (_task, _edge) => (_task.map(_.auditTaskId), _edge.streetEdgeId) }
          .groupBy(_._2)
          .map { case (_edgeId, group) => (_edgeId, group.map(_._1).countDefined > 0) }

      val tasks = for {
        ser <- edgesInRegion
        ucs <- userCompletedStreets if ser.streetEdgeId === ucs._1
        se <- streetEdges if ser.streetEdgeId === se.streetEdgeId
        sep <- streetEdgePriorities if se.streetEdgeId === sep.streetEdgeId
        scau <- streetCompletedByAnyUser if sep.streetEdgeId === scau._1
      } yield (
        se.streetEdgeId, se.geom, se.x1, se.y1, se.x2, se.y2, timestamp, scau._2, sep.priority, ucs._2)

      tasks.to[List].result

    }).map(_.map(NewTask.tupled(_)))
  }

  def isAuditComplete(auditTaskId: Int): Future[Boolean] = db.run(
    auditTasks.filter(_.auditTaskId === auditTaskId).map(_.completed).result.headOption).map(_.getOrElse(false))

  /**
   * Saves a new audit task.
   *
   * Reference for rturning the last inserted item's id
   * http://stackoverflow.com/questions/21894377/returning-autoinc-id-after-insert-in-slick-2-0
   *
   * @param completedTask completed task
   * @return
   */
  def save(completedTask: AuditTask): Future[Int] = db.run(
    ((auditTasks returning auditTasks.map(_.auditTaskId)) += completedTask).transactionally)

  /**
   * Update the `completed` column of the specified audit task row.
   * Reference: http://slick.lightbend.com/doc/2.0.0/queries.html#updating
   *
   * @param auditTaskId Audit task id
   * @param completed A completed flag
   * @return Number of rows updated
   */
  def updateCompleted(auditTaskId: Int, completed: Boolean): Future[Int] = db.run {
    auditTasks.filter(_.auditTaskId === auditTaskId).map(task => task.completed).update(completed).transactionally
  }

  /**
   * Update the `task_end` column of the specified audit task row
   *
   * @param auditTaskId
   * @param timestamp
   * @return Number of rows updated
   */
  def updateTaskEnd(auditTaskId: Int, timestamp: Timestamp): Future[Int] = db.run {
    auditTasks.filter(_.auditTaskId === auditTaskId).map(task => task.taskEnd).update(Some(timestamp)).transactionally
  }
}
