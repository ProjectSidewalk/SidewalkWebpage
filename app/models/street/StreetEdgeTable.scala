package models.street

import java.sql.Timestamp
import java.util.Calendar
import java.text.SimpleDateFormat
import scala.concurrent.duration._
import com.vividsolutions.jts.geom.LineString
import models.audit.AuditTaskTable
import models.daos.slick.DBTableDefinitions.UserTable
import models.user.{User, UserStatTable, UserRoleTable}
import models.user.RoleTable
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import play.api.cache.Cache
import play.api.Play.current
import scala.slick.jdbc.{GetResult, StaticQuery => Q}

case class StreetEdge(streetEdgeId: Int, geom: LineString, x1: Float, y1: Float, x2: Float, y2: Float, wayType: String, deleted: Boolean, timestamp: Option[Timestamp])

case class StreetEdgeInfo(val street: StreetEdge, val auditCount: Int)

class StreetEdgeTable(tag: Tag) extends Table[StreetEdge](tag, Some("sidewalk"), "street_edge") {
  def streetEdgeId = column[Int]("street_edge_id", O.PrimaryKey)
  def geom = column[LineString]("geom")
  def x1 = column[Float]("x1")
  def y1 = column[Float]("y1")
  def x2 = column[Float]("x2")
  def y2 = column[Float]("y2")
  def wayType = column[String]("way_type")
  def deleted = column[Boolean]("deleted", O.Default(false))
  def timestamp = column[Option[Timestamp]]("timestamp")

  def * = (streetEdgeId, geom, x1, y1, x2, y2, wayType, deleted, timestamp) <> ((StreetEdge.apply _).tupled, StreetEdge.unapply)
}

/**
 * Data access object for the street_edge table.
 */
object StreetEdgeTable {
  // For plain query
  // https://github.com/tminglei/slick-pg/blob/slick2/src/test/scala/com/github/tminglei/slickpg/addon/PgPostGISSupportTest.scala
  import MyPostgresDriver.plainImplicits._

  implicit val streetEdgeConverter = GetResult[StreetEdge](r => {
    val streetEdgeId = r.nextInt
    val geometry = r.nextGeometry[LineString]
    val x1 = r.nextFloat
    val y1 = r.nextFloat
    val x2 = r.nextFloat
    val y2 = r.nextFloat
    val wayType = r.nextString
    val deleted = r.nextBoolean
    val timestamp = r.nextTimestampOption
    StreetEdge(streetEdgeId, geometry, x1, y1, x2, y2, wayType, deleted, timestamp)
  })

  implicit val streetEdgeInformationConverter = GetResult[StreetEdgeInfo](r => {
    val streetEdgeId = r.nextInt
    val geometry = r.nextGeometry[LineString]
    val x1 = r.nextFloat
    val y1 = r.nextFloat
    val x2 = r.nextFloat
    val y2 = r.nextFloat
    val wayType = r.nextString
    val deleted = r.nextBoolean
    val timestamp = r.nextTimestampOption
    val auditCount = r.nextInt
    StreetEdgeInfo(StreetEdge(streetEdgeId, geometry, x1, y1, x2, y2, wayType, deleted, timestamp), auditCount)
  })

  val db = play.api.db.slick.DB
  val auditTasks = TableQuery[AuditTaskTable]
  val streetEdges = TableQuery[StreetEdgeTable]
  val streetEdgeRegion = TableQuery[StreetEdgeRegionTable]
  val userRoles = TableQuery[UserRoleTable]
  val userTable = TableQuery[UserTable]
  val roleTable = TableQuery[RoleTable]
  val completedAuditTasks = auditTasks.filter(_.completed === true)

  val turkerCompletedAuditTasks = for {
    _tasks <- completedAuditTasks
    _roleIds <- userRoles if _roleIds.userId === _tasks.userId
    _roles <- roleTable if _roles.roleId === _roleIds.roleId && _roles.role === "Turker"
  } yield _tasks

  val regUserCompletedAuditTasks = for {
    _users <- userTable
    _tasks <- completedAuditTasks if _users.userId === _tasks.userId && _users.username =!= "anonymous"
    _roleIds <- userRoles if _roleIds.userId === _tasks.userId
    _roles <- roleTable if _roles.roleId === _roleIds.roleId && _roles.role === "Registered"
  } yield _tasks

