package models.street

import java.sql.Timestamp
import java.util.UUID
import java.util.Calendar
import java.text.SimpleDateFormat
import scala.concurrent.duration._

import com.vividsolutions.jts.geom.LineString
import models.audit.AuditTaskTable
import models.region.RegionTable
import models.daos.slick.DBTableDefinitions.UserTable
import models.user.UserRoleTable
import models.user.RoleTable
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import org.postgresql.util.PSQLException
import play.api.cache.Cache
import play.api.Play.current

import scala.slick.jdbc.{GetResult, StaticQuery => Q}

case class StreetEdge(streetEdgeId: Int, geom: LineString, x1: Float, y1: Float, x2: Float, y2: Float, wayType: String, deleted: Boolean, timestamp: Option[Timestamp])

/**
 *
 */
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
 * Data access object for the street_edge table
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

  val db = play.api.db.slick.DB
  val auditTasks = TableQuery[AuditTaskTable]
  val regions = TableQuery[RegionTable]
  val streetEdges = TableQuery[StreetEdgeTable]
  val streetEdgeRegion = TableQuery[StreetEdgeRegionTable]

  val userRoles = TableQuery[UserRoleTable]
  val userTable = TableQuery[UserTable]
  val roleTable = TableQuery[RoleTable]
  val neighborhoods = regions.filter(_.deleted === false).filter(_.regionTypeId === 2)

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
  val streetEdgeNeighborhood = for { (se, n) <- streetEdgeRegion.innerJoin(neighborhoods).on(_.regionId === _.regionId) } yield se


  /**
   * Returns a list of all the street edges
    *
    * @return A list of StreetEdge objects.
   */
  def all: List[StreetEdge] = db.withSession { implicit session =>
    streetEdgesWithoutDeleted.list
  }

  /**
    * Count the number of streets that have been audited at least a given number of times
    *
    * @return
    */
  def countTotalStreets(): Int = db.withSession { implicit session =>
    all.size
  }

  /**
    * This method returns the audit completion rate for the specified group of users.
    *
    * @param auditCount
    * @param userType
    * @return
    */
  def auditCompletionRate(auditCount: Int, userType: String = "All"): Float = db.withSession { implicit session =>
    val auditedStreetCount = countAuditedStreets(1, userType).toFloat
    val allEdgesCount: Int = streetEdgesWithoutDeleted.list.length
    auditedStreetCount / allEdgesCount
  }

  /**
    * Calculate the proportion of the total miles of the city that have been audited at least auditCount times.
    *
    * @param auditCount
    * @return Float between 0 and 1
    */
  def streetDistanceCompletionRate(auditCount: Int, userType: String = "All"): Float = db.withSession { implicit session =>
    val auditedDistance = auditedStreetDistance(auditCount, userType)
    val totalDistance = totalStreetDistance()
    auditedDistance / totalDistance
  }

  /**
    * Get the total distance in miles
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
    * Get the audited distance in miles
    * Reference: http://gis.stackexchange.com/questions/143436/how-do-i-calculate-st-length-in-miles
    *
    * @param auditCount
    * @return
    */
  def auditedStreetDistance(auditCount: Int, userType: String = "All"): Float = db.withSession { implicit session =>
    val cacheKey = s"auditedStreetDistance($auditCount, $userType)"

    Cache.getOrElse(cacheKey, 1.hour.toSeconds.toInt) {
      val auditTaskQuery = userType match {
        case "All" => completedAuditTasks
        case "Researcher" => researcherCompletedAuditTasks
        case "Turker" => turkerCompletedAuditTasks
        case "Registered" => regUserCompletedAuditTasks
        case "Anonymous" => anonCompletedAuditTasks
        case _ => completedAuditTasks
      }

      val edges = for {
        _edges <- streetEdgesWithoutDeleted
        _tasks <- auditTaskQuery if _tasks.streetEdgeId === _edges.streetEdgeId
      } yield _edges

      // Gets tuple of (street_edge_id, num_completed_audits)
      val edgesWithAuditCounts = edges.groupBy(x => x).map{
        case (edge, group) => (edge.geom.transform(26918).length, group.length)
      }

      // Get length of each street segment, sum the lengths, and convert from meters to miles
      val distances: List[Float] = edgesWithAuditCounts.filter(_._2 >= auditCount).map(_._1).list
      (distances.sum * 0.000621371).toFloat
    }
  }

  /**
    * Computes percentage of the city audited over time.
    *
    * author: Mikey Saugstad
    * date: 06/16/2017
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

    // get distances of street edges associated with their edgeId
    val edgeDists: Map[Int, Float] = edges.groupBy(x => x).map(g => (g._1.streetEdgeId, g._1.geom.transform(26918).length)).list.toMap

    // Filter out group of edges with the size less than the passed `auditCount`, picking 1 rep from each group
    // TODO pick audit with earliest timestamp
    val uniqueEdgeDists: List[(Option[Timestamp], Option[Float])] = (for ((eid, groupedAudits) <- audits.list.groupBy(_.streetEdgeId)) yield {
      if (auditCount > 0 && groupedAudits.size >= auditCount) {
        Some((groupedAudits.head.taskEnd, edgeDists.get(eid)))
      } else {
        None
      }
    }).toList.flatten

    // round the timestamps down to just the date (year-month-day)
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

    // sum the distances by date
    val distsPerDay: List[(Calendar, Double)] = dateRoundedDists.groupBy(_._1).mapValues(_.map(_._2).sum).view.force.toList

    // sort the list by date
    val sortedEdges: Seq[(Calendar, Double)] =
      scala.util.Sorting.stableSort(distsPerDay, (e1: (Calendar,Double), e2: (Calendar, Double)) => e1._1.getTimeInMillis < e2._1.getTimeInMillis).toSeq

    // get the cumulative distance over time
    val cumDistsPerDay: Seq[(Calendar, Double)] = sortedEdges.map({var dist = 0.0; pair => {dist += pair._2; (pair._1, dist)}})

    // calculate the completion percentage for each day
    val totalDist = totalStreetDistance()
    val ratePerDay: Seq[(Calendar, Float)] = cumDistsPerDay.map(pair => (pair._1, (100.0 * pair._2 / totalDist).toFloat))

    // format the calendar date in the correct format and return the (date,completionPercentage) pair
    val format1 = new SimpleDateFormat("yyyy-MM-dd")
    ratePerDay.map(pair => (format1.format(pair._1.getTime), pair._2))
  }

  /**
    * Returns a list of street edges that are audited at least auditCount times
    *
    * @return
    */
  def selectAuditedStreets(auditCount: Int = 1, userType: String = "All"): List[StreetEdge] = db.withSession { implicit session =>
    val auditTasksQuery = userType match {
      case "All" => completedAuditTasks
      case "Researcher" => researcherCompletedAuditTasks
      case "Turker" => turkerCompletedAuditTasks
      case "Registered" => regUserCompletedAuditTasks
      case "Anonymous" => anonCompletedAuditTasks
      case _ => completedAuditTasks
    }

    val edges = for {
      (_streetEdges, _auditTasks) <- streetEdgesWithoutDeleted.innerJoin(auditTasksQuery).on(_.streetEdgeId === _.streetEdgeId)
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
    * Count the number of streets that have been audited at least a given number of times
    *
    * @param auditCount
    * @return
    */
  def countAuditedStreets(auditCount: Int = 1, userType: String = "All"): Int = db.withSession { implicit session =>
    selectAuditedStreets(auditCount, userType).size
  }

  /**
    * Returns all the streets in the given region that has been audited
    * @param regionId
    * @param auditCount
    * @return
    */
  def selectAuditedStreetsByARegionId(regionId: Int, auditCount: Int = 1): List[StreetEdge] = db.withSession { implicit session =>
    val selectAuditedStreetsQuery = Q.query[Int, StreetEdge](
      """SELECT street_edge.street_edge_id,
        |       street_edge.geom,
        |       x1,
        |       y1,
        |       x2,
        |       y2,
        |       way_type,
        |       street_edge.deleted,
        |       street_edge.timestamp
        |FROM sidewalk.street_edge
        |INNER JOIN sidewalk.region ON ST_Intersects(street_edge.geom, region.geom)
        |INNER JOIN sidewalk.audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
        |                               AND audit_task.completed = TRUE
        |WHERE region.region_id=?
        |    AND street_edge.deleted = FALSE
      """.stripMargin
    )
    selectAuditedStreetsQuery(regionId).list.groupBy(_.streetEdgeId).map(_._2.head).toList
  }

  /** Gets a list of all street edges that the user has audited in the specified region */
  def selectStreetsAuditedByAUser(userId: UUID, regionId: Int): List[StreetEdge] = db.withSession { implicit session =>
    val selectAuditedStreetsQuery = Q.query[(String, Int), StreetEdge](
      """SELECT street_edge.street_edge_id,
        |       street_edge.geom,
        |       x1,
        |       y1,
        |       x2,
        |       y2,
        |       way_type,
        |       street_edge.deleted,
        |       street_edge.timestamp
        |FROM sidewalk.street_edge
        |INNER JOIN sidewalk.street_edge_regio ON street_edge_region.street_edge_id = street_edge.street_edge_id
        |INNER JOIN sidewalk.audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
        |                               AND audit_task.completed = TRUE
        |                               AND audit_task.user_id = ?
        |WHERE street_edge_region.region_id = ?
        |    AND street_edge.deleted=FALSE
      """.stripMargin
    )
    selectAuditedStreetsQuery((userId.toString, regionId)).list.groupBy(_.streetEdgeId).map(_._2.head).toList
  }

  /** Gets a list of all street edges that the user has audited */
  def selectAllStreetsAuditedByAUser(userId: UUID): List[StreetEdge] = db.withSession { implicit session =>
    selectAllStreetsAuditedByAUserQuery(userId).list
  }

  /** Gets the query for a list of all street edges that the user has audited */
  def selectAllStreetsAuditedByAUserQuery(userId: UUID) = db.withSession { implicit session =>

    val auditedStreets = for {
      (_edges, _tasks) <- streetEdgesWithoutDeleted.innerJoin(completedAuditTasks).on(_.streetEdgeId === _.streetEdgeId)
      if _tasks.userId === userId.toString
    } yield _edges
    auditedStreets.groupBy(x => x).map(_._1) // does a select distinct
  }

  /** Returns the sum of the lengths of all streets in the region that have been audited */
  def getDistanceAuditedInARegion(regionId: Int): Float = db.withSession { implicit session =>
    val streetsInRegion = for {
      _edgeRegions <- streetEdgeRegion if _edgeRegions.regionId === regionId
      _edges <- streetEdgesWithoutDeleted if _edges.streetEdgeId === _edgeRegions.streetEdgeId
    } yield _edges

    val auditedStreetsInARegion = for {
      (_edges, _tasks) <- streetsInRegion.innerJoin(completedAuditTasks).on(_.streetEdgeId === _.streetEdgeId)
    } yield _edges

    // select distinct and sum the lengths of the streets
    auditedStreetsInARegion.groupBy(x => x).map(_._1.geom.transform(26918).length).list.sum
  }

  /** Returns the sum of the lengths of all streets in the region */
  def getTotalDistanceOfARegion(regionId: Int): Float = db.withSession { implicit session =>
    val streetsInRegion = for {
      _edgeRegions <- streetEdgeRegion if _edgeRegions.regionId === regionId
      _edges <- streetEdgesWithoutDeleted if _edges.streetEdgeId === _edgeRegions.streetEdgeId
    } yield _edges

    // select distinct and sum the lengths of the streets
    streetsInRegion.groupBy(x => x).map(_._1.geom.transform(26918).length).list.sum
  }

  /** Returns the distance of the given street edge */
  def getStreetEdgeDistance(streetEdgeId: Int): Float = db.withSession { implicit session =>
    streetEdgesWithoutDeleted.filter(_.streetEdgeId === streetEdgeId).groupBy(x => x).map(_._1.geom.transform(26918).length).list.head
  }

  /**
    * Returns all the streets intersecting the neighborhood
    * @param regionId
    * @param auditCount
    * @return
    */
  def selectStreetsByARegionId(regionId: Int, auditCount: Int = 1): List[StreetEdge] = db.withSession { implicit session =>
    val selectStreetsInARegionQuery = Q.query[Int, StreetEdge](
      """SELECT street_edge.street_edge_id,
        |       street_edge.geom,
        |       x1,
        |       y1,
        |       x2,
        |       y2,
        |       way_type,
        |       street_edge.deleted,
        |       street_edge.timestamp
        |FROM sidewalk.street_edge
        |INNER JOIN sidewalk.region ON ST_Intersects(street_edge.geom, region.geom)
        |WHERE region.region_id = ?
        |    AND street_edge.deleted = FALSE
      """.stripMargin
    )

    try {
      selectStreetsInARegionQuery(regionId).list
    } catch {
      case e: PSQLException => List()
    }
  }

  def selectStreetsIntersecting(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): List[StreetEdge] = db.withSession { implicit session =>
    // http://gis.stackexchange.com/questions/60700/postgis-select-by-lat-long-bounding-box
    // http://postgis.net/docs/ST_MakeEnvelope.html
    val selectEdgeQuery = Q.query[(Double, Double, Double, Double), StreetEdge](
      """SELECT st_e.street_edge_id,
        |       st_e.geom,
        |       st_e.x1,
        |       st_e.y1,
        |       st_e.x2,
        |       st_e.y2,
        |       st_e.way_type,
        |       st_e.deleted,
        |       st_e.timestamp
        |FROM sidewalk.street_edge AS st_e
        |WHERE st_e.deleted = FALSE
        |    AND ST_Intersects(st_e.geom, ST_MakeEnvelope(?, ?, ?, ?, 4326))""".stripMargin
    )

    val edges: List[StreetEdge] = selectEdgeQuery((minLng, minLat, maxLng, maxLat)).list
    edges
  }

  def selectAuditedStreetsIntersecting(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): List[StreetEdge] = db.withSession { implicit session =>
    // http://gis.stackexchange.com/questions/60700/postgis-select-by-lat-long-bounding-box
    // http://postgis.net/docs/ST_MakeEnvelope.html
    val selectEdgeQuery = Q.query[(Double, Double, Double, Double), StreetEdge](
      """SELECT DISTINCT(street_edge.street_edge_id),
        |       street_edge.geom,
        |       street_edge.x1,
        |       street_edge.y1,
        |       street_edge.x2,
        |       street_edge.y2,
        |       street_edge.way_type,
        |       street_edge.deleted,
        |       street_edge.timestamp
        |FROM sidewalk.street_edge
        |INNER JOIN sidewalk.audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
        |WHERE street_edge.deleted = FALSE
        |    AND ST_Intersects(street_edge.geom, ST_MakeEnvelope(?, ?, ?, ?, 4326))
        |    AND audit_task.completed = TRUE""".stripMargin
    )

    val edges: List[StreetEdge] = selectEdgeQuery((minLng, minLat, maxLng, maxLat)).list
    edges
  }

  def selectStreetsWithin(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): List[StreetEdge] = db.withSession { implicit session =>
    val selectEdgeQuery = Q.query[(Double, Double, Double, Double), StreetEdge](
      """SELECT DISTINCT(st_e.street_edge_id),
        |       st_e.geom,
        |       st_e.x1,
        |       st_e.y1,
        |       st_e.x2,
        |       st_e.y2,
        |       st_e.way_type,
        |       st_e.deleted,
        |       st_e.timestamp
        |FROM sidewalk.street_edge AS st_e
        |WHERE st_e.deleted = FALSE
        |    AND ST_Within(st_e.geom, ST_MakeEnvelope(?, ?, ?, ?, 4326))""".stripMargin
    )

    val edges: List[StreetEdge] = selectEdgeQuery((minLng, minLat, maxLng, maxLat)).list
    edges
  }

  def selectAuditedStreetsWithin(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): List[StreetEdge] = db.withSession { implicit session =>
    val selectEdgeQuery = Q.query[(Double, Double, Double, Double), StreetEdge](
      """SELECT DISTINCT(street_edge.street_edge_id),
        |       street_edge.geom,
        |       street_edge.x1,
        |       street_edge.y1,
        |       street_edge.x2,
        |       street_edge.y2,
        |       street_edge.way_type,
        |       street_edge.deleted,
        |       street_edge.timestamp
        |FROM sidewalk.street_edge
        |INNER JOIN sidewalk.audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
        |WHERE street_edge.deleted = FALSE
        |    AND ST_Within(street_edge.geom, ST_MakeEnvelope(?, ?, ?, ?, 4326))
        |    AND audit_task.completed = TRUE""".stripMargin
    )

    val edges: List[StreetEdge] = selectEdgeQuery((minLng, minLat, maxLng, maxLat)).list
    edges
  }

  /**
   * Set a record's deleted column to true
   */
  def delete(id: Int) = db.withSession { implicit session =>
    streetEdges.filter(edge => edge.streetEdgeId === id).map(_.deleted).update(true)
  }

  /**
   * Save a StreetEdge into the street_edge table
    *
    * @param edge A StreetEdge object
   * @return
   */
  def save(edge: StreetEdge): Int = db.withTransaction { implicit session =>
    streetEdges += edge
    edge.streetEdgeId // return the edge id.
  }
}

