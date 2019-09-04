package models.user

import java.util.UUID

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

  val LABEL_PER_METER_THRESHOLD: Float = 0.0375.toFloat

  /**
    * Return query with user_id and high_quality columns.
    */
  def getQualityOfUsers: Query[(Column[String], Column[Boolean]), (String, Boolean), Seq] = db.withSession { implicit session =>
    userStats.map(x => (x.userId, x.highQuality))
  }

  /**
    * Get list of users where high_quality column is marked as TRUE and they have placed at least one label.
    */
  def getIdsOfGoodUsersWithLabels: List[String] = db.withSession { implicit session =>

    // Get the list of users who have placed a label by joining with the label table.
    val usersWithLabels = for {
      _stat <- userStats if _stat.highQuality
      _mission <- MissionTable.auditMissions if _mission.userId === _stat.userId
      _label <- LabelTable.labelsWithoutDeletedOrOnboarding if _mission.missionId === _label.missionId
    } yield _stat.userId

    // Select distinct on the name user_ids.
    usersWithLabels.groupBy(x => x).map(_._1).list
  }

  /**
    * Call helper functions to update all columns in user_stat table.
    */
  def updateUserStatTable() = db.withSession { implicit session =>
    updateAuditedDistance()
    updateLabelsPerMeter()
    updateHighQuality()
  }

  /**
    * Update meters_audited column in the user_stat table for all users.
    */
  def updateAuditedDistance() = db.withSession { implicit session =>

    // Computes the audited distance in meters using the distance_progress column of the mission table.
    val auditedDists: List[(String, Option[Float])] = (for {
      _user <- userTable if _user.username =!= "anonymous"
      _mission <- MissionTable.auditMissions if _mission.userId === _user.userId
    } yield (_user.userId, _mission.distanceProgress)).groupBy(_._1).map(x => (x._1, x._2.map(_._2).sum)).list

    // Update the meters_audited column in the user_stat table.
    for ((userId, auditedDist) <- auditedDists) {
      val updateQuery = for { _userStat <- userStats if _userStat.userId === userId } yield _userStat.metersAudited
      updateQuery.update(auditedDist.getOrElse(0F))
    }
  }

  /**
    * Update labels_per_meter column in the user_stat table for all users, run after `updateAuditedDistance`.
    *
    */
  def updateLabelsPerMeter() = db.withSession { implicit session =>

    // Compute label counts for each user that has audited.
    val labelCounts = (for {
      _stat <- userStats if _stat.metersAudited > 0F
      _mission <- MissionTable.auditMissions if _stat.userId === _mission.userId
      _label <- LabelTable.labelsWithoutDeletedOrOnboarding if _mission.missionId === _label.missionId
    } yield (_stat.userId, _label.labelId)).groupBy(_._1).map(x => (x._1, x._2.length))

    // Compute labeling frequency using label counts above and the meters_audited column in user_stat table.
    val labelFreq: List[(String, Float)] = userStats
      .filter(_.metersAudited > 0F)
      .leftJoin(labelCounts).on(_.userId === _._1)
      .map { case (_stat, _count) =>
        (_stat.userId, _count._2.ifNull(0.asColumnOf[Int]).asColumnOf[Float] / _stat.metersAudited)
      }.list

    // Update the labels_per_meter column in the user_stat table.
    for ((userId, labelingFreq) <- labelFreq) {
      val updateQuery = for { _userStat <- userStats if _userStat.userId === userId } yield _userStat.labelsPerMeter
      updateQuery.update(Some(labelingFreq))
    }
  }

  /**
    * Update high_quality column in the user_stat table, run after `updateAuditedDistance` and `updateLabelsPerMeter`.
    */
  def updateHighQuality() = db.withSession { implicit session =>

    // Get users manually marked as low quality first.
    val lowQualityUsers: List[(String, Boolean)] =
      userStats.filterNot(_.highQualityManual).map(x => (x.userId, x.highQualityManual.get)).list

    // Decide if each user is high quality. First check if user was manually marked as high quality, then if they have
    // an audited distance of 0 (meaning an infinite labeling frequency), then if labeling frequency is over threshold.
    val userQuality: List[(String, Boolean)] =
      userStats.filter(x => x.highQualityManual.isEmpty || x.highQualityManual).map { x =>
        (
          x.userId,
          x.highQualityManual.getOrElse(false)
          || x.metersAudited === 0F
          || x.labelsPerMeter.getOrElse(5F) > LABEL_PER_METER_THRESHOLD
        )
      }.list

    // Update the high_quality column in the user_stat table.
    for ((userId, highQuality) <- lowQualityUsers ++ userQuality) {
      val updateQuery = for {_userStat <- userStats if _userStat.userId === userId} yield _userStat.highQuality
      updateQuery.update(highQuality)
    }
  }

  /**
    * Insert new user_stat row with defaults if the user_id doesn't already have a row.
    *
    * @param userId
    * @return Number of rows updated
    */
  def addUserStatIfNew(userId: UUID): Int = db.withTransaction { implicit session =>
    if (userStats.filter(_.userId === userId.toString).length.run == 0)
      userStats.insert(UserStat(0, userId.toString, 0F, None, true, None))
    else
      0
  }
}
