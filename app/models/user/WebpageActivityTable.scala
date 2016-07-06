package models.user

import java.util.UUID

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class WebpageActivity(webpageActivityId: Int, userId: String, ipAddress: String, description: String, timestamp: java.sql.Timestamp)

class WebpageActivityTable(tag: Tag) extends Table[WebpageActivity](tag, Some("sidewalk"), "webpage_activity") {
  def webpageActivityId = column[Int]("webpage_activity_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id", O.NotNull)
  def ipAddress = column[String]("ip_address", O.NotNull)
  def activity = column[String]("activity", O.NotNull)
  def timestamp = column[java.sql.Timestamp]("timestamp", O.NotNull)

  def * = (webpageActivityId, userId, ipAddress, activity, timestamp) <> ((WebpageActivity.apply _).tupled, WebpageActivity.unapply)
}

object WebpageActivityTable {
  val db = play.api.db.slick.DB
  val activities = TableQuery[WebpageActivityTable]

  def save(activity: WebpageActivity): Int = db.withTransaction { implicit session =>
    if (activity.ipAddress == "128.8.132.187") {
      // Don't save data if the activity is from the remote proxy. Todo: The IP address of the remote proxy server should be store
      0
    } else {
      val webpageActivityId: Int =
        (activities returning activities.map(_.webpageActivityId)) += activity
      webpageActivityId
    }
  }

  /**
    * Returns the last log in timestamp
    * @param userId User id
    * @return
    */
  def selectLastSignInTimestamp(userId: UUID): Option[java.sql.Timestamp] = db.withTransaction { implicit session =>
    val signInActivities: List[WebpageActivity] = activities.filter(_.userId === userId.toString).filter(_.activity === "SignIn").sortBy(_.timestamp.desc).list

    if (signInActivities.nonEmpty) {
      Some(signInActivities.head.timestamp)
    } else {
      None
    }
  }

  /**
    * Returns the signup timestamp
    * @param userId User id
    * @return
    */
  def selectSignUpTimestamp(userId: UUID): Option[java.sql.Timestamp] = db.withTransaction { implicit session =>
    val signUpActivities: List[WebpageActivity] = activities.filter(_.userId === userId.toString).filter(_.activity === "SignUp").sortBy(_.timestamp.desc).list

    if (signUpActivities.nonEmpty) {
      Some(signUpActivities.head.timestamp)
    } else {
      None
    }
  }
}
