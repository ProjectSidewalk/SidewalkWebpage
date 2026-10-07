package service

import com.google.inject.ImplementedBy
import models.utils.{IpAddress, MyPostgresProfile, WebpageActivity, WebpageActivityTable}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.*
import scala.concurrent.Future

@ImplementedBy(classOf[LoggingServiceImpl])
trait LoggingService {
  def insert(userId: String, ipAddress: IpAddress, activity: String, timestamp: OffsetDateTime): Future[Int]
  def insert(userId: String, ipAddress: IpAddress, activity: String): Future[Int]
  def insert(userId: Option[String], ipAddress: IpAddress, activity: String): Future[Int]
  def insert(userId: Option[String], ipAddress: IpAddress, activity: String, timestamp: OffsetDateTime): Future[Int]
}

@Singleton
class LoggingServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    webpageActivityTable: WebpageActivityTable
) extends LoggingService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  def insert(userId: String, ipAddress: IpAddress, activity: String, timestamp: OffsetDateTime): Future[Int] =
    _insert(Some(userId), ipAddress, activity, Some(timestamp))

  def insert(userId: String, ipAddress: IpAddress, activity: String): Future[Int] =
    _insert(Some(userId), ipAddress, activity, None)

  def insert(userId: Option[String], ipAddress: IpAddress, activity: String): Future[Int] =
    _insert(userId, ipAddress, activity, None)

  def insert(userId: Option[String], ipAddress: IpAddress, activity: String, timestamp: OffsetDateTime): Future[Int] =
    _insert(userId, ipAddress, activity, Some(timestamp))

  /**
   * Inserts a new webpage activity record into the database, dealing with all optional inputs.
   * @param userId The user, or None for a visitor with no session
   * @param ipAddress IP address of the user
   * @param activity Description of the activity performed
   * @param timestamp Optional timestamp of the activity, defaults to current time if not provided
   * @return Future[Int] representing the number of rows inserted
   */
  private def _insert(
      userId: Option[String],
      ipAddress: IpAddress,
      activity: String,
      timestamp: Option[OffsetDateTime]
  ): Future[Int] = {
    val time: OffsetDateTime = timestamp.getOrElse(OffsetDateTime.now)
    db.run(webpageActivityTable.insert(WebpageActivity(0, userId, ipAddress, activity, time)))
  }
}
