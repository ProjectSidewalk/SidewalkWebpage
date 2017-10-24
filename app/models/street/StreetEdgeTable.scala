package models.street

import java.sql.Timestamp
import java.util.UUID
import java.util.Calendar
import java.text.SimpleDateFormat

import org.geotools.geometry.jts.JTS
import org.geotools.referencing.CRS

import com.vividsolutions.jts.geom.LineString
import models.audit.{AuditTask, AuditTaskTable}
import models.region.RegionTable
import models.user.UserRoleTable
import models.user.RoleTable
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import org.postgresql.util.PSQLException
import play.api.Play.current

import scala.slick.jdbc.{GetResult, StaticQuery => Q}

case class StreetEdge(streetEdgeId: Int, geom: LineString, source: Int, target: Int, x1: Float, y1: Float, x2: Float, y2: Float, wayType: String, deleted: Boolean, timestamp: Option[Timestamp])

/**
 *
 */
class StreetEdgeTable(tag: Tag) extends Table[StreetEdge](tag, Some("sidewalk"), "street_edge") {
  def streetEdgeId = column[Int]("street_edge_id", O.PrimaryKey)
  def geom = column[LineString]("geom")
  def source = column[Int]("source")
  def target = column[Int]("target")
  def x1 = column[Float]("x1")
  def y1 = column[Float]("y1")
  def x2 = column[Float]("x2")
  def y2 = column[Float]("y2")
  def wayType = column[String]("way_type")
  def deleted = column[Boolean]("deleted", O.Default(false))
  def timestamp = column[Option[Timestamp]]("timestamp")

