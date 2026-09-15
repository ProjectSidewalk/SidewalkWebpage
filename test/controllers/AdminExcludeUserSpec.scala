package controllers

import actor.RecalculateStreetPriorityActor
import models.user.Role
import models.utils.BackgroundJobRunTable
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.Materializer
import org.scalatest.concurrent.Eventually
import org.scalatest.time.{Millis, Seconds, Span}
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.bind
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._
import service.StreetService
import util.{AnonSession, RoleSession, RolledBackDb, StubService}

import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.Future

/**
 * Functional tests for excluding a user through `PUT /adminapi/saveUserSettings` (#3956): permissions, forced low
 * quality, ordering against a quality change, and the street priority recalculation (stubbed, since it rewrites every
 * street). The label recount is covered by ValidationRecountSpec.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class AdminExcludeUserSpec
    extends PlaySpec
    with RoleSession
    with GuiceOneAppPerSuite
    with AnonSession
    with RolledBackDb
    with Eventually {

  private val priorityRecalcs = new AtomicInteger(0)

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // AnonSession mints one session per call and the limiter is per-IP; every suite in a run shares loopback.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .overrides(
        bind[StreetService].toInstance(
          StubService.answeringWith[StreetService](
            Map("recalculateStreetPriority" -> { () =>
              priorityRecalcs.incrementAndGet()
              Future.successful(Seq.empty[Int])
            })
          )
        )
      )
      .build()

  implicit lazy val mat: Materializer = app.materializer

  implicit override val patienceConfig: PatienceConfig =
    PatienceConfig(timeout = Span(10, Seconds), interval = Span(100, Millis))

  private val jobRunTable = app.injector.instanceOf[BackgroundJobRunTable]

  private lazy val adminCookies: Seq[Cookie] = sessionAs(Role.Administrator)
  private lazy val ownerCookies: Seq[Cookie] = sessionAs(Role.Owner)

  /** Every user whose user_stat row the suite may have changed, reset in `afterAll`. */
  private var touchedUserIds: Set[String] = Set.empty

  /** Highest background_job_run id before the suite ran, so the recalculations it started can be deleted after. */
  private val runIdFloor: Int =
    run(jobRunTable.backgroundJobRuns.map(_.backgroundJobRunId).max.result).getOrElse(0)

  private def targetUser(role: Role.Value): String = {
    val userId = userIdOf(sessionAs(role))
    touchedUserIds += userId
    userId
  }

  /** A save body that leaves every setting as it is except quality and exclusion. */
  private def settingsBody(userId: String, highQualityManual: Option[Boolean], excluded: Boolean): JsObject = {
    val (username, role) = run(
      sql"""SELECT sidewalk_user.username, user_role.role::text
            FROM sidewalk_login.sidewalk_user
            INNER JOIN sidewalk_login.user_role ON sidewalk_user.user_id = user_role.user_id
            WHERE sidewalk_user.user_id = $userId""".as[(String, String)]
    ).head
    val (onLeaderboard, publicProfile) = run(
      sql"SELECT on_leaderboard, public_profile FROM user_stat WHERE user_id = $userId".as[(Boolean, Boolean)]
    ).headOption.getOrElse((true, true))
    Json.obj(
      "userId"            -> userId,
      "username"          -> username,
      "role"              -> role,
      "teamId"            -> Option.empty[Int],
      "highQualityManual" -> highQualityManual,
      "excluded"          -> excluded,
      "communityService"  -> false,
      "onLeaderboard"     -> onLeaderboard,
      "publicProfile"     -> publicProfile
    )
  }

  private def save(cookies: Seq[Cookie], body: JsValue) =
    route(
      app,
      FakeRequest(PUT, "/adminapi/saveUserSettings")
        .withHeaders("X-Requested-With" -> "XMLHttpRequest")
        .withCookies(cookies: _*)
        .withJsonBody(body)
        .withCSRFToken
    ).get

  /** The user's (excluded, high_quality_manual, high_quality). */
  private def qualityState(userId: String): (Boolean, Option[Boolean], Boolean) =
    run(
      sql"SELECT excluded, high_quality_manual, high_quality FROM user_stat WHERE user_id = $userId"
        .as[(Boolean, Option[Boolean], Boolean)]
    ).head

  override def afterAll(): Unit = {
    try {
      touchedUserIds.foreach { userId =>
        val _ = run(
          sqlu"""UPDATE user_stat SET excluded = DEFAULT, high_quality_manual = DEFAULT, high_quality = DEFAULT
                 WHERE user_id = $userId"""
        )
      }
      val suiteRuns = jobRunTable.backgroundJobRuns
        .filter(r => r.jobName === RecalculateStreetPriorityActor.Name && r.backgroundJobRunId > runIdFloor)
      // The recalculations aren't awaited by the save, so one may still be closing its row.
      eventually(run(suiteRuns.filter(_.finishedAt.isEmpty).length.result) mustBe 0)
      val _ = run(suiteRuns.delete)
    } finally super.afterAll()
  }

  "Excluding a user from the Manage user page" should {
    "mark them excluded and manually low quality, and recalculate street priority" in {
      val userId        = targetUser(Role.Registered)
      val recalcsBefore = priorityRecalcs.get()

      val resp = save(adminCookies, settingsBody(userId, highQualityManual = None, excluded = true))
      status(resp) mustBe OK
      (contentAsJson(resp) \ "excluded").as[Boolean] mustBe true
      (contentAsJson(resp) \ "high_quality").as[Boolean] mustBe false
      qualityState(userId) mustBe ((true, Some(false), false))
      eventually(priorityRecalcs.get() must be > recalcsBefore)
    }

    "keep an excluded user low quality even when the save asks for high quality" in {
      val userId = targetUser(Role.Registered)
      status(save(adminCookies, settingsBody(userId, highQualityManual = None, excluded = true))) mustBe OK

      status(save(adminCookies, settingsBody(userId, highQualityManual = Some(true), excluded = true))) mustBe OK
      qualityState(userId) mustBe ((true, Some(false), false))
    }

    "leave them manually low quality when un-excluded, unless the same save changes their quality" in {
      val lowUser = targetUser(Role.Registered)
      status(save(adminCookies, settingsBody(lowUser, highQualityManual = None, excluded = true))) mustBe OK
      status(save(adminCookies, settingsBody(lowUser, highQualityManual = Some(false), excluded = false))) mustBe OK
      qualityState(lowUser) mustBe ((false, Some(false), false))

      // The quality write skips excluded users, so this only lands if the un-exclude runs first.
      val autoUser = targetUser(Role.Registered)
      status(save(adminCookies, settingsBody(autoUser, highQualityManual = None, excluded = true))) mustBe OK
      status(save(adminCookies, settingsBody(autoUser, highQualityManual = None, excluded = false))) mustBe OK
      val (excluded, manual, _) = qualityState(autoUser)
      (excluded, manual) mustBe ((false, None))
    }

    "leave alone a user excluded before this page existed, whose manual quality was never set" in {
      val userId = targetUser(Role.Administrator)
      val _      = run(sqlu"UPDATE user_stat SET excluded = TRUE, high_quality_manual = NULL WHERE user_id = $userId")

      // A non-Owner admin may save an excluded admin's page as long as the save changes neither quality nor exclusion.
      status(save(adminCookies, settingsBody(userId, highQualityManual = None, excluded = true))) mustBe OK
      val (excluded, manual, _) = qualityState(userId)
      (excluded, manual) mustBe ((true, None))
    }

    "refuse an Administrator excluding another Administrator, but let an Owner do it" in {
      val userId = targetUser(Role.Administrator)

      val refused = save(adminCookies, settingsBody(userId, highQualityManual = None, excluded = true))
      status(refused) mustBe BAD_REQUEST
      (contentAsJson(refused) \ "error").as[String] mustBe "An admin can only be excluded by an Owner"
      qualityState(userId)._1 mustBe false

      status(save(ownerCookies, settingsBody(userId, highQualityManual = None, excluded = true))) mustBe OK
      qualityState(userId)._1 mustBe true
    }

    "refuse excluding an Owner" in {
      val userId = targetUser(Role.Owner)
      val resp   = save(ownerCookies, settingsBody(userId, highQualityManual = None, excluded = true))
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "error").as[String] mustBe "An Owner's settings can't be changed"
      qualityState(userId)._1 mustBe false
    }
  }
}
