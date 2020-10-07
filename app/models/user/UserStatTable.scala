package models.user

import java.util.UUID

import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.LabelTable
import models.mission.MissionTable
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.{StaticQuery => Q}

case class UserStat(userStatId: Int, userId: String, metersAudited: Float, labelsPerMeter: Option[Float],
                    highQuality: Boolean, highQualityManual: Option[Boolean])

case class LeaderboardStat(username: String, labelCount: Int, missionCount: Int, distanceMeters: Float, accuracy: Option[Float])

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

  def getLeaderboardStats(n: Int, timePeriod: String = "lifetime"): List[LeaderboardStat] = db.withSession { implicit session =>
    val statStartTime = timePeriod.toLowerCase() match {
      case "lifetime" => """TIMESTAMP 'epoch'"""
      case "weekly" => """(now() AT TIME ZONE 'US/Pacific')::date - (cast(extract(dow from (now() AT TIME ZONE 'US/Pacific')::date) as int) % 7) + TIME '00:00:00'"""
    }
    val statsQuery = Q.queryNA[(String, Int, Int, Float, Option[Float])](
      s"""SELECT usernames.username,
        |	label_counts.label_count,
        |	mission_count,
        |	distance_meters,
        |	CASE WHEN validated_count > 9 THEN accuracy ELSE NULL END AS accuracy
        |FROM (
        |	SELECT sidewalk_user.user_id, COUNT(label_id) AS label_count
        |	FROM sidewalk_user
        |	INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
        |	INNER JOIN role ON user_role.role_id = role.role_id
        | INNER JOIN user_stat ON sidewalk_user.user_id = user_stat.user_id
        |	INNER JOIN mission ON sidewalk_user.user_id = mission.user_id
        |	INNER JOIN label ON mission.mission_id = label.mission_id
        |	WHERE label.deleted = FALSE
        |	    AND label.tutorial = FALSE
        |	    AND role.role IN ('Registered', 'Administrator', 'Researcher')
        |     AND (user_stat.high_quality_manual = TRUE OR user_stat.high_quality_manual IS NULL)
        |	    AND (label.time_created AT TIME ZONE 'US/Pacific') > $statStartTime
        |	GROUP BY sidewalk_user.user_id
        |	ORDER BY label_count DESC
        |	LIMIT $n
        |) "label_counts"
        |INNER JOIN (
        |	SELECT user_id, username
        |	FROM sidewalk_user
        |) "usernames" ON label_counts.user_id = usernames.user_id
        |INNER JOIN (
        |	SELECT user_id, COUNT(mission_id) AS mission_count, COALESCE(SUM(distance_progress), 0) AS distance_meters
        |	FROM mission
        |	WHERE (mission_end AT TIME ZONE 'US/Pacific') > $statStartTime
        |	GROUP BY user_id
        |) "missions_and_distance" ON label_counts.user_id = missions_and_distance.user_id
        |LEFT JOIN (
        |	SELECT user_id,
        |		   CAST (COUNT(CASE WHEN n_agree > n_disagree THEN 1 END) AS FLOAT) / NULLIF(COUNT(CASE WHEN n_agree > n_disagree THEN 1 END) + COUNT(CASE WHEN n_disagree > n_agree THEN 1 END), 0) AS accuracy,
        |		   COUNT(CASE WHEN n_agree > n_disagree THEN 1 END) + COUNT(CASE WHEN n_disagree > n_agree THEN 1 END) AS validated_count
        |	FROM (
        |		SELECT mission.user_id, label.label_id,
        |			   COUNT(CASE WHEN validation_result = 1 THEN 1 END) AS n_agree,
        |			   COUNT(CASE WHEN validation_result = 2 THEN 1 END) AS n_disagree
        |		FROM mission
        |		INNER JOIN label ON mission.mission_id = label.mission_id
        |		INNER JOIN label_validation ON label.label_id = label_validation.label_id
        |		WHERE (label.time_created AT TIME ZONE 'US/Pacific') > $statStartTime
        |		GROUP BY mission.user_id, label.label_id
        |	) agree_count
        |	GROUP BY user_id
        |) "accuracy" ON label_counts.user_id = accuracy.user_id
        |ORDER BY label_counts.label_count DESC;""".stripMargin
    )
    // Run the query and remove the "@X.Y" from usernames that are valid email addresses.
    statsQuery.list.map(stat =>
      if (isValidEmail(stat._1)) LeaderboardStat(stat._1.slice(0, stat._1.lastIndexOf('@')), stat._2, stat._3, stat._4, stat._5)
      else LeaderboardStat.tupled(stat)
    )
  }

  /**
   * Check if the input string is a valid email address.
   *
   * We use a regex found in the Play Framework's code: https://github.com/playframework/playframework/blob/ddf3a7ee4285212ec665826ec268ef32b5a76000/core/play/src/main/scala/play/api/data/validation/Validation.scala#L79
   * @param maybeEmail
   * @return
   */
  def isValidEmail(maybeEmail: String): Boolean = {
    val emailRegex = """^[a-zA-Z0-9\.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$""".r
    maybeEmail match {
      case e if e.trim.isEmpty => false
      case e if emailRegex.findFirstMatchIn(e).isDefined => true
      case _ => false
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
