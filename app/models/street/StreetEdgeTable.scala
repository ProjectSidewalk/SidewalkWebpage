package models.street

import java.sql.Timestamp
import scala.concurrent.ExecutionContext
//import java.util.Calendar
//import java.text.SimpleDateFormat
//import scala.concurrent.duration._
//import com.vividsolutions.jts.geom.LineString
//import controllers.{APIBBox, APIType}
//import controllers.APIType.APIType
//import models.audit.AuditTaskTable
//import models.user.SidewalkUserTableDef
//import models.user.{UserRoleTable, UserStatTable}
//import models.user.RoleTable
//import play.api.cache.Cache
//import play.api.Play.current
//import scala.slick.jdbc.{GetResult, StaticQuery => Q}

// New
import models.audit.AuditTaskTableDef
import models.utils.MyPostgresDriver
import play.api.db.slick.DatabaseConfigProvider
import javax.inject._
import play.api.db.slick.HasDatabaseConfigProvider
import com.google.inject.ImplementedBy
import models.utils.MyPostgresDriver.api._
import scala.concurrent.Future
import com.vividsolutions.jts.geom.LineString

case class StreetEdge(streetEdgeId: Int, geom: LineString, x1: Float, y1: Float, x2: Float, y2: Float, wayType: String, deleted: Boolean, timestamp: Option[Timestamp])

case class StreetEdgeInfo(val street: StreetEdge, osmId: Long, regionId: Int, val auditCount: Int)

class StreetEdgeTableDef(tag: Tag) extends Table[StreetEdge](tag, "street_edge") {
  def streetEdgeId: Rep[Int] = column[Int]("street_edge_id", O.PrimaryKey)
  def geom = column[LineString]("geom")
  def x1: Rep[Float] = column[Float]("x1")
  def y1: Rep[Float] = column[Float]("y1")
  def x2: Rep[Float] = column[Float]("x2")
  def y2: Rep[Float] = column[Float]("y2")
  def wayType: Rep[String] = column[String]("way_type")
  def deleted: Rep[Boolean] = column[Boolean]("deleted", O.Default(false))
  def timestamp: Rep[Option[Timestamp]] = column[Option[Timestamp]]("timestamp")

  def * = (streetEdgeId, geom, x1, y1, x2, y2, wayType, deleted, timestamp) <> ((StreetEdge.apply _).tupled, StreetEdge.unapply)
}

@ImplementedBy(classOf[StreetEdgeTable])
trait StreetEdgeTableRepository {
}

/**
 * Data access object for the street_edge table.
 */
@Singleton
class StreetEdgeTable @Inject()(
                                 protected val dbConfigProvider: DatabaseConfigProvider,
                                 implicit val ec: ExecutionContext
                               ) extends StreetEdgeTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._

  // For plain query
  // https://github.com/tminglei/slick-pg/blob/slick2/src/test/scala/com/github/tminglei/slickpg/addon/PgPostGISSupportTest.scala
//  import MyPostgresDriver.plainImplicits._

//  implicit val streetEdgeConverter = GetResult[StreetEdge](r => {
//    val streetEdgeId = r.nextInt
//    val geometry = r.nextGeometry[LineString]
//    val x1 = r.nextFloat
//    val y1 = r.nextFloat
//    val x2 = r.nextFloat
//    val y2 = r.nextFloat
//    val wayType = r.nextString
//    val deleted = r.nextBoolean
//    val timestamp = r.nextTimestampOption
//    StreetEdge(streetEdgeId, geometry, x1, y1, x2, y2, wayType, deleted, timestamp)
//  })
//
//  implicit val streetEdgeInformationConverter = GetResult[StreetEdgeInfo](r => {
//    val streetEdgeId = r.nextInt
//    val geometry = r.nextGeometry[LineString]
//    val x1 = r.nextFloat
//    val y1 = r.nextFloat
//    val x2 = r.nextFloat
//    val y2 = r.nextFloat
//    val wayType = r.nextString
//    val deleted = r.nextBoolean
//    val timestamp = r.nextTimestampOption
//    val osmId = r.nextLong
//    val regionId = r.nextInt
//    val auditCount = r.nextInt
//    StreetEdgeInfo(StreetEdge(streetEdgeId, geometry, x1, y1, x2, y2, wayType, deleted, timestamp), osmId, regionId, auditCount)
//  })

  val auditTasks = TableQuery[AuditTaskTableDef]
  val streetEdges = TableQuery[StreetEdgeTableDef]
  val streetEdgeRegion = TableQuery[StreetEdgeRegionTableDef]
