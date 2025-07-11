package service

import com.google.inject.ImplementedBy
import models.region._
import models.street.{StreetEdgePriorityTableDef, StreetEdgeRegionTableDef, StreetEdgeTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[RegionServiceImpl])
trait RegionService {
  def getAllRegions: Future[Seq[Region]]
  def getRegion(regionId: Int): Future[Option[Region]]
  def getRegionByName(regionName: String): Future[Option[Region]]
  def getRegionWithMostLabels: Future[Option[Region]]
  def getNeighborhoodsWithUserCompletionStatus(userId: String, regionIds: Seq[Int]): Future[Seq[(Region, Boolean)]]
  def selectAllNamedNeighborhoodCompletions(regionIds: Seq[Int]): Future[Seq[NamedRegionCompletion]]
  def truncateRegionCompletionTable: Future[Int]
  def initializeRegionCompletionTable: Future[Int]
}

@Singleton
class RegionServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    regionTable: RegionTable,
    regionCompletionTable: RegionCompletionTable,
    streetEdgeTable: StreetEdgeTable,
    implicit val ec: ExecutionContext
) extends RegionService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  val regionCompletions    = regionCompletionTable.regionCompletions
  val streetEdgeRegion     = TableQuery[StreetEdgeRegionTableDef]
  val streetEdgePriorities = TableQuery[StreetEdgePriorityTableDef]

  def getAllRegions: Future[Seq[Region]] = db.run(regionTable.getAllRegions)

  def getRegion(regionId: Int): Future[Option[Region]] = db.run(regionTable.getRegion(regionId))

  def getRegionByName(regionName: String): Future[Option[Region]] = db.run(regionTable.getRegionByName(regionName))

  def getRegionWithMostLabels: Future[Option[Region]] = db.run(regionTable.getRegionWithMostLabels)

  def getNeighborhoodsWithUserCompletionStatus(userId: String, regionIds: Seq[Int]): Future[Seq[(Region, Boolean)]] =
    db.run(regionTable.getNeighborhoodsWithUserCompletionStatus(userId, regionIds))

  def selectAllNamedNeighborhoodCompletions(regionIds: Seq[Int]): Future[Seq[NamedRegionCompletion]] =
    db.run(regionCompletionTable.selectAllNamedNeighborhoodCompletions(regionIds))

  def truncateRegionCompletionTable: Future[Int] = db.run(regionCompletionTable.truncateTable)

  /**
   * If the region_completion table is empty, initializes it with the total and audited distance for each region.
   * @return The number of rows inserted into the region_completion table.
   */
  def initializeRegionCompletionTable: Future[Int] = {
    val tableInitAction = for {
      count: Int       <- regionCompletionTable.count
      numInserted: Int <-
        if (count == 0) {
          val streetsInRegion = for {
            _edgeRegion <- streetEdgeRegion
            _edges      <- streetEdgeTable.streetEdgesWithoutDeleted if _edges.streetEdgeId === _edgeRegion.streetEdgeId
            _edgePriority <- streetEdgePriorities if _edges.streetEdgeId === _edgePriority.streetEdgeId
          } yield (_edgeRegion.regionId, _edges.geom.transform(26918), _edgePriority.priority < 1.0)

          // Get region_id, total_distance, audited_distance for each region.
          val regionsQuery = streetsInRegion.groupBy(_._1).map { case (regionId, group) =>
            (
              regionId,
              group.map(_._2.length).sum.getOrElse(0.0f),                                    // total distance
              group.map(s => Case.If(s._3).Then(s._2.length).Else(0.0f)).sum.getOrElse(0.0f) // audited distance
            )
          }

          // Grab the regions with no streets in them as well, so we can insert them with 0 distances.
          val includingEmptyRegionsQuery = regionTable.regionsWithoutDeleted
            .joinLeft(regionsQuery)
            .on(_.regionId === _._1)
            .map { case (region, regionData) =>
              (region.regionId, regionData.map(_._2).getOrElse(0.0f), regionData.map(_._3).getOrElse(0.0f))
            }

          for {
            regions     <- includingEmptyRegionsQuery.result
            insertCount <- (regionCompletions ++= regions
              .map(r => RegionCompletion(r._1, r._2.toDouble, r._3.toDouble)))
              .map(_.getOrElse(0))
          } yield insertCount
        } else {
          DBIO.successful(0) // If the table is already initialized, 0 rows inserted.
        }
    } yield numInserted

    db.run(tableInitAction.transactionally)
  }
}
