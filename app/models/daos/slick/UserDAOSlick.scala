package models.daos.slick

import java.sql.Timestamp
import java.util.UUID
import com.mohiva.play.silhouette.api.LoginInfo
import models.audit._
import models.daos.slick.DBTableDefinitions._
import models.daos.UserDAO
import models.label.LabelValidationTable
import models.label.LabelTable
import models.mission.MissionTable
import models.user.{RoleTable, WebpageActivityTable}
import models.user.{UserRoleTable, User}
import play.api.db.slick._
import play.api.db.slick.Config.driver.simple._
import play.api.Play.current
import play.Logger
import scala.concurrent.Future
import scala.slick.jdbc.{StaticQuery => Q}

case class UserStatsForAdminPage(userId: String, username: String, email: String, role: String,
                                 signUpTime: Option[Timestamp], lastSignInTime: Option[Timestamp], signInCount: Int,
                                 completedMissions: Int, completedAudits: Int, labels: Int, ownValidated: Int,
                                 ownValidatedAgreedPct: Double, ownValidatedDisagreedPct: Double, ownValidatedUnsurePct: Double,
                                 othersValidated: Int, othersValidatedAgreedPct: Double)

class UserDAOSlick extends UserDAO {
  /**
   * Finds a user by its login info.
   *
   * @param loginInfo The login info of the user to find.
   * @return The found user or None if no user for the given login info could be found.
   */
  def find(loginInfo: LoginInfo): Future[Option[User]] = {
    DB withSession { implicit session =>
      Future.successful {
        slickLoginInfos.filter(
          x => x.providerID === loginInfo.providerID && x.providerKey === loginInfo.providerKey
        ).firstOption match {
          case Some(info) =>
            slickUserLoginInfos.filter(_.loginInfoId === info.id).firstOption match {
              case Some(userLoginInfo) =>
                slickUsers.filter(_.userId === userLoginInfo.userID).firstOption match {
                  case Some(user) =>
                    val role = UserRoleTable.getRole(UUID.fromString(user.userId))
                    Some(User(UUID.fromString(user.userId), loginInfo, user.username, user.email, Some(role)))
                  case None => None
                }
              case None => None
            }
          case None => None
        }
      }
    }
  }

  /**
   * Finds a user by its user ID.
   *
   * @param userID The ID of the user to find.
   * @return The found user or None if no user for the given ID could be found.
   */
  def find(userID: UUID): Future[Option[User]] = {
    DB withSession { implicit session =>
      Future.successful {
        slickUsers.filter(
          _.userId === userID.toString
        ).firstOption match {
          case Some(user) =>
            slickUserLoginInfos.filter(_.userID === user.userId).firstOption match {
              case Some(info) =>
                slickLoginInfos.filter(_.loginInfoId === info.loginInfoId).firstOption match {
                  case Some(loginInfo) =>
                    val role = UserRoleTable.getRole(UUID.fromString(user.userId))
                    Some(User(UUID.fromString(user.userId), LoginInfo(loginInfo.providerID, loginInfo.providerKey), user.username, user.email, Some(role)))
                  case None => None
                }
              case None => None
            }
          case None => None
        }
      }
    }
  }

  def find(username: String): Future[Option[User]] = {
    DB withSession { implicit session =>
      Future.successful {
        slickUsers.filter(_.username === username).firstOption match {
          case Some(user) =>
            slickUserLoginInfos.filter(_.userID === user.userId).firstOption match {
              case Some(info) =>
                slickLoginInfos.filter(_.loginInfoId === info.loginInfoId).firstOption match {
                  case Some(loginInfo) =>
                    val role = UserRoleTable.getRole(UUID.fromString(user.userId))
                    Some(User(UUID.fromString(user.userId), LoginInfo(loginInfo.providerID, loginInfo.providerKey), user.username, user.email, Some(role)))
                  case None => None
                }
              case None => None
            }
          case None => None
        }
      }
    }
  }

