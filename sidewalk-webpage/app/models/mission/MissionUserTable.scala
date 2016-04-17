package models.mission

import java.util.UUID

import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class MissionUser(missionUserId: Int, missionId: Int, userId: String)

class MissionUserTable(tag: Tag) extends Table[MissionUser](tag, Some("sidewalk"), "mission_user") {
  def missionUserId = column[Int]("mission_user_id", O.PrimaryKey, O.AutoInc)
  def missionId = column[Int]("mission_id", O.NotNull)
  def userId = column[String]("user_id", O.NotNull)

  def * = (missionUserId, missionId, userId) <> ((MissionUser.apply _).tupled, MissionUser.unapply)

  def mission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("mission_user_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("mission_user_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}

object MissionUserTable {
  val db = play.api.db.slick.DB
  val missionUsers = TableQuery[MissionUserTable]

  def exists(missionId: Int, userId: String): Boolean = db.withTransaction { implicit session =>
    val l = missionUsers.list
    l.count(m => m.missionId == missionId && m.userId.toString == userId) > 0
  }

  /**
    * Insert a new mission user
    * @param missionId mission id
    * @param userId user id
    * @return missionUserId
    */
  def save(missionId: Int, userId: String): Int = save(MissionUser(0, missionId, userId))

  /**
    * Insert a new mission user
    * @param missionUser A MissionUser object
    * @return missionUserId
    */
  def save(missionUser: MissionUser): Int = db.withTransaction { implicit session =>
    val missionUserId: Int =
      (missionUsers returning missionUsers.map(_.missionUserId)) += missionUser
    missionUserId
  }
}
