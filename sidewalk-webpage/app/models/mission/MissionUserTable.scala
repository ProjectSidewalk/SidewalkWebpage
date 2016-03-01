package models.mission

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
}
