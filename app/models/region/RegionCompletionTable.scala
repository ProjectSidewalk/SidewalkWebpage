package models.region

import com.google.inject.ImplementedBy
import models.street.{StreetEdgePriorityTableDef, StreetEdgeRegionTableDef, StreetEdgeTable}
import models.utils.{ConfigTableDef, MyPostgresProfile}
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class RegionCompletion(regionId: Int, totalDistance: Double, auditedDistance: Double)
case class NamedRegionCompletion(regionId: Int, name: String, totalDistance: Double, auditedDistance: Double)

class RegionCompletionTableDef(tag: Tag) extends Table[RegionCompletion](tag, "region_completion") {
  def regionId: Rep[Int]           = column[Int]("region_id", O.PrimaryKey)
  def totalDistance: Rep[Double]   = column[Double]("total_distance")
  def auditedDistance: Rep[Double] = column[Double]("audited_distance")

  def * = (regionId, totalDistance, auditedDistance) <> ((RegionCompletion.apply _).tupled, RegionCompletion.unapply)

  def region =
    foreignKey("region_completion_region_id_fkey", regionId, TableQuery[RegionTableDef])(
      _.regionId,
      onDelete = ForeignKeyAction.Cascade
    )
}

@ImplementedBy(classOf[RegionCompletionTable])
trait RegionCompletionTableRepository {}

object RegionCompletionTable {

  /**
   * How much of a street's geometric length to credit to its region's `audited_distance`.
   *
   * A normally-completed street credits its full length. But when a street is cut short because Street View imagery
   * ran out partway (#4677), crediting the full length overstates coverage — nobody could see the unwalked remainder.
   * In that case credit how far the user actually got (`audited_distance_m`), clamped to `[0, fullLengthMeters]` so a
   * missing, negative, or oversized client value can never push the region's audited distance past the street's real
   * length.
   *
   * @param fullLengthMeters          The street edge's full projected length in meters.
   * @param imageryTruncatedDistanceM `Some(metersWalked)` when the street ended early because imagery ran out; `None`
   *                                  for a normal completion (credit the full length).
   * @return The number of meters to add to the region's `audited_distance`.
   */
  def auditedDistanceToCredit(fullLengthMeters: Double, imageryTruncatedDistanceM: Option[Double]): Double =
    imageryTruncatedDistanceM match {
      case Some(metersWalked) => math.max(0.0, math.min(metersWalked, fullLengthMeters))
      case None               => fullLengthMeters
    }
}

@Singleton
class RegionCompletionTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    streetEdgeTable: StreetEdgeTable
)(implicit
    ec: ExecutionContext
) extends RegionCompletionTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val regionCompletions       = TableQuery[RegionCompletionTableDef]
  val regions                 = TableQuery[RegionTableDef]
  val streetEdgeRegion        = TableQuery[StreetEdgeRegionTableDef]
  val streetEdgePriorityTable = TableQuery[StreetEdgePriorityTableDef]
  val configTable             = TableQuery[ConfigTableDef]
  val regionsWithoutDeleted   = regions.filter(_.deleted === false)

  val tutorialStreetId: Query[Rep[Int], Int, Seq] = configTable.map(_.tutorialStreetEdgeID)

  def count: DBIO[Int] = regionCompletions.length.result

  /**
   * Returns a list of all neighborhoods with names. If provided, filter for only given regions.
   */
  def selectAllNamedNeighborhoodCompletions(regionIds: Seq[Int]): DBIO[Seq[NamedRegionCompletion]] = {
    val namedRegionCompletions = for {
      _rc <- regionCompletions
      _r  <- regionsWithoutDeleted if _rc.regionId === _r.regionId
      if (_r.regionId inSetBind regionIds) || regionIds.isEmpty
    } yield (_r.regionId, _r.name, _rc.totalDistance, _rc.auditedDistance)

    namedRegionCompletions.result.map(_.map(x => NamedRegionCompletion.tupled(x)))
  }

  /**
   * Increase the `audited_distance` column of the corresponding region by the distance credited for the specified
   * street edge. Short-circuits for the tutorial street — it's excluded from region completion totals entirely, so
   * crediting its distance here would overshoot `total_distance`.
   *
   * @param imageryTruncatedDistanceM `Some(metersWalked)` when the street ended early because Street View imagery ran
   *                                  out (#4677) — credit only how far the user actually got, not the full geometry.
   *                                  `None` for a normal completion (credit the full street length).
   */
  def updateAuditedDistance(streetEdgeId: Int, imageryTruncatedDistanceM: Option[Double] = None): DBIO[Int] = {
    tutorialStreetId.filter(_ === streetEdgeId).exists.result.flatMap { isTutorial =>
      if (isTutorial) DBIO.successful(0)
      else doUpdateAuditedDistance(streetEdgeId, imageryTruncatedDistanceM)
    }
  }

  private def doUpdateAuditedDistance(streetEdgeId: Int, imageryTruncatedDistanceM: Option[Double]): DBIO[Int] = {
    for {
      fullLength: Double <- streetEdgeTable.streets
        .filter(_.streetEdgeId === streetEdgeId)
        .map(_.geom.transform(26918).lengthD)
        .result
        .head
      distToAdd: Double = RegionCompletionTable.auditedDistanceToCredit(fullLength, imageryTruncatedDistanceM)
      regionId: Int <- streetEdgeRegion
        .join(regionsWithoutDeleted)
        .on(_.regionId === _.regionId)
        .filter(_._1.streetEdgeId === streetEdgeId)
        .map(_._2.regionId)
        .result
        .head

      // Check if neighborhood is fully audited. Exclude the tutorial street (permanent priority=1.0) and the street
      // currently being audited (its priority update runs separately in partiallyUpdatePriority — if we don't exclude
      // it here, the last street in a region always appears un-audited at this point, so regionIncomplete is always
      // true and the floating-point equalization never fires).
      regionIncomplete: Boolean <- streetEdgeRegion
        .join(streetEdgePriorityTable)
        .on(_.streetEdgeId === _.streetEdgeId)
        .filter(x => x._1.regionId === regionId && x._2.priority === 1.0)
        .filterNot(_._1.streetEdgeId in tutorialStreetId)
        .filterNot(_._1.streetEdgeId === streetEdgeId)
        .exists
        .result

      // Check if the neighborhood is fully audited, and set audited_distance equal to total_distance if so. We are
      // doing this to fix floating point error, so that in the end, the region is marked as exactly 100% complete. Also
      // doing a check to see if the completion is erroneously over 100%, when the streets have not all been audited in
      // that neighborhood; this has never been observed, but it could theoretically be an issue if there is a sizable
      // error, while there is a single (very short) street segment left to be audited. That case shouldn't happen, but
      // we are just being safe, and setting audited_distance to be less than total_distance.
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
