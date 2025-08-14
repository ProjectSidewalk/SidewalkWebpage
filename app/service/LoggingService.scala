package service

import com.google.inject.ImplementedBy
import models.utils.{MyPostgresProfile, WebpageActivity, WebpageActivityTable}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[LoggingServiceImpl])
trait LoggingService {
  def insert(userId: String, ipAddress: String, activity: String, timestamp: OffsetDateTime): Future[Int]
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

  def insert(userId: String, ipAddress: String, activity: String, timestamp: OffsetDateTime): Future[Int] =
    _insert(Some(userId), ipAddress, activity, Some(timestamp))

  def insert(userId: String, ipAddress: String, activity: String): Future[Int] =
    _insert(Some(userId), ipAddress, activity, None)

  def insert(userId: Option[String], ipAddress: String, activity: String): Future[Int] =
    _insert(userId, ipAddress, activity, None)

  /**
   * Inserts a new webpage activity record into the database, dealing with all optional inputs.
   * @param userId Optional user ID, if available
   * @param ipAddress IP address of the user
   * @param activity Description of the activity performed
   * @param timestamp Optional timestamp of the activity, defaults to current time if not provided
   * @return Future[Int] representing the number of rows inserted
   */
  private def _insert(
      userId: Option[String],
      ipAddress: String,
      activity: String,
      timestamp: Option[OffsetDateTime]
  ): Future[Int] = {
    // If userId is provided, use it; otherwise, get the default anonymous user ID.
    val user: Future[String] = userId match {
      case Some(uId) => Future.successful(uId)
      case None      => authenticationService.getDefaultAnonUser.map(_.userId)
    }

    // If the IP address is comma-separated, take the first part (the rest should be proxies).
    val mainIpAddress = ipAddress.split(",").head.trim

    val time: OffsetDateTime = timestamp.getOrElse(OffsetDateTime.now)
    user.flatMap { uId => db.run(webpageActivityTable.insert(WebpageActivity(0, uId, mainIpAddress, activity, time))) }
  }
}
