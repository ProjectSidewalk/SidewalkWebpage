package service

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import play.api.cache._
import com.google.inject.ImplementedBy
import models.label.{LabelLocationWithSeverity, LabelTable}
import models.utils.MyPostgresDriver
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import models.utils.MyPostgresDriver.api._

@ImplementedBy(classOf[LabelServiceImpl])
trait LabelService {
  def countLabels(labelType: Option[String] = None): Future[Int]
  def selectLocationsAndSeveritiesOfLabels(regionIds: Seq[Int], routeIds: Seq[Int]): Future[Seq[LabelLocationWithSeverity]]
}

@Singleton
class LabelServiceImpl @Inject()(
                                  protected val dbConfigProvider: DatabaseConfigProvider,
                                  cache: CacheApi,
                                  labelTable: LabelTable,
                                  implicit val ec: ExecutionContext
                                 ) extends LabelService with HasDatabaseConfigProvider[MyPostgresDriver] {
  //  import driver.api._

  def countLabels(labelType: Option[String] = None): Future[Int] = {
    labelType match {
      case Some(lType) => db.run(labelTable.countLabels(lType))
      case None => db.run(labelTable.countLabels)
    }
  }

  def selectLocationsAndSeveritiesOfLabels(regionIds: Seq[Int], routeIds: Seq[Int]): Future[Seq[LabelLocationWithSeverity]] = {
    db.run(labelTable.selectLocationsAndSeveritiesOfLabels(regionIds, routeIds))
  }

}
