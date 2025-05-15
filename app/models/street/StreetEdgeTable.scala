package models.street

import com.google.inject.ImplementedBy
import models.utils.LatLngBBox
import models.utils.SpatialQueryType
import models.utils.SpatialQueryType.SpatialQueryType
import models.audit.AuditTaskTableDef
import models.region.RegionTableDef
import models.user.RoleTable.RESEARCHER_ROLES
import models.user.{RoleTableDef, UserRoleTableDef, UserStatTableDef}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import models.label.LabelTableDef
import models.api.{StreetDataForApi, StreetFiltersForApi}
import org.locationtech.jts.geom.LineString
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.TimeInterval
import service.TimeInterval.TimeInterval
import slick.jdbc.GetResult
import org.postgresql.jdbc.PgArray
import slick.sql.SqlStreamingAction
import slick.dbio.Effect

import java.time.{OffsetDateTime, ZoneOffset}
import javax.inject._
import scala.concurrent.ExecutionContext

/**
 * Represents label statistics for a street edge.
 *
 * @param labelCount The number of labels on the street edge
 * @param userIds    The IDs of users who created labels on this street edge
 * @param streetEdgeId The ID of the street edge these stats are for
 */
case class StreetLabelStats(
  streetEdgeId: Int,
  labelCount: Int,
  userIds: Seq[String]
) {
  // Derived properties can be added here
  def userCount: Int = userIds.size
}

case class StreetEdge(streetEdgeId: Int, geom: LineString, x1: Float, y1: Float, x2: Float, y2: Float, wayType: String,
                      deleted: Boolean, timestamp: Option[OffsetDateTime])
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
trait StreetEdgeTableRepository { }