  /**
   * Saves a user.
   *
   * @param user The user to save.
   * @return The saved user.
   */
  def save(user: User): Future[User] = {
    DB withSession { implicit session =>
      Future.successful {
        val dbUser = DBUser(user.userId.toString, user.username, user.email)
        slickUsers.filter(_.userId === dbUser.userId).firstOption match {
          case Some(userFound) => slickUsers.filter(_.userId === dbUser.userId).update(dbUser)
          case None => slickUsers.insert(dbUser)
        }
        var dbLoginInfo = DBLoginInfo(None, user.loginInfo.providerID, user.loginInfo.providerKey)
        // Insert if it does not exist yet.
        slickLoginInfos.filter(info => info.providerID === dbLoginInfo.providerID && info.providerKey === dbLoginInfo.providerKey).firstOption match {
          case None => slickLoginInfos.insert(dbLoginInfo)
          case Some(info) => Logger.debug("Nothing to insert since info already exists: " + info)
        }
        dbLoginInfo = slickLoginInfos.filter(info => info.providerID === dbLoginInfo.providerID && info.providerKey === dbLoginInfo.providerKey).first
        val dbUserLoginInfo = DBUserLoginInfo(dbUser.userId, dbLoginInfo.id.get)
        // Now make sure they are connected.
        slickUserLoginInfos.filter(_.userID === dbUser.userId).firstOption match {
          case Some(info) =>
            slickUserLoginInfos.filter(_.userID === dbUser.userId).update(dbUserLoginInfo)
            Logger.debug("Updated user login info: " + info)
          case None =>
            slickUserLoginInfos.insert(dbUserLoginInfo)
        }
        user // We do not change the user => return it.
      }
    }
  }
}

/**
 * The companion object.
 */
object UserDAOSlick {
  val db = play.api.db.slick.DB
  val userTable = TableQuery[UserTable]
  val userRoleTable = TableQuery[UserRoleTable]
  val roleTable = TableQuery[RoleTable]
  val auditTaskTable = TableQuery[AuditTaskTable]

  /**
   * Get all users, excluding anonymous users who haven't placed any labels (so admin user table isn't too big).
   */
  def usersMinusAnonUsersWithNoLabels: Query[UserTable, DBUser, Seq] = {
    val anonUsers = (for {
      _user <- userTable
      _userRole <- userRoleTable if _user.userId === _userRole.userId
      _role <- roleTable if _userRole.roleId === _role.roleId
      _mission <- MissionTable.missions if _user.userId === _mission.userId
      _label <- LabelTable.labelsWithoutDeleted if _mission.missionId === _label.missionId
      if _role.role === "Anonymous"
    } yield _user).groupBy(x => x).map(_._1)

    val otherUsers = for {
      _user <- userTable
      _userRole <- userRoleTable if _user.userId === _userRole.userId
      _role <- roleTable if _userRole.roleId === _role.roleId
      if _role.role =!= "Anonymous"
    } yield _user

    anonUsers ++ otherUsers
  }

