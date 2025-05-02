package models.region

import com.google.inject.ImplementedBy
import models.street.{StreetEdgePriorityTableDef, StreetEdgeRegionTableDef, StreetEdgeTableDef}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class RegionCompletion(regionId: Int, totalDistance: Double, auditedDistance: Double)
case class NamedRegionCompletion(regionId: Int, name: String, totalDistance: Double, auditedDistance: Double)

class RegionCompletionTableDef(tag: Tag) extends Table[RegionCompletion](tag, "region_completion") {
  def regionId: Rep[Int] = column[Int]("region_id", O.PrimaryKey)
  def totalDistance: Rep[Double] = column[Double]("total_distance")
  def auditedDistance: Rep[Double] = column[Double]("audited_distance")

  def * = (regionId, totalDistance, auditedDistance) <> ((RegionCompletion.apply _).tupled, RegionCompletion.unapply)
}

@ImplementedBy(classOf[RegionCompletionTable])
trait RegionCompletionTableRepository { }

@Singleton
class RegionCompletionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
  extends RegionCompletionTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {

  val regionCompletions = TableQuery[RegionCompletionTableDef]
  val regions = TableQuery[RegionTableDef]
  val streetEdgeRegion = TableQuery[StreetEdgeRegionTableDef]
  val streetEdgeTable = TableQuery[StreetEdgeTableDef]
  val streetEdgePriorityTable = TableQuery[StreetEdgePriorityTableDef]
  val streetsWithoutDeleted = streetEdgeTable.filter(_.deleted === false)
  val regionsWithoutDeleted = regions.filter(_.deleted === false)

  def count: DBIO[Int] = regionCompletions.length.result

  /**
   * Returns a list of all neighborhoods with names. If provided, filter for only given regions.
   */
  def selectAllNamedNeighborhoodCompletions(regionIds: Seq[Int]): DBIO[Seq[NamedRegionCompletion]] = {
    val namedRegionCompletions = for {
      _rc <- regionCompletions
      _r <- regionsWithoutDeleted if _rc.regionId === _r.regionId
      if (_r.regionId inSet regionIds) || regionIds.isEmpty
    } yield (_r.regionId, _r.name, _rc.totalDistance, _rc.auditedDistance)

    namedRegionCompletions.result.map(_.map(x => NamedRegionCompletion.tupled(x)))
  }

  /**
   * Increase the `audited_distance` column of the corresponding region by the length of the specified street edge.
   */
  def updateAuditedDistance(streetEdgeId: Int): DBIO[Int] = {
    for {
      distToAdd: Float <- streetsWithoutDeleted
        .filter(_.streetEdgeId === streetEdgeId)
        .map(_.geom.transform(26918).length).result.head
      regionId: Int <- streetEdgeRegion
        .join(regionsWithoutDeleted).on(_.regionId === _.regionId)
        .filter(_._1.streetEdgeId === streetEdgeId)
        .map(_._2.regionId).result.head

      // Check if neighborhood is fully audited.
      regionIncomplete: Boolean <- streetEdgeRegion
        .join(streetEdgePriorityTable).on(_.streetEdgeId === _.streetEdgeId)
        .filter(x => x._1.regionId === regionId && x._2.priority === 1.0).exists.result

      // Check if the neighborhood is fully audited, and set audited_distance equal to total_distance if so. We are
      // doing this to fix floating point error, so that in the end, the region is marked as exactly 100% complete. Also
      // doing a check to see if the completion is erroneously over 100%, when the streets have not all been audited in
      // that neighborhood; this has never been observed, but it could theoretically be an issue if there is a sizable
      // error, while there is a single (very very short) street segment left to be audited. That case shouldn't happen,
      // but we are just being safe, and setting audited_distance to be less than total_distance.
      rCQuery = regionCompletions.filter(_.regionId === regionId)
      rowsUpdated: Int <- rCQuery.result.head.flatMap { rC: RegionCompletion =>
        if (!regionIncomplete) {
          rCQuery.map(_.auditedDistance).update(rC.totalDistance)
        } else if (rC.auditedDistance + distToAdd > rC.totalDistance) {
          rCQuery.map(_.auditedDistance).update(rC.totalDistance * 0.995)
        } else {
          rCQuery.map(_.auditedDistance).update(rC.auditedDistance + distToAdd)
        }
      }
    } yield {
      rowsUpdated
    }
  }

  def truncateTable: DBIO[Int] = {
    sqlu"TRUNCATE TABLE region_completion"
  }
}
