package models.user

import models.utils.ConfigTable
import models.utils.MyPostgresProfile.api.given
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO
import util.{RolledBackDb, SidewalkSpec}

/**
 * The admin Overview's Contributors count uses the #3976 definition behind `/v3/api/aggregateStats` `total_users`
 * (#4344): someone counts for a non-tutorial label or a vote, never for a tutorial label alone, and never when
 * excluded. Self-seeding inside a rolled-back transaction, so it runs on an empty CI schema and leaves the DB as found.
 */
class UserStatTableContributorCountSpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val userStatTable: UserStatTable = app.injector.instanceOf[UserStatTable]
  private lazy val configTable: ConfigTable     = app.injector.instanceOf[ConfigTable]

  /**
   * Seeds a user with a `user_stat` row and, for an AI account, its role. Ids are MAX+1 because seeded dev dumps
   * insert explicit ids without advancing the sequences; only safe inside a rolled-back transaction.
   *
   * @return The new user's id.
   */
  private def seedUser(excluded: Boolean = false, ai: Boolean = false): DBIO[String] = {
    val userId   = java.util.UUID.randomUUID().toString
    val username = "ci-contrib-" + userId.take(8)
    for {
      _ <- sqlu"""INSERT INTO sidewalk_login.sidewalk_user (user_id, username, email)
                  VALUES ($userId, $username, ${username + "@test.invalid"})"""
      _ <- sqlu"""INSERT INTO user_stat (user_stat_id, user_id, meters_audited, high_quality, excluded)
                  VALUES ((SELECT COALESCE(MAX(user_stat_id), 0) + 1 FROM user_stat), $userId, 0, TRUE, $excluded)"""
      _ <-
        if (ai) sqlu"""INSERT INTO sidewalk_login.user_role (user_role_id, user_id, role)
                       VALUES ((SELECT COALESCE(MAX(user_role_id), 0) + 1 FROM sidewalk_login.user_role), $userId,
                               'AI')"""
        else DBIO.successful(0)
    } yield userId
  }

  /** Seeds a fresh open street, so the label can't land on the tutorial street. */
  private def seedStreet(): DBIO[Int] =
    sql"""INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)
          VALUES ((SELECT COALESCE(MAX(street_edge_id), 0) + 1 FROM street_edge),
                  ST_SetSRID(ST_MakeLine(ST_MakePoint(0, 0), ST_MakePoint(0.0001, 0)), 4326),
                  0, 0, 0.0001, 0, 'residential', 'open')
          RETURNING street_edge_id""".as[Int].head

  /** Seeds a mission of the given type for the user. */
  private def seedMission(userId: String, missionType: String): DBIO[Int] =
    sql"""INSERT INTO mission (mission_id, mission_type, user_id, completed, paid, skipped)
          VALUES ((SELECT COALESCE(MAX(mission_id), 0) + 1 FROM mission),
                  CAST($missionType AS mission_type), $userId, FALSE, FALSE, FALSE)
          RETURNING mission_id""".as[Int].head

  /**
   * Seeds one label by the user, under their own audit task, on its own street and pano.
   *
   * @return The new label_id.
   */
  private def seedLabel(userId: String, tutorial: Boolean = false): DBIO[Int] = {
    val panoId = "ci-contrib-pano-" + java.util.UUID.randomUUID().toString.take(8)
    for {
      streetEdgeId <- seedStreet()
      auditTaskId  <-
        sql"""INSERT INTO audit_task (audit_task_id, user_id, street_edge_id, completed, current_lat, current_lng)
              VALUES ((SELECT COALESCE(MAX(audit_task_id), 0) + 1 FROM audit_task),
                      $userId, $streetEdgeId, FALSE, 0, 0)
              RETURNING audit_task_id""".as[Int].head
      missionId <- seedMission(userId, "audit")
      _         <- sqlu"""INSERT INTO pano_data (pano_id, capture_date, source) VALUES ($panoId, '2020-01', 'gsv')"""
      labelId   <-
        sql"""INSERT INTO label (label_id, audit_task_id, pano_id, label_type, temporary_label_id, mission_id,
                                 street_edge_id, user_id, tutorial)
              VALUES ((SELECT COALESCE(MAX(label_id), 0) + 1 FROM label),
                      $auditTaskId, $panoId, 'CurbRamp', 1, $missionId, $streetEdgeId, $userId, $tutorial)
              RETURNING label_id""".as[Int].head
    } yield labelId
  }

  /** Seeds one Agree vote by the user on the label, as the label's type. */
  private def seedVote(userId: String, labelId: Int): DBIO[Int] =
    for {
      missionId <- seedMission(userId, "validation")
      n         <-
        sqlu"""INSERT INTO label_validation (label_validation_id, label_id, validation_result, user_id, mission_id,
                                             heading, pitch, zoom, canvas_height, canvas_width, start_timestamp,
                                             end_timestamp, source, viewer_type, label_type)
               SELECT (SELECT COALESCE(MAX(label_validation_id), 0) + 1 FROM label_validation), $labelId, 'Agree',
                      $userId, $missionId, 0, 0, 1, 480, 720, now(), now(), 'Validate', 'Default', label.label_type
               FROM label
               WHERE label.label_id = $labelId"""
    } yield n

  "UserStatTable.countAllUsersContributed" should {
    "count a real label or a vote, but not a tutorial label alone or an excluded user (#4344)" in {
      val (before, after) = runRolledBack(for {
        before       <- userStatTable.countAllUsersContributed()
        tutorialOnly <- seedUser()
        _            <- seedLabel(tutorialOnly, tutorial = true)
        labeler      <- seedUser()
        labelId      <- seedLabel(labeler)
        validator    <- seedUser()
        _            <- seedVote(validator, labelId)
        excluded     <- seedUser(excluded = true)
        _            <- seedLabel(excluded)
        _            <- seedVote(excluded, labelId)
        after        <- userStatTable.countAllUsersContributed()
      } yield (before, after))

      // Only the labeler and the validator are new contributors.
      after mustBe before + 2
    }

    "equal the API's contributor ids for the same schema, less AI accounts (#3976)" in {
      val (adminCount, apiIds, aiIds, aiUser) = runRolledBack(for {
        labeler    <- seedUser()
        labelId    <- seedLabel(labeler)
        validator  <- seedUser()
        _          <- seedVote(validator, labelId)
        aiUser     <- seedUser(ai = true)
        _          <- seedVote(aiUser, labelId)
        schema     <- currentSchema
        adminCount <- userStatTable.countAllUsersContributed()
        apiIds     <- configTable.getContributorUserIdsBySchema(schema)
        aiIds      <- configTable.getAiUserIds
      } yield (adminCount, apiIds, aiIds.toSet, aiUser))

      apiIds must contain(aiUser)
      adminCount mustBe apiIds.distinct.filterNot(aiIds).size
    }
  }
}
