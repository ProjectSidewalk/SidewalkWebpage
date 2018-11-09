package models.user

import java.util.UUID

import models.utils.MyPostgresDriver.api._
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

case class WebpageActivity(webpageActivityId: Int, userId: String, ipAddress: String, description: String, timestamp: java.sql.Timestamp)

class WebpageActivityTable(tag: Tag) extends Table[WebpageActivity](tag, Some("sidewalk"), "webpage_activity") {
  def webpageActivityId = column[Int]("webpage_activity_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id")
  def ipAddress = column[String]("ip_address")
  def activity = column[String]("activity")
  def timestamp = column[java.sql.Timestamp]("timestamp")

  def * = (webpageActivityId, userId, ipAddress, activity, timestamp) <> ((WebpageActivity.apply _).tupled, WebpageActivity.unapply)
}

object WebpageActivityTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val activities = TableQuery[WebpageActivityTable]
  val userRoles = TableQuery[UserRoleTable]
  val roles = TableQuery[RoleTable]

  def save(activity: WebpageActivity): Future[Int] = {
    if (activity.ipAddress == "128.8.132.187") {
      // Don't save data if the activity is from the remote proxy.
      // TODO The IP address of the remote proxy server should be stored somewhere
      Future.successful(0)
    } else {
      db.run((activities returning activities.map(_.webpageActivityId)) += activity)
    }
  }

  /**
    * Returns the last log in timestamp
    *
    * @param userId User id
    * @return
    */
  def selectLastSignInTimestamp(userId: UUID): Future[Option[java.sql.Timestamp]] = {
    UserRoleTable.getRole(userId) flatMap { _userRole =>
      val signInString: String = if (_userRole == "Anonymous") "AnonAutoSignUp" else "SignIn"
      val signInActivitiesFuture: Future[Seq[WebpageActivity]] = db.run {
        activities.filter(_.userId === userId.toString).filter(_.activity === signInString).sortBy(_.timestamp.desc).result
      }
      signInActivitiesFuture.map { signInActivities =>
        if (signInActivities.nonEmpty) {
          Some(signInActivities.head.timestamp)
        } else {
          None
        }
      }
    }
  }

  /**
    * Returns the signup timestamp
    *
    * @param userId User id
    * @return
    */
  def selectSignUpTimestamp(userId: UUID): Future[Option[java.sql.Timestamp]] = {
    UserRoleTable.getRole(userId) flatMap { _userRole =>
      val signUpString: String = if (_userRole == "Anonymous") "AnonAutoSignUp" else "SignUp"
      val signUpActivitiesFuture: Future[Seq[WebpageActivity]] = db.run {
        activities.filter(_.userId === userId.toString).filter(_.activity === signUpString).sortBy(_.timestamp.desc).result
      }
      signUpActivitiesFuture.map { signUpActivities =>
        if (signUpActivities.nonEmpty) {
          Some(signUpActivities.head.timestamp)
        } else {
          None
        }
      }
    }
  }

  /**
    * Returns the signin count
    * @param userId User id
    * @return
    */
  def selectSignInCount(userId: UUID): Future[Int] = db.run {
    activities.filter(_.userId === userId.toString).filter(_.activity === "SignIn").length.result
  }

  /**
    * Returns a list of signin counts, each element being a count of logins for a user
    *
    * @return List[(userId: String, role: String, count: Int)]
    */
  def selectAllSignInCounts: Future[Seq[(String, String, Int)]] = db.run {
    val signIns = for {
      _activity <- activities if _activity.activity === "SignIn"
      _userRole <- userRoles if _activity.userId === _userRole.userId
      _role <- roles if _userRole.roleId === _role.roleId
      if _role.role =!= "Anonymous"
    } yield (_userRole.userId, _role.role, _activity.webpageActivityId)

    // Count sign in counts by grouping by (user_id, role).
    signIns.groupBy(x => (x._1, x._2)).map{ case ((uId, role), group) => (uId, role, group.length) }.result
  }

  /**
    * Returns all WebpageActivities that contain the given string in their 'activity' field
    */
  def find(activity: String): Future[Seq[WebpageActivity]] = db.run {
    activities.filter(_.activity.like("%"++activity++"%")).result
  }

  /** Returns all WebpageActivities that contain the given string and keyValue pairs in their 'activity' field
    *
    * Partial activity searches work (for example, if activity is "Cli" then WebpageActivities whose activity begins
    * with "Cli...", such as "Click" will be matched)
    *
    * @param activity
    * @param keyVals
    * @return
    */
  def findKeyVal(activity: String, keyVals: Array[String]): Future[Seq[WebpageActivity]] = db.run {
    var filteredActivities = activities.filter(x => x.activity.startsWith(activity++"_") || x.activity === activity)
    for(keyVal <- keyVals) yield {
      filteredActivities = filteredActivities.filter(x => (x.activity.indexOf("_"++keyVal++"_") >= 0) || x.activity.endsWith("_"+keyVal))
    }
    filteredActivities.result
  }

  // Returns all webpage activities
  def getAllActivities: Future[Seq[WebpageActivity]] = db.run {
    activities.result
  }

  def webpageActivityListToJson(webpageActivities: Seq[WebpageActivity]): Seq[JsObject] = {
    webpageActivities.map(webpageActivity => webpageActivityToJson(webpageActivity))
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
