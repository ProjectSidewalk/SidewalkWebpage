package models.utils

import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.basic.DatabaseConfig
import slick.dbio.DBIO

import scala.concurrent.Await
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.DurationInt
import scala.util.control.NoStackTrace

/**
 * DB-backed tests for ConfigTable's voided-vote archive reads (#4842, PR #4866 review).
 *
 * Two guarantees, one per direction of the same review finding:
 *   1. Work credit: an archived voided vote counts in the per-schema aggregate `total_validations` and marks its
 *      caster as a contributor (aggregate data, contributor ids, and the Owner scorecard). Self-seeding — each test
 *      inserts the full FK chain for one archived vote inside a rolled-back transaction — so it is meaningful on an
 *      empty CI schema and leaves a seeded dev DB exactly as found.
 *   2. Rollout safety: the same queries must SURVIVE a schema that does not have `voided_label_validation` yet.
 *      These queries fan out across OTHER cities' schemas, and each city applies evolution 353 on its own release
 *      schedule (a parked deployment may never apply it) — without the `to_regclass` guard, the missing table failed
 *      the whole per-city query and the service layer's `.recover` silently dropped that city from
 *      /v3/api/aggregateStats and the scorecard. Pinned by cloning the city schema's tables into a scratch schema
 *      WITHOUT the archive table and running all three queries against it.
 */
class ConfigTableVoidedArchiveSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  private val configTable = app.injector.instanceOf[ConfigTable]
  // Typed explicitly: letting `.db` infer here yields an existential type the compiler rejects under -Xfatal-warnings.
  private val dbConfig: DatabaseConfig[MyPostgresProfile] =
    app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  // Carries a successful result out through the forced-rollback failure path of `runRolledBack`.
  private case class RollbackWithResult(result: Any) extends RuntimeException with NoStackTrace

  /**
   * Runs `action` inside a transaction that is ALWAYS rolled back, returning the action's result. Lets a test seed
   * synthetic rows (or whole scratch schemas) against the shared dev DB and leave it exactly as found — even if an
   * assertion later fails. Same idiom as GeodesicDistanceSpec.
   */
  private def runRolledBack[T](action: DBIO[T]): T = {
    val alwaysRollback = action.flatMap(r => DBIO.failed(RollbackWithResult(r))).transactionally
    Await.result(
      dbConfig.db.run(alwaysRollback).recover { case RollbackWithResult(r) => r.asInstanceOf[T] },
      120.seconds
    )
  }

  /** The active city schema (first search_path entry) — what the service layer passes for the own-city fan-out arm. */
  private def currentSchema: DBIO[String] = sql"SELECT current_schema()".as[String].head

  /**
   * Seeds the minimal FK chain for one archived voided vote — user (+ non-excluded user_stat), street, audit task,
   * mission, label, then the `voided_label_validation` row itself — and returns the seeded caster's user id.
   *
   * Unqualified table names resolve through the app role's search_path, i.e. the same schema `currentSchema` reports.
   * Ids are explicit MAX+1 because seeded dev dumps insert rows with explicit ids without advancing the sequences, so
   * the sequence defaults can collide; only safe inside a rolled-back transaction.
   */
  private def seedArchivedVote(): DBIO[String] = {
    val userId   = java.util.UUID.randomUUID().toString
    val username = "ci-voided-" + userId.take(8)
    val email    = username + "@test.invalid"
    for {
      _ <- sqlu"""INSERT INTO sidewalk_login.sidewalk_user (user_id, username, email)
                  VALUES ($userId, $username, $email)"""
      _ <- sqlu"""INSERT INTO user_stat (user_stat_id, user_id, meters_audited, high_quality, excluded)
                  VALUES ((SELECT COALESCE(MAX(user_stat_id), 0) + 1 FROM user_stat), $userId, 0, TRUE, FALSE)"""
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
              VALUES ((SELECT COALESCE(MAX(mission_id), 0) + 1 FROM mission),
                      'validation', $userId, FALSE, FALSE, FALSE)
              RETURNING mission_id""".as[Int].head
      labelId <-
        sql"""INSERT INTO label (label_id, audit_task_id, pano_id, label_type_id, temporary_label_id, mission_id,
                                 street_edge_id, user_id)
              VALUES ((SELECT COALESCE(MAX(label_id), 0) + 1 FROM label),
                      $auditTaskId, 'ci-voided-archive-pano', (SELECT MIN(label_type_id) FROM label_type), 1,
                      $missionId, $streetEdgeId, $userId)
              RETURNING label_id""".as[Int].head
      _ <- sqlu"""INSERT INTO voided_label_validation (label_validation_id, label_id, validation_result, user_id,
                                                       mission_id, heading, pitch, zoom, canvas_height, canvas_width,
                                                       start_timestamp, end_timestamp, source, old_tags, new_tags,
                                                       viewer_type, old_render_error_px)
                  VALUES ((SELECT COALESCE(MAX(label_validation_id), 0) + 1 FROM voided_label_validation),
                          $labelId, 'Agree', $userId, $missionId, 0, 0, 1, 480, 720, now(), now(), 'Validate',
                          '{}', '{}', 'Default', 42)"""
    } yield userId
  }

  "the voided-vote archive work-credit add-ons" should {
    "count an archived voided vote in getCityAggregateDataBySchema's total_validations" in {
      val (before, after) = runRolledBack(for {
        schema <- currentSchema
        before <- configTable.getCityAggregateDataBySchema(schema)
        _      <- seedArchivedVote()
        after  <- configTable.getCityAggregateDataBySchema(schema)
      } yield (before, after))

      after.totalValidations mustBe before.totalValidations + 1
    }

    "include an archived voided vote's caster in getContributorUserIdsBySchema" in {
      val (userId, before, after) = runRolledBack(for {
        schema <- currentSchema
        before <- configTable.getContributorUserIdsBySchema(schema)
        userId <- seedArchivedVote()
        after  <- configTable.getContributorUserIdsBySchema(schema)
      } yield (userId, before, after))

      before must not contain userId
      after must contain(userId)
    }

    "count an archived voided vote and its caster in getCityScorecardBySchema" in {
      val (before, after) = runRolledBack(for {
        schema <- currentSchema
        before <- configTable.getCityScorecardBySchema(schema)
        _      <- seedArchivedVote()
        after  <- configTable.getCityScorecardBySchema(schema)
      } yield (before, after))

      after.totalValidations mustBe before.totalValidations + 1
      after.activeContributors mustBe before.activeContributors + 1
      // Archived verdicts must never resurface in the agree/disagree quality columns.
      after.validationsAgree mustBe before.validationsAgree
      after.validationsDisagree mustBe before.validationsDisagree
    }
  }

  "the cross-schema queries against a schema without voided_label_validation" should {
    // Clone of the review's rollout scenario: another city's schema exists but hasn't applied evolution 353.
    "still succeed, contributing zero archive rows" in {
      val scratch      = "ci_unmigrated_scratch"
      val clonedTables = Seq("street_edge", "audit_task", "user_stat", "label", "config", "label_validation",
        "label_type", "tag", "mission", "audit_task_interaction_small")
      val (agg, ids, scorecard) = runRolledBack(for {
        schema    <- currentSchema
        _         <- sqlu"CREATE SCHEMA #$scratch"
        _         <- DBIO.sequence(clonedTables.map { t => sqlu"""CREATE TABLE #$scratch.#$t (LIKE "#$schema".#$t)""" })
        agg       <- configTable.getCityAggregateDataBySchema(scratch)
        ids       <- configTable.getContributorUserIdsBySchema(scratch)
        scorecard <- configTable.getCityScorecardBySchema(scratch)
      } yield (agg, ids, scorecard))

      agg.totalValidations mustBe 0
      ids mustBe empty
      scorecard.totalValidations mustBe 0
      scorecard.activeContributors mustBe 0
    }
  }
}
