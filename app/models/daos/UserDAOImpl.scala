package models.daos

import java.util.UUID

import com.mohiva.play.silhouette.api.LoginInfo
import models.daos.UserDAOImpl._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.user.{RoleTable, User, UserRoleTable}
import models.label.Label
import models.audit._
import play.api.Play.current

import scala.collection.mutable
import scala.concurrent.Future
import scala.slick.driver.PostgresDriver.simple._
import scala.slick.jdbc.{GetResult, StaticQuery => Q}

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

  val anonId = "97760883-8ef0-4309-9a5e-0c086ef27573"
  val anonUsers = for {
    (_ate, _at) <- auditTaskEnvironmentTable.innerJoin(auditTaskTable).on(_.auditTaskId === _.auditTaskId)
    if _at.userId === anonId && _at.completed === true
  } yield (_ate.ipAddress, _ate.auditTaskId, _at.taskStart, _at.taskEnd)

  val anonIps = anonUsers.groupBy(_._1).map{case(ip,group)=>ip}

  val anonUserInteractions = getAnonUserInteractions


  val users: mutable.HashMap[UUID, User] = mutable.HashMap()

  case class AnonymousUserProfile(ipAddress: String, timestamp: java.sql.Timestamp, auditCount: Int, labelCount: Int)
  case class AnonymousUserRecords(ipAddress: String, taskId: Int)

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
//    val rolesQuery = roleTable.filter(_.role inSet roles)

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

  /*
   * Gets anonymous user records
   * Date: Oct 11, 2016
   */
  def getAnonymousUsers(taskCompleted: Boolean): List[AnonymousUserRecords] = db.withSession { implicit session =>

    // TODO: Not able to find a better way of coding this right now. Need to clean up later.
    val anonUsers = taskCompleted match {
      case true =>
        Q.queryNA[(String, Int)](
          """SELECT DISTINCT ip_address, audit_task_id
             FROM sidewalk.audit_task_environment
             WHERE audit_task_id IN (SELECT audit_task_id
                                      FROM sidewalk.audit_task
                                      WHERE user_id = (SELECT user_id
                                                        FROM sidewalk.user
                                                        WHERE username = 'anonymous')
                                      AND completed = true);
          """.stripMargin
        )
      case _ =>
        Q.queryNA[(String, Int)](
          """SELECT DISTINCT ip_address, audit_task_id
             FROM sidewalk.audit_task_environment
             WHERE audit_task_id IN (SELECT audit_task_id
                                      FROM sidewalk.audit_task
                                      WHERE user_id = (SELECT user_id
                                                        FROM sidewalk.user
                                                        WHERE username = 'anonymous')
                                      );
          """.stripMargin
        )
    }
    anonUsers.list.map(anonUser => AnonymousUserRecords.tupled(anonUser))
  }

  /**
    * Gets a query for all audit task interactions done by anonymous users
    *
    * @return a query
    */
  def getAnonUserInteractions = db.withSession { implicit session =>
    val anonAuditTasks = for {
      (_ate, _at) <- auditTaskEnvironmentTable.innerJoin(auditTaskTable).on(_.auditTaskId === _.auditTaskId)
      if _at.userId === anonId
    } yield (_ate.ipAddress, _ate.auditTaskId, _at.taskStart, _at.taskEnd)

    val interactions = for {
      (_ati, _au) <-auditTaskInteractionTable.innerJoin(anonAuditTasks).on(_.auditTaskId === _._2)
    } yield (_au._1, _au._2, _au._3, _au._4, _ati.action)
    interactions
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
        |  FROM sidewalk.audit_task
        |INNER JOIN sidewalk.user
        |  ON sidewalk.user.user_id = audit_task.user_id
        |INNER JOIN sidewalk.user_role
        |  ON sidewalk.user.user_id = sidewalk.user_role.user_id
        |INNER JOIN sidewalk.role
        |  ON sidewalk.user_role.role_id = sidewalk.role.role_id
        |WHERE audit_task.task_end::date = now()::date
        |      AND sidewalk.user.username <> 'anonymous'
        |      AND role.role = ?
        |      AND audit_task.completed = true""".stripMargin
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
        |  FROM sidewalk.audit_task
        |INNER JOIN sidewalk.user
        |  ON sidewalk.user.user_id = audit_task.user_id
        |INNER JOIN sidewalk.user_role
        |  ON sidewalk.user.user_id = sidewalk.user_role.user_id
        |INNER JOIN sidewalk.role
        |  ON sidewalk.user_role.role_id = sidewalk.role.role_id
        |WHERE audit_task.task_end::date = now()::date - interval '1' day
        |      AND sidewalk.user.username <> 'anonymous'
        |      AND role.role = ?
        |      AND audit_task.completed = true""".stripMargin
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

  /*
   * Counts anonymous user records
   * Date: Oct 11, 2016
   */

  def getAnonymousUserProfiles: List[AnonymousUserProfile] = db.withSession { implicit session =>
    // TODO: Implement a more cleaner, elegant solution
    /*
    Correct way of doing it:
      - Using anonUsersTable, filter/join to get (i) ip_address with timestamp
        (ii) user records with ip_address and the audit and label counts
    - Join both results based on ip_address

    The following solution does:
      - Runs two sub-queries to get the above mentioned results (which has a redundant computation of anonUsersTable
      - Does a join on the result of the two queries.
    */
    val anonProfileQuery = Q.queryNA[(String, java.sql.Timestamp, Int, Int)](
      """SELECT AnonProfile.ip_address, LastAuditTimestamp.new_timestamp, AnonProfile.audit_count, AnonProfile.label_count
        |FROM (SELECT anonProfile.ip_address, count(anonProfile.audit_task_id) AS audit_count,
        |      sum (anonProfile.n_labels) AS label_count
        |		FROM (SELECT anonUsersTable.ip_address, anonUsersTable.audit_task_id , count (l.label_id) AS n_labels
        |				   FROM (SELECT DISTINCT ip_address, audit_task_id
        |						     FROM sidewalk.audit_task_environment
        |						     WHERE audit_task_id IN (SELECT audit_task_id
        |                                        FROM sidewalk.audit_task
        |                                        WHERE user_id = (SELECT user_id
        |                                                         FROM sidewalk.user
        |                                                         WHERE username = 'anonymous')
        |                                  AND completed = true)
        |           ) AS anonUsersTable
        |         LEFT JOIN sidewalk.label AS l
        |           ON anonUsersTable.audit_task_id = l.audit_task_id
        |         GROUP BY anonUsersTable.ip_address, anonUsersTable.audit_task_id
        |       ) AS anonProfile
        |   GROUP BY anonProfile.ip_address) AS AnonProfile,
        |
        |	(SELECT ip_address, max(timestamp) AS new_timestamp
        |  FROM (SELECT ip_address, anonUsersTable.audit_task_id AS task_id, task_end AS timestamp
        |        FROM (SELECT DISTINCT ip_address, audit_task_id
        |              FROM sidewalk.audit_task_environment
        |              WHERE audit_task_id IN (SELECT audit_task_id
        |                                      FROM sidewalk.audit_task
        |                                      WHERE user_id = (SELECT user_id
        |			      							                              FROM sidewalk.user
        |                                                       WHERE username = 'anonymous')
        |                                      AND completed = true)
        |             ) AS anonUsersTable
        |
        |      LEFT JOIN sidewalk.audit_task AS at
        |      ON anonUsersTable.audit_task_id = at.audit_task_id) AS t
        |   GROUP BY ip_address) AS LastAuditTimestamp
        |WHERE AnonProfile.ip_address = LastAuditTimestamp.ip_address;""".stripMargin
    )

    anonProfileQuery.list.map(anonUser => AnonymousUserProfile.tupled(anonUser))
    /*
    An attempt:

    val anonProfileQuery = Q.queryNA[(String, Int, Int)](
      """SELECT anonProfile.ip_address, count(anonProfile.audit_task_id) AS audit_count, sum (anonProfile.n_labels) AS label_count
        |FROM (SELECT anonUsersTable.ip_address, anonUsersTable.audit_task_id , count (l.label_id) AS n_labels
        |		   FROM (SELECT DISTINCT ip_address, audit_task_id
        |				     FROM sidewalk.audit_task_environment
        |				     WHERE audit_task_id IN (SELECT audit_task_id
        |											                FROM sidewalk.audit_task
        |											                WHERE user_id = (SELECT user_id
        |												                              FROM sidewalk.user
        |												                              WHERE username = 'anonymous')
        |											         AND completed = true)
        |				) AS anonUsersTable
        |		  LEFT JOIN sidewalk.label AS l
        |		  	on anonUsersTable.audit_task_id = l.audit_task_id
        |		  GROUP BY anonUsersTable.ip_address, anonUsersTable.audit_task_id
        |	  ) AS anonProfile
        |GROUP BY anonProfile.ip_address;""".stripMargin
    )


    val anonProfiles = anonProfileQuery.list

    val lastAuditedTimestampQuery = Q.queryNA[(String, Int)](
      """SELECT ip_address, max(timestamp) AS new_timestamp
        |FROM (SELECT ip_address, anonUsersTable.audit_task_id AS task_id, task_end AS timestamp
        |	 FROM (SELECT DISTINCT ip_address, audit_task_id
        |				     FROM sidewalk.audit_task_environment
        |				     WHERE audit_task_id IN (SELECT audit_task_id
        |							                 FROM sidewalk.audit_task
        |							                 WHERE user_id = (SELECT user_id
        |								                              FROM sidewalk.user
        |								                              WHERE username = 'anonymous')
        |											 AND completed = true)
        |				) AS anonUsersTable
        |	 LEFT JOIN sidewalk.audit_task AS at
        |		on anonUsersTable.audit_task_id = at.audit_task_id) AS t
        |GROUP BY ip_address;""".stripMargin
    )

    val recordsWithLastAudit = lastAuditedTimestampQuery.list

    val anonUsers = for {
      (_anonProfiles, _recordsWithLastAudit) <- anonProfiles.innerJoin(recordsWithLastAudit).on(_.ip_address === _.ip_address)
    } yield _anonProfiles

    anonUsers.list.map(anonUser => AnonymousUserProfile.tupled(anonUser))
    */

    /*
    val anonymousUser: DBUser = UserTable.find("anonymous").get

    // Placeholder code -- won't compile
    val entries = (for {
      a <- anonUsers
      t <- auditTaskTable
      l <- labelTable
    }.yield(a, t, l)).groupby(_.ipAddress).map{case (a,t,l) => (a,a.map(_.audit_task_id).length)}
    */
  }
}
