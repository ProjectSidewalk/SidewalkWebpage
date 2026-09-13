package service

import com.google.inject.ImplementedBy
import models.audit.{AuditTaskTable, StreetEdgeWithAuditStatus}
import models.label.LabelTable
import models.street.{StreetEdgePriorityTable, StreetEdgeTable, StreetImageryTable, StreetPriorityForAdmin}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.{LocalDate, OffsetDateTime}
import javax.inject._
import scala.concurrent.duration.DurationInt
import scala.concurrent.{ExecutionContext, Future}

/**
 * What a street that still needs a re-audit can tell a mapper who hovers it on the map (#5258).
 *
 * @param streetEdgeId   The street this describes.
 * @param lastAuditedAt  When anyone last finished auditing it. Never `None` for a summary that exists -- a street
 *                       only needs a *re*-audit if it was audited once.
 * @param newImageryDate The capture date that flagged it: the median of its sample points' newest captures (#4384).
 *                       `None` when the latest poll came back empty, which clears the median while the flags it
 *                       created stand until the next sync.
 * @param labelCounts    Labels previously placed on the street by type, most frequent first. Only types actually
 *                       present appear; a street whose labels were all deleted has an empty Seq.
 */
case class StreetReauditSummary(
    streetEdgeId: Int,
    lastAuditedAt: OffsetDateTime,
    newImageryDate: Option[LocalDate],
    labelCounts: Seq[(String, Int)]
)

@ImplementedBy(classOf[StreetServiceImpl])
trait StreetService {
  def getStreetCountDBIO: DBIO[Int]
  def getTotalStreetDistanceDBIO: DBIO[Double]
  def getTotalStreetDistance(metric: Boolean): Future[Double]
  def getAuditedStreetDistance(metric: Boolean): Future[Double]
  def recalculateStreetPriority: Future[Seq[Int]]
  def getPriorityWithInputs: Future[Seq[StreetPriorityForAdmin]]
  def selectStreetsWithAuditStatus(
      filterLowQuality: Boolean,
      regionIds: Seq[Int],
      routeIds: Seq[Int]
  ): Future[Seq[StreetEdgeWithAuditStatus]]
  def getReauditSummary(streetEdgeId: Int): Future[Option[StreetReauditSummary]]
  def getReauditSummaryDBIO(streetEdgeId: Int): DBIO[Option[StreetReauditSummary]]
}

@Singleton
class StreetServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    cacheApi: AsyncCacheApi,
    configService: ConfigService,
    streetEdgeTable: StreetEdgeTable,
    streetEdgePriorityTable: StreetEdgePriorityTable,
    streetImageryTable: StreetImageryTable,
    auditTaskTable: AuditTaskTable,
    labelTable: LabelTable,
    implicit val ec: ExecutionContext
) extends StreetService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  def getStreetCountDBIO: DBIO[Int] = configService.cachedDBIO[Int]("streetCount")(streetEdgeTable.streetCount)

  def getTotalStreetDistanceDBIO: DBIO[Double] =
    configService.cachedDBIO[Double]("totalStreetDistance")(streetEdgeTable.totalStreetDistance)

  def getTotalStreetDistance(metric: Boolean): Future[Double] = {
    db.run(getTotalStreetDistanceDBIO).map { dist =>
      if (metric) {
        dist * 0.001d // Meters to kilometers.
      } else {
        dist * 0.000621371d // Meters to miles.
      }
    }
  }

  def getAuditedStreetDistance(metric: Boolean): Future[Double] = {
    val auditedDist: Future[Double] =
      cacheApi.getOrElseUpdate[Double]("auditedStreetDistanceUsingPriority", 30.minutes) {
        db.run(streetEdgePriorityTable.auditedStreetDistanceUsingPriority)
      }

    auditedDist.map { dist =>
      if (metric) {
        dist * 0.001f // Meters to kilometers.
      } else {
        dist * 0.000621371f // Meters to miles.
      }
    }
  }

  def recalculateStreetPriority: Future[Seq[Int]] = db.run(streetEdgePriorityTable.recalculateStreetPriority)

  /**
   * Every routable street's priority with the audit counts behind it, for the admin imagery panel (#4908).
   *
   * Deliberately uncached: the result is one row per open street, which is megabytes for a large city and would sit in
   * the app's heap between the nightly recalcs that are the only thing that changes it. The query is a single pass
   * over `audit_task`, so re-running it per page load is the cheaper side of that trade.
   */
  def getPriorityWithInputs: Future[Seq[StreetPriorityForAdmin]] =
    db.run(streetEdgePriorityTable.getPriorityWithInputs)

  def selectStreetsWithAuditStatus(
      filterLowQuality: Boolean,
      regionIds: Seq[Int],
      routeIds: Seq[Int]
  ): Future[Seq[StreetEdgeWithAuditStatus]] =
    auditTaskTable.selectStreetsWithAuditStatus(filterLowQuality, regionIds, routeIds)

  /**
   * What a street needing a re-audit was last mapped as, for the map's hover card (#5258).
   *
   * `None` for every street that is not currently stale -- never audited, or already refreshed against the current
   * imagery. That test is re-derived here rather than trusted from the caller so the card cannot outlive the state
   * it describes: the map's GeoJSON is fetched once per page load, so a street another mapper refreshes mid-session
   * still arrives at the client flagged.
   *
   * The three reads run as one action so they see one snapshot; a re-audit landing between them would otherwise
   * produce a card reporting a stale street with fresh imagery.
   */
  def getReauditSummary(streetEdgeId: Int): Future[Option[StreetReauditSummary]] = {
    db.run(getReauditSummaryDBIO(streetEdgeId).transactionally)
  }

  /**
   * [[getReauditSummary]] as a composable action, for callers that need it inside a transaction of their own.
   */
  def getReauditSummaryDBIO(streetEdgeId: Int): DBIO[Option[StreetReauditSummary]] = {
    for {
      hasFreshAudit <- auditTaskTable.hasUpToDateAuditFor(streetEdgeId)
      lastAudited   <- auditTaskTable.getLastCompletedAuditTime(streetEdgeId)
      result        <-
        if (hasFreshAudit || lastAudited.isEmpty) {
          DBIO.successful(Option.empty[StreetReauditSummary])
        } else {
          for {
            imagery     <- streetImageryTable.getForStreet(streetEdgeId)
            labelCounts <- labelTable.getLabelTypeCountsForStreet(streetEdgeId)
          } yield Some(
            StreetReauditSummary(
              streetEdgeId,
              lastAudited.get,
              imagery.flatMap(_.medianNewestCapture),
              labelCounts.sortBy { case (labelType, count) => (-count, labelType) }
            )
          )
        }
    } yield result
  }
}