  /**
   * Returns a count of all users under the specified conditions.
   *
   * @param timeInterval: can be "today" or "week". If anything else, defaults to "all time"
   * @param taskCompletedOnly: if true, only counts users who have completed one audit task or at least one validation.
   *                           Defaults to false.
   * @param highQualityOnly: if true, only counts users who are marked as high quality. Defaults to false.
   */
  def countAllUsersContributed(timeInterval: String = "all time", taskCompletedOnly: Boolean = false, highQualityOnly: Boolean = false): Int = db.withSession { implicit session =>

    // Build up SQL string related to validation and audit task time intervals.
    // Defaults to *not* specifying a time (which is the same thing as "all time").
    val (lblValidationTimeIntervalSql, auditTaskTimeIntervalSql) = timeInterval.toLowerCase() match {
      case "today" => (
        "(label_validation.end_timestamp AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date",
        "(audit_task.task_end AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date"
      )
      case "week" => (
        "(label_validation.end_timestamp AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'",
        "(audit_task.task_end AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'"
      )
      case _ => ("TRUE", "TRUE")
    }

    // Add in the optional SQL WHERE statement for filtering on high quality users.
    val highQualityOnlySql =
      if (highQualityOnly) "(user_stat.high_quality_manual = TRUE OR user_stat.high_quality_manual IS NULL)"
      else "TRUE"

    // Add in the task completion logic.
    val auditTaskCompletedSql = if (taskCompletedOnly) "audit_task.completed = TRUE" else "TRUE"
    val validationCompletedSql = if (taskCompletedOnly) "labels_progress > 0" else "TRUE"

    val countQuery = s"""SELECT COUNT(DISTINCT(users.user_id))
                   |FROM (
                   |    SELECT DISTINCT(mission.user_id)
                   |    FROM mission
                   |    INNER JOIN mission_type ON mission.mission_type_id = mission_type.mission_type_id
                   |    LEFT JOIN label_validation ON mission.mission_id = label_validation.mission_id
                   |    WHERE mission_type.mission_type = 'validation'
                   |        AND $lblValidationTimeIntervalSql
                   |        AND $validationCompletedSql
                   |    UNION
                   |    SELECT DISTINCT(user_id)
                   |    FROM audit_task
                   |    WHERE $auditTaskCompletedSql
                   |        AND $auditTaskTimeIntervalSql
                   |) users
                   |INNER JOIN user_stat ON users.user_id = user_stat.user_id
                   |WHERE $highQualityOnlySql;
                 """.stripMargin

    Q.queryNA[Int](countQuery).first
  }

  /**
   * Count the number of users of the given role who have ever started (or completed) validating a label.
   */
  def countValidationUsersContributed(roles: List[String], labelValidated: Boolean): Int = db.withSession { implicit session =>

    val validationMissions =
      if (labelValidated) MissionTable.validationMissions.filter(_.labelsProgress > 0)
      else MissionTable.validationMissions

    val users = for {
      _mission <- validationMissions
      _user <- userTable if _mission.userId === _user.userId
      _userRole <- userRoleTable if _user.userId === _userRole.userId
      _role <- roleTable if _userRole.roleId === _role.roleId
      if _user.username =!= "anonymous"
      if _role.role inSet roles
    } yield _user.userId

    // The group by and map does a SELECT DISTINCT, and the list.length does the COUNT.
    users.groupBy(x => x).map(_._1).size.run
  }

  /**
   * Count the number of researchers who have ever started (or completed) validating a label.
   *
   * Researchers include the Researcher, Administrator, and Owner roles.
   */
  def countValidationResearchersContributed(labelValidated: Boolean): Int = db.withSession { implicit session =>
    countValidationUsersContributed(List("Researcher", "Administrator", "Owner"), labelValidated)
  }

  /**
   * Count the number of users who have ever started (or completed) validating a label (across all roles).
   */
  def countAllValidationUsersContributed(taskCompleted: Boolean): Int = db.withSession { implicit session =>
    countValidationUsersContributed(roleTable.map(_.role).list, taskCompleted)
  }

  /**
   * Count the number of users of the given role who contributed validations today.
   *
   * We consider a "contribution" to mean that a user has validated a label.
   */
  def countValidationUsersContributedToday(role: String): Int = db.withSession { implicit session =>
    val countQuery = Q.query[String, Int](
      """SELECT COUNT(DISTINCT(mission.user_id))
        |FROM label_validation
        |INNER JOIN mission ON label_validation.user_id = mission.user_id
        |INNER JOIN sidewalk_user ON sidewalk_user.user_id = mission.user_id
        |INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
        |INNER JOIN role ON user_role.role_id = role.role_id
        |WHERE (label_validation.end_timestamp AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date
        |    AND sidewalk_user.username <> 'anonymous'
        |    AND role.role = ?""".stripMargin
    )
    countQuery(role).first
  }

  /**
   * Count the num of researchers who contributed validations today (incl Researcher, Administrator, and Owner roles).
   */
  def countValidationResearchersContributedToday: Int = db.withSession { implicit session =>
    countValidationUsersContributedToday("Researcher") +
      countValidationUsersContributedToday("Administrator") +
      countValidationUsersContributedToday("Owner")
  }

