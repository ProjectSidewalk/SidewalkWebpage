package models.daos

import java.util.UUID

import com.mohiva.play.silhouette.api.LoginInfo
import models.daos.UserDAOImpl._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.user.User
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
  val users: mutable.HashMap[UUID, User] = mutable.HashMap()

  case class AnonymousUserProfile(ipAddress: String,
                                  missionCount: Int, auditCount: Int,
                                  labelCount: Int)
  case class AnonymousUserRecords(ipAddress: String, taskId: Int)

  def all: List[DBUser] = db.withTransaction { implicit session =>
    userTable.list
  }

  def size: Int = db.withTransaction { implicit session =>
    userTable.list.size
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
   * Counts anonymous user records
   * Date: Oct 11, 2016
   */

  def getAnonymousUserProfiles: List[AnonymousUserProfile] = db.withSession { implicit session =>

    val countAUsers = Q.queryNA[(String, Int, Int, Int)](
      """select ip_address, mission_count, audit_count, label_count
        |from sidewalk.audit_task_environment
        |where audit_task_id in (select audit_task_id
        |						from sidewalk.audit_task
        |						where user_id = (select user_id
        |						                 from sidewalk.user
        |						                 where username = 'anonymous')
        |						      and completed = true);""".stripMargin
    )
    countAUsers.list.map(anonUser => AnonymousUserProfile.tupled(anonUser))
  }

  /*
  * Counts the number of users who contributed today.
  * Author: Manaswi Saha
  * Date: Aug 28, 2016
  */
  def countTodayUsers: Int = db.withSession { implicit session =>

    val countQuery = Q.queryNA[(Int)](
      """SELECT COUNT(DISTINCT(audit_task.user_id))
        |  FROM sidewalk.audit_task
        |INNER JOIN sidewalk.user
        |  ON sidewalk.user.user_id = audit_task.user_id
        |WHERE audit_task.task_end::date = now()::date""".stripMargin
    )
    val records = countQuery.list
    records.head
  }

  /*
  * Counts the number of users who contributed yesterday.
  * Author: Manaswi Saha
  * Date: Aug 28, 2016
  */
  def countYesterdayUsers: Int = db.withSession { implicit session =>

    val countQuery = Q.queryNA[(Int)](
      """SELECT COUNT(DISTINCT(audit_task.user_id))
        |  FROM sidewalk.audit_task
        |INNER JOIN sidewalk.user
        |  ON sidewalk.user.user_id = audit_task.user_id
        |WHERE audit_task.task_end::date = now()::date - interval '1' day""".stripMargin
    )
    val records = countQuery.list
    records.head
  }

}