package models.daos

import java.util.UUID

import com.mohiva.play.silhouette.api.LoginInfo
import models.daos.UserDAOImpl._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.user.User
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
  val auditTaskTable = TableQuery[AuditTaskTable]
  val auditTaskEnvironmentTable = TableQuery[AuditTaskEnvironmentTable]
  val auditTaskInteractionTable = TableQuery[AuditTaskInteractionTable]

  val anonUsers = for {
    (_ate, _at) <- auditTaskEnvironmentTable.innerJoin(auditTaskTable).on(_.auditTaskId === _.auditTaskId)
    if _at.userId === "97760883-8ef0-4309-9a5e-0c086ef27573" && _at.completed === true
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

    anonUsers.list.map(anonUser => AnonymousUserRecords.tupled((anonUser._1.get, anonUser._2)))
  }

  /*
   * Counts anonymous user records
   * Date: Oct 10, 2016
   */
  def countAnonymousUsers: Int = db.withSession { implicit session =>

    val anonUsers = getAnonymousUsers
    anonUsers.groupBy(_.ipAddress).keySet.size
  }

  /**
    * Gets a query for all audit task interactions done by anonymous users
    *
    * @return a query
    */
  def getAnonUserInteractions = db.withSession { implicit session =>
    val anonAuditTasks = for {
      (_ate, _at) <- auditTaskEnvironmentTable.innerJoin(auditTaskTable).on(_.auditTaskId === _.auditTaskId)
      if _at.userId === "97760883-8ef0-4309-9a5e-0c086ef27573"
    } yield (_ate.ipAddress, _ate.auditTaskId, _at.taskStart, _at.taskEnd)

    val interactions = for {
      (_ati, _au) <-auditTaskInteractionTable.innerJoin(anonAuditTasks).on(_.auditTaskId === _._2)
    } yield (_au._1, _au._2, _au._3, _au._4, _ati.action)
    interactions
  }

  /**
    * Gets the number of missions completed by each anonymous user.
    *
    * Unfortunate limitation of slick: https://groups.google.com/forum/#!topic/scalaquery/lrumVNo3JE4
    *
    * @return List[(String: ipAddress, Int: missionCount)]
    */
  def getAnonUserCompletedMissionCounts: List[(Option[String], Int)] = db.withSession { implicit session =>
    // filter down to only the MissionComplete interactions, then get the set of unique ip/taskId pairs, then group by
    // ip and count the number of audit tasks in there.
    val completedMissions = anonUserInteractions.filter(_._5 === "MissionComplete").groupBy(x => (x._1, x._2)).map{
      case ((ip, taskId), group) => (ip, taskId)
    }.groupBy(x => x._1).map{case(ip, group) => (ip, group.map(_._2).length)}

    // then join with the table of anon user ip addresses to give those with no completed missions a 0.
    val missionCounts: List[(Option[String], Option[Int])] = completedMissions.rightJoin(anonIps).on(_._1 === _).map{
      case (cm, ai) => (ai, cm._2.?)
    }.list

    // right now the count is an option; replace the None with a 0 -- it was none b/c only users who had completed
    // missions ended up in the completedMissions query.
    missionCounts.map{pair => (pair._1, pair._2.getOrElse(0))}
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
        |												          where username = 'anonymous')
        |      and audit_task.completed = true""".stripMargin
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
        |						where audit_task.completed = true
        |						      and audit_task.task_end::date = now()::date - interval '1' day
        |							    and audit_task.user_id = (select user_id
        |						                                 from sidewalk.user
        |						                                 where username = 'anonymous'));""".stripMargin
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
        |WHERE audit_task.completed = true
        |      and audit_task.task_end::date = now()::date - interval '1' day
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
      """select AnonProfile.ip_address, LastAuditTimestamp.new_timestamp, AnonProfile.audit_count, AnonProfile.label_count
        |from (select anonProfile.ip_address, count(anonProfile.audit_task_id) as audit_count,
        |      sum (anonProfile.n_labels) as label_count
        |		from (select anonUsersTable.ip_address, anonUsersTable.audit_task_id , count (l.label_id) as n_labels
        |				   from (select ip_address, audit_task_id
        |						     from sidewalk.audit_task_environment
        |						     where audit_task_id in (select audit_task_id
        |													                from sidewalk.audit_task
        |													                where user_id = (select user_id
        |														                              from sidewalk.user
        |														                              where username = 'anonymous')
        |													         and completed = true)
        |						) as anonUsersTable
        |				  left join sidewalk.label as l
        |				  	on anonUsersTable.audit_task_id = l.audit_task_id
        |				  group by anonUsersTable.ip_address, anonUsersTable.audit_task_id
        |			  ) as anonProfile
        |		group by anonProfile.ip_address) as AnonProfile,
        |
        |	(select ip_address, max(timestamp) as new_timestamp
        |		from (select ip_address, anonUsersTable.audit_task_id as task_id, task_end as timestamp
        |			 from (select ip_address, audit_task_id
        |						     from sidewalk.audit_task_environment
        |						     where audit_task_id in (select audit_task_id
        |									                 from sidewalk.audit_task
        |									                 where user_id = (select user_id
        |										                              from sidewalk.user
        |										                              where username = 'anonymous')
        |													 and completed = true)
        |						) as anonUsersTable
        |
        |			 left join sidewalk.audit_task as at
        |				on anonUsersTable.audit_task_id = at.audit_task_id) as t
        |		group by ip_address) as LastAuditTimestamp
        |where AnonProfile.ip_address = LastAuditTimestamp.ip_address;""".stripMargin
    )

    anonProfileQuery.list.map(anonUser => AnonymousUserProfile.tupled(anonUser))
    /*
    An attempt:

    val anonProfileQuery = Q.queryNA[(String, Int, Int)](
      """select anonProfile.ip_address, count(anonProfile.audit_task_id) as audit_count, sum (anonProfile.n_labels) as label_count
        |from (select anonUsersTable.ip_address, anonUsersTable.audit_task_id , count (l.label_id) as n_labels
        |		   from (select ip_address, audit_task_id
        |				     from sidewalk.audit_task_environment
        |				     where audit_task_id in (select audit_task_id
        |											                from sidewalk.audit_task
        |											                where user_id = (select user_id
        |												                              from sidewalk.user
        |												                              where username = 'anonymous')
        |											         and completed = true)
        |				) as anonUsersTable
        |		  left join sidewalk.label as l
        |		  	on anonUsersTable.audit_task_id = l.audit_task_id
        |		  group by anonUsersTable.ip_address, anonUsersTable.audit_task_id
        |	  ) as anonProfile
        |group by anonProfile.ip_address;""".stripMargin
    )


    val anonProfiles = anonProfileQuery.list

    val lastAuditedTimestampQuery = Q.queryNA[(String, Int)](
      """select ip_address, max(timestamp) as new_timestamp
        |from (select ip_address, anonUsersTable.audit_task_id as task_id, task_end as timestamp
        |	 from (select ip_address, audit_task_id
        |				     from sidewalk.audit_task_environment
        |				     where audit_task_id in (select audit_task_id
        |							                 from sidewalk.audit_task
        |							                 where user_id = (select user_id
        |								                              from sidewalk.user
        |								                              where username = 'anonymous')
        |											 and completed = true)
        |				) as anonUsersTable
        |	 left join sidewalk.audit_task as at
        |		on anonUsersTable.audit_task_id = at.audit_task_id) as t
        |group by ip_address;""".stripMargin
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
