package models.region

import com.google.inject.ImplementedBy
import models.street.{StreetEdgePriorityTableDef, StreetEdgeRegionTableDef, StreetEdgeTable}
import models.utils.{ConfigTableDef, MyPostgresProfile}
import models.utils.MyPostgresProfile.api.*
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class RegionCompletion(regionId: Int, totalDistance: Double, auditedDistance: Double)
case class NamedRegionCompletion(regionId: Int, name: String, totalDistance: Double, auditedDistance: Double)

class RegionCompletionTableDef(tag: Tag) extends Table[RegionCompletion](tag, "region_completion") {
  def regionId: Rep[Int]           = column[Int]("region_id", O.PrimaryKey)
  def totalDistance: Rep[Double]   = column[Double]("total_distance")
  def auditedDistance: Rep[Double] = column[Double]("audited_distance")

  def * = (regionId, totalDistance, auditedDistance).mapTo[RegionCompletion]

  def region =
    foreignKey("region_completion_region_id_fkey", regionId, TableQuery[RegionTableDef])(
      _.regionId,
      onDelete = ForeignKeyAction.Cascade
    )
}

@ImplementedBy(classOf[RegionCompletionTable])
trait RegionCompletionTableRepository {}

@Singleton
class RegionCompletionTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    streetEdgeTable: StreetEdgeTable
)(using ec: ExecutionContext)
    extends RegionCompletionTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val regionCompletions       = TableQuery[RegionCompletionTableDef]
  val regions                 = TableQuery[RegionTableDef]
  val streetEdgeRegion        = TableQuery[StreetEdgeRegionTableDef]
  val streetEdgePriorityTable = TableQuery[StreetEdgePriorityTableDef]
  val configTable             = TableQuery[ConfigTableDef]
  val regionsWithoutDeleted   = regions.filter(_.deleted === false)

  val tutorialStreetId: Query[Rep[Int], Int, Seq] = configTable.map(_.tutorialStreetEdgeID)

  /**
   * Returns each region's completion distances along with its name. If provided, filter for only given regions.
   */
  def getRegionCompletions(regionIds: Seq[Int]): DBIO[Seq[NamedRegionCompletion]] = {
    val namedRegionCompletions = for {
      _rc <- regionCompletions
      _r  <- regionsWithoutDeleted if _rc.regionId === _r.regionId
      if (_r.regionId inSetBind regionIds) || regionIds.isEmpty
    } yield (_r.regionId, _r.name, _rc.totalDistance, _rc.auditedDistance).mapTo[NamedRegionCompletion]

    namedRegionCompletions.result
  }

  /**
   * Increase the `audited_distance` column of the corresponding region by the length of the specified street edge.
   * Short-circuits for the tutorial street — it's excluded from region completion totals entirely, so crediting its
   * distance here would overshoot `total_distance`.
   */
  def updateAuditedDistance(streetEdgeId: Int): DBIO[Int] = {
    tutorialStreetId.filter(_ === streetEdgeId).exists.result.flatMap { isTutorial =>
      if (isTutorial) DBIO.successful(0)
      else doUpdateAuditedDistance(streetEdgeId)
    }
  }

  private def doUpdateAuditedDistance(streetEdgeId: Int): DBIO[Int] = {
    for {
      distToAdd: Double <- streetEdgeTable.streets
        .filter(_.streetEdgeId === streetEdgeId)
        .map(_.geom.lengthGeodesic)
        .result
        .head
      regionId: Int <- streetEdgeRegion
        .join(regionsWithoutDeleted)
        .on(_.regionId === _.regionId)
        .filter { case (streetRegion, _) => streetRegion.streetEdgeId === streetEdgeId }
        .map { case (_, region) => region.regionId }
        .result
        .head

      // Only open, non-tutorial streets can hold a region back; the others never lose priority 1.0. The street being
      // audited is skipped too, since its priority updates separately and would always look unfinished here.
      regionIncomplete: Boolean <- streetEdgeRegion
        .join(streetEdgeTable.streets)
        .on(_.streetEdgeId === _.streetEdgeId)
        .join(streetEdgePriorityTable)
        .on { case ((streetRegion, _), priority) => streetRegion.streetEdgeId === priority.streetEdgeId }
        .filter { case ((streetRegion, _), priority) =>
          streetRegion.regionId === regionId && priority.priority === 1.0
        }
        .filterNot { case ((streetRegion, _), _) => streetRegion.streetEdgeId === streetEdgeId }
        .exists
        .result

      // Check if the region is fully audited, and set audited_distance equal to total_distance if so. We are
      // doing this to fix floating point error, so that in the end, the region is marked as exactly 100% complete. Also
      // doing a check to see if the completion is erroneously over 100%, when the streets have not all been audited in
      // that region; this has never been observed, but it could theoretically be an issue if there is a sizable
      // error, while there is a single (very short) street segment left to be audited. That case shouldn't happen, but
      // we are just being safe, and setting audited_distance to be less than total_distance.
      rCQuery = regionCompletions.filter(_.regionId === regionId)
      // No row means a maintenance script emptied the table to force a rebuild; that rebuild will count this street.
      rowsUpdated: Int <- rCQuery.result.headOption.flatMap {
        case None                          => DBIO.successful(0)
        case Some(rC) if !regionIncomplete => rCQuery.map(_.auditedDistance).update(rC.totalDistance)
        case Some(rC) if rC.auditedDistance + distToAdd > rC.totalDistance =>
          rCQuery.map(_.auditedDistance).update(rC.totalDistance * 0.995)
        case Some(rC) => rCQuery.map(_.auditedDistance).update(rC.auditedDistance + distToAdd)
      }
    } yield {
      rowsUpdated
    }
  }

  /**
   * Recomputes every region's row in place. Never TRUNCATE: that waits out the nightly backup, with every reader
   * of the table stuck behind it, and leaves the table empty for whoever reads next (#6014).
   * @return The number of rows written.
   */
  def rebuild: DBIO[Int] = {
    val streetsInRegion = for {
      _edgeRegion   <- streetEdgeRegion
      _edges        <- streetEdgeTable.streets if _edges.streetEdgeId === _edgeRegion.streetEdgeId
      _edgePriority <- streetEdgePriorityTable if _edges.streetEdgeId === _edgePriority.streetEdgeId
    } yield (_edgeRegion.regionId, _edges.geom.lengthGeodesic, _edgePriority.priority < 1.0)

    val distancesByRegion =
      streetsInRegion.groupBy { case (regionId, _, _) => regionId }.map { case (regionId, group) =>
        val totalDistance   = group.map { case (_, length, _) => length }.sum.getOrElse(0.0d)
        val auditedDistance = group
          .map { case (_, length, audited) => Case.If(audited).Then(length).Else(0.0d) }
          .sum
          .getOrElse(0.0d)
        (regionId, totalDistance, auditedDistance)
      }

    // Left join so a region with no streets still gets a row, with zero distances.
    val freshCompletions = regionsWithoutDeleted
      .joinLeft(distancesByRegion)
      .on { case (region, (regionId, _, _)) => region.regionId === regionId }
      .map { case (region, regionData) =>
        (
          region.regionId,
          regionData.map { case (_, totalDistance, _) => totalDistance }.getOrElse(0.0d),
          regionData.map { case (_, _, auditedDistance) => auditedDistance }.getOrElse(0.0d)
        ).mapTo[RegionCompletion]
      }

    // Blocks writers only, not readers or the backup, so Explore saves in flight are counted and rebuilds take turns.
    (for {
      _     <- sqlu"LOCK TABLE region_completion IN SHARE ROW EXCLUSIVE MODE"
      fresh <- freshCompletions.result
      _     <- regionCompletions.filterNot(_.regionId inSet fresh.map(_.regionId)).delete
      _     <- regionCompletions.insertOrUpdateAll(fresh)
    } yield fresh.size).transactionally
  }

  /**
   * Fills the table the first time it is read in a city that has never had it built.
   * @return The number of rows written, 0 when the table already had rows.
   */
  def rebuildIfEmpty: DBIO[Int] = regionCompletions.exists.result.flatMap { filled =>
    if (filled) DBIO.successful(0) else rebuild
  }
}
