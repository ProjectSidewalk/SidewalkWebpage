package models.utils

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO
import util.RolledBackDb

/**
 * DB-backed tests for ConfigTable.getCityStoryStatsBySchema, the per-city counts behind the Across Cities Stories
 * section (#5543).
 *
 * Seeds three stories with different ages, visibility, and media, then checks each count moves by exactly what the
 * seed adds. Deltas against a "before" read keep it meaningful on a dev DB that already holds stories, and the
 * rolled-back transaction leaves that DB exactly as found.
 */
class ConfigTableStoryStatsSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val configTable = app.injector.instanceOf[ConfigTable]

  /**
   * Seeds one user and the FK chain for `n` labels (street, audit task, mission, pano, label), returning the user id
   * and the label ids. Ids are explicit MAX+1 because seeded dev dumps don't advance the sequences; only safe inside a
   * rolled-back transaction.
   */
  private def seedLabels(n: Int): DBIO[(String, Seq[Int])] = {
    val userId   = java.util.UUID.randomUUID().toString
    val username = "ci-story-" + userId.take(8)
    for {
      _ <- sqlu"""INSERT INTO sidewalk_login.sidewalk_user (user_id, username, email)
                  VALUES ($userId, $username, ${username + "@test.invalid"})"""
      streetEdgeId <-
        sql"""INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)
              VALUES ((SELECT COALESCE(MAX(street_edge_id), 0) + 1 FROM street_edge),
                      ST_SetSRID(ST_MakeLine(ST_MakePoint(0, 0), ST_MakePoint(0.0001, 0)), 4326),
                      0, 0, 0.0001, 0, 'residential', 'open')
              RETURNING street_edge_id""".as[Int].head
      auditTaskId <-
        sql"""INSERT INTO audit_task (audit_task_id, user_id, street_edge_id, completed, current_lat, current_lng)
              VALUES ((SELECT COALESCE(MAX(audit_task_id), 0) + 1 FROM audit_task),
                      $userId, $streetEdgeId, FALSE, 0, 0)
              RETURNING audit_task_id""".as[Int].head
      missionId <-
        sql"""INSERT INTO mission (mission_id, mission_type, user_id, completed, paid, skipped)
              VALUES ((SELECT COALESCE(MAX(mission_id), 0) + 1 FROM mission), 'audit', $userId, FALSE, FALSE, FALSE)
              RETURNING mission_id""".as[Int].head
      labelIds <- DBIO.sequence((1 to n).map { i =>
        val panoId = s"ci-story-pano-${userId.take(8)}-$i"
        for {
          _       <- sqlu"""INSERT INTO pano_data (pano_id, capture_date, source) VALUES ($panoId, '2020-01', 'gsv')"""
          labelId <-
            sql"""INSERT INTO label (label_id, audit_task_id, pano_id, label_type, temporary_label_id, mission_id,
                                     street_edge_id, user_id)
                  VALUES ((SELECT COALESCE(MAX(label_id), 0) + 1 FROM label),
                          $auditTaskId, $panoId, 'CurbRamp', $i, $missionId, $streetEdgeId, $userId)
                  RETURNING label_id""".as[Int].head
        } yield labelId
      })
    } yield (userId, labelIds)
  }

  /** Inserts one story on `labelId`, `daysAgo` days old, returning its id. */
  private def seedStory(labelId: Int, userId: String, daysAgo: Int, visible: Boolean): DBIO[Int] =
    sql"""INSERT INTO story (story_id, label_id, user_id, story_text, visible, created_at)
          VALUES ((SELECT COALESCE(MAX(story_id), 0) + 1 FROM story), $labelId, $userId, 'ci story', $visible,
                  now() - ($daysAgo * INTERVAL '1 day'))
          RETURNING story_id""".as[Int].head

  "getCityStoryStatsBySchema" should {
    "count every story, hidden ones included, and split them by age and photo" in {
      val (before, after) = runRolledBack(for {
        schema       <- currentSchema
        before       <- configTable.getCityStoryStatsBySchema(schema)
        seeded       <- seedLabels(3)
        newWithPhoto <- seedStory(seeded._2(0), seeded._1, daysAgo = 1, visible = true)
        _            <- seedStory(seeded._2(1), seeded._1, daysAgo = 10, visible = false)
        _            <- seedStory(seeded._2(2), seeded._1, daysAgo = 60, visible = true)
        _            <- sqlu"""INSERT INTO story_media (story_media_id, story_id, media_type, mime_type)
                    VALUES ((SELECT COALESCE(MAX(story_media_id), 0) + 1 FROM story_media), $newWithPhoto,
                            'photo', 'image/jpeg')"""
        after <- configTable.getCityStoryStatsBySchema(schema)
      } yield (before, after))

      after.total mustBe before.total + 3
      after.hidden mustBe before.hidden + 1
      after.withPhoto mustBe before.withPhoto + 1
      after.last7d mustBe before.last7d + 1
      after.last30d mustBe before.last30d + 2
      after.newest mustBe defined
    }

    "report no newest date and zero counts for a city with no stories" in {
      val stats = runRolledBack(for {
        schema <- currentSchema
        _      <- sqlu"DELETE FROM story_media"
        _      <- sqlu"DELETE FROM story"
        stats  <- configTable.getCityStoryStatsBySchema(schema)
      } yield stats)

      stats mustBe service.CityStoryStats(0, 0, 0, 0, 0, None)
    }
  }
}