//  val userRoles = TableQuery[UserRoleTableDef]
//  val userTable = TableQuery[UserTableDef]
//  val roleTable = TableQuery[RoleTableDef]

//  val completedAuditTasks = for {
//    _tasks <- auditTasks
//    _stat <- UserStatTable.userStats if _tasks.userId === _stat.userId
//    if _tasks.completed && !_stat.excluded
//  } yield _tasks
//
//  val turkerCompletedAuditTasks = for {
//    _tasks <- completedAuditTasks
//    _roleIds <- userRoles if _roleIds.userId === _tasks.userId
//    _roles <- roleTable if _roles.roleId === _roleIds.roleId && _roles.role === "Turker"
//  } yield _tasks
//
//  val regUserCompletedAuditTasks = for {
//    _users <- userTable
//    _tasks <- completedAuditTasks if _users.userId === _tasks.userId && _users.username =!= "anonymous"
//    _roleIds <- userRoles if _roleIds.userId === _tasks.userId
//    _roles <- roleTable if _roles.roleId === _roleIds.roleId && _roles.role === "Registered"
//  } yield _tasks
//
//  val researcherCompletedAuditTasks = for {
//    _tasks <- completedAuditTasks
//    _roleIds <- userRoles if _roleIds.userId === _tasks.userId
//    _roles <- roleTable if _roles.roleId === _roleIds.roleId
//    if _roles.role inSet List("Researcher", "Administrator", "Owner")
//  } yield _tasks
//
//  val anonCompletedAuditTasks = for {
//    _users <- userTable
//    _tasks <- completedAuditTasks if _users.userId === _tasks.userId && _users.username =!= "anonymous"
//    _roleIds <- userRoles if _roleIds.userId === _tasks.userId
//    _roles <- roleTable if _roles.roleId === _roleIds.roleId && _roles.role === "Anonymous"
//  } yield _tasks

  val streetEdgesWithoutDeleted = streetEdges.filter(_.deleted === false)

//  /**
//    * Count the number of streets that have been audited at least a given number of times.
//    *
//    * @return
//    */
//  def countTotalStreets(): Int = {
//    streetEdgesWithoutDeleted.size.run
//  }
//
//  /**
//    * Get the total distance in miles.
//    * Reference: http://gis.stackexchange.com/questions/143436/how-do-i-calculate-st-length-in-miles
//    *
//    * @return
//    */
  def totalStreetDistance: DBIO[Float] = {
//    Cache.getOrElse("totalStreetDistance()") {

    // Get length of each street segment and sum the lengths.
    streetEdgesWithoutDeleted.map(_.geom.transform(26918).length).sum.result.map(x => x.getOrElse(0.0F))
  }
