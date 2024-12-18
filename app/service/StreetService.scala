package service

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import play.api.cache._
import com.google.inject.ImplementedBy
import models.region.{Region, RegionTable}
import models.street.{StreetEdgePriorityTable, StreetEdgeTable}
import models.utils.MyPostgresDriver
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import models.utils.MyPostgresDriver.api._
import play.api.cache.Cache

import scala.concurrent.duration.DurationInt

@ImplementedBy(classOf[StreetServiceImpl])
trait StreetService {
  def getTotalStreetDistance(metric: Boolean): Future[Float]
  def getAuditedStreetDistance(metric: Boolean): Future[Float]
}

@Singleton
class StreetServiceImpl @Inject()(
                                   protected val dbConfigProvider: DatabaseConfigProvider,
                                   cache: CacheApi,
                                   streetEdgeTable: StreetEdgeTable,
                                   streetEdgePriorityTable: StreetEdgePriorityTable,
                                   implicit val ec: ExecutionContext
                                 ) extends StreetService with HasDatabaseConfigProvider[MyPostgresDriver] {
  //  import driver.api._

  def getTotalStreetDistance(metric: Boolean): Future[Float] = {
    val streetDist: Future[Float] = cache.get[Float]("totalStreetDistance") match {
      case Some(distance: Float) => Future(distance)
      case None =>
        db.run(streetEdgeTable.totalStreetDistance).map { distance =>
          cache.set("totalStreetDistance", distance)
          distance
        }
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
    val auditedDist: Future[Float] = cache.get[Float]("auditedStreetDistanceUsingPriority") match {
      case Some(distance: Float) => Future(distance)
      case None =>
        db.run(streetEdgePriorityTable.auditedStreetDistanceUsingPriority).map { distance =>
          cache.set("auditedStreetDistanceUsingPriority", distance, 30.minutes)
          distance
        }
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
