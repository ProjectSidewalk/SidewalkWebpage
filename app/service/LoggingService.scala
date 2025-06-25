package service

import com.google.inject.ImplementedBy
import models.utils.{MyPostgresProfile, WebpageActivity, WebpageActivityTable}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[LoggingServiceImpl])
trait LoggingService {
  def insert(activity: WebpageActivity): Future[Int]
  def insert(userId: String, ipAddress: String, activity: String): Future[Int]
  def insert(userId: Option[String], ipAddress: String, activity: String): Future[Int]
}

@Singleton
class LoggingServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    webpageActivityTable: WebpageActivityTable,
    authenticationService: AuthenticationService,
    implicit val ec: ExecutionContext
) extends LoggingService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  def insert(activity: WebpageActivity): Future[Int] = db.run(webpageActivityTable.insert(activity))

  def insert(userId: String, ipAddress: String, activity: String): Future[Int] =
    insert(WebpageActivity(0, userId, ipAddress, activity, OffsetDateTime.now))

  def insert(userId: Option[String], ipAddress: String, activity: String): Future[Int] = {
    userId match {
      case Some(uId) =>
        insert(WebpageActivity(0, uId, ipAddress, activity, OffsetDateTime.now))
      case None =>
        authenticationService.getDefaultAnonUser.flatMap { anonUser =>
          insert(WebpageActivity(0, anonUser.userId, ipAddress, activity, OffsetDateTime.now))
        }
    }
  }
}
