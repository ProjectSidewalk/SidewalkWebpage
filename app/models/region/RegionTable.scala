package models.region

import java.util.UUID

import com.vividsolutions.jts.geom.Polygon
import models.audit.AuditTaskTable

import math._
import models.street.{StreetEdgePriorityTable, StreetEdgeRegionTable}
import models.user.UserCurrentRegionTable
import models.utils.MyPostgresDriver.api._
import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.jdbc.GetResult
import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

case class Region(regionId: Int, regionTypeId: Int, dataSource: Option[String], description: String, geom: Polygon, deleted: Boolean)
case class NamedRegion(regionId: Int, name: Option[String], geom: Polygon)

class RegionTable(tag: Tag) extends Table[Region](tag, Some("sidewalk"), "region") {
  def regionId = column[Int]("region_id", O.PrimaryKey, O.AutoInc)
  def regionTypeId = column[Int]("region_type_id")
  def dataSource = column[Option[String]]("data_source")
  def description = column[String]("description")
  def geom = column[Polygon]("geom")
  def deleted = column[Boolean]("deleted")

  def * = (regionId, regionTypeId, dataSource, description, geom, deleted) <> ((Region.apply _).tupled, Region.unapply)

  def regionType = foreignKey("region_region_type_id_fkey", regionTypeId, TableQuery[RegionTypeTable])(_.regionTypeId)
}

/**
 * Data access object for the sidewalk_edge table
 */
object RegionTable {
  import models.utils.MyPostgresDriver.api._

  implicit val regionConverter = GetResult[Region](r => {
    Region(r.nextInt, r.nextInt, r.nextStringOption, r.nextString, r.nextGeometry[Polygon], r.nextBoolean)
  })

  implicit val namedRegionConverter = GetResult[NamedRegion](r => {
    NamedRegion(r.nextInt, r.nextStringOption, r.nextGeometry[Polygon])
  })

  case class StreetCompletion(regionId: Int, regionName: String, streetEdgeId: Int, completionCount: Int, distance: Double)
  implicit val streetCompletionConverter = GetResult[StreetCompletion](r => {
    StreetCompletion(r.nextInt, r.nextString, r.nextInt, r.nextInt, r.nextDouble)
  })

  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val regions = TableQuery[RegionTable]
  val regionTypes = TableQuery[RegionTypeTable]
  val regionProperties = TableQuery[RegionPropertyTable]
  val userCurrentRegions = TableQuery[UserCurrentRegionTable]

  // These regions are buggy, so we steer new users away from them
  val difficultRegionIds: List[Int] = List(251, 281, 317, 366)
  val regionsWithoutDeleted = regions.filter(_.deleted === false)
  val neighborhoods = regionsWithoutDeleted.filter(_.regionTypeId === 2)
  val namedRegions = for {
    (_neighborhoods, _regionProperties) <- neighborhoods.joinLeft(regionProperties).on(_.regionId === _.regionId)
    if _regionProperties.map(_.key === "Neighborhood Name").isDefined
  } yield (_neighborhoods.regionId, _regionProperties.map(_.value), _neighborhoods.geom)
  val namedNeighborhoods = for {
    (_namedRegion, _neighborhood) <- namedRegions.joinLeft(neighborhoods).on(_._1 === _.regionId)
  } yield _namedRegion

  /**
   * Returns a list of all the neighborhood regions
    *
    * @return A list of Region objects.
   */
  def selectAllNeighborhoods: Future[List[Region]] = db.run(
    regionsWithoutDeleted.filter(_.regionTypeId === 2).to[List].result
  )

  /**
    * Returns a list of all neighborhoods with names
    * @return
    */
  def selectAllNamedNeighborhoods: Future[List[NamedRegion]] = db.run(
    namedRegions.to[List].result.map(_.map(NamedRegion.tupled))
  )

  def regionIdToNeighborhoodName(regionId: Int): String = db.withSession { implicit session =>
    namedNeighborhoods.filter(_._1 === regionId).map(_._2).list.head.get
  }

  /**
    * Picks one of the regions with highest average priority.
    *
    * @return
    */
  def selectAHighPriorityRegion: Future[Option[NamedRegion]] = {
    db.run(
      regionsWithoutDeleted.map(_.regionId).to[List].result
    ).flatMap { possibleRegionIds =>
      selectAHighPriorityRegionGeneric(possibleRegionIds)
    }
  }

  /**
    * Picks one of the regions with highest average priority out of those that the user has not completed.
    *
    * @param userId
    * @return
    */
  def selectAHighPriorityRegion(userId: UUID): Future[Option[NamedRegion]] = {
    AuditTaskTable.selectIncompleteRegions(userId).flatMap { possibleRegionIds =>
      selectAHighPriorityRegionGeneric(possibleRegionIds.toList).flatMap {
        case Some(region) => Future.successful(Some(region))
        case _ => selectAHighPriorityRegion // Should only happen if user has completed all regions.
      }
    }
  }

