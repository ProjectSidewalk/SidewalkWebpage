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

      // A fully audited region is set to exactly total_distance, so floating point error can't keep it off 100%; one
      // that isn't is held just under, in case that error overshoots with a very short street left (never observed).
      // One UPDATE, so the sum starts from the row as it is when the write lands, not from a read that a rebuild or
      // another save has since replaced. A region with no row is left for the rebuild that creates it.
      rowsUpdated: Int <- sqlu"""
        UPDATE region_completion
        SET audited_distance = CASE
            WHEN NOT $regionIncomplete THEN total_distance
            WHEN audited_distance + $distToAdd > total_distance THEN total_distance * 0.995
            ELSE audited_distance + $distToAdd
        END
        WHERE region_id = $regionId"""
    } yield {
      rowsUpdated
    }
  }

  /**
   * Recomputes every region's row in place. Never TRUNCATE: that waits out the nightly backup, with every reader
   * of the table stuck behind it, and leaves the table empty for whoever reads next (#6014).
   * @return The number of rows written.
   */
  def rebuild: DBIO[Int] = (lockAgainstWriters >> recompute).transactionally

  /** Writes every region's fresh row and drops rows of regions that are gone. Run under [[lockAgainstWriters]]. */
  private def recompute: DBIO[Int] = {
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

    for {
      fresh <- freshCompletions.result
      _     <- regionCompletions.filterNot(rc => regionsWithoutDeleted.filter(_.regionId === rc.regionId).exists).delete
      _     <- regionCompletions.insertOrUpdateAll(fresh)
    } yield fresh.size
  }

  // Blocks writers only, not readers or the backup, so Explore saves in flight are counted and rebuilds take turns.
  private val lockAgainstWriters = sqlu"LOCK TABLE region_completion IN SHARE ROW EXCLUSIVE MODE"

  /**
   * Fills the table the first time it is read in a city that has never had it built.
   * @return The number of rows written, 0 when the table already had rows.
   */
  def rebuildIfEmpty: DBIO[Int] = regionCompletions.exists.result.flatMap { filled =>
    if (filled) DBIO.successful(0)
    else {
      // Checked again under the lock: requests that all found it empty would otherwise each rebuild in turn.
      (lockAgainstWriters >> regionCompletions.exists.result.flatMap { filledMeanwhile =>
        if (filledMeanwhile) DBIO.successful(0) else recompute
      }).transactionally
    }
  }
}
