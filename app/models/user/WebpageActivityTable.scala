package models.user

import java.util.UUID
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}

case class WebpageActivity(webpageActivityId: Int, userId: String, ipAddress: String, description: String, timestamp: java.sql.Timestamp)

class WebpageActivityTable(tag: Tag) extends Table[WebpageActivity](tag, "webpage_activity") {
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
  val userRoles = TableQuery[UserRoleTable]
  val roles = TableQuery[RoleTable]

  def save(activity: WebpageActivity): Int = db.withTransaction { implicit session =>
    if (activity.ipAddress == "128.8.132.187") {
      // Don't save data if the activity is from the remote proxy.
      // TODO The IP address of the remote proxy server should be stored somewhere
      0
    } else {
      val webpageActivityId: Int = (activities returning activities.map(_.webpageActivityId)) += activity
      webpageActivityId
    }
  }

  /**
    * Returns a list of signin counts, each element being a count of logins for a user.
    *
    * @return List[(userId: String, role: String, count: Int)]
    */
  def selectAllSignInCounts: List[(String, String, Int)] = db.withTransaction { implicit session =>
    val signIns = for {
      _activity <- activities if _activity.activity === "SignIn"
      _userRole <- userRoles if _activity.userId === _userRole.userId
      _role <- roles if _userRole.roleId === _role.roleId
      if _role.role =!= "Anonymous"
    } yield (_userRole.userId, _role.role, _activity.webpageActivityId)

    // Count sign in counts by grouping by (user_id, role).
    signIns.groupBy(x => (x._1, x._2)).map{ case ((uId, role), group) => (uId, role, group.length) }.list
  }

  /**
    * See if the user has previous logs for a specific activity.
    */
  def findUserActivity(activity: String, userId: UUID): List[WebpageActivity] = db.withSession { implicit session =>
    activities.filter(a => a.userId === userId.toString && a.activity === activity).list
  }

  /** Returns all WebpageActivities that contain the given string and keyValue pairs in their 'activity' field.
    *
    * Partial activity searches work (for example, if activity is "Cli" then WebpageActivities whose activity begins
    * with "Cli...", such as "Click" will be matched).
    */
  def findKeyVal(activity: String, keyVals: Array[String]): List[WebpageActivity] = db.withSession { implicit session =>
    var filteredActivities = activities.filter(x => (x.activity.startsWith(activity++"_") || x.activity === activity))
    for(keyVal <- keyVals) yield {
      filteredActivities = filteredActivities.filter(x => (x.activity.indexOf("_"++keyVal++"_") >= 0) || x.activity.endsWith("_"+keyVal))
    }
    filteredActivities.list
  }

  // Returns all webpage activities.
  def getAllActivities: List[WebpageActivity] = db.withSession{implicit session =>
    activities.list
  }

  def webpageActivityListToJson(webpageActivities: List[WebpageActivity]): List[JsObject] = {
    webpageActivities.map(webpageActivity => webpageActivityToJson(webpageActivity)).toList
  }

  def webpageActivityToJson(webpageActivity: WebpageActivity): JsObject = {
    Json.obj(
      "webpageActivityId" -> webpageActivity.webpageActivityId,
      "userId" -> webpageActivity.userId,
      "ipAddress" -> webpageActivity.ipAddress,
      "activity" -> webpageActivity.description,
      "timestamp" -> webpageActivity.timestamp
    )
  }
}
