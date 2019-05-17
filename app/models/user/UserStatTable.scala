package models.user

import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.mission.MissionTable
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class UserStat(userStatId: Int, userId: String, metersAudited: Float, labelsPerMeter: Option[Float],
                    highQuality: Boolean, highQualityManual: Option[Boolean])

class UserStatTable(tag: Tag) extends Table[UserStat](tag, Some("sidewalk"), "user_stat") {
  def userStatId = column[Int]("user_stat_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id", O.NotNull)
  def metersAudited = column[Float]("meters_audited", O.NotNull)
  def labelsPerMeter = column[Option[Float]]("labels_per_meter")
  def highQuality = column[Boolean]("high_quality", O.NotNull)
  def highQualityManual = column[Option[Boolean]]("high_quality_manual")

  def * = (userStatId, userId, metersAudited, labelsPerMeter, highQuality, highQualityManual) <> ((UserStat.apply _).tupled, UserStat.unapply)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("user_stat_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}

object UserStatTable {
  val db = play.api.db.slick.DB
  val userStats = TableQuery[UserStatTable]
  val userTable = TableQuery[UserTable]

  /**
    * Updates meters_audited column in the user_stat table for all users.
    */
  def updateAuditedDistance() = db.withSession { implicit session =>

    val auditedDists = (for {
      _user <- userTable if _user.username =!= "anonymous"
      _mission <- MissionTable.auditMissions if _mission.userId === _user.userId
    } yield (_user.userId, _mission.distanceProgress)).groupBy(_._1).map(x => (x._1, x._2.map(_._2).sum))

    for ((userId, auditedDist) <- auditedDists.list) {
      val updateQuery = for { _userStat <- userStats if _userStat.userId === userId } yield _userStat.metersAudited
      updateQuery.update(auditedDist.getOrElse(0F))
    }
  }

}