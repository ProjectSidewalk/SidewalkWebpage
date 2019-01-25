package models.street

import java.sql.Timestamp
import java.util.UUID
import java.util.Calendar
import java.text.SimpleDateFormat

import com.vividsolutions.jts.geom.LineString
import models.audit.AuditTaskTable
import models.region.RegionTable
import models.daos.slickdaos.DBTableDefinitions.UserTable
import models.user.UserRoleTable
import models.user.RoleTable
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import org.postgresql.util.PSQLException
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

import slick.jdbc.GetResult

import scala.concurrent.ExecutionContext.Implicits.global

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
  import MyPostgresDriver.api._

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

  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
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
  val streetEdgeNeighborhood = for { (se, n) <- streetEdgeRegion.join(neighborhoods).on(_.regionId === _.regionId) } yield se

  /**
   * Returns a list of all the street edges
   *
   * @return A list of StreetEdge objects.
   */
  def all: Future[List[StreetEdge]] = db.run(
    streetEdgesWithoutDeleted.to[List].result)

  /**
   * Count the number of streets that have been audited at least a given number of times
   *
   * @return
   */
  def countTotalStreets(): Future[Int] = all.map(_.size)

  /**
   * Calculate the proportion of the total miles of DC that have been audited at least auditCount times.
   *
   * @param auditCount
   * @return Float between 0 and 1
   */
  def streetDistanceCompletionRate(userType: String = "All"): Future[Float] = {
    for {
      auditedDistance <- auditedStreetDistance(userType)
      totalDistance <- totalStreetDistance()
    } yield {
      auditedDistance / totalDistance
    }
  }

  /**
   * Get the total distance in miles
   * Reference: http://gis.stackexchange.com/questions/143436/how-do-i-calculate-st-length-in-miles
   *
   * @return
   */
  def totalStreetDistance(): Future[Float] = {
    db.run(
      // DISTINCT query: http://stackoverflow.com/questions/18256768/select-distinct-in-scala-slick
      // get length of each street segment, sum the lengths, and convert from meters to miles
      streetEdgesWithoutDeleted.groupBy(x => x).map(_._1.geom.transform(26918).length).to[List].result).map { distances =>
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
  def auditedStreetDistance(userType: String = "All"): Future[Float] = {

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

    // Selects distinct and gets distance of each street edge
    val edgesWithLength = edges.groupBy(x => x).map {
      case (edge, group) => edge.geom.transform(26918).length
    }

    // Sum the lengths of the streets and convert from meters to miles
    db.run(edgesWithLength.to[List].result).map { distances => (distances.sum * 0.000621371).toFloat }
  }

  /**
   * Gets a mapping from user group to the distance of unique streets and percentage of total that group has audited.
   *
   * @return
   */
  def countAuditedStreetDistanceAndRateByUserGroup(): Future[Map[String, (Float, Float)]] = {
    for {
      allEdgesDistance <- totalStreetDistance()
      allDistance <- auditedStreetDistance("All")
      researcherDistance <- auditedStreetDistance("Researcher")
      turkDistance <- auditedStreetDistance("Turker")
      regDistance <- auditedStreetDistance("Registered")
      anonDistance <- auditedStreetDistance("Anonymous")
    } yield {
      Map(
        "All" -> ((allDistance, allDistance / allEdgesDistance)),
        "Researcher" -> ((researcherDistance, researcherDistance / allEdgesDistance)),
        "Turker" -> ((turkDistance, turkDistance / allEdgesDistance)),
        "Registered" -> ((regDistance, regDistance / allEdgesDistance)),
        "Anonymous" -> ((anonDistance, anonDistance / allEdgesDistance)))
    }
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
  def streetDistanceCompletionRateByDate(auditCount: Int): Future[Seq[(String, Float)]] = {
    // join the street edges and audit tasks
    // TODO figure out how to do this w/out doing the join twice
    val edges = for {
      (_streetEdges, _auditTasks) <- streetEdgesWithoutDeleted.join(completedAuditTasks).on(_.streetEdgeId === _.streetEdgeId)
    } yield _streetEdges
    val audits = for {
      (_streetEdges, _auditTasks) <- streetEdgesWithoutDeleted.join(completedAuditTasks).on(_.streetEdgeId === _.streetEdgeId)
    } yield _auditTasks

    // get distances of street edges associated with their edgeId
    //FIXME
    //    val edgeDists: Map[Int, Float] = edges.groupBy(x => x).map(g => (g._1.streetEdgeId, g._1.geom.transform(26918).length)).list.toMap

    // Filter out group of edges with the size less than the passed `auditCount`, picking 1 rep from each group
    // TODO pick audit with earliest timestamp
    val uniqueEdgeDists: List[(Option[Timestamp], Option[Float])] = Nil
    //FIXME
    //      (for ((eid, groupedAudits) <- audits.list.groupBy(_.streetEdgeId)) yield {
    //        if (auditCount > 0 && groupedAudits.size >= auditCount) {
    //          Some((groupedAudits.head.taskEnd, edgeDists.get(eid)))
    //        } else {
    //          None
    //        }
    //      }).toList.flatten

    // round the timestamps down to just the date (year-month-day)
    val dateRoundedDists: List[(Calendar, Double)] = uniqueEdgeDists.map({
      pair =>
        {
          var c: Calendar = Calendar.getInstance()
          c.setTimeInMillis(pair._1.get.getTime)
          c.set(Calendar.HOUR_OF_DAY, 0)
          c.set(Calendar.MINUTE, 0)
          c.set(Calendar.SECOND, 0)
          c.set(Calendar.MILLISECOND, 0)
          (c, pair._2.get * 0.000621371) // converts from meters to miles
        }
    })

    // sum the distances by date
    val distsPerDay: List[(Calendar, Double)] = dateRoundedDists.groupBy(_._1).mapValues(_.map(_._2).sum).view.force.toList

    // sort the list by date
    val sortedEdges: Seq[(Calendar, Double)] =
      scala.util.Sorting.stableSort(distsPerDay, (e1: (Calendar, Double), e2: (Calendar, Double)) => e1._1.getTimeInMillis < e2._1.getTimeInMillis).toSeq

    // get the cumulative distance over time
    val cumDistsPerDay: Seq[(Calendar, Double)] = sortedEdges.map({ var dist = 0.0; pair => { dist += pair._2; (pair._1, dist) } })

    // calculate the completion percentage for each day
    totalStreetDistance().map { totalDist =>
      val ratePerDay: Seq[(Calendar, Float)] = cumDistsPerDay.map(pair => (pair._1, (100.0 * pair._2 / totalDist).toFloat))

      // format the calendar date in the correct format and return the (date,completionPercentage) pair
      val format1 = new SimpleDateFormat("yyyy-MM-dd")
      ratePerDay.map(pair => (format1.format(pair._1.getTime), pair._2))
    }
  }

  /**
   * Gets a mapping from user group to the number of unique streets and percentage of total that group has audited.
   *
   * @return
   */
  def countAuditedStreetCountAndRateByUserGroup(): Future[Map[String, (Int, Float)]] = {
    for {
      allEdgesCnt <- db.run(streetEdgesWithoutDeleted.length.result)
      allCnt <- countAuditedStreets("All")
      researcherCnt <- countAuditedStreets("Researcher")
      turkCnt <- countAuditedStreets("Turker")
      regCnt <- countAuditedStreets("Registered")
      anonCnt <- countAuditedStreets("Anonymous")
    } yield {
      Map(
        "All" -> ((allCnt, allCnt.toFloat / allEdgesCnt)),
        "Researcher" -> ((researcherCnt, researcherCnt.toFloat / allEdgesCnt)),
        "Turker" -> ((turkCnt, turkCnt.toFloat / allEdgesCnt)),
        "Registered" -> ((regCnt, regCnt.toFloat / allEdgesCnt)),
        "Anonymous" -> ((anonCnt, anonCnt.toFloat / allEdgesCnt)))
    }
  }

  /**
   * Count the number of streets that have been audited at least a given number of times
   *
   * @param auditCount
   * @return
   */
  def countAuditedStreets(userType: String = "All"): Future[Int] = {

    val auditTasksQuery = userType match {
      case "All" => completedAuditTasks
      case "Researcher" => researcherCompletedAuditTasks
      case "Turker" => turkerCompletedAuditTasks
      case "Registered" => regUserCompletedAuditTasks
      case "Anonymous" => anonCompletedAuditTasks
      case _ => completedAuditTasks
    }

    val edges = for {
      (_streetEdges, _auditTasks) <- streetEdgesWithoutDeleted.join(auditTasksQuery).on(_.streetEdgeId === _.streetEdgeId)
    } yield _streetEdges

    db.run(edges.groupBy(_.streetEdgeId).map(_._1).length.result)
  }

  /**
   * Returns all the streets in the given region that has been audited
   * @param regionId
   * @param auditCount
   * @return
   */
  def selectAuditedStreetsByARegionId(regionId: Int, auditCount: Int = 1): Future[List[StreetEdge]] = {
    def selectAuditedStreetsQuery(regionId: Int) =
      sql"""SELECT street_edge.street_edge_id,
        |       street_edge.geom,
        |       source,
        |       target,
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
        |WHERE region.region_id= #${regionId}
        |    AND street_edge.deleted = FALSE
      """.as[StreetEdge]

    db.run(selectAuditedStreetsQuery(regionId)).map(_.groupBy(_.streetEdgeId).map(_._2.head).toList)
  }

  /** Gets a list of all street edges that the user has audited in the specified region */
  def selectStreetsAuditedByAUser(userId: UUID, regionId: Int): Future[List[StreetEdge]] = {
    val selectAuditedStreetsQuery =
      sql"""SELECT street_edge.street_edge_id,
        |       street_edge.geom,
        |       source,
        |       target,
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
        |                               AND audit_task.user_id = #${userId.toString}
        |WHERE street_edge_region.region_id = #${regionId}
        |    AND street_edge.deleted=FALSE
      """.as[StreetEdge]

    db.run(selectAuditedStreetsQuery).map(_.groupBy(_.streetEdgeId).map(_._2.head).toList)
  }

  /** Gets a list of all street edges that the user has audited */
  def selectAllStreetsAuditedByAUser(userId: UUID): Future[List[StreetEdge]] = selectAllStreetsAuditedByAUserQuery(userId)

  /** Gets the query for a list of all street edges that the user has audited */
  def selectAllStreetsAuditedByAUserQuery(userId: UUID): Future[List[StreetEdge]] = db.run({
    val auditedStreets = for {
      (_edges, _tasks) <- streetEdgesWithoutDeleted.join(completedAuditTasks).on(_.streetEdgeId === _.streetEdgeId)
      if _tasks.userId === userId.toString
    } yield _edges

    auditedStreets.groupBy(x => x).map(_._1).to[List].result // does a select distinct
  })

  /** Returns the total distance that the specified user has audited in miles */
  def getDistanceAudited(userId: UUID): Future[Float] = {
    selectAllStreetsAuditedByAUserQuery(userId).map { streetEdges =>
      //FIXME `transform` is a server-side function
      //      val dist = streetEdges.groupBy(x => x).map(_._1.geom.transform(26918).length).list.sum
      //      (dist * 0.000621371).toFloat // converts to miles
      1.0f
    }
  }

  /** Returns the total distance audited by the specified user within the specified region, in miles */
  def getDistanceAudited(userId: UUID, region: Int): Future[Float] = {
    // get the street edges from only this region
    val auditedStreetsInRegion = for {
      _edgeRegions <- db.run(streetEdgeRegion.filter(_.regionId === region).result)
      _edges <- selectAllStreetsAuditedByAUserQuery(userId)
    } yield {
      val streetEdgeIds = _edgeRegions.map(_.streetEdgeId).toSet
      _edges.filter(e => streetEdgeIds.contains(e.streetEdgeId))
    }

    // compute sum of lengths of the streets audited by the user in the region
    //FIXME `transform` is a server-side function
    //    auditedStreetsInRegion.map { auditedStreets =>
    //      val dist = auditedStreets.groupBy(x => x).map(_._1.geom.transform(26918).length).list.sum
    //      (dist * 0.000621371).toFloat // converts to miles
    //    }
    Future.successful(-1)
  }

  /** Returns the sum of the lengths of all streets in the region that have been audited */
  def getDistanceAuditedInARegion(regionId: Int): Future[Float] = {
    val streetsInRegion = for {
      _edgeRegions <- streetEdgeRegion if _edgeRegions.regionId === regionId
      _edges <- streetEdgesWithoutDeleted if _edges.streetEdgeId === _edgeRegions.streetEdgeId
    } yield _edges

    val auditedStreetsInARegion = for {
      (_edges, _tasks) <- streetsInRegion.join(completedAuditTasks).on(_.streetEdgeId === _.streetEdgeId)
    } yield _edges

    // select distinct and sum the lengths of the streets
    db.run(
      auditedStreetsInARegion.groupBy(x => x).map(_._1.geom.transform(26918).length).to[List].result).map(_.sum)
  }

  /** Returns the sum of the lengths of all streets in the region */
  def getTotalDistanceOfARegion(regionId: Int): Future[Float] = db.run({
    val streetsInRegion = for {
      _edgeRegions <- streetEdgeRegion if _edgeRegions.regionId === regionId
      _edges <- streetEdgesWithoutDeleted if _edges.streetEdgeId === _edgeRegions.streetEdgeId
    } yield _edges

    // select distinct and sum the lengths of the streets
    streetsInRegion.groupBy(x => x).map(_._1.geom.transform(26918).length).to[List].result
  }).map(_.sum)

  /** Returns the distance of the given street edge */
  def getStreetEdgeDistance(streetEdgeId: Int): Future[Float] = db.run(
    streetEdgesWithoutDeleted.filter(_.streetEdgeId === streetEdgeId).groupBy(x => x).map(_._1.geom.transform(26918).length).result.head)

  /**
   * Returns all the streets intersecting the neighborhood
   * @param regionId
   * @param auditCount
   * @return
   */
  def selectStreetsByARegionId(regionId: Int, auditCount: Int = 1): Future[List[StreetEdge]] = {
    val selectStreetsInARegionQuery =
      sql"""SELECT street_edge.street_edge_id,
        |       street_edge.geom,
        |       source,
        |       target,
        |       x1,
        |       y1,
        |       x2,
        |       y2,
        |       way_type,
        |       street_edge.deleted,
        |       street_edge.timestamp
        |FROM sidewalk.street_edge
        |INNER JOIN sidewalk.region ON ST_Intersects(street_edge.geom, region.geom)
        |WHERE region.region_id = #${regionId}
        |    AND street_edge.deleted = FALSE
      """.as[StreetEdge]

    db.run(selectStreetsInARegionQuery).map(_.toList)
  }

  def selectStreetsIntersecting(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): Future[List[StreetEdge]] = {
    // http://gis.stackexchange.com/questions/60700/postgis-select-by-lat-long-bounding-box
    // http://postgis.net/docs/ST_MakeEnvelope.html
    val selectEdgeQuery =
      sql"""SELECT st_e.street_edge_id,
         |       st_e.geom,
         |       st_e.source,
         |       st_e.target,
         |       st_e.x1,
         |       st_e.y1,
         |       st_e.x2,
         |       st_e.y2,
         |       st_e.way_type,
         |       st_e.deleted,
         |       st_e.timestamp
         |FROM sidewalk.street_edge AS st_e
         |WHERE st_e.deleted = FALSE
         |    AND ST_Intersects(st_e.geom, ST_MakeEnvelope(#$minLng, #$minLat, #$maxLng, #$maxLat, 4326))
         |    """.as[StreetEdge]

    db.run(selectEdgeQuery).map(_.toList)
  }

  def selectAuditedStreetsIntersecting(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): Future[List[StreetEdge]] = {
    // http://gis.stackexchange.com/questions/60700/postgis-select-by-lat-long-bounding-box
    // http://postgis.net/docs/ST_MakeEnvelope.html
    val selectEdgeQuery =
      sql"""SELECT DISTINCT(street_edge.street_edge_id),
        |       street_edge.geom,
        |       street_edge.source,
        |       street_edge.target,
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
        |    AND ST_Intersects(street_edge.geom, ST_MakeEnvelope(#$minLng, #$minLat, #$maxLng, #$maxLat, 4326))
        |    AND audit_task.completed = TRUE""".as[StreetEdge]

    db.run(selectEdgeQuery).map(_.toList)
  }

  def selectStreetsWithin(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): Future[List[StreetEdge]] = {
    val selectEdgeQuery =
      sql"""SELECT DISTINCT(st_e.street_edge_id),
        |       st_e.geom,
        |       st_e.source,
        |       st_e.target,
        |       st_e.x1,
        |       st_e.y1,
        |       st_e.x2,
        |       st_e.y2,
        |       st_e.way_type,
        |       st_e.deleted,
        |       st_e.timestamp
        |FROM sidewalk.street_edge AS st_e
        |WHERE st_e.deleted = FALSE
        |    AND ST_Within(st_e.geom, ST_MakeEnvelope(#$minLng, #$minLat, #$maxLng, #$maxLat, 4326))
        |    """.as[StreetEdge]

    db.run(selectEdgeQuery).map(_.toList)
  }

  def selectAuditedStreetsWithin(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): Future[List[StreetEdge]] = {
    val selectEdgeQuery =
      sql"""SELECT DISTINCT(street_edge.street_edge_id),
        |       street_edge.geom,
        |       street_edge.source,
        |       street_edge.target,
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
        |    AND ST_Within(street_edge.geom, ST_MakeEnvelope(#$minLng, #$minLat, #$maxLng, #$maxLat, 4326))
        |    AND audit_task.completed = TRUE""".as[StreetEdge]

    db.run(selectEdgeQuery).map(_.toList)
  }

  /**
   * Set a record's deleted column to true
   */
  def delete(id: Int): Future[Int] = db.run(
    streetEdges.filter(edge => edge.streetEdgeId === id).map(_.deleted).update(true).transactionally)

  /**
   * Save a StreetEdge into the street_edge table
   *
   * @param edge A StreetEdge object
   * @return
   */
  def save(edge: StreetEdge): Future[Int] = db.run(
    ((streetEdges returning streetEdges.map(_.streetEdgeId)) += edge).transactionally)
}

