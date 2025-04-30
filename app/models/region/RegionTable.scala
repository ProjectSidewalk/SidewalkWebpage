package models.region

import com.google.inject.ImplementedBy
import controllers.APIBBox
import models.audit.AuditTaskTableDef
import models.street.{StreetEdgePriorityTableDef, StreetEdgeRegionTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.MultiPolygon
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject._
import scala.concurrent.ExecutionContext

//case class Region(regionId: Int, dataSource: String, name: String, deleted: Boolean)
case class Region(regionId: Int, dataSource: String, name: String, geom: MultiPolygon, deleted: Boolean)

class RegionTableDef(tag: Tag) extends Table[Region](tag, "region") {
  def regionId: Rep[Int] = column[Int]("region_id", O.PrimaryKey, O.AutoInc)
  def dataSource: Rep[String] = column[String]("data_source")
  def name: Rep[String] = column[String]("name")
  def geom: Rep[MultiPolygon] = column[MultiPolygon]("geom")
  def deleted: Rep[Boolean] = column[Boolean]("deleted")

  def * = (regionId, dataSource, name, geom, deleted) <> ((Region.apply _).tupled, Region.unapply)
}

@ImplementedBy(classOf[RegionTable])
trait RegionTableRepository {
  def getAllRegions: DBIO[Seq[Region]]
  def getNeighborhoodsWithUserCompletionStatus(userId: String, regionIds: Seq[Int]): DBIO[Seq[(Region, Boolean)]]
}

@Singleton
class RegionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
                            streetEdgeRegionTable: StreetEdgeRegionTable
                           )(implicit ec: ExecutionContext)
  extends RegionTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._

  val regions = TableQuery[RegionTableDef]
  val auditTasks = TableQuery[AuditTaskTableDef]
  val streetEdgePriorities = TableQuery[StreetEdgePriorityTableDef]
  //  val userCurrentRegions = TableQuery[UserCurrentRegionTableDef]

  val regionsWithoutDeleted = regions.filter(_.deleted === false)

//  implicit val regionConverter = GetResult[Region](r => {
//    Region(r.nextInt, r.nextString, r.nextString, r.nextGeometry[MultiPolygon], r.nextBoolean)
//  })

//  case class StreetCompletion(regionId: Int, regionName: String, streetEdgeId: Int, completionCount: Int, distance: Double)
//  implicit val streetCompletionConverter = GetResult[StreetCompletion](r => {
//    StreetCompletion(r.nextInt, r.nextString, r.nextInt, r.nextInt, r.nextDouble)
//  })

//  implicit class MultiPolygonUtils(val multiPolygon: MultiPolygon) {
//    // Put MultiPolygon in geojson format, an array[array[array[latlng]]], where each array[array[latlng]] represents a
//    // single polygon. In each polygon, the first array contains the latlngs for the outer boundary of the polygon, and
//    // the remaining arrays have the latlngs for any holes in the polygon.
//    def toJSON: geojson.MultiPolygon[LatLng] = {
//      val nPolygons: Int = multiPolygon.getNumGeometries
//      val allCoordinates: Seq[Seq[Seq[geojson.LatLng]]] = (0 until nPolygons).map { polygonIndex =>
//        val currPolygon: Polygon = multiPolygon.getGeometryN(polygonIndex).asInstanceOf[Polygon]
//        val nHoles: Int = currPolygon.getNumInteriorRing
//        val outerRing: Seq[Array[Coordinate]] = Seq(currPolygon.getExteriorRing.getCoordinates)
//        val holes: Seq[Array[Coordinate]] = (0 until nHoles).map(i => currPolygon.getInteriorRingN(i).getCoordinates)
//        val coordinates: Seq[Array[Coordinate]] = outerRing ++ holes
//        coordinates.map { ring => ring.map(coord => geojson.LatLng(coord.y, coord.x)).toList }
//      }
//      geojson.MultiPolygon(allCoordinates)
//    }
//  }

  def getAllRegions: DBIO[Seq[Region]] = regionsWithoutDeleted.result

  /**
   * Return the name of the given neighborhood.
   */
