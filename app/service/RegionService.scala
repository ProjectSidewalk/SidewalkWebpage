package service

import com.google.inject.ImplementedBy
import models.region.*
import models.street.{StreetEdgePriorityTableDef, StreetEdgeRegionTableDef, StreetEdgeTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api.*
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.*
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[RegionServiceImpl])
trait RegionService {
  def getAllRegions: Future[Seq[Region]]
  def getRegion(regionId: Int): Future[Option[Region]]
  def getRegionByName(regionName: String): Future[Option[Region]]
  def getRegionsWithUserCompletion(userId: String, regionIds: Seq[Int]): Future[Seq[(Region, Boolean)]]
  def getRegionCompletions(regionIds: Seq[Int]): Future[Seq[NamedRegionCompletion]]
  def getOutdatedDistanceByRegion: Future[Map[Int, Double]]
  def truncateRegionCompletionTable: Future[Int]
  def initializeRegionCompletionTable: Future[Int]
  def initializeRegionCompletionTableAction: DBIO[Int]
}

@Singleton
class RegionServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    regionTable: RegionTable,
    regionCompletionTable: RegionCompletionTable,
    streetEdgeTable: StreetEdgeTable
)(using ec: ExecutionContext)
    extends RegionService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  val regionCompletions    = regionCompletionTable.regionCompletions
  val streetEdgeRegion     = TableQuery[StreetEdgeRegionTableDef]
  val streetEdgePriorities = TableQuery[StreetEdgePriorityTableDef]

  def getAllRegions: Future[Seq[Region]] = db.run(regionTable.getAllRegions)

  def getRegion(regionId: Int): Future[Option[Region]] = db.run(regionTable.getRegion(regionId))

  def getRegionByName(regionName: String): Future[Option[Region]] = db.run(regionTable.getRegionByName(regionName))

  def getRegionsWithUserCompletion(userId: String, regionIds: Seq[Int]): Future[Seq[(Region, Boolean)]] =
    db.run(regionTable.getRegionsWithUserCompletion(userId, regionIds))

  def getRegionCompletions(regionIds: Seq[Int]): Future[Seq[NamedRegionCompletion]] =
    db.run(regionCompletionTable.getRegionCompletions(regionIds))

  /** Distance (meters) of streets needing re-audit per region (#4384); regions with none are absent from the map. */
  def getOutdatedDistanceByRegion: Future[Map[Int, Double]] =
    db.run(regionTable.outdatedDistanceByRegion).map(_.toMap)

  def truncateRegionCompletionTable: Future[Int] = db.run(regionCompletionTable.truncateTable)

  /**
   * If the region_completion table is empty, initializes it with the total and audited distance for each region.
   * @return The number of rows inserted into the region_completion table.
   */
  def initializeRegionCompletionTable: Future[Int] = {
    db.run(initializeRegionCompletionTableAction.transactionally)
  }

  /**
   * The composable action behind `initializeRegionCompletionTable` — exposed separately so tests can run the real
   * recompute inside their own (rolled-back) transaction and compare it against the cached values.
   */
  def initializeRegionCompletionTableAction: DBIO[Int] = {
    for {
      count: Int       <- regionCompletionTable.count
      numInserted: Int <-
        if (count == 0) {
          val streetsInRegion = for {
            _edgeRegion   <- streetEdgeRegion
            _edges        <- streetEdgeTable.streets if _edges.streetEdgeId === _edgeRegion.streetEdgeId
            _edgePriority <- streetEdgePriorities if _edges.streetEdgeId === _edgePriority.streetEdgeId
          } yield (_edgeRegion.regionId, _edges.geom.lengthGeodesic, _edgePriority.priority < 1.0)

          // Get region_id, total_distance, audited_distance for each region.
          val regionsQuery =
            streetsInRegion.groupBy { case (regionId, _, _) => regionId }.map { case (regionId, group) =>
              val totalDistance   = group.map { case (_, length, _) => length }.sum.getOrElse(0.0d)
              val auditedDistance = group
                .map { case (_, length, audited) => Case.If(audited).Then(length).Else(0.0d) }
                .sum
                .getOrElse(0.0d)
              (regionId, totalDistance, auditedDistance)
            }

          // Grab the regions with no streets in them as well, so we can insert them with 0 distances.
          val includingEmptyRegionsQuery = regionTable.regionsWithoutDeleted
            .joinLeft(regionsQuery)
            .on { case (region, (regionId, _, _)) => region.regionId === regionId }
            .map { case (region, regionData) =>
              (
                region.regionId,
                regionData.map { case (_, totalDistance, _) => totalDistance }.getOrElse(0.0d),
                regionData.map { case (_, _, auditedDistance) => auditedDistance }.getOrElse(0.0d)
              ).mapTo[RegionCompletion]
            }

          for {
            regions     <- includingEmptyRegionsQuery.result
            insertCount <- (regionCompletions ++= regions).map(_.getOrElse(0))
          } yield insertCount
        } else {
          DBIO.successful(0) // If the table is already initialized, 0 rows inserted.
        }
    } yield numInserted
  }
}