  /**
    * Picks one of the easy regions with highest average priority out of those that the user has not completed.
    *
    * @param userId
    * @return
    */
  def selectAHighPriorityEasyRegion(userId: UUID): Future[Option[NamedRegion]] = {
    AuditTaskTable.selectIncompleteRegions(userId).flatMap { incompleteRegions =>
      val possibleRegionIds = incompleteRegions.filterNot(difficultRegionIds.contains(_)).toList
      selectAHighPriorityRegionGeneric(possibleRegionIds).flatMap {
        case Some(region) => Future.successful(Some(region))
        case _ => selectAHighPriorityRegion(userId) // Should only happen if user has completed all easy regions.
      }
    }
  }

  /**
    * Out of the provided regions, picks one of the 5 with highest average priority across their street edges.
    *
    * @param possibleRegionIds
    * @return
    */
  def selectAHighPriorityRegionGeneric(possibleRegionIds: List[Int]): Future[Option[NamedRegion]] = {
    db.run(
      StreetEdgeRegionTable.streetEdgeRegionTable
        .filter(_.regionId inSet possibleRegionIds)
        .join(StreetEdgePriorityTable.streetEdgePriorities).on(_.streetEdgeId === _.streetEdgeId)
        .map { case (_region, _priority) => (_region.regionId, _priority.priority) } // select region_id, priority
        .groupBy(_._1).map { case (_regionId, group) => (_regionId, group.map(_._2).avg) } // get avg priority by region
        .sortBy(_._2.desc).take(5).map(_._1) // take the 5 with highest average priority, select region_id
        .to[List].result
    ).flatMap { highestPriorityRegions =>
      scala.util.Random.shuffle(highestPriorityRegions).headOption match {
        case Some(regionId) => selectANamedRegion(regionId)
        case _ => Future.successful(None)
      }
    }
  }

  /**
    * Get the region specified by the region id
    *
    * @param regionId region id
    * @return
    */
  def selectANeighborhood(regionId: Int): Future[Option[Region]] = db.run(
      neighborhoods.filter(_.regionId === regionId).result.headOption
  )

  /**
    * Get the region specified by the region id
    *
    * @param regionId region id
    * @return
    */
  def selectANamedRegion(regionId: Int): Future[Option[NamedRegion]] = {
    db.run({
      val filteredNeighborhoods = neighborhoods.filter(_.regionId === regionId)
      val _regions = for {
        (_neighborhoods, _properties) <- filteredNeighborhoods.joinLeft(regionProperties).on(_.regionId === _.regionId)
        if _properties.map(_.key === "Neighborhood Name").isDefined
      } yield (_neighborhoods.regionId, _properties.map(_.value), _neighborhoods.geom)
      _regions.result.headOption
    }).map(x => x.map(NamedRegion.tupled))
  }

  /**
    * Get the neighborhood that is currently assigned to the user.
    *
    * @param userId user id
    * @return
    */
  def selectTheCurrentRegion(userId: UUID): Future[Option[Region]] = {
    db.run({
      val currentRegions = for {
        (r, ucr) <- regionsWithoutDeleted.filter(_.regionTypeId === 2).join(userCurrentRegions).on(_.regionId === _.regionId)
        if ucr.userId === userId.toString
      } yield r
      currentRegions.result.headOption
    })
  }

  /**
    * Get the neighborhood that is currently assigned to the user.
    *
    * @param userId user id
    * @return
    */
  def selectTheCurrentNamedRegion(userId: UUID): Future[Option[NamedRegion]] = {
    db.run({
      val currentRegions = for {
        (r, ucr) <- regionsWithoutDeleted.filter(_.regionTypeId === 2).join(userCurrentRegions).on(_.regionId === _.regionId)
        if ucr.userId === userId.toString
      } yield r

      val _regions = for {
        (_regions, _properties) <- currentRegions.joinLeft(regionProperties).on(_.regionId === _.regionId)
        if _properties.map(_.key === "Neighborhood Name").isDefined
      } yield (_regions.regionId, _properties.map(_.value), _regions.geom)
      _regions.result.headOption
    }).map(x => x.map(NamedRegion.tupled))
  }

  def selectNamedRegionsIntersectingAStreet(streetEdgeId: Int): Future[List[NamedRegion]] = {
    def selectRegionQuery(streetEdgeId: Int) =
      sql"""SELECT region.region_id, region_property.value, region.geom
             FROM sidewalk.region
             INNER JOIN sidewalk.street_edge ON ST_Intersects(region.geom, street_edge.geom)
             LEFT JOIN sidewalk.region_property ON region.region_id = region_property.region_id
             WHERE street_edge.street_edge_id = #$streetEdgeId
                AND region_property.key = 'Neighborhood Name'
                AND region.deleted = FALSE
        """.as[(Int, String, Polygon)]

    db.run(selectRegionQuery(streetEdgeId))
      .map(_.toList.map {
        case (regionId: Int, name: String, regionGeom: Polygon) =>
          NamedRegion(regionId, Option(name), regionGeom)
      })
  }

