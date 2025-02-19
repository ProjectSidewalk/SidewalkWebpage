package models.utils

import com.google.inject.ImplementedBy
import models.user.{RoleTableDef, UserRoleTableDef}

import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsObject, Json}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}


case class WebpageActivity(webpageActivityId: Int, userId: String, ipAddress: String, description: String, timestamp: OffsetDateTime)

class WebpageActivityTableDef(tag: Tag) extends Table[WebpageActivity](tag, "webpage_activity") {
  def webpageActivityId: Rep[Int] = column[Int]("webpage_activity_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String] = column[String]("user_id")
  def ipAddress: Rep[String] = column[String]("ip_address")
  def activity: Rep[String] = column[String]("activity")
  def timestamp: Rep[OffsetDateTime] = column[OffsetDateTime]("timestamp")

  def * = (webpageActivityId, userId, ipAddress, activity, timestamp) <> ((WebpageActivity.apply _).tupled, WebpageActivity.unapply)

//  def user: ForeignKeyQuery[UserTable, DBUser] =
//    foreignKey("webpage_activity_user_id_fkey", userId, TableQuery[UserTableDef])(_.userId)
}

@ImplementedBy(classOf[WebpageActivityTable])
trait WebpageActivityTableRepository {
  def insert(activity: WebpageActivity): DBIO[Int]
}

@Singleton
class WebpageActivityTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends WebpageActivityTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val activities = TableQuery[WebpageActivityTableDef]
  val userRoles = TableQuery[UserRoleTableDef]
  val roles = TableQuery[RoleTableDef]

  def insert(activity: WebpageActivity): DBIO[Int] = {
    (activities returning activities.map(_.webpageActivityId)) += activity
  }

//  /**
//    * Returns a list of signin counts, each element being a count of logins for a user.
//    *
//    * @return List[(userId: String, role: String, count: Int)]
//    */
//  def selectAllSignInCounts: List[(String, String, Int)] = {
//    val signIns = for {
//      _activity <- activities if _activity.activity like "SignIn%"
//      _userRole <- userRoles if _activity.userId === _userRole.userId
//      _role <- roles if _userRole.roleId === _role.roleId
//      if _role.role =!= "Anonymous"
//    } yield (_userRole.userId, _role.role, _activity.webpageActivityId)
//
//    // Count sign in counts by grouping by (user_id, role).
//    signIns.groupBy(x => (x._1, x._2)).map{ case ((uId, role), group) => (uId, role, group.length) }.list
//  }
//
//  /**
//    * See if the user has previous logs for a specific activity.
//    */
//  def findUserActivity(activity: String, userId: UUID): List[WebpageActivity] = {
//    activities.filter(a => a.userId === userId.toString && a.activity === activity).list
//  }
//
//  /** Returns all WebpageActivities that contain the given string and keyValue pairs in their 'activity' field.
//    *
//    * Partial activity searches work (for example, if activity is "Cli" then WebpageActivities whose activity begins
//    * with "Cli...", such as "Click" will be matched).
//    */
//  def findKeyVal(activity: String, keyVals: Array[String]): List[WebpageActivity] = {
//    var filteredActivities = activities.filter(x => (x.activity.startsWith(activity++"_") || x.activity === activity))
//    for(keyVal <- keyVals) yield {
//      filteredActivities = filteredActivities.filter(x => (x.activity.indexOf("_"++keyVal++"_") >= 0) || x.activity.endsWith("_"+keyVal))
//    }
//    filteredActivities.list
//  }
//
//  // Returns all webpage activities.
//  def getAllActivities: List[WebpageActivity] = db.withSession{implicit session =>
//    activities.list
//  }
//
//  def webpageActivityListToJson(webpageActivities: List[WebpageActivity]): List[JsObject] = {
//    webpageActivities.map(webpageActivity => webpageActivityToJson(webpageActivity)).toList
//  }

  // TODO move this to a more appropriate place.
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