  /**
   * Count the number of users who contributed validations today (across all roles).
   */
  def countAllValidationUsersContributedToday: Int = db.withSession { implicit session =>
    countValidationUsersContributedToday("Registered") +
      countValidationUsersContributedToday("Anonymous") +
      countValidationUsersContributedToday("Turker") +
      countValidationResearchersContributedToday
  }

  /**
   * Count the number of users of the given role who contributed validations in the past week.
   *
   * We consider a "contribution" to mean that a user has validated at least one label.
   */
  def countValidationUsersContributedPastWeek(role: String): Int = db.withSession { implicit session =>
    val countQuery = Q.query[String, Int](
      """SELECT COUNT(DISTINCT(mission.user_id))
        |FROM label_validation
        |INNER JOIN mission ON label_validation.user_id = mission.user_id
        |INNER JOIN sidewalk_user ON sidewalk_user.user_id = mission.user_id
        |INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
        |INNER JOIN role ON user_role.role_id = role.role_id
        |WHERE (label_validation.end_timestamp AT TIME ZONE 'US/Pacific') > (NOW() AT TIME ZONE 'US/Pacific') - interval '168 hours'
        |    AND sidewalk_user.username <> 'anonymous'
        |    AND role.role = ?""".stripMargin
    )
    countQuery(role).first
  }

  /**
   * Count num of researchers who contributed validations in the past week (incl Researcher, Administrator, and Owner roles).
   */
  def countValidationResearchersContributedPastWeek: Int = db.withSession { implicit session =>
    countValidationUsersContributedPastWeek("Researcher") +
      countValidationUsersContributedPastWeek("Administrator") +
      countValidationUsersContributedPastWeek("Owner")
  }

  /**
   * Count the number of users who contributed validations in the past week (across all roles).
   */
  def countAllValidationUsersContributedPastWeek: Int = db.withSession { implicit session =>
    countValidationUsersContributedPastWeek("Registered") +
      countValidationUsersContributedPastWeek("Anonymous") +
      countValidationUsersContributedPastWeek("Turker") +
      countValidationResearchersContributedPastWeek
  }

  /**
   * Count the number of users of the given role who have ever started (or completed) an audit task.
   */
  def countAuditUsersContributed(roles: List[String], taskCompleted: Boolean): Int = db.withSession { implicit session =>

    val tasks = if (taskCompleted) auditTaskTable.filter(_.completed) else auditTaskTable

    val users = for {
      _task <- tasks
      _user <- userTable if _task.userId === _user.userId
      _userRole <- userRoleTable if _user.userId === _userRole.userId
      _role <- roleTable if _userRole.roleId === _role.roleId
      if _user.username =!= "anonymous"
      if _role.role inSet roles
    } yield _user.userId

    // The group by and map does a SELECT DISTINCT, and the list.length does the COUNT.
    users.groupBy(x => x).map(_._1).size.run
  }

  /**
   * Count the number of researchers who have ever started (or completed) an audit task.
   *
   * Researchers include the Researcher, Administrator, and Owner roles.
   */
  def countAuditResearchersContributed(taskCompleted: Boolean): Int = db.withSession { implicit session =>
    countAuditUsersContributed(List("Researcher", "Administrator", "Owner"), taskCompleted)
  }

  /**
   * Count the number of users who have ever started (or completed) an audit task (across all roles).
   */
  def countAllAuditUsersContributed(taskCompleted: Boolean): Int = db.withSession { implicit session =>
    countAuditUsersContributed(roleTable.map(_.role).list, taskCompleted)
  }