  val researcherCompletedAuditTasks = for {
    _tasks <- completedAuditTasks
    _roleIds <- userRoles if _roleIds.userId === _tasks.userId
    _roles <- roleTable if _roles.roleId === _roleIds.roleId
    if _roles.role inSet List("Researcher", "Administrator", "Owner")
  } yield _tasks

  val anonCompletedAuditTasks = for {
    _users <- userTable
    _tasks <- completedAuditTasks if _users.userId === _tasks.userId && _users.username =!= "anonymous"
    _roleIds <- userRoles if _roleIds.userId === _tasks.userId
    _roles <- roleTable if _roles.roleId === _roleIds.roleId && _roles.role === "Anonymous"
  } yield _tasks

  val streetEdgesWithoutDeleted = streetEdges.filter(_.deleted === false)

  /**
    * Count the number of streets that have been audited at least a given number of times.
    *
    * @return
    */
  def countTotalStreets(): Int = db.withSession { implicit session =>
    streetEdgesWithoutDeleted.length.run
  }

  /**
    * Returns the audit completion rate for the specified group of users.
    *
    * @param auditCount
    * @param userType
    * @return
    */
  def auditCompletionRate(auditCount: Int, userType: String = "All", highQualityOnly: Boolean = false): Float = db.withSession { implicit session =>
    val auditedStreetCount = countAuditedStreets(1, userType, highQualityOnly).toFloat
    val allEdgesCount: Int = streetEdgesWithoutDeleted.length.run
    auditedStreetCount / allEdgesCount
  }

  /**
    * Calculate the proportion of the total miles of the city that have been audited at least auditCount times.
    *
    * @param auditCount
    * @return Float between 0 and 1
    */
  def streetDistanceCompletionRate(auditCount: Int, userType: String = "All", highQualityOnly: Boolean = false): Float = db.withSession { implicit session =>
    val auditedDistance: Float = auditedStreetDistance(auditCount, userType, highQualityOnly)
    val totalDistance: Float = totalStreetDistance()
    auditedDistance / totalDistance
  }

  /**
    * Get the total distance in miles.
    * Reference: http://gis.stackexchange.com/questions/143436/how-do-i-calculate-st-length-in-miles
    *
    * @return
    */
  def totalStreetDistance(): Float = db.withSession { implicit session =>
    Cache.getOrElse("totalStreetDistance()") {

      // Get length of each street segment, sum the lengths, and convert from meters to miles.
      val distances: List[Float] = streetEdgesWithoutDeleted.map(_.geom.transform(26918).length).list
      (distances.sum * 0.000621371).toFloat
    }
  }

  /**
    * Get the audited distance in miles.
    * Reference: http://gis.stackexchange.com/questions/143436/how-do-i-calculate-st-length-in-miles
    *
    * @param auditCount
    * @return
    */
  def auditedStreetDistance(auditCount: Int, userType: String = "All", highQualityOnly: Boolean = false): Float = db.withSession { implicit session =>
    val cacheKey = s"auditedStreetDistance($auditCount, $userType, $highQualityOnly)"

    Cache.getOrElse(cacheKey, 30.minutes.toSeconds.toInt) {
      val auditTaskQuery = userType match {
        case "All" => completedAuditTasks
        case "Researcher" => researcherCompletedAuditTasks
        case "Turker" => turkerCompletedAuditTasks
        case "Registered" => regUserCompletedAuditTasks
        case "Anonymous" => anonCompletedAuditTasks
        case _ => completedAuditTasks
      }

      val filteredTasks = if (highQualityOnly) {
        for {
            tasks <- auditTaskQuery
            stats <- UserStatTable.userStats if tasks.userId === stats.userId
            if stats.highQuality && !stats.excluded
        } yield tasks
      } else {
          auditTaskQuery
      }

      val edges = for {
        _edges <- streetEdgesWithoutDeleted
        _tasks <- filteredTasks if _tasks.streetEdgeId === _edges.streetEdgeId
      } yield _edges

      // Gets tuple of (street_edge_id, num_completed_audits).
      val edgesWithAuditCounts = edges.groupBy(x => x).map{
        case (edge, group) => (edge.geom.transform(26918).length, group.length)
      }

      // Get length of each street segment, sum the lengths, and convert from meters to miles.
      edgesWithAuditCounts.filter(_._2 >= auditCount).map(_._1).sum.run.map(_ * 0.000621371F).getOrElse(0.0F)
    }
  }

