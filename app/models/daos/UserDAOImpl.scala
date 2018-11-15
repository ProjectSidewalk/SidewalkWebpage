package models.daos

import java.util.UUID

import com.mohiva.play.silhouette.api.LoginInfo
import models.daos.UserDAOImpl._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.user.{RoleTable, User, UserRoleTable}
import models.audit._
import play.api.Play.current

import scala.collection.mutable
import scala.concurrent.Future
import scala.slick.driver.PostgresDriver.simple._
import scala.slick.jdbc.{StaticQuery => Q}

class UserDAOImpl extends UserDAO {


  /**
   * Finds a user by its login info.
   *
   * @param loginInfo The login info of the user to find.
   * @return The found user or None if no user for the given login info could be found.
   */
  def find(loginInfo: LoginInfo) = Future.successful(
    users.find { case (id, user) => user.loginInfo == loginInfo }.map(_._2)
  )

  /**
   * Finds a user by its user ID.
   *
   * @param userID The ID of the user to find.
   * @return The found user or None if no user for the given ID could be found.
   */
  def find(userID: UUID) = Future.successful(users.get(userID))

  def find(username: String) = Future.successful(
    users.find { case (id, user) => user.username == username }.map(_._2)
  )

  /**
   * Saves a user.
   *
   * @param user The user to save.
   * @return The saved user.
   */
  def save(user: User) = {
    users += (user.userId -> user)
    Future.successful(user)
  }
}

/**
 * The companion object.
 */
object UserDAOImpl {
  val db = play.api.db.slick.DB
  val userTable = TableQuery[UserTable]
  val userRoleTable = TableQuery[UserRoleTable]
  val roleTable = TableQuery[RoleTable]
  val auditTaskTable = TableQuery[AuditTaskTable]
  val auditTaskEnvironmentTable = TableQuery[AuditTaskEnvironmentTable]
  val auditTaskInteractionTable = TableQuery[AuditTaskInteractionTable]

  val users: mutable.HashMap[UUID, User] = mutable.HashMap()

  def all: List[DBUser] = db.withTransaction { implicit session =>
    userTable.list
  }

  def size: Int = db.withTransaction { implicit session =>
    userTable.list.size
  }

  /**
    * Count the number of users of the given role who have ever started (or completed) an audit task.
    *
    * @param roles
    * @param taskCompleted
    * @return
    */
  def countUsersContributed(roles: List[String], taskCompleted: Boolean): Int = db.withSession { implicit session =>

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
    users.groupBy(x => x).map(_._1).list.length
  }

  /**
    * Count the number of researchers who have ever started (or completed) an audit task.
    *
    * Researchers include the Researcher, Adminstrator, and Owner roles.
    *
    * @param taskCompleted
    * @return
    */
  def countResearchersContributed(taskCompleted: Boolean): Int = db.withSession { implicit session =>
    countUsersContributed(List("Researcher", "Administrator", "Owner"), taskCompleted)
  }

  /**
    * Count the number of users who have ever started (or completed) an audit task (across all roles).
    *
    * @param taskCompleted
    * @return
    */
  def countAllUsersContributed(taskCompleted: Boolean): Int = db.withSession { implicit session =>
    countUsersContributed(roleTable.map(_.role).list, taskCompleted)
  }

  /**
    * Count the number of users of the given role who contributed today.
    *
    * We consider a "contribution" to mean that a user has completed at least one audit task.
    *
    * @param role
    * @return
    */
  def countUsersContributedToday(role: String): Int = db.withSession { implicit session =>
    val countQuery = Q.query[String, Int](
      """SELECT COUNT(DISTINCT(audit_task.user_id))
        |FROM sidewalk.audit_task
        |INNER JOIN sidewalk_user ON sidewalk_user.user_id = audit_task.user_id
        |INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
        |INNER JOIN sidewalk.role ON user_role.role_id = sidewalk.role.role_id
        |WHERE audit_task.task_end::date = now()::date
        |    AND sidewalk_user.username <> 'anonymous'
        |    AND role.role = ?
        |    AND audit_task.completed = true""".stripMargin
    )
    countQuery(role).list.head
  }

  /**
    * Count the number of researchers who contributed today (includes Researcher, Adminstrator, and Owner roles).
    *
    * @return
    */
  def countResearchersContributedToday: Int = db.withSession { implicit session =>
    countUsersContributedToday("Researcher") +
      countUsersContributedToday("Administrator") +
      countUsersContributedToday("Owner")
  }

  /**
    * Count the number of users who contributed today (across all roles).
    *
    * @return
    */
  def countAllUsersContributedToday: Int = db.withSession { implicit session =>
    countUsersContributedToday("Registered") +
      countUsersContributedToday("Anonymous") +
      countUsersContributedToday("Turker") +
      countResearchersContributedToday
  }

  /**
    * Count the number of users of the given role who contributed yesterday.
    *
    * We consider a "contribution" to mean that a user has completed at least one audit task.
    *
    * @param role
    * @return
    */
  def countUsersContributedYesterday(role: String): Int = db.withSession { implicit session =>
    val countQuery = Q.query[String, Int](
      """SELECT COUNT(DISTINCT(audit_task.user_id))
        |FROM sidewalk.audit_task
        |INNER JOIN sidewalk_user ON sidewalk_user.user_id = audit_task.user_id
        |INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
        |INNER JOIN sidewalk.role ON user_role.role_id = sidewalk.role.role_id
        |WHERE audit_task.task_end::date = now()::date - interval '1' day
        |    AND sidewalk_user.username <> 'anonymous'
        |    AND role.role = ?
        |    AND audit_task.completed = true""".stripMargin
    )
    countQuery(role).list.head
  }

  /**
    * Count the number of researchers who contributed yesterday (includes Researcher, Adminstrator, and Owner roles).
    *
    * @return
    */
  def countResearchersContributedYesterday: Int = db.withSession { implicit session =>
    countUsersContributedYesterday("Researcher") +
      countUsersContributedYesterday("Administrator") +
      countUsersContributedYesterday("Owner")
  }

  /**
    * Count the number of users who contributed yesterday (across all roles).
    *
    * @return
    */
  def countAllUsersContributedYesterday: Int = db.withSession { implicit session =>
    countUsersContributedYesterday("Registered") +
      countUsersContributedYesterday("Anonymous") +
      countUsersContributedYesterday("Turker") +
      countResearchersContributedYesterday
  }
}
