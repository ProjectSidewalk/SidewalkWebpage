package models.daos

import java.util.UUID

import com.mohiva.play.silhouette.api.LoginInfo
import models.daos.UserDAOImpl._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable }
import models.user.User
import models.label.Label
import models.audit.AuditTask
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
  //  val auditTaskTable = TableQuery[AuditTask]
  //  val labelTable = TableQuery[Label]
  val users: mutable.HashMap[UUID, User] = mutable.HashMap()

  case class AnonymousUserProfile(ipAddress: String, auditCount: Int, labelCount: Int)

  case class AnonymousUserRecords(ipAddress: String, taskId: Int)

  def all: List[DBUser] = db.withTransaction { implicit session =>
    userTable.list
  }

  def size: Int = db.withTransaction { implicit session =>
    userTable.list.size
  }

  /*
   * Total number of contributing users
   */
  def countContributingUsers: Int = db.withTransaction { implicit session =>
    val count = size - 1 + countAnonymousUsers
    count
  }

  /*
   * Total number of contributing registered users
   */
  def countRegisteredUsers: Int = db.withTransaction { implicit session =>
    val count = size - 1
    count
  }

  /*
   * Gets anonymous user records
   * Date: Oct 11, 2016
   */

  def getAnonymousUsers: List[AnonymousUserRecords] = db.withSession { implicit session =>

    val anonUsers = Q.queryNA[(String, Int)](
      """select ip_address, audit_task_id
        |from sidewalk.audit_task_environment
        |where audit_task_id in (select audit_task_id
        |						from sidewalk.audit_task
        |						where user_id = (select user_id
        |						                 from sidewalk.user
        |						                 where username = 'anonymous')
        |						      and completed = true);""".stripMargin
    )
    anonUsers.list.map(anonUser => AnonymousUserRecords.tupled(anonUser))
  }


  /*
   * Counts anonymous user records
   * Date: Oct 10, 2016
   */

  def countAnonymousUsers: Int = db.withSession { implicit session =>

    val anonUsers = getAnonymousUsers
    anonUsers.groupBy(_.ipAddress).keySet.size
  }

  /*
   * Counts anonymous user records visited today
   * Date: Nov 10, 2016
   */

  def countAnonymousUsersVisitedToday: Int = db.withSession { implicit session =>

    val anonUsers = Q.queryNA[(String, Int)](
      """select ip_address, audit_task_id
        |from sidewalk.audit_task_environment
        |where audit_task_id in (select audit_task_id
        |						from sidewalk.audit_task
        |						where completed = true
        |						      and task_end::date = now()::date
        |							  and user_id = (select user_id
        |						                 from sidewalk.user
        |						                 where username = 'anonymous'));""".stripMargin
    )
    val records = anonUsers.list.map(anonUser => AnonymousUserRecords.tupled(anonUser))
    val count = records.groupBy(_.ipAddress).keySet.size
    count
  }

  /*
  * Counts the number of registered users who contributed today.
  * Author: Manaswi Saha
  * Date: Nov 11, 2016
  */
  def countRegisteredUsersVisitedToday: Int = db.withSession { implicit session =>
    // TODO: Condense both calculations into one query and then using filters
    val countQuery = Q.queryNA[(Int)](
      """SELECT COUNT(DISTINCT(audit_task.user_id))
        |  FROM sidewalk.audit_task
        |INNER JOIN sidewalk.user
        |  ON sidewalk.user.user_id = audit_task.user_id
        |WHERE audit_task.task_end::date = now()::date
        |      and audit_task.user_id != (select user_id
        |												          from sidewalk.user
        |												          where username = 'anonymous')""".stripMargin
    )
    val count = countQuery.list.head
    count
  }

  /*
  * Counts the number of users who contributed today.
  * Author: Manaswi Saha
  * Date: Aug 28, 2016
  * Updated: Nov 11, 2016
  */
  def countTodayUsers: Int = db.withSession { implicit session =>

    val count = countRegisteredUsersVisitedToday + countAnonymousUsersVisitedToday
    count
  }

  /*
   * Counts anonymous user records contributed yesterday
   * Date: Nov 10, 2016
   */

  def countAnonymousUsersVisitedYesterday: Int = db.withSession { implicit session =>

    val anonUsers = Q.queryNA[(String, Int)](
      """select ip_address, audit_task_id
        |from sidewalk.audit_task_environment
        |where audit_task_id in (select audit_task_id
        |						from sidewalk.audit_task
        |						where completed = true
        |						      and task_end::date = now()::date - interval '1' day
        |							    and user_id = (select user_id
        |						                 from sidewalk.user
        |						                 where username = 'anonymous'));""".stripMargin
    )
    val records = anonUsers.list.map(anonUser => AnonymousUserRecords.tupled(anonUser))
    records.groupBy(_.ipAddress).keySet.size
  }

  /*
  * Counts the number of registered users who contributed yesterday.
  * Author: Manaswi Saha
  * Date: Nov 11, 2016
  */
  def countRegisteredUsersVisitedYesterday: Int = db.withSession { implicit session =>

    val countQuery = Q.queryNA[(Int)](
      """SELECT COUNT(DISTINCT(audit_task.user_id))
        |  FROM sidewalk.audit_task
        |INNER JOIN sidewalk.user
        |  ON sidewalk.user.user_id = audit_task.user_id
        |WHERE audit_task.task_end::date = now()::date - interval '1' day
        |      and audit_task.user_id != (select user_id
        |												          from sidewalk.user
        |												          where username = 'anonymous')""".stripMargin
    )
    val count = countQuery.list.head
    count
  }

  /*
  * Counts the number of users who contributed yesterday.
  * Author: Manaswi Saha
  * Date: Aug 28, 2016
  * Updated: Nov 11, 2016
  */
  def countYesterdayUsers: Int = db.withSession { implicit session =>

    val count = countRegisteredUsersVisitedYesterday + countAnonymousUsersVisitedYesterday
    count
  }

  /*
   * Counts anonymous user records
   * Date: Oct 11, 2016
   */

  def getAnonymousUserProfiles: List[AnonymousUserProfile] = db.withSession { implicit session =>

    // TODO: To convert the following code in play slick
    val anonProfileQuery = Q.queryNA[(String, Int, Int)](
      """select anonProfile.ip_address, count(anonProfile.audit_task_id) as audit_count,
        |       sum (anonProfile.n_labels) as label_count
        |from (select anonUsersTable.ip_address, anonUsersTable.audit_task_id , count (l.label_id) as n_labels
        |		  from (select ip_address, audit_task_id
        |				 from sidewalk.audit_task_environment
        |				 where audit_task_id in (select audit_task_id
        |											  from sidewalk.audit_task
        |											  where user_id = (select user_id
        |												                 from sidewalk.user
        |												                 where username = 'anonymous')
        |											         and completed = true)
        |				) as anonUsersTable
        |		  left join sidewalk.label as l
        |		  	on anonUsersTable.audit_task_id = l.audit_task_id
        |		  group by anonUsersTable.ip_address, anonUsersTable.audit_task_id
        |	  ) as anonProfile
        |group by anonProfile.ip_address;""".stripMargin
    )
    anonProfileQuery.list.map(anonUser => AnonymousUserProfile.tupled(anonUser))
  }
}