  /**
   * Count the number of users of the given role who contributed today.
   *
   * We consider a "contribution" to mean that a user has completed at least one audit task.
   */
  def countAuditUsersContributedToday(role: String): Int = db.withSession { implicit session =>
    val countQuery = Q.query[String, Int](
      """SELECT COUNT(DISTINCT(audit_task.user_id))
        |FROM audit_task
        |INNER JOIN sidewalk_user ON sidewalk_user.user_id = audit_task.user_id
        |INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
        |INNER JOIN role ON user_role.role_id = role.role_id
        |WHERE (audit_task.task_end AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date
        |    AND sidewalk_user.username <> 'anonymous'
        |    AND role.role = ?
        |    AND audit_task.completed = true""".stripMargin
    )
    countQuery(role).first
  }

  /**
   * Count the number of researchers who contributed today (includes Researcher, Administrator, and Owner roles).
   */
  def countAuditResearchersContributedToday: Int = db.withSession { implicit session =>
    countAuditUsersContributedToday("Researcher") +
      countAuditUsersContributedToday("Administrator") +
      countAuditUsersContributedToday("Owner")
  }

  /**
   * Count the number of users who contributed today (across all roles).
   */
  def countAllAuditUsersContributedToday: Int = db.withSession { implicit session =>
    countAuditUsersContributedToday("Registered") +
      countAuditUsersContributedToday("Anonymous") +
      countAuditUsersContributedToday("Turker") +
      countAuditResearchersContributedToday
  }

  /**
   * Count the number of users of the given role who contributed in the past week.
   *
   * We consider a "contribution" to mean that a user has completed at least one audit task.
   */
  def countAuditUsersContributedPastWeek(role: String): Int = db.withSession { implicit session =>
    val countQuery = Q.query[String, Int](
      """SELECT COUNT(DISTINCT(audit_task.user_id))
        |FROM audit_task
        |INNER JOIN sidewalk_user ON sidewalk_user.user_id = audit_task.user_id
        |INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
        |INNER JOIN role ON user_role.role_id = role.role_id
        |WHERE (audit_task.task_end AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'
        |    AND sidewalk_user.username <> 'anonymous'
        |    AND role.role = ?
        |    AND audit_task.completed = true""".stripMargin
    )
    countQuery(role).first
  }

  /**
   * Count the number of researchers who contributed in the past week (includes Researcher, Administrator, and Owner roles).
   */
  def countAuditResearchersContributedPastWeek: Int = db.withSession { implicit session =>
    countAuditUsersContributedPastWeek("Researcher") +
      countAuditUsersContributedPastWeek("Administrator") +
      countAuditUsersContributedPastWeek("Owner")
  }

  /**
   * Count the number of users who contributed in the past week (across all roles).
   *
   */
  def countAllAuditUsersContributedPastWeek: Int = db.withSession { implicit session =>
    countAuditUsersContributedPastWeek("Registered") +
      countAuditUsersContributedPastWeek("Anonymous") +
      countAuditUsersContributedPastWeek("Turker") +
      countAuditResearchersContributedPastWeek
  }