  /**
    * Calculates the distance audited today by all users.
    *
    * @return The distance audited today by all users in miles.
    */
  def auditedStreetDistanceToday(): Float = db.withSession { implicit session =>
    val getDistanceQuery = Q.queryNA[Float](
      """SELECT SUM(ST_Length(ST_Transform(geom, 26918)))
        |FROM street_edge
        |INNER JOIN audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
        |WHERE (audit_task.task_end AT TIME ZONE 'US/Pacific')::date = (now() AT TIME ZONE 'US/Pacific')::date
        |     AND street_edge.deleted = FALSE
        |     AND audit_task.completed = TRUE""".stripMargin
    )
    (getDistanceQuery.first * 0.000621371).toFloat;
  }

  /**
    * Calculates the distance audited during the past week by all users.
    *
    * @return The distance audited during the past week by all users in miles.
    */
  def auditedStreetDistancePastWeek(): Float = db.withSession { implicit session =>
    val getDistanceQuery = Q.queryNA[Float](
        """SELECT SUM(ST_Length(ST_Transform(geom, 26918)))
            |FROM street_edge
            |INNER JOIN audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
            |WHERE (audit_task.task_end AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'
            |     AND street_edge.deleted = FALSE
            |     AND audit_task.completed = TRUE""".stripMargin
        )
    (getDistanceQuery.first * 0.000621371).toFloat;
  }

  /**
    * Computes percentage of the city audited over time.
    *
    * @param auditCount
    * @return List[(String,Float)] representing dates and percentages
    */
  def streetDistanceCompletionRateByDate(auditCount: Int): Seq[(String, Float)] = db.withSession { implicit session =>
    // join the street edges and audit tasks
    // TODO figure out how to do this w/out doing the join twice
    val edges = for {
      (_streetEdges, _auditTasks) <- streetEdgesWithoutDeleted.innerJoin(completedAuditTasks).on(_.streetEdgeId === _.streetEdgeId)
    } yield _streetEdges
    val audits = for {
      (_streetEdges, _auditTasks) <- streetEdgesWithoutDeleted.innerJoin(completedAuditTasks).on(_.streetEdgeId === _.streetEdgeId)
    } yield _auditTasks

    // get distances of street edges associated with their edgeId.
    val edgeDists: Map[Int, Float] = edges.groupBy(x => x).map(g => (g._1.streetEdgeId, g._1.geom.transform(26918).length)).list.toMap

    // Filter out group of edges with the size less than the passed `auditCount`, picking 1 rep from each group.
    // TODO pick audit with earliest timestamp.
    val uniqueEdgeDists: List[(Option[Timestamp], Option[Float])] = (for ((eid, groupedAudits) <- audits.list.groupBy(_.streetEdgeId)) yield {
      if (auditCount > 0 && groupedAudits.size >= auditCount) {
        Some((groupedAudits.head.taskEnd, edgeDists.get(eid)))
      } else {
        None
      }
    }).toList.flatten

    // Round the timestamps down to just the date (year-month-day).
    val dateRoundedDists: List[(Calendar, Double)] = uniqueEdgeDists.map({
      pair => {
        var c : Calendar = Calendar.getInstance()
        c.setTimeInMillis(pair._1.get.getTime)
        c.set(Calendar.HOUR_OF_DAY, 0)
        c.set(Calendar.MINUTE, 0)
        c.set(Calendar.SECOND, 0)
        c.set(Calendar.MILLISECOND, 0)
        (c, pair._2.get * 0.000621371) // converts from meters to miles
      }})

    // Sum the distances by date.
    val distsPerDay: List[(Calendar, Double)] = dateRoundedDists.groupBy(_._1).mapValues(_.map(_._2).sum).view.force.toList

    // Sort the list by date.
    val sortedEdges: Seq[(Calendar, Double)] =
      scala.util.Sorting.stableSort(distsPerDay, (e1: (Calendar,Double), e2: (Calendar, Double)) => e1._1.getTimeInMillis < e2._1.getTimeInMillis).toSeq

    // Get the cumulative distance over time.
    val cumDistsPerDay: Seq[(Calendar, Double)] = sortedEdges.map({var dist = 0.0; pair => {dist += pair._2; (pair._1, dist)}})

    // Calculate the completion percentage for each day.
    val totalDist = totalStreetDistance()
    val ratePerDay: Seq[(Calendar, Float)] = cumDistsPerDay.map(pair => (pair._1, (100.0 * pair._2 / totalDist).toFloat))

    // Format the calendar date in the correct format and return the (date,completionPercentage) pair.
    val format1 = new SimpleDateFormat("yyyy-MM-dd")
    ratePerDay.map(pair => (format1.format(pair._1.getTime), pair._2))
  }

