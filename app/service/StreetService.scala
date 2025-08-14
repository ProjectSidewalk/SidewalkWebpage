package service

import com.google.inject.ImplementedBy
import formats.json.RouteBuilderFormats.NewRoute
import models.audit.{AuditTaskTable, StreetEdgeWithAuditStatus}
import models.route.{Route, RouteStreet, RouteStreetTable, RouteTable}
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
  def getTotalStreetDistanceDBIO: DBIO[Float]
  def getTotalStreetDistance(metric: Boolean): Future[Float]
  def getAuditedStreetDistance(metric: Boolean): Future[Float]
  def recalculateStreetPriority: Future[Seq[Int]]
  def saveRoute(route: NewRoute, userId: String): Future[Int]
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
    routeTable: RouteTable,
    routeStreetTable: RouteStreetTable,
    auditTaskTable: AuditTaskTable,
    implicit val ec: ExecutionContext
) extends StreetService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  def getStreetCountDBIO: DBIO[Int] = configService.cachedDBIO[Int]("streetCount")(streetEdgeTable.streetCount)

  def getTotalStreetDistanceDBIO: DBIO[Float] =
    configService.cachedDBIO[Float]("totalStreetDistance")(streetEdgeTable.totalStreetDistance)

  def getTotalStreetDistance(metric: Boolean): Future[Float] = {
    db.run(getTotalStreetDistanceDBIO).map { dist =>
      if (metric) {
        dist * 0.001f // Meters to kilometers.
      } else {
        dist * 0.000621371f // Meters to miles.
      }
    }
  }

  def getAuditedStreetDistance(metric: Boolean): Future[Float] = {
    val auditedDist: Future[Float] = cacheApi.getOrElseUpdate[Float]("auditedStreetDistanceUsingPriority", 30.minutes) {
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

  def saveRoute(route: NewRoute, userId: String): Future[Int] = {
    // Save new route in the database. The order of the streets should be preserved when saving to db.
    db.run((for {
      routeId: Int <- routeTable.insert(Route(0, userId, route.regionId, "temp", public = false, deleted = false))
      newRouteStreets = route.streets.map(street => RouteStreet(0, routeId, street.streetId, street.reverse))
      _ <- routeStreetTable.insertMultiple(newRouteStreets)
    } yield routeId).transactionally)
  }

  def selectStreetsWithAuditStatus(
      filterLowQuality: Boolean,
      regionIds: Seq[Int],
      routeIds: Seq[Int]
  ): Future[Seq[StreetEdgeWithAuditStatus]] =
    auditTaskTable.selectStreetsWithAuditStatus(filterLowQuality, regionIds, routeIds)
}