  /**
   * Gets metadata for each user that we use on the admin page.
   */
  def getUserStatsForAdminPage: List[UserStatsForAdminPage] = db.withSession { implicit session =>

    // We run different queries for each bit of metadata that we need. We run each query and convert them to Scala maps
    // with the user_id as the key. We then query for all the users in the `user` table and for each user, we lookup
    // the user's metadata in each of the maps from those 6 queries. This simulates a left join across the six sub-
    // queries. We are using Scala Map objects instead of Slick b/c Slick doesn't create very efficient queries for this
    // use-case (at least in the old version of Slick that we are using right now).

    // Map(user_id: String -> role: String).
    val roles =
      userRoleTable.innerJoin(roleTable).on(_.roleId === _.roleId).map(x => (x._1.userId, x._2.role)).list.toMap

    // Map(user_id: String -> signup_time: Option[Timestamp]).
    val signUpTimes =
      WebpageActivityTable.activities.filter(_.activity inSet List("AnonAutoSignUp", "SignUp"))
        .groupBy(_.userId).map{ case (_userId, group) => (_userId, group.map(_.timestamp).max) }.list.toMap

    // Map(user_id: String -> (most_recent_sign_in_time: Option[Timestamp], sign_in_count: Int)).
    val signInTimesAndCounts =
      WebpageActivityTable.activities.filter(_.activity inSet List("AnonAutoSignUp", "SignIn"))
        .groupBy(_.userId).map{ case (_userId, group) => (_userId, group.map(_.timestamp).max, group.length) }
        .list.map{ case (_userId, _time, _count) => (_userId, (_time, _count)) }.toMap

    // Map(user_id: String -> mission_count: Int).
    val missionCounts =
      MissionTable.missions.filter(_.completed)
        .groupBy(_.userId).map { case (_userId, group) => (_userId, group.length) }.list.toMap

    // Map(user_id: String -> audit_count: Int).
    val auditCounts =
      AuditTaskTable.completedTasks.groupBy(_.userId).map { case (_uId, group) => (_uId, group.length) }.list.toMap

    // Map(user_id: String -> label_count: Int).
    val labelCounts =
      AuditTaskTable.auditTasks.innerJoin(LabelTable.labelsWithoutDeleted).on(_.auditTaskId === _.auditTaskId)
        .groupBy(_._1.userId).map { case (_userId, group) => (_userId, group.length) }.list.toMap

    // Map(user_id: String -> (role: String, distinct: Int, total: Int, agreed: Int, disagreed: Int, unsure: Int)).
    val validatedCounts = LabelValidationTable.getValidationCountsPerUser.map { valCount =>
      (valCount._1, (valCount._2, valCount._3, valCount._4, valCount._5, valCount._6, valCount._7))
    }.toMap

    // Map(user_id: String -> (count: Int, agreed: Int)).
    val othersValidatedCounts = LabelValidationTable.getValidatedCountsPerUser.map { valCount =>
      (valCount._1, (valCount._2, valCount._3))
    }.toMap

    // Now left join them all together and put into UserStatsForAdminPage objects.
    usersMinusAnonUsersWithNoLabels.list.map{ u =>
      val ownValidatedCounts = validatedCounts.getOrElse(u.userId, ("", 0, 0, 0, 0, 0))
      val ownValidatedDistinct = ownValidatedCounts._2
      val ownValidatedTotal = ownValidatedCounts._3
      val ownValidatedAgreed = ownValidatedCounts._4
      val ownValidatedDisagreed = ownValidatedCounts._5
      val ownValidatedUnsure = ownValidatedCounts._6

      val otherValidatedCounts = othersValidatedCounts.getOrElse(u.userId, (0, 0))
      val otherValidatedTotal = otherValidatedCounts._1
      val otherValidatedAgreed = otherValidatedCounts._2

      val ownValidatedAgreedPct =
        if (ownValidatedTotal == 0) 0f
        else ownValidatedAgreed * 1.0 / ownValidatedTotal

      val ownValidatedDisagreedPct =
        if (ownValidatedTotal == 0) 0f
        else ownValidatedDisagreed * 1.0 / ownValidatedTotal

      val ownValidatedUnsurePct =
        if (ownValidatedTotal == 0) 0f
        else ownValidatedUnsure * 1.0 / ownValidatedTotal

      val otherValidatedAgreedPct =
        if (otherValidatedTotal == 0) 0f
        else otherValidatedAgreed * 1.0 / otherValidatedTotal

      UserStatsForAdminPage(
        u.userId, u.username, u.email,
        roles.getOrElse(u.userId, ""),
        signUpTimes.get(u.userId).flatten,
        signInTimesAndCounts.get(u.userId).flatMap(_._1), signInTimesAndCounts.get(u.userId).map(_._2).getOrElse(0),
        missionCounts.getOrElse(u.userId, 0),
        auditCounts.getOrElse(u.userId, 0),
        labelCounts.getOrElse(u.userId, 0),
        ownValidatedDistinct,
        ownValidatedAgreedPct,
        ownValidatedDisagreedPct,
        ownValidatedUnsurePct,
        otherValidatedTotal,
        otherValidatedAgreedPct
      )
    }
  }
}
