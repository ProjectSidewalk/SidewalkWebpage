package models.user

import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.LabelTable
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
    * Update meters_audited column in the user_stat table for all users.
    */
  def updateAuditedDistance() = db.withSession { implicit session =>

    // Computes the audited distance in meters using the distance_progress column of the mission table.
    val auditedDists = (for {
      _user <- userTable if _user.username =!= "anonymous"
      _mission <- MissionTable.auditMissions if _mission.userId === _user.userId
    } yield (_user.userId, _mission.distanceProgress)).groupBy(_._1).map(x => (x._1, x._2.map(_._2).sum))

    // Update the meters_audited column in the user_stat table.
    for ((userId, auditedDist) <- auditedDists.list) {
      val updateQuery = for { _userStat <- userStats if _userStat.userId === userId } yield _userStat.metersAudited
      updateQuery.update(auditedDist.getOrElse(0F))
    }
  }

  /**
    * Update labels_per_meter column in the user_stat table for all users, run after `updateAuditedDistance`.
    */
  def updateLabelsPerMeter() = db.withSession { implicit session =>

    // Compute label counts for each user that has audited.
    val labelCounts = (for {
      _stat <- userStats if _stat.metersAudited > 0F
      _mission <- MissionTable.auditMissions if _stat.userId === _mission.userId
      _label <- LabelTable.labelsWithoutDeleted if _mission.missionId === _label.missionId
    } yield (_stat.userId, _label.labelId)).groupBy(_._1).map(x => (x._1, x._2.length))

    // Compute labeling frequency using label counts above and the meters_audited column in user_stat table.
    val labelFreq = userStats
      .filter(_.metersAudited > 0F)
      .leftJoin(labelCounts).on(_.userId === _._1)
      .map { case (_stat, _count) =>
        (_stat.userId, _count._2.ifNull(0.asColumnOf[Int]).asColumnOf[Float] / _stat.metersAudited)
      }

    // Update the labels_per_meter column in the user_stat table.
    for ((userId, labelingFreq) <- labelFreq.list) {
      val updateQuery = for { _userStat <- userStats if _userStat.userId === userId } yield _userStat.labelsPerMeter
      updateQuery.update(Some(labelingFreq))
    }
  }

}