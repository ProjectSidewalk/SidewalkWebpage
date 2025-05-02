package models.utils

import com.google.inject.ImplementedBy
import models.user.{RoleTableDef, UserRoleTableDef}
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

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
trait WebpageActivityTableRepository { }

@Singleton
class WebpageActivityTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)
  extends WebpageActivityTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  val activities = TableQuery[WebpageActivityTableDef]
  val userRoles = TableQuery[UserRoleTableDef]
  val roles = TableQuery[RoleTableDef]

  def insert(activity: WebpageActivity): DBIO[Int] = {
    (activities returning activities.map(_.webpageActivityId)) += activity
  }

  /**
   * Returns a list of signin counts, each element being a count of logins for a user.
   * @return DBIO[Seq[(userId: String, role: String, count: Int)]]
   */
  def getSignInCounts: DBIO[Seq[(String, String, Int)]] = {
    val signIns = for {
      _activity <- activities if _activity.activity like "SignIn%"
      _userRole <- userRoles if _activity.userId === _userRole.userId
      _role <- roles if _userRole.roleId === _role.roleId
      if _role.role =!= "Anonymous"
    } yield (_userRole.userId, _role.role, _activity.webpageActivityId)

    // Count sign in counts by grouping by (user_id, role).
    signIns.groupBy(x => (x._1, x._2)).map{ case ((uId, role), group) => (uId, role, group.length) }.result
  }

  /**
   * Get the time that each user signed up (if we have it logged).
   */
  def getSignUpTimes: DBIO[Seq[(String, Option[OffsetDateTime])]] = {
    activities.filter(_.activity inSet Seq("AnonAutoSignUp", "SignUp"))
      .groupBy(_.userId).map{ case (_userId, group) => (_userId, group.map(_.timestamp).max) }.result
  }

  /**
   * For each user, gets count of number of sign ins and the timestamp of their most recent sign-in.
   */
  def getSignInTimesAndCounts: DBIO[Seq[(String, (Int, Option[OffsetDateTime]))]] = {
    activities.filter(row => row.activity === "AnonAutoSignUp" || (row.activity like "SignIn%"))
      .groupBy(_.userId).map{ case (_userId, rows) => (_userId, (rows.length, rows.map(_.timestamp).max)) }.result
  }

  /**
   * See if the user has previous logs for a specific activity.
   */
  def findUserActivity(activity: String, userId: String): DBIO[Seq[WebpageActivity]] = {
    activities.filter(a => a.userId === userId && a.activity === activity).result
  }
}
