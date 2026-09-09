package service

import com.google.inject.ImplementedBy
import models.intersection.{IntersectionRebuildCounts, IntersectionTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsObject, Json}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/**
 * What a rebuild of the intersection table did (#5095).
 *
 * @param intersections      Rows in the table afterwards.
 * @param inserted           Nodes that had no row within a meter.
 * @param updated            Rows whose degree, grade separation, region, or exact position changed.
 * @param deleted            Rows no derived node was within a meter of.
 * @param clustersAttributed Cluster rows whose intersection changed in the re-attribution that follows.
 */
case class IntersectionRebuildResult(
    intersections: Int,
    inserted: Int,
    updated: Int,
    deleted: Int,
    clustersAttributed: Int
) {

  /**
   * The counts as they are stored against a `background_job_run` row.
   *
   * @return The run's `details` object.
   */
  def runDetails: JsObject = Json.obj(
    "intersections"       -> intersections,
    "inserted"            -> inserted,
    "updated"             -> updated,
    "deleted"             -> deleted,
    "clusters_attributed" -> clustersAttributed
  )
}

@ImplementedBy(classOf[IntersectionServiceImpl])
trait IntersectionService {

  /**
   * Re-derives the intersections from the street graph and re-attributes every corner-type cluster, in one
   * transaction, so a reader never sees a node without its clusters or a cluster pointing at a node that is gone.
   */
  def rebuild(): Future[IntersectionRebuildResult]
}

/**
 * Keeps the derived `intersection` table current (#5095). Runs at the top of the nightly clustering job — the street
 * graph rarely changes, but the OSM tags that decide grade separation arrive from their own nightly refresh, and a
 * cheap rebuild (seconds, even for Seattle) is simpler than tracking what changed.
 */
@Singleton
class IntersectionServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    intersectionTable: IntersectionTable
)(implicit ec: ExecutionContext)
    extends IntersectionService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  def rebuild(): Future[IntersectionRebuildResult] = {
    val action: DBIO[IntersectionRebuildResult] = for {
      counts: IntersectionRebuildCounts <- intersectionTable.rebuild
      attributed: Int                   <- intersectionTable.attributeClusters(
        AccessScoreCalculator.intersectionTypeNames,
        AccessScoreCalculator.attributionRadiusMeters,
        sessionId = None
      )
    } yield IntersectionRebuildResult(counts.total, counts.inserted, counts.updated, counts.deleted, attributed)
    db.run(action.transactionally)
  }
}
