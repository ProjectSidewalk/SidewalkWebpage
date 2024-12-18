package service.utils

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import com.google.inject.ImplementedBy
import models.utils.{MapParams, MyPostgresDriver, VersionTable, WebpageActivity, WebpageActivityTable}
import play.api.Configuration
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.i18n.{Lang, MessagesApi}

import java.sql.Timestamp
import scala.collection.JavaConverters._

@ImplementedBy(classOf[WebpageActivityServiceImpl])
trait WebpageActivityService {
  def insert(activity: WebpageActivity): Future[Int]
}

@Singleton
class WebpageActivityServiceImpl @Inject()(
                                            protected val dbConfigProvider: DatabaseConfigProvider,
                                            webpageActivityTable: WebpageActivityTable,
                                            implicit val ec: ExecutionContext
                                          ) extends WebpageActivityService with HasDatabaseConfigProvider[MyPostgresDriver] {
//  import driver.api._

  def insert(activity: WebpageActivity): Future[Int] = {
    db.run(webpageActivityTable.insert(activity))
  }
}