//  def neighborhoodName(regionId: Int): Option[String] = {
//    regions.filter(_.regionId === regionId).map(_.name).firstOption
//  }

  /**
   * Picks one of the 5 with highest average priority across their street edges.
   */
  def selectAHighPriorityRegion(excludedRegionIds: Seq[Int]): DBIO[Option[Region]] = {
    streetEdgeRegionTable.streetEdgeRegionTable
      .filterNot(_.regionId inSet excludedRegionIds)
      .join(streetEdgePriorities).on(_.streetEdgeId === _.streetEdgeId)
      .groupBy(_._1.regionId).map { case (rId, group) => (rId, group.map(_._2.priority).avg) } // Get avg priority by region
      .join(regionsWithoutDeleted).on(_._1 === _.regionId) // Get the full region instead of just the region_id
      .sortBy(_._1._2.desc).take(5).map(_._2) // Take the 5 with highest average priority
      .sortBy(_ => SimpleFunction.nullary[Double]("random")).result.headOption // Randomly select one of the 5
  }

  def getRegion(regionId: Int): DBIO[Option[Region]] = {
    regionsWithoutDeleted.filter(_.regionId === regionId).result.headOption
  }

  def getRegionByName(regionName: String): DBIO[Option[Region]] = {
    regionsWithoutDeleted.filter(_.name === regionName).result.headOption
  }

  /**
   * Returns a list of neighborhoods within the given bounding box.
   */
  def getNeighborhoodsWithin(bbox: APIBBox): DBIO[Seq[Region]] = {
    regionsWithoutDeleted
      .filter(_.geom.within(makeEnvelope(bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat, Some(4326))))
      .result
  }

  /**
   * Gets regions w/ boolean noting if given user fully audited the region. If provided, filter for only given regions.
   */
  def getNeighborhoodsWithUserCompletionStatus(userId: String, regionIds: Seq[Int]): DBIO[Seq[(Region, Boolean)]] = {
    val userTasks = auditTasks.filter(a => a.completed && a.userId === userId)
    // Get regions that the user has not fully audited.
    val incompleteRegionsForUser = streetEdgeRegionTable.nonDeletedStreetEdgeRegions // FROM street_edge_region
      .joinLeft(userTasks).on(_.streetEdgeId === _.streetEdgeId) // LEFT JOIN audit_task
      .filter(_._2.isEmpty) // WHERE audit_task.audit_task_id IS NULL
      .groupBy(_._1.regionId) // GROUP BY region_id
      .map(_._1) // SELECT region_id

    // Left join regions and incomplete neighborhoods to record completion status.
    regionsWithoutDeleted
      .filter(_r => (_r.regionId inSet regionIds) || regionIds.isEmpty) // WHERE region_id IN regionIds
      .joinLeft(incompleteRegionsForUser).on(_.regionId === _)
      .map(x => (x._1, x._2.isEmpty)).result
  }

  /**
   * Select region_id of the region containing (or closest to) the lat/lng position for every lat/lng.
   *
   * Note that an attempt to take copy the Slick code from the function above and take a union between all the lat/lngs
   * to turn it into one query was unsuccessful, resulting in a stack overflow error. Maybe there is some other way to
   * use Slick syntax that more closely mirrors what we're doing in raw SQL below. Ultimately resorted to batching.
   * @param latLngs Seq of lat/lng pairs to find the closest region for.
   * @return Seq of region_ids that are the closest region to the corresponding lat/lng in the input Seq.
   */
  def getRegionIdClosestToLatLngs(latLngs: Seq[(Float, Float)], batchSize: Int = 25): DBIO[Seq[Int]] = {
    if (latLngs.isEmpty) {
      DBIO.successful(Seq.empty)
    } else {
      // Run the query in batches. We were hitting errors when running on too many lat/lngs at once.
//      DBIO.sequence(
//        latLngs.grouped(batchSize).map { latLngBatch =>
          // Build a VALUES clause with all points.
          val pointDataSql = latLngs.zipWithIndex.map { case ((lat, lng), idx) =>
            s"($idx, ST_SetSRID(ST_MakePoint($lng, $lat), 4326))"
          }.mkString(", ")

          sql"""
            SELECT closest_region.region_id
            FROM (VALUES #$pointDataSql) AS point_data(idx, geom)
            CROSS JOIN LATERAL (
              SELECT region_id
              FROM region
              WHERE deleted = FALSE
              ORDER BY geom <-> point_data.geom
              LIMIT 1
            ) closest_region
            ORDER BY point_data.idx;
          """.as[Int]
//        }.toSeq
//      ).map(_.flatten)
    }
  }
}
