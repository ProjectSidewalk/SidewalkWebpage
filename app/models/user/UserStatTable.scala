package models.user

import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
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

}