package service

import com.google.inject.ImplementedBy
import models.audit.AuditTaskTable
import models.street.StreetImageryTable
import models.utils.MyPostgresProfile
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

/**
 * Keeps the app's imagery-age knowledge (street_imagery) fresh and syncs the audit_task.outdated_imagery flag against
 * it (#4384). An audit performed on since-replaced imagery keeps its user credit but stops counting toward routing
 * and completion, so labelers are re-sent down re-imaged streets and "% complete" means "audited with current
 * imagery".
 */
@ImplementedBy(classOf[ImageryFreshnessServiceImpl])
trait ImageryFreshnessService {
  def syncImageryFreshness: Future[ImageryFreshnessService.SyncResult]
}

object ImageryFreshnessService {

  /**
   * Outcome of one freshness sync.
   *
   * @param streetsRefreshed street_imagery rows inserted or updated from recently-labeled panos.
   * @param auditsFlagged    Completed audits newly flagged as outdated_imagery.
   * @param auditsUnflagged  Audits whose outdated_imagery flag was cleared.
   */
  case class SyncResult(streetsRefreshed: Int, auditsFlagged: Int, auditsUnflagged: Int)
}

@Singleton
class ImageryFreshnessServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    streetImageryTable: StreetImageryTable,
    auditTaskTable: AuditTaskTable,
    implicit val ec: ExecutionContext
) extends ImageryFreshnessService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  import models.utils.MyPostgresProfile.api._

  /**
   * Refreshes street_imagery from recently-labeled panos, then syncs outdated_imagery flags against it.
   *
   * Ordering contract: this must run BEFORE recalculateStreetPriority and the region_completion rebuild (see
   * RecalculateStreetPriorityActor), and only there. Flags changing exclusively in that nightly sequence keeps
   * street_edge_priority and region_completion consistent with the flags, and keeps the priority-1.0-crossing
   * increment in ExploreService.updateStreetPriority sound during the day.
   */
  def syncImageryFreshness: Future[ImageryFreshnessService.SyncResult] = {
    db.run((for {
      streetsRefreshed     <- streetImageryTable.refreshFromPanoData
      (flagged, unflagged) <- auditTaskTable.syncOutdatedImageryFlags
    } yield ImageryFreshnessService.SyncResult(streetsRefreshed, flagged, unflagged)).transactionally)
  }
}