@Singleton
class StreetEdgeTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
                                implicit val ec: ExecutionContext
                               ) extends StreetEdgeTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {

  implicit val streetEdgeInfoConverter: GetResult[StreetEdgeInfo] = GetResult[StreetEdgeInfo](r => {
    StreetEdgeInfo(
      StreetEdge(
        r.nextInt(), r.nextGeometry[LineString](), r.nextFloat(), r.nextFloat(), r.nextFloat(), r.nextFloat(),
        r.nextString(), r.nextBoolean(),
        r.nextTimestampOption().map(t => OffsetDateTime.ofInstant(t.toInstant, ZoneOffset.UTC))
      ),
      r.nextLong(), r.nextInt(), r.nextInt()
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

  /**
   * Selects street edges that intersect with a given bounding box.
   *
   * @param spatialQueryType The type of API request, which may influence the selection logic.
   * @param bbox The bounding box within which to search for intersecting street edges.
   * @return A database action that, when executed, yields a sequence of `StreetEdgeInfo` objects
   *         representing the street edges that intersect with the specified bounding box.
   */
  def selectStreetsIntersecting(spatialQueryType: SpatialQueryType, bbox: LatLngBBox): DBIO[Seq[StreetEdgeInfo]] = {
    require(spatialQueryType != SpatialQueryType.LabelCluster, "This method is not supported for the Attributes API.")

    // Do all the necessary joins to get all the data we need.
    val baseQuery = streetEdgesWithoutDeleted
      .join(osmWayStreetEdge).on(_.streetEdgeId === _.streetEdgeId)
      .join(streetEdgeRegion).on(_._1.streetEdgeId === _.streetEdgeId)
      .join(regions).on(_._2.regionId === _.regionId)
      .joinLeft(auditTasks).on(_._1._1._1.streetEdgeId === _.streetEdgeId)
      .joinLeft(userStats).on(_._2.map(_.userId) === _.userId)
      .map(row => (row._1._1._1._1._1, row._1._1._1._1._2, row._1._1._1._2, row._1._1._2, row._1._2, row._2))

    // Either user bounding box filter on neighborhood or street boundaries.
    val filteredQuery = spatialQueryType match {
      case SpatialQueryType.Region =>
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

   /**
   * Retrieves streets based on the provided filters.
   *
   * @param filters   The filters to apply when retrieving streets.
   * @return          A query that yields a sequence of StreetEdge objects.
   */
  def getStreetsWithFilters(filters: StreetFiltersForApi): Query[StreetEdgeTableDef, StreetEdge, Seq] = {
    // Start with all non-deleted street edges
    var query = streetEdgesWithoutDeleted
    
    // Apply bounding box filter if provided
    filters.bbox.foreach { bbox =>
      query = query.filter(_.geom.intersects(
        makeEnvelope(bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat, Some(4326))
      ))
    }
    
    // Apply way type filter if provided
    filters.wayTypes.foreach { wayTypes =>
      query = query.filter(_.wayType inSet wayTypes)
    }
    
    query
  }

  /**
   * Gets the label count, user count, and user IDs for a street edge.
   *
   * @param streetEdgeId     The street edge ID to look up.
   * @param onlyHighQuality  If true, only includes labels from high quality users.
   * @return                 A database action that yields StreetLabelStats.
   */
  def getStreetLabelStats(streetEdgeId: Int, onlyHighQuality: Boolean = false): DBIO[StreetLabelStats] = {
    // Create table queries
    val labelTable = TableQuery[LabelTableDef]
    val userStats = TableQuery[UserStatTableDef]
    
    // Base query: Get all non-deleted labels for this street edge
    var labelsQuery = labelTable
      .filter(_.deleted === false)
      .filter(_.streetEdgeId === streetEdgeId)
    
    // If onlyHighQuality is true, join with user_stat table and filter
    if (onlyHighQuality) {
      labelsQuery = labelsQuery
        .join(userStats).on(_.userId === _.userId)
        .filter(_._2.highQuality === true)
        .map(_._1) // Map back to just the label table
    }
    
    // Count the number of labels
    val labelCountQuery = labelsQuery.length.result
    
    // Get distinct user IDs who created labels on this street
    val userIdsQuery = labelsQuery.map(_.userId).distinct.result
    
    // Execute both queries and combine the results into a StreetLabelStats object
    for {
      labelCount <- labelCountQuery
      userIds <- userIdsQuery
    } yield StreetLabelStats(streetEdgeId, labelCount, userIds)
  }
  
  /**
   * Gets all street data for the API with filters applied, designed for streaming.
   *
   * @param filters   The filters to apply when retrieving streets.
   * @return          A streaming database action that yields StreetDataForApi objects for the API.
   */
  def getStreetsForApi(filters: StreetFiltersForApi): SqlStreamingAction[Vector[StreetDataForApi], StreetDataForApi, Effect.Read] = {
    import slick.jdbc.PostgresProfile.api._

    // We'll use a plain SQL query with proper parameter binding
    val bboxFilter = filters.bbox.map { bbox =>
      s"AND ST_Intersects(s.geom, ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326))"
    }.getOrElse("")
    
    val wayTypeFilter = filters.wayTypes.map { wayTypes =>
      s"AND s.way_type IN (${wayTypes.map(wt => s"'$wt'").mkString(",")})"
    }.getOrElse("")
    
    val regionIdFilter = filters.regionId.map { regionId =>
      s"AND r.region_id = $regionId"
    }.getOrElse("")
    
    val regionNameFilter = filters.regionName.map { regionName =>
      s"AND LOWER(reg.name) = LOWER('$regionName')"
    }.getOrElse("")
    
    val minLabelCountFilter = filters.minLabelCount.map { count =>
      s"AND label_count >= $count"
    }.getOrElse("")
    
    val minAuditCountFilter = filters.minAuditCount.map { count =>
      s"AND audit_count >= $count"
    }.getOrElse("")
    
    val minUserCountFilter = filters.minUserCount.map { count =>
      s"AND array_length(user_ids, 1) >= $count"
    }.getOrElse("")

    // Build the query as a string - safer than string interpolation for SQL
    val queryStr = s"""
      WITH filtered_streets AS (
        SELECT s.street_edge_id, s.geom, s.way_type, o.osm_way_id, r.region_id, reg.name as region_name
        FROM street_edge s
        JOIN osm_way_street_edge o ON s.street_edge_id = o.street_edge_id
        JOIN street_edge_region r ON s.street_edge_id = r.street_edge_id
        JOIN region reg ON r.region_id = reg.region_id
        WHERE s.deleted = false
        $bboxFilter
        $wayTypeFilter
        $regionIdFilter
        $regionNameFilter
      ),
      -- Get audit counts
      audit_counts AS (
        SELECT s.street_edge_id, COUNT(a.audit_task_id) as audit_count
        FROM filtered_streets s
        LEFT JOIN audit_task a ON s.street_edge_id = a.street_edge_id AND a.completed = true
        GROUP BY s.street_edge_id
      ),
      -- Get label counts and users
      label_stats AS (
        SELECT s.street_edge_id, 
              COUNT(l.label_id) as label_count,
              array_agg(DISTINCT l.user_id) as user_ids
        FROM filtered_streets s
        LEFT JOIN label l ON s.street_edge_id = l.street_edge_id AND l.deleted = false
        GROUP BY s.street_edge_id
      )
      -- Final selection with all filters applied
      SELECT s.street_edge_id, s.osm_way_id, s.region_id, s.region_name, s.way_type,
            COALESCE(l.user_ids, ARRAY[]::text[]) as user_ids, 
            COALESCE(l.label_count, 0) as label_count, 
            COALESCE(a.audit_count, 0) as audit_count, 
            s.geom
      FROM filtered_streets s
      LEFT JOIN audit_counts a ON s.street_edge_id = a.street_edge_id
      LEFT JOIN label_stats l ON s.street_edge_id = l.street_edge_id
      WHERE 1=1
      $minLabelCountFilter
      $minAuditCountFilter
      $minUserCountFilter
    """
    
    // Use the plainSQL function with GetResult implicit for StreetDataForApi
    implicit val getStreetDataForApi: GetResult[StreetDataForApi] = GetResult { r =>
      StreetDataForApi(
        streetEdgeId = r.nextInt(),
        osmStreetId = r.nextLong(),
        regionId = r.nextInt(),
        regionName = r.nextString(),
        wayType = r.nextString(),
        userIds = {
          // Handle PostgreSQL array type properly
          val pgArray = r.nextObject().asInstanceOf[PgArray]
          if (pgArray == null) Seq.empty[String]
          else pgArray.getArray.asInstanceOf[Array[String]].toSeq
        },
        labelCount = r.nextInt(),
        auditCount = r.nextInt(),
        geometry = r.nextGeometry[LineString]()
      )
    }
    
    // Return a Query that can be used with db.stream
    sql"""#$queryStr""".as[StreetDataForApi]
  }

  /**
   * Gets all street data for the API with filters applied.
   * Note: This method is not streaming.
   *
   * @param filters   The filters to apply when retrieving streets.
   * @return          A database action that yields a sequence of StreetDataForApi objects for the API.
   */
  def getStreets(filters: StreetFiltersForApi): DBIO[Seq[StreetDataForApi]] = {
    // Get base query from filters
    val baseQuery = getStreetsWithFilters(filters)
    
    // Compile a list of all street edges that match our filters
    for {
      // Get all filtered street edges with their OpenStreetMap IDs and regions
      streets <- baseQuery
        .join(osmWayStreetEdge).on(_.streetEdgeId === _.streetEdgeId)
        .join(streetEdgeRegion).on(_._1.streetEdgeId === _.streetEdgeId)
        .join(regions).on(_._2.regionId === _.regionId)
        .map { case (((street, osmWay), region), regionObj) =>
          (street, osmWay.osmWayId, region.regionId, regionObj.name)
        }.result
        
      // Get audit counts for each street edge
      auditCounts <- DBIO.sequence(streets.map { case (street, _, _, _) =>
        completedAuditTasks
          .filter(_.streetEdgeId === street.streetEdgeId)
          .length.result.map(count => (street.streetEdgeId, count))
      }).map(_.toMap)
      
      // Get label counts and user IDs for each street edge
      labelStats <- DBIO.sequence(streets.map { case (street, _, _, _) =>
        getStreetLabelStats(street.streetEdgeId).map(stats => (street.streetEdgeId, stats))
      }).map(_.toMap)
      
      // Apply post-query filters
      // Note: We couldn't apply these in the base query because they depend on aggregations
      filteredStreets = streets.filter { case (street, osmWayId, regionId, regionName) =>
        // Get the stats object for this street edge
        val stats = labelStats.getOrElse(street.streetEdgeId, 
                                      StreetLabelStats(street.streetEdgeId, 0, Seq.empty))
        val auditCount = auditCounts.getOrElse(street.streetEdgeId, 0)
        
        // Check if street matches all filters
        filters.minLabelCount.forall(stats.labelCount >= _) &&
        filters.minAuditCount.forall(auditCount >= _) &&
        filters.minUserCount.forall(stats.userCount >= _) &&
        (filters.regionId.isEmpty || filters.regionId.contains(regionId)) &&
        (filters.regionName.isEmpty || filters.regionName.exists(_.equalsIgnoreCase(regionName)))
      }
      
    } yield {
      // Convert to StreetDataForApi objects
      filteredStreets.map { case (street, osmWayId, regionId, regionName) =>
        val stats = labelStats.getOrElse(street.streetEdgeId, 
                                         StreetLabelStats(street.streetEdgeId, 0, Seq.empty))
        val auditCount = auditCounts.getOrElse(street.streetEdgeId, 0)
        
        StreetDataForApi(
          streetEdgeId = street.streetEdgeId,
          osmStreetId = osmWayId,
          regionId = regionId,
          regionName = regionName,
          wayType = street.wayType,
          userIds = stats.userIds,
          labelCount = stats.labelCount,
          auditCount = auditCount,
          geometry = street.geom
        )
      }
    }
  }
}