  /**
    * Returns a list of neighborhoods intersecting the given bounding box
    * @param lat1
    * @param lng1
    * @param lat2
    * @param lng2
    * @return
    */
  def selectNamedNeighborhoodsIntersecting(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Future[List[NamedRegion]] = {
    def selectNamedNeighborhoodQuery(lat1: Double, lng1: Double, lat2: Double, lng2: Double) =
      sql"""SELECT region.region_id, region_property.value, region.geom
             FROM sidewalk.region
             LEFT JOIN sidewalk.region_property ON region.region_id = region_property.region_id
             WHERE region.deleted = FALSE
                 AND region.region_type_id = 2
                 AND ST_Intersects(region.geom, ST_MakeEnvelope(#$lat1, #$lng1, #$lat2, #$lng2, 4326))
        """.as[(Int, String, Polygon)]

    val minLat = min(lat1, lat2)
    val minLng = min(lng1, lng2)
    val maxLat = max(lat1, lat2)
    val maxLng = max(lng1, lng2)
    db.run(selectNamedNeighborhoodQuery(minLng, minLat, maxLng, maxLat))
      .map(_.toList.map {
        case (regionId: Int, name: String, regionGeom: Polygon) =>
          NamedRegion(regionId, Option(name), regionGeom)
      })
  }

  /**
    * Returns a list of neighborhoods within the given bounding box
    * @param lat1
    * @param lng1
    * @param lat2
    * @param lng2
    * @return
    */
  def selectNamedNeighborhoodsWithin(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Future[List[NamedRegion]] = {
    def selectNamedNeighborhoodQuery(lat1: Double, lng1: Double, lat2: Double, lng2: Double) =
      sql"""SELECT region.region_id, region_property.value, region.geom
             FROM sidewalk.region
             LEFT JOIN sidewalk.region_property ON region.region_id = region_property.region_id
             WHERE region.deleted = FALSE
                AND region.region_type_id = 2
                AND ST_Within(region.geom, ST_MakeEnvelope(#$lat1, #$lng1, #$lat2, #$lng2,4326))
        """.as[(Int, String, Polygon)]

    val minLat = min(lat1, lat2)
    val minLng = min(lng1, lng2)
    val maxLat = max(lat1, lat2)
    val maxLng = max(lng1, lng2)
    db.run(selectNamedNeighborhoodQuery(minLng, minLat, maxLng, maxLat))
      .map(_.toList.map {
        case (regionId: Int, name: String, regionGeom: Polygon) =>
          NamedRegion(regionId, Option(name), regionGeom)
      })
  }

  /**
    * This method returns a list of NamedRegions
    *
    * @param regionType
    * @return
    */
  def selectNamedRegionsOfAType(regionType: String): Future[List[NamedRegion]] = {
    db.run({
      val _regions = for {
        (_regions, _regionTypes) <- regionsWithoutDeleted.join(regionTypes).on(_.regionTypeId === _.regionTypeId)
        if _regionTypes.regionType === regionType
      } yield _regions


      val _namedRegions = for {
        (_regions, _regionProperties) <- _regions.joinLeft(regionProperties).on(_.regionId === _.regionId)
        if _regionProperties.map(_.key === "Neighborhood Name").isDefined
      } yield (_regions.regionId, _regionProperties.map(_.value), _regions.geom)

      _namedRegions.to[List].result
    }).map(x => x.map(NamedRegion.tupled))
  }

  /**
    * Gets the region id of the neighborhood wherein the lat-lng point is located, the closest neighborhood otherwise.
    *
    * @param lng
    * @param lat
    * @return
    */
  def selectRegionIdOfClosestNeighborhood(lng: Float, lat: Float): Future[Int] = {
    def closestNeighborhoodQuery(lng: Float, lat: Float) =
      sql"""SELECT region_id
             FROM region,
                 (
                     SELECT MIN(st_distance(geom, st_setsrid(st_makepoint(#$lng, #$lat), 4326))) AS min_dist
                     FROM region
                     WHERE region.deleted = FALSE
                         AND region.region_type_id = 2
                 ) region_dists
             WHERE st_distance(geom, st_setsrid(st_makepoint(#$lng, #$lat), 4326)) = min_dist
                 AND deleted = FALSE
                 AND region_type_id = 2;
        """.as[Int]

    db.run(closestNeighborhoodQuery(lng, lat).head)
  }
}
