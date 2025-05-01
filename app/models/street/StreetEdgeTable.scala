package models.street

import com.google.inject.ImplementedBy
import controllers.APIType.APIType
import controllers.{APIBBox, APIType}
import models.audit.AuditTaskTableDef
import models.region.RegionTableDef
import models.user.RoleTable.RESEARCHER_ROLES
import models.user.{RoleTableDef, UserRoleTableDef, UserStatTableDef}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.LineString
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.TimeInterval
import service.TimeInterval.TimeInterval
import slick.jdbc.GetResult

import java.time.{OffsetDateTime, ZoneOffset}
import javax.inject._
import scala.concurrent.ExecutionContext

case class StreetEdge(streetEdgeId: Int, geom: LineString, x1: Float, y1: Float, x2: Float, y2: Float, wayType: String, deleted: Boolean, timestamp: Option[OffsetDateTime])

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
  def timestamp: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("timestamp")

  def * = (streetEdgeId, geom, x1, y1, x2, y2, wayType, deleted, timestamp) <> ((StreetEdge.apply _).tupled, StreetEdge.unapply)
}

@ImplementedBy(classOf[StreetEdgeTable])
trait StreetEdgeTableRepository {
}

/**
 * Data access object for the street_edge table.
 */
@Singleton
class StreetEdgeTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
                                implicit val ec: ExecutionContext
                               ) extends StreetEdgeTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._

  // For plain query
  // https://github.com/tminglei/slick-pg/blob/slick2/src/test/scala/com/github/tminglei/slickpg/addon/PgPostGISSupportTest.scala
//  import MyPostgresProfile.plainImplicits._

//  implicit val streetEdgeConverter = GetResult[StreetEdge](r => {
//    val streetEdgeId = r.nextInt
//    val geometry = r.nextGeometry[LineString]
//    val x1 = r.nextFloat
//    val y1 = r.nextFloat
//    val x2 = r.nextFloat
//    val y2 = r.nextFloat
//    val wayType = r.nextString
//    val deleted = r.nextBoolean
//    val timestamp = r.nextTimestampOption.map(t => OffsetDateTime.ofInstant(t.toInstant, ZoneOffset.UTC))
//    StreetEdge(streetEdgeId, geometry, x1, y1, x2, y2, wayType, deleted, timestamp)
//  })

  implicit val streetEdgeInfoConverter = GetResult[StreetEdgeInfo](r => {
    StreetEdgeInfo(
      StreetEdge(
        r.nextInt, r.nextGeometry[LineString], r.nextFloat, r.nextFloat, r.nextFloat, r.nextFloat, r.nextString,
        r.nextBoolean, r.nextTimestampOption.map(t => OffsetDateTime.ofInstant(t.toInstant, ZoneOffset.UTC))
      ),
      r.nextLong, r.nextInt, r.nextInt
    )
  })

  val auditTasks = TableQuery[AuditTaskTableDef]
  val streetEdges = TableQuery[StreetEdgeTableDef]
  val streetEdgeRegion = TableQuery[StreetEdgeRegionTableDef]
  val osmWayStreetEdge = TableQuery[OsmWayStreetEdgeTableDef]
  val regions = TableQuery[RegionTableDef]
  val userStats = TableQuery[UserStatTableDef]
  val userRoles = TableQuery[UserRoleTableDef]
  val roleTable = TableQuery[RoleTableDef]

  val roleTableWithResearchersCollapsed = roleTable.map(_roles => (
    _roles.roleId, Case.If(_roles.role inSet RESEARCHER_ROLES).Then("Researcher").Else(_roles.role)
  ))

  val completedAuditTasksWithUsers = auditTasks
    .join(userStats).on(_.userId === _.userId)
    .filter(t => t._1.completed && !t._2.excluded)
  val completedAuditTasks = completedAuditTasksWithUsers.map(_._1)
  val highQualityCompletedTasks = completedAuditTasksWithUsers.filter(_._2.highQuality).map(_._1)

  val streetEdgesWithoutDeleted = streetEdges.filter(_.deleted === false)


  def streetCount: DBIO[Int] = {
    streetEdgesWithoutDeleted.length.result
  }

  /**
   * Get the total street distance in meters.
   */
  def totalStreetDistance: DBIO[Float] = {
    streetEdgesWithoutDeleted.map(_.geom.transform(26918).length).sum.result.map(x => x.getOrElse(0.0F))
  }

  /**
   * Get the total street distance in meters for all streets that have been audited.
   * @param highQualityOnly if true, only count high quality audits.
   */
  def auditedStreetDistance(highQualityOnly: Boolean = false): DBIO[Float] = {
    val filteredTasks = if (highQualityOnly) highQualityCompletedTasks else completedAuditTasks

    // Get the street edges that have been audited.
    val edges = for {
      _tasks <- filteredTasks
      _edges <- streetEdgesWithoutDeleted if _tasks.streetEdgeId === _edges.streetEdgeId
    } yield _edges

    // Get length of each street segment, sum the lengths, and convert from meters to miles.
    edges.distinctOn(_.streetEdgeId).map(_.geom.transform(26918).length).sum.getOrElse(0F).result
  }

  /**
   * Get the total street distance in meters for all streets that have been audited, grouped by role.
   * @param highQualityOnly if true, only count high quality audits.
   */
  def auditedStreetDistanceByRole(highQualityOnly: Boolean = false): DBIO[Map[String, Float]] = {
    val filteredTasks = if (highQualityOnly) highQualityCompletedTasks else completedAuditTasks

    // Group by role and count distinct street edges.
    (for {
      _tasks <- filteredTasks
      _edges <- streetEdges if _tasks.streetEdgeId === _edges.streetEdgeId
      _userRole <- userRoles if _userRole.userId === _tasks.userId
      _role <- roleTableWithResearchersCollapsed if _role._1 === _userRole.roleId
    } yield (_role._2, _edges.streetEdgeId, _edges.geom))
      .groupBy(x => x._1).map { case (role, rows) => (role, rows.map(_._3.transform(26918).length).sum.getOrElse(0F)) }
      .result.map(_.toMap)
  }

  /**
   * Calculates the total distance audited by all users over a specified time period.
   * @param timeInterval can be "today" or "week". If anything else, defaults to "all_time".
   * @return The total distance audited by all users in miles.
   */
  def auditedStreetDistanceOverTime(timeInterval: TimeInterval = TimeInterval.AllTime): DBIO[Float] = {
    // Filter by the given time interval.
    val tasksEndedInTimeInterval = timeInterval match {
      case TimeInterval.Today => auditTasks.filter(a => a.taskEnd > OffsetDateTime.now().minusDays(1))
      case TimeInterval.Week => auditTasks.filter(a => a.taskEnd >= OffsetDateTime.now().minusDays(7))
      case _ => auditTasks
    }

    streetEdges
      .join(tasksEndedInTimeInterval).on(_.streetEdgeId === _.streetEdgeId)
      .filter { case (street, task) => street.deleted === false && task.completed === true }
      .map { case (street, task) => street.geom.transform(26918).length }
      .sum.result.map(_.getOrElse(0.0F))
  }

  /**
    * Computes distances of the city audited by date.
    * @return Dates and the distance of newly audited streets on those dates in meters.
    */
  def streetDistanceCompletionRateByDate: DBIO[Seq[(OffsetDateTime, Float)]] = {
    completedAuditTasks
      // Get date of earliest completed audit of each street.
      .groupBy(_.streetEdgeId).map { case (streetId, rows) => (streetId, rows.map(_.taskEnd).min.trunc("day")) }
      // Join with street edges to get the geometry.
      .join(streetEdgesWithoutDeleted).on(_._1 === _.streetEdgeId)
      // Group by date and sum the distances.
      .groupBy(_._1._2)
      .map { case (date, rows) => (date, rows.map(_._2.geom.transform(26918).length).sum.getOrElse(0F)) }
      // Set the date to no longer be an option (it's forced to an option when calling .min above).
      .result.map(_.collect {  case (Some(date), dist) => (date, dist) })
  }

  /**
   * Counts the number of distinct audited streets.
   * @param highQualityOnly if true, only count high quality audits.
   */
  def countDistinctAuditedStreets(highQualityOnly: Boolean = false): DBIO[Int] = {
    val filteredTasks = if (highQualityOnly) highQualityCompletedTasks else completedAuditTasks
    filteredTasks.distinctOn(_.streetEdgeId).length.result
  }

  /**
   * Counts the number of distinct audited streets by role.
   * @param highQualityOnly if true, only count high quality audits.
   */
  def countDistinctAuditedStreetsByRole(highQualityOnly: Boolean = false): DBIO[Map[String, Int]] = {
    val filteredTasks = if (highQualityOnly) highQualityCompletedTasks else completedAuditTasks
    (for {
      _tasks <- filteredTasks
      _userRole <- userRoles if _userRole.userId === _tasks.userId
      _role <- roleTableWithResearchersCollapsed if _role._1 === _userRole.roleId
    } yield (_role._2, _tasks.streetEdgeId)
      ).groupBy(x => x._1).map { case (role, rows) => (role, rows.map(_._2).countDistinct) }
      .result.map(_.toMap)
  }

