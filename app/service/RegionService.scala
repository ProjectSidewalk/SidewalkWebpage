package service

import com.google.inject.ImplementedBy
import models.region.*
import models.utils.MyPostgresProfile
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
  def rebuildRegionCompletionTable: Future[Int]
  def rebuildRegionCompletionTableIfEmpty: Future[Int]
}

@Singleton
class RegionServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    regionTable: RegionTable,
    regionCompletionTable: RegionCompletionTable
)(using ec: ExecutionContext)
    extends RegionService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

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

  def rebuildRegionCompletionTable: Future[Int] = db.run(regionCompletionTable.rebuild)

  def rebuildRegionCompletionTableIfEmpty: Future[Int] = db.run(regionCompletionTable.rebuildIfEmpty)
}
