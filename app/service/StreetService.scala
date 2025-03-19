package service

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import com.google.inject.ImplementedBy
import models.region.{Region, RegionTable}
import models.street.{StreetEdgePriorityTable, StreetEdgeTable}
import models.utils.MyPostgresProfile
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import models.utils.MyPostgresProfile.api._
import play.api.cache.AsyncCacheApi
import service.utils.ConfigService

import scala.concurrent.duration.DurationInt

@ImplementedBy(classOf[StreetServiceImpl])
trait StreetService {
  def getTotalStreetDistanceDBIO: DBIO[Float]
  def getTotalStreetDistance(metric: Boolean): Future[Float]
  def getAuditedStreetDistance(metric: Boolean): Future[Float]
  def recalculateStreetPriority: Future[Seq[Int]]
}

@Singleton
class StreetServiceImpl @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
                                  cacheApi: AsyncCacheApi,
                                  configService: ConfigService,
                                  streetEdgeTable: StreetEdgeTable,
                                  streetEdgePriorityTable: StreetEdgePriorityTable,
                                  implicit val ec: ExecutionContext
                                 ) extends StreetService with HasDatabaseConfigProvider[MyPostgresProfile] {
  //  import profile.api._

  def getTotalStreetDistanceDBIO: DBIO[Float] = {
    configService.cachedDBIO[Float]("totalStreetDistance")(streetEdgeTable.totalStreetDistance)
  }

  def getTotalStreetDistance(metric: Boolean): Future[Float] = {
    db.run(getTotalStreetDistanceDBIO).map { dist =>
      if (metric) {
        dist * 0.001F // Meters to kilometers.
      } else {
        dist * 0.000621371F // Meters to miles.
      }
    }
  }

  def getAuditedStreetDistance(metric: Boolean): Future[Float] = {
    val auditedDist: Future[Float] = cacheApi.getOrElseUpdate[Float]("auditedStreetDistanceUsingPriority", 30.minutes) {
      db.run(streetEdgePriorityTable.auditedStreetDistanceUsingPriority)
    }

    auditedDist.map { dist =>
      if (metric) {
        dist * 0.001F // Meters to kilometers.
      } else {
        dist * 0.000621371F // Meters to miles.
      }
    }
  }

  def recalculateStreetPriority: Future[Seq[Int]] = {
    db.run(streetEdgePriorityTable.recalculateStreetPriority)
  }
}