  /**
    * Returns a list of street edges that are audited at least auditCount times.
    */
  def selectAuditedStreets(auditCount: Int = 1, userType: String = "All", highQualityOnly: Boolean = false): List[StreetEdge] = db.withSession { implicit session =>
    val auditTasksQuery = userType match {
      case "All" => completedAuditTasks
      case "Researcher" => researcherCompletedAuditTasks
      case "Turker" => turkerCompletedAuditTasks
      case "Registered" => regUserCompletedAuditTasks
      case "Anonymous" => anonCompletedAuditTasks
      case _ => completedAuditTasks
    }

    val filteredTasks = if (highQualityOnly) {
        for {
            tasks <- auditTasksQuery
            stats <- UserStatTable.userStats if tasks.userId === stats.userId
            if stats.highQuality && !stats.excluded
        } yield tasks
      } else {
          auditTasksQuery
    }

    val edges = for {
      (_streetEdges, _auditTasks) <- streetEdgesWithoutDeleted.innerJoin(filteredTasks).on(_.streetEdgeId === _.streetEdgeId)
    } yield _streetEdges

    val uniqueStreetEdges: List[StreetEdge] = (for ((eid, groupedEdges) <- edges.list.groupBy(_.streetEdgeId)) yield {
      // Filter out group of edges with the size less than the passed `auditCount`
      if (auditCount > 0 && groupedEdges.size >= auditCount) {
        Some(groupedEdges.head)
      } else {
        None
      }
    }).toList.flatten

    uniqueStreetEdges
  }

  /**
    * Count the number of streets that have been audited at least a given number of times.
    */
  def countAuditedStreets(auditCount: Int = 1, userType: String = "All", highQualityOnly: Boolean = false): Int = db.withSession { implicit session =>
    selectAuditedStreets(auditCount, userType, highQualityOnly).size
  }

  /** Returns the sum of the lengths of all streets in the region. */
  def getTotalDistanceOfARegion(regionId: Int): Float = db.withSession { implicit session =>
    val streetsInRegion = for {
      _edgeRegions <- streetEdgeRegion if _edgeRegions.regionId === regionId
      _edges <- streetEdgesWithoutDeleted if _edges.streetEdgeId === _edgeRegions.streetEdgeId
    } yield _edges

    // Select distinct and sum the lengths of the streets.
    streetsInRegion.groupBy(x => x).map(_._1.geom.transform(26918).length).list.sum
  }

  /** Returns the distance of the given street edge. */
  def getStreetEdgeDistance(streetEdgeId: Int): Float = db.withSession { implicit session =>
    streetEdgesWithoutDeleted.filter(_.streetEdgeId === streetEdgeId).groupBy(x => x).map(_._1.geom.transform(26918).length).first
  }

  def selectStreetsIntersecting(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): List[StreetEdgeInfo] = db.withSession { implicit session =>
    // http://gis.stackexchange.com/questions/60700/postgis-select-by-lat-long-bounding-box
    // http://postgis.net/docs/ST_MakeEnvelope.html
    val selectEdgeQuery = Q.query[(Double, Double, Double, Double), StreetEdgeInfo](
      """SELECT street_edge.street_edge_id,
        |       street_edge.geom,
        |       street_edge.x1,
        |       street_edge.y1,
        |       street_edge.x2,
        |       street_edge.y2,
        |       street_edge.way_type,
        |       street_edge.deleted,
        |       street_edge.timestamp,
        |       SUM(CASE WHEN user_stat.high_quality = TRUE AND audit_task.completed = TRUE THEN 1 ELSE 0 END) AS audit_count
        |FROM street_edge
        |LEFT JOIN audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
        |LEFT JOIN user_stat ON audit_task.user_id = user_stat.user_id
        |WHERE street_edge.deleted = FALSE
        |    AND ST_Intersects(street_edge.geom, ST_MakeEnvelope(?, ?, ?, ?, 4326))
        |GROUP BY street_edge.street_edge_id""".stripMargin
    )
    selectEdgeQuery((minLng, minLat, maxLng, maxLat)).list
  }
}