//
//  /**
//    * Get the audited distance in miles.
//    * Reference: http://gis.stackexchange.com/questions/143436/how-do-i-calculate-st-length-in-miles
//    *
//    * @param auditCount
//    * @return
//    */
//  def auditedStreetDistance(auditCount: Int, userType: String = "All", highQualityOnly: Boolean = false): Float = {
//    val cacheKey = s"auditedStreetDistance($auditCount, $userType, $highQualityOnly)"
//
//    Cache.getOrElse(cacheKey, 30.minutes.toSeconds.toInt) {
//      val auditTaskQuery = userType match {
//        case "All" => completedAuditTasks
//        case "Researcher" => researcherCompletedAuditTasks
//        case "Turker" => turkerCompletedAuditTasks
//        case "Registered" => regUserCompletedAuditTasks
//        case "Anonymous" => anonCompletedAuditTasks
//        case _ => completedAuditTasks
//      }
//
//      val filteredTasks = if (highQualityOnly) {
//        for {
//            tasks <- auditTaskQuery
//            stats <- UserStatTable.userStats if tasks.userId === stats.userId
//            if stats.highQuality
//        } yield tasks
//      } else {
//          auditTaskQuery
//      }
//
//      val edges = for {
//        _edges <- streetEdgesWithoutDeleted
//        _tasks <- filteredTasks if _tasks.streetEdgeId === _edges.streetEdgeId
//      } yield _edges
//
//      // Gets tuple of (street_edge_id, num_completed_audits).
//      val edgesWithAuditCounts = edges.groupBy(x => x).map{
//        case (edge, group) => (edge.geom.transform(26918).length, group.length)
//      }
//
//      // Get length of each street segment, sum the lengths, and convert from meters to miles.
//      edgesWithAuditCounts.filter(_._2 >= auditCount).map(_._1).sum.run.map(_ * 0.000621371F).getOrElse(0.0F)
//    }
//  }
//
//  /**
//   * Calculates the total distance audited by all users over a specified time period.
//   *
//   * @param timeInterval can be "today" or "week". If anything else, defaults to "all time".
//   * @return The total distance audited by all users in miles.
//   */
//  def auditedStreetDistanceOverTime(timeInterval: String = "all time"): Float = {
//    // Build up SQL string related to audit task time intervals.
//    // Defaults to *not* specifying a time (which is the same thing as "all time").
//    val auditTaskTimeIntervalSql = timeInterval.toLowerCase() match {
//      case "today" => "(audit_task.task_end AT TIME ZONE 'US/Pacific')::date = (now() AT TIME ZONE 'US/Pacific')::date"
//      case "week" => "(audit_task.task_end AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'"
//      case _ => "TRUE"
//    }
//
//    // Execute query.
//    val getDistanceQuery = Q.queryNA[Float](
//      s"""SELECT SUM(ST_Length(ST_Transform(geom, 26918)))
//         |FROM street_edge
//         |INNER JOIN audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
//         |WHERE $auditTaskTimeIntervalSql
//         |     AND street_edge.deleted = FALSE
//         |     AND audit_task.completed = TRUE""".stripMargin
//    )
//    (getDistanceQuery.first * 0.000621371).toFloat
//  }
//
//  /**
//    * Computes percentage of the city audited over time.
//    *
//    * @param auditCount
//    * @return List[(String,Float)] representing dates and percentages
//    */
//  def streetDistanceCompletionRateByDate(auditCount: Int): Seq[(String, Float)] = {
//    // join the street edges and audit tasks
//    // TODO figure out how to do this w/out doing the join twice
//    val edges = for {
//      (_streetEdges, _auditTasks) <- streetEdgesWithoutDeleted.innerJoin(completedAuditTasks).on(_.streetEdgeId === _.streetEdgeId)
//    } yield _streetEdges
//    val audits = for {
//      (_streetEdges, _auditTasks) <- streetEdgesWithoutDeleted.innerJoin(completedAuditTasks).on(_.streetEdgeId === _.streetEdgeId)
//    } yield _auditTasks
//
//    // get distances of street edges associated with their edgeId.
//    val edgeDists: Map[Int, Float] = edges.groupBy(x => x).map(g => (g._1.streetEdgeId, g._1.geom.transform(26918).length)).list.toMap
//
//    // Filter out group of edges with the size less than the passed `auditCount`, picking 1 rep from each group.
//    // TODO pick audit with earliest timestamp.
//    val uniqueEdgeDists: List[(Timestamp, Option[Float])] = (for ((eid, groupedAudits) <- audits.list.groupBy(_.streetEdgeId)) yield {
//      if (auditCount > 0 && groupedAudits.size >= auditCount) {
//        Some((groupedAudits.head.taskEnd, edgeDists.get(eid)))
//      } else {
//        None
//      }
//    }).toList.flatten
//
//    // Round the timestamps down to just the date (year-month-day).
//    val dateRoundedDists: List[(Calendar, Double)] = uniqueEdgeDists.map({
//      pair => {
//        var c : Calendar = Calendar.getInstance()
//        c.setTimeInMillis(pair._1.getTime)
//        c.set(Calendar.HOUR_OF_DAY, 0)
//        c.set(Calendar.MINUTE, 0)
//        c.set(Calendar.SECOND, 0)
//        c.set(Calendar.MILLISECOND, 0)
//        (c, pair._2.get * 0.000621371) // converts from meters to miles
//      }})
//
//    // Sum the distances by date.
//    val distsPerDay: List[(Calendar, Double)] = dateRoundedDists.groupBy(_._1).mapValues(_.map(_._2).sum).view.force.toList
//
//    // Sort the list by date.
//    val sortedEdges: Seq[(Calendar, Double)] =
//      scala.util.Sorting.stableSort(distsPerDay, (e1: (Calendar,Double), e2: (Calendar, Double)) => e1._1.getTimeInMillis < e2._1.getTimeInMillis).toSeq
//
//    // Get the cumulative distance over time.
//    val cumDistsPerDay: Seq[(Calendar, Double)] = sortedEdges.map({var dist = 0.0; pair => {dist += pair._2; (pair._1, dist)}})
//
//    // Calculate the completion percentage for each day.
//    val totalDist = totalStreetDistance()
//    val ratePerDay: Seq[(Calendar, Float)] = cumDistsPerDay.map(pair => (pair._1, (100.0 * pair._2 / totalDist).toFloat))
//
//    // Format the calendar date in the correct format and return the (date,completionPercentage) pair.
//    val format1 = new SimpleDateFormat("yyyy-MM-dd")
//    ratePerDay.map(pair => (format1.format(pair._1.getTime), pair._2))
//  }
//
//  /**
//    * Returns a list of street edges that are audited at least auditCount times.
//    */
//  def selectAuditedStreets(auditCount: Int = 1, userType: String = "All", highQualityOnly: Boolean = false): List[StreetEdge] = {
//    val auditTasksQuery = userType match {
//      case "All" => completedAuditTasks
//      case "Researcher" => researcherCompletedAuditTasks
//      case "Turker" => turkerCompletedAuditTasks
//      case "Registered" => regUserCompletedAuditTasks
//      case "Anonymous" => anonCompletedAuditTasks
//      case _ => completedAuditTasks
//    }
//
//    val filteredTasks = if (highQualityOnly) {
//        for {
//            tasks <- auditTasksQuery
//            stats <- UserStatTable.userStats if tasks.userId === stats.userId
//            if stats.highQuality
//        } yield tasks
//      } else {
//          auditTasksQuery
//    }
//
//    val edges = for {
//      (_streetEdges, _auditTasks) <- streetEdgesWithoutDeleted.innerJoin(filteredTasks).on(_.streetEdgeId === _.streetEdgeId)
//    } yield _streetEdges
//
//    val uniqueStreetEdges: List[StreetEdge] = (for ((eid, groupedEdges) <- edges.list.groupBy(_.streetEdgeId)) yield {
//      // Filter out group of edges with the size less than the passed `auditCount`
//      if (auditCount > 0 && groupedEdges.size >= auditCount) {
//        Some(groupedEdges.head)
//      } else {
//        None
//      }
//    }).toList.flatten
//
//    uniqueStreetEdges
//  }
//
//  /**
//    * Count the number of streets that have been audited at least a given number of times.
//    */
//  def countAuditedStreets(auditCount: Int = 1, userType: String = "All", highQualityOnly: Boolean = false): Int = {
//    selectAuditedStreets(auditCount, userType, highQualityOnly).size
//  }
//
//  /** Returns the distance of the given street edge. */
//  def getStreetEdgeDistance(streetEdgeId: Int): Float = {
//    streetEdgesWithoutDeleted.filter(_.streetEdgeId === streetEdgeId).groupBy(x => x).map(_._1.geom.transform(26918).length).first
//  }
//
//  def selectStreetsIntersecting(apiType: APIType, bbox: APIBBox): List[StreetEdgeInfo] = {
//    require(apiType != APIType.Attribute, "This method is not supported for the Attributes API.")
//    val locationFilter: String = if (apiType == APIType.Neighborhood) {
//      s"ST_Within(region.geom, ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326))"
//    } else {
//      s"ST_Intersects(street_edge.geom, ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326))"
//    }
//    // http://gis.stackexchange.com/questions/60700/postgis-select-by-lat-long-bounding-box
//    // http://postgis.net/docs/ST_MakeEnvelope.html
//    val selectEdgeQuery = Q.queryNA[StreetEdgeInfo](
//      s"""SELECT street_edge.street_edge_id,
//         |       street_edge.geom,
//         |       street_edge.x1,
//         |       street_edge.y1,
//         |       street_edge.x2,
//         |       street_edge.y2,
//         |       street_edge.way_type,
//         |       street_edge.deleted,
//         |       street_edge.timestamp,
//         |       osm_way_street_edge.osm_way_id,
//         |       region.region_id,
//         |       SUM(CASE WHEN user_stat.high_quality = TRUE AND audit_task.completed = TRUE THEN 1 ELSE 0 END) AS audit_count
//         |FROM street_edge
//         |INNER JOIN osm_way_street_edge ON street_edge.street_edge_id = osm_way_street_edge.street_edge_id
//         |INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
//         |INNER JOIN region ON street_edge_region.region_id = region.region_id
//         |LEFT JOIN audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
//         |LEFT JOIN user_stat ON audit_task.user_id = user_stat.user_id
//         |WHERE street_edge.deleted = FALSE
//         |    AND $locationFilter
//         |GROUP BY street_edge.street_edge_id, osm_way_street_edge.osm_way_id, region.region_id""".stripMargin
//    )
//    selectEdgeQuery.list
//  }
}
