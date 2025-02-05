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

import scala.concurrent.duration.DurationInt

@ImplementedBy(classOf[StreetServiceImpl])
trait StreetService {
  def getTotalStreetDistance(metric: Boolean): Future[Float]
  def getAuditedStreetDistance(metric: Boolean): Future[Float]
}

@Singleton
class StreetServiceImpl @Inject()(
                                   protected val dbConfigProvider: DatabaseConfigProvider,
                                   cacheApi: AsyncCacheApi,
                                   streetEdgeTable: StreetEdgeTable,
                                   streetEdgePriorityTable: StreetEdgePriorityTable,
                                   implicit val ec: ExecutionContext
                                 ) extends StreetService with HasDatabaseConfigProvider[MyPostgresProfile] {
  //  import profile.api._

  def getTotalStreetDistance(metric: Boolean): Future[Float] = {
    val streetDist: Future[Float] = cacheApi.getOrElseUpdate[Float]("totalStreetDistance") {
      db.run(streetEdgeTable.totalStreetDistance)
    }

    streetDist.map { dist =>
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
}