//  /** Returns the distance of the given street edge. */
//  def getStreetEdgeDistance(streetEdgeId: Int): Float = {
//    streetEdgesWithoutDeleted.filter(_.streetEdgeId === streetEdgeId).groupBy(x => x).map(_._1.geom.transform(26918).length).first
//  }

  def selectStreetsIntersecting(apiType: APIType, bbox: APIBBox): DBIO[Seq[StreetEdgeInfo]] = {
    require(apiType != APIType.Attribute, "This method is not supported for the Attributes API.")

    // Do all the necessary joins to get all the data we need.
    val baseQuery = streetEdgesWithoutDeleted
      .join(osmWayStreetEdge).on(_.streetEdgeId === _.streetEdgeId)
      .join(streetEdgeRegion).on(_._1.streetEdgeId === _.streetEdgeId)
      .join(regions).on(_._2.regionId === _.regionId)
      .joinLeft(auditTasks).on(_._1._1._1.streetEdgeId === _.streetEdgeId)
      .joinLeft(userStats).on(_._2.map(_.userId) === _.userId)
      .map(row => (row._1._1._1._1._1, row._1._1._1._1._2, row._1._1._1._2, row._1._1._2, row._1._2, row._2))

    // Either user bounding box filter on neighborhood or street boundaries.
    val filteredQuery = apiType match {
      case APIType.Neighborhood =>
        baseQuery.filter(_._4.geom.within(makeEnvelope(bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat, Some(4326))))
      case _ =>
        baseQuery.filter(_._1.geom.intersects(makeEnvelope(bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat, Some(4326))))
    }

    // Group by street and sum the number of audits completed audits. Then package into the StreetEdgeInfo case class.
    filteredQuery
      .groupBy(row => (row._1, row._2.osmWayId, row._4.regionId))
      .map { case ((street, osmWayId, regionId), group) => (
        street, osmWayId, regionId,
        group.map(r =>
          Case.If(r._6.map(_.highQuality).getOrElse(false) && r._5.map(_.completed).getOrElse(false)).Then(1).Else(0)
        ).sum
      )}
      .result.map(_.map(tuple => StreetEdgeInfo(tuple._1, tuple._2, tuple._3, tuple._4.getOrElse(0))))
  }
}
