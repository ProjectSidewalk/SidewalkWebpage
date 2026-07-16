package service

import com.google.inject.ImplementedBy
import models.audit.{AuditTaskTable, StreetEdgeWithAuditStatus}
import models.street.{StreetEdgePriorityTable, StreetEdgeTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject._
import scala.concurrent.duration.DurationInt
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[StreetServiceImpl])
trait StreetService {
  def getStreetCountDBIO: DBIO[Int]
  def getTotalStreetDistanceDBIO: DBIO[Double]
  def getTotalStreetDistance(metric: Boolean): Future[Double]
  def getAuditedStreetDistance(metric: Boolean): Future[Double]
  def recalculateStreetPriority: Future[Seq[Int]]
  def selectStreetsWithAuditStatus(
      filterLowQuality: Boolean,
      regionIds: Seq[Int],
      routeIds: Seq[Int]
  ): Future[Seq[StreetEdgeWithAuditStatus]]
}

@Singleton
class StreetServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    cacheApi: AsyncCacheApi,
    configService: ConfigService,
    streetEdgeTable: StreetEdgeTable,
    streetEdgePriorityTable: StreetEdgePriorityTable,
    auditTaskTable: AuditTaskTable,
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

  def selectStreetsWithAuditStatus(
      filterLowQuality: Boolean,
      regionIds: Seq[Int],
      routeIds: Seq[Int]
  ): Future[Seq[StreetEdgeWithAuditStatus]] =
    auditTaskTable.selectStreetsWithAuditStatus(filterLowQuality, regionIds, routeIds)
}
