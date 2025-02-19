package service

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import com.google.inject.ImplementedBy
import models.user.SidewalkUserTable
import models.utils.{MapParams, MyPostgresProfile, VersionTable, WebpageActivity, WebpageActivityTable}
import play.api.Configuration
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.i18n.{Lang, MessagesApi}
import service.user.UserService

import java.time.OffsetDateTime

@ImplementedBy(classOf[LoggingServiceImpl])
trait LoggingService {
  def insert(activity: WebpageActivity): Future[Int]
  def insert(userId: String, ipAddress: String, activity: String): Future[Int]
  def insert(userId: Option[String], ipAddress: String, activity: String): Future[Int]
}

@Singleton
class LoggingServiceImpl @Inject()(
                                            protected val dbConfigProvider: DatabaseConfigProvider,
                                            webpageActivityTable: WebpageActivityTable,
                                            sidewalkUserTable: SidewalkUserTable,
                                            userService: UserService,
                                            implicit val ec: ExecutionContext
                                          ) extends LoggingService with HasDatabaseConfigProvider[MyPostgresProfile] {
//  import profile.api._

  def insert(activity: WebpageActivity): Future[Int] = {
    db.run(webpageActivityTable.insert(activity))
  }

  def insert(userId: String, ipAddress: String, activity: String): Future[Int] = {
    insert(WebpageActivity(0, userId, ipAddress, activity, OffsetDateTime.now))
  }

  def insert(userId: Option[String], ipAddress: String, activity: String): Future[Int] = {
    userId match {
      case Some(uId) =>
        insert(WebpageActivity(0, uId, ipAddress, activity, OffsetDateTime.now))
      case None =>
        userService.getDefaultAnonUser().flatMap { anonUser =>
          insert(WebpageActivity(0, anonUser.userId, ipAddress, activity, OffsetDateTime.now))
        }
    }
  }
}