  def * = (streetEdgeId, geom, source, target, x1, y1, x2, y2, wayType, deleted, timestamp) <> ((StreetEdge.apply _).tupled, StreetEdge.unapply)
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
    val source = r.nextInt
    val target = r.nextInt
    val x1 = r.nextFloat
    val y1 = r.nextFloat
    val x2 = r.nextFloat
    val y2 = r.nextFloat
    val wayType = r.nextString
    val deleted = r.nextBoolean
    val timestamp = r.nextTimestampOption
    StreetEdge(streetEdgeId, geometry, source, target, x1, y1, x2, y2, wayType, deleted, timestamp)
  })

  val db = play.api.db.slick.DB
  val auditTasks = TableQuery[AuditTaskTable]
  val regions = TableQuery[RegionTable]
  val streetEdges = TableQuery[StreetEdgeTable]
  val streetEdgeAssignmentCounts = TableQuery[StreetEdgeAssignmentCountTable]
  val streetEdgeRegion = TableQuery[StreetEdgeRegionTable]
  val anonId = "97760883-8ef0-4309-9a5e-0c086ef27573"

  val userRoles = TableQuery[UserRoleTable]
  val roleTable = TableQuery[RoleTable]
  val neighborhoods = regions.filter(_.deleted === false).filter(_.regionTypeId === 2)

  val completedAuditTasks = auditTasks.filter(_.completed === true)

  val turkerCompletedAuditTasks = for {
    ((_audittasks, _roles), _roletype) <- completedAuditTasks.innerJoin(userRoles).on(_.userId === _.userId).innerJoin(roleTable).on(_._2.roleId === _.roleId)
    if _roletype.role === "Turker"
  } yield _audittasks

  val regUserCompletedAuditTasks = for {
    ((_audittasks, _roles), _roletype) <- completedAuditTasks.innerJoin(userRoles).on(_.userId === _.userId).innerJoin(roleTable).on(_._2.roleId === _.roleId)
    if _roletype.role === "User" && _audittasks.userId =!= anonId
  } yield _audittasks

  val researcherCompletedAuditTasks = for {
    ((_audittasks, _roles), _roletype) <- completedAuditTasks.innerJoin(userRoles).on(_.userId === _.userId).innerJoin(roleTable).on(_._2.roleId === _.roleId)
    if _roletype.role === "Researcher" || _roletype.role === "Administrator" || _roletype.role === "Owner"
  } yield _audittasks

  val anonCompletedAuditTasks = completedAuditTasks.filter(_.userId === anonId)

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
    * This method returns the audit completion rate
    *
    * @param auditCount
    * @return
    */
  def auditCompletionRate(auditCount: Int): Float = db.withSession { implicit session =>
    val allEdges = streetEdgesWithoutDeleted.list
    countAuditedStreets(auditCount).toFloat / allEdges.length
  }

  /**
    * This method returns the turker audit completion rate
    *
    * @param auditCount
    * @return
    */
  def auditCompletionRateTurker(auditCount: Int): Float = db.withSession { implicit session =>
    val allEdges = streetEdgesWithoutDeleted.list
    countTurkerAuditedStreets(auditCount).toFloat / allEdges.length
  }

  /**
    * This method returns the registered user audit completion rate
    *
    * @param auditCount
    * @return
    */
  def auditCompletionRateRegUser(auditCount: Int): Float = db.withSession { implicit session =>
    val allEdges = streetEdgesWithoutDeleted.list
    countRegisteredUserAuditedStreets(auditCount).toFloat / allEdges.length
  }

  /**
    * This method returns the researcher total audit completion rate
    *
    * @param auditCount
    * @return
    */
  def auditCompletionRateResearcher(auditCount: Int): Float = db.withSession { implicit session =>
    val allEdges = streetEdgesWithoutDeleted.list
    countResearcherAuditedStreets(auditCount).toFloat / allEdges.length
  }

  /**
    * This method returns the anonymous user total audit completion rate
    *
    * @param auditCount
    * @return
    */
  def auditCompletionRateAnonUser(auditCount: Int): Float = db.withSession { implicit session =>
    val allEdges = streetEdgesWithoutDeleted.list
    countAnonAuditedStreets(auditCount).toFloat / allEdges.length
  }

  /**
    * Calculate the proportion of the total miles of DC that have been audited at least auditCount times.
    *
    * @param auditCount
    * @return Float between 0 and 1
    */
  def streetDistanceCompletionRate(auditCount: Int): Float = db.withSession { implicit session =>
    val auditedDistance = auditedStreetDistance(auditCount)
    val totalDistance = totalStreetDistance()
    auditedDistance / totalDistance
  }

  /**
    * Calculate the proportion of the total miles of DC that have been audited at least auditCount times by turkers
    *
    * @param auditCount
    * @return Float between 0 and 1
    */
  def streetDistanceCompletionRateTurker(auditCount: Int): Float = db.withSession { implicit session =>
    val auditedDistance = auditedStreetDistanceTurker(auditCount)
    val totalDistance = totalStreetDistance()
    auditedDistance / totalDistance
  }

  /**
    * Calculate the proportion of the total miles of DC that have been audited at least auditCount times by registered users
    *
    * @param auditCount
    * @return Float between 0 and 1
    */
  def streetDistanceCompletionRateRegUser(auditCount: Int): Float = db.withSession { implicit session =>
    val auditedDistance = auditedStreetDistanceRegUser(auditCount)
    val totalDistance = totalStreetDistance()
    auditedDistance / totalDistance
  }

  /**
    * Calculate the proportion of the total miles of DC that have been audited at least auditCount times by researchers
    *
    * @param auditCount
    * @return Float between 0 and 1
    */
  def streetDistanceCompletionRateResearcher(auditCount: Int): Float = db.withSession { implicit session =>
    val auditedDistance = auditedStreetDistanceResearcher(auditCount)
    val totalDistance = totalStreetDistance()
    auditedDistance / totalDistance
  }

  /**
    * Calculate the proportion of the total miles of DC that have been audited at least auditCount times by anonymous users
    *
    * @param auditCount
    * @return Float between 0 and 1
    */
  def streetDistanceCompletionRateAnon(auditCount: Int): Float = db.withSession { implicit session =>
    val auditedDistance = auditedStreetDistanceAnon(auditCount)
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
    // DISTINCT query: http://stackoverflow.com/questions/18256768/select-distinct-in-scala-slick

    // get length of each street segment, sum the lengths, and convert from meters to miles
    val distances: List[Float] = streetEdgesWithoutDeleted.groupBy(x => x).map(_._1.geom.transform(26918).length).list
    (distances.sum * 0.000621371).toFloat
  }

  /**
    * Get the audited distance in miles
    * Reference: http://gis.stackexchange.com/questions/143436/how-do-i-calculate-st-length-in-miles
    *
    * @param auditCount
    * @return
    */
  def auditedStreetDistance(auditCount: Int, auditTaskQuery: Query[AuditTaskTable, AuditTask, Seq] = completedAuditTasks): Float = db.withSession { implicit session =>
    // DISTINCT query: http://stackoverflow.com/questions/18256768/select-distinct-in-scala-slick
    val edges = for {
      (_streetEdges, _auditTasks) <- streetEdgesWithoutDeleted.innerJoin(auditTaskQuery).on(_.streetEdgeId === _.streetEdgeId)
    } yield _streetEdges

    // TODO: Audit Count is not taken into account. Currently it's calculated on all completed audit tasks

    // get length of each street segment, sum the lengths, and convert from meters to miles
    val distances: List[Float] = edges.groupBy(x => x).map(_._1.geom.transform(26918).length).list
    (distances.sum * 0.000621371).toFloat
  }

  /**
    * Get the audited distance in miles for turkers
    * Reference: http://gis.stackexchange.com/questions/143436/how-do-i-calculate-st-length-in-miles
    */
  def auditedStreetDistanceTurker(auditCount: Int): Float = db.withSession { implicit session =>
    auditedStreetDistance(auditCount, turkerCompletedAuditTasks)
  }

  /**
    * Get the audited distance in miles for registered users
    * Reference: http://gis.stackexchange.com/questions/143436/how-do-i-calculate-st-length-in-miles
    */
  def auditedStreetDistanceRegUser(auditCount: Int): Float = db.withSession { implicit session =>
    auditedStreetDistance(auditCount, regUserCompletedAuditTasks)
  }

  /**
    * Get the audited distance in miles for researchers
    * Reference: http://gis.stackexchange.com/questions/143436/how-do-i-calculate-st-length-in-miles
    */
  def auditedStreetDistanceResearcher(auditCount: Int): Float = db.withSession { implicit session =>
    auditedStreetDistance(auditCount, researcherCompletedAuditTasks)
  }

  /**
    * Get the audited distance in miles for anonymous users
    * Reference: http://gis.stackexchange.com/questions/143436/how-do-i-calculate-st-length-in-miles
    */
  def auditedStreetDistanceAnon(auditCount: Int): Float = db.withSession { implicit session =>
    auditedStreetDistance(auditCount, anonCompletedAuditTasks)
  }

  /**
    * Computes percentage of DC audited over time.
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
    * Count the number of streets that have been audited at least a given number of times
    *
    * @param auditCount
    * @return
    */
  def countAuditedStreets(auditCount: Int = 1): Int = db.withSession { implicit session =>
    selectAuditedStreets(auditCount, completedAuditTasks).size
  }

  def countTurkerAuditedStreets(auditCount: Int = 1): Int = db.withSession { implicit session =>
    selectAuditedStreets(auditCount, turkerCompletedAuditTasks).size
  }

  def countRegisteredUserAuditedStreets(auditCount: Int = 1): Int = db.withSession { implicit session =>
    selectAuditedStreets(auditCount, regUserCompletedAuditTasks).size
  }

  def countResearcherAuditedStreets(auditCount: Int = 1): Int = db.withSession { implicit session =>
    selectAuditedStreets(auditCount, researcherCompletedAuditTasks).size
  }

  def countAnonAuditedStreets(auditCount: Int = 1): Int = db.withSession { implicit session =>
    selectAuditedStreets(auditCount, anonCompletedAuditTasks).size
  }

  /**
    * Returns a list of street edges that are audited at least auditCount times
    *
    * @return
    */
  def selectAuditedStreets(auditCount: Int = 1, auditTasksQuery: Query[AuditTaskTable, AuditTask, Seq] = completedAuditTasks): List[StreetEdge] = db.withSession { implicit session =>
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
    * Returns all the streets in the given region that has been audited
    * @param regionId
    * @param auditCount
    * @return
    */
  def selectAuditedStreetsByARegionId(regionId: Int, auditCount: Int = 1): List[StreetEdge] = db.withSession { implicit session =>
    val selectAuditedStreetsQuery = Q.query[Int, StreetEdge](
      """SELECT street_edge.street_edge_id, street_edge.geom, source, target, x1, y1, x2, y2, way_type, street_edge.deleted, street_edge.timestamp
        |  FROM sidewalk.street_edge
        |INNER JOIN sidewalk.region
        |  ON ST_Intersects(street_edge.geom, region.geom)
        |INNER JOIN sidewalk.audit_task
        |  ON street_edge.street_edge_id = audit_task.street_edge_id
        |  AND audit_task.completed = TRUE
        |WHERE region.region_id=?
        |  AND street_edge.deleted=FALSE
      """.stripMargin
    )
    selectAuditedStreetsQuery(regionId).list.groupBy(_.streetEdgeId).map(_._2.head).toList
  }

  /** Gets a list of all street edges that the user has audited in the specified region */
  def selectStreetsAuditedByAUser(userId: UUID, regionId: Int): List[StreetEdge] = db.withSession { implicit session =>
    val selectAuditedStreetsQuery = Q.query[(String, Int), StreetEdge](
      """SELECT street_edge.street_edge_id, street_edge.geom, source, target, x1, y1, x2, y2, way_type, street_edge.deleted, street_edge.timestamp
        |  FROM sidewalk.street_edge
        |INNER JOIN sidewalk.street_edge_region
        |  ON street_edge_region.street_edge_id = street_edge.street_edge_id
        |INNER JOIN sidewalk.audit_task
        |  ON street_edge.street_edge_id = audit_task.street_edge_id
        |  AND audit_task.completed = TRUE
        |  AND audit_task.user_id = ?
        |WHERE street_edge_region.region_id=?
        |  AND street_edge.deleted=FALSE
      """.stripMargin
    )
    selectAuditedStreetsQuery((userId.toString, regionId)).list.groupBy(_.streetEdgeId).map(_._2.head).toList
  }

  /** Gets a list of all street edges that the user has audited */
  def selectAllStreetsAuditedByAUser(userId: UUID): List[StreetEdge] = db.withSession { implicit session =>
    val selectAuditedStreetsQuery = Q.query[String, StreetEdge](
      """SELECT street_edge.street_edge_id, street_edge.geom, source, target, x1, y1, x2, y2, way_type, street_edge.deleted, street_edge.timestamp
        |  FROM sidewalk.street_edge
        |INNER JOIN sidewalk.street_edge_region
        |  ON street_edge_region.street_edge_id = street_edge.street_edge_id
        |INNER JOIN sidewalk.audit_task
        |  ON street_edge.street_edge_id = audit_task.street_edge_id
        |  AND audit_task.completed = TRUE
        |  AND audit_task.user_id = ?
        |WHERE street_edge.deleted=FALSE
      """.stripMargin
    )
    selectAuditedStreetsQuery(userId.toString).list.groupBy(_.streetEdgeId).map(_._2.head).toList
  }

  /** Returns the total distance that the specified user has audited in miles */
  def getDistanceAudited(userId: UUID): Float = db.withSession {implicit session =>
    // http://docs.geotools.org/latest/tutorials/geometry/geometrycrs.html
    val CRSEpsg4326 = CRS.decode("epsg:4326")
    val CRSEpsg26918 = CRS.decode("epsg:26918")
    val transform = CRS.findMathTransform(CRSEpsg4326, CRSEpsg26918)

    val userStreets = selectAllStreetsAuditedByAUser(userId)
    // get length of each street segment, sum the lengths, and convert from meters to miles
    (userStreets.map(s => JTS.transform(s.geom, transform).getLength).sum * 0.000621371).toFloat
  }

  /**
    * Returns all the streets intersecting the neighborhood
    * @param regionId
    * @param auditCount
    * @return
    */
  def selectStreetsByARegionId(regionId: Int, auditCount: Int = 1): List[StreetEdge] = db.withSession { implicit session =>
    val selectAuditedStreetsQuery = Q.query[Int, StreetEdge](
      """SELECT street_edge.street_edge_id, street_edge.geom, source, target, x1, y1, x2, y2, way_type, street_edge.deleted, street_edge.timestamp
        |  FROM sidewalk.street_edge
        |INNER JOIN sidewalk.region
        |  ON ST_Intersects(street_edge.geom, region.geom)
        |WHERE region.region_id=?
        |  AND street_edge.deleted=FALSE
      """.stripMargin
    )

    try {
      selectAuditedStreetsQuery(regionId).list
    } catch {
      case e: PSQLException => List()
    }
  }

  def selectStreetsIntersecting(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): List[StreetEdge] = db.withSession { implicit session =>
    // http://gis.stackexchange.com/questions/60700/postgis-select-by-lat-long-bounding-box
    // http://postgis.net/docs/ST_MakeEnvelope.html
    val selectEdgeQuery = Q.query[(Double, Double, Double, Double), StreetEdge](
      """SELECT st_e.street_edge_id, st_e.geom, st_e.source, st_e.target, st_e.x1, st_e.y1, st_e.x2, st_e.y2, st_e.way_type, st_e.deleted, st_e.timestamp
       |FROM sidewalk.street_edge AS st_e
       |WHERE st_e.deleted = FALSE AND ST_Intersects(st_e.geom, ST_MakeEnvelope(?, ?, ?, ?, 4326))""".stripMargin
    )

    val edges: List[StreetEdge] = selectEdgeQuery((minLng, minLat, maxLng, maxLat)).list
    edges
  }

  def selectAuditedStreetsIntersecting(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): List[StreetEdge] = db.withSession { implicit session =>
    // http://gis.stackexchange.com/questions/60700/postgis-select-by-lat-long-bounding-box
    // http://postgis.net/docs/ST_MakeEnvelope.html
    val selectEdgeQuery = Q.query[(Double, Double, Double, Double), StreetEdge](
      """SELECT DISTINCT(street_edge.street_edge_id), street_edge.geom, street_edge.source, street_edge.target, street_edge.x1, street_edge.y1, street_edge.x2, street_edge.y2, street_edge.way_type, street_edge.deleted, street_edge.timestamp
        |  FROM sidewalk.street_edge
        |  INNER JOIN sidewalk.audit_task
        |  ON street_edge.street_edge_id = audit_task.street_edge_id
        |  WHERE street_edge.deleted = FALSE
        |  AND ST_Intersects(street_edge.geom, ST_MakeEnvelope(?, ?, ?, ?, 4326))
        |  AND audit_task.completed = TRUE""".stripMargin
    )

    val edges: List[StreetEdge] = selectEdgeQuery((minLng, minLat, maxLng, maxLat)).list
    edges
  }

  def selectStreetsWithin(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): List[StreetEdge] = db.withSession { implicit session =>
    val selectEdgeQuery = Q.query[(Double, Double, Double, Double), StreetEdge](
      """SELECT DISTINCT(st_e.street_edge_id), st_e.geom, st_e.source, st_e.target, st_e.x1, st_e.y1, st_e.x2, st_e.y2, st_e.way_type, st_e.deleted, st_e.timestamp
        |FROM sidewalk.street_edge AS st_e
        |WHERE st_e.deleted = FALSE
        |AND ST_Within(st_e.geom, ST_MakeEnvelope(?, ?, ?, ?, 4326))""".stripMargin
    )

    val edges: List[StreetEdge] = selectEdgeQuery((minLng, minLat, maxLng, maxLat)).list
    edges
  }

  def selectAuditedStreetsWithin(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): List[StreetEdge] = db.withSession { implicit session =>
    val selectEdgeQuery = Q.query[(Double, Double, Double, Double), StreetEdge](
      """SELECT DISTINCT(street_edge.street_edge_id), street_edge.geom, street_edge.source, street_edge.target, street_edge.x1, street_edge.y1, street_edge.x2, street_edge.y2, street_edge.way_type, street_edge.deleted, street_edge.timestamp
        |  FROM sidewalk.street_edge
        |  INNER JOIN sidewalk.audit_task
        |  ON street_edge.street_edge_id = audit_task.street_edge_id
        |  WHERE street_edge.deleted = FALSE
        |  AND ST_Within(street_edge.geom, ST_MakeEnvelope(?, ?, ?, ?, 4326))
        |  AND audit_task.completed = TRUE""".stripMargin
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

