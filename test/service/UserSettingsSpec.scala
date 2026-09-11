package service

import models.user.{MeasurementSystem, Role, SidewalkUserWithRole, UserSettingsTableDef}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.silhouette.api.util.PasswordInfo

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed tests for the account-wide settings in `sidewalk_login.user_settings` (#3720), read back through the same
 * user lookup every request makes, since that's where pages get them from.
 *
 * Creates throwaway anonymous users and deletes their settings rows in afterAll. Requires a Postgres DB (as in dev/CI).
 */
// BeforeAndAfterAll must be mixed in BEFORE GuiceOneAppPerSuite: linearization then runs afterAll inside the running
// app, rather than after the app (and its DB pool) has already been stopped.
class UserSettingsSpec extends PlaySpec with org.scalatest.BeforeAndAfterAll with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val authService = app.injector.instanceOf[AuthenticationService]
  private val userService = app.injector.instanceOf[UserService]
  // Keep the DatabaseConfig as a stable val and call .db.run inline; binding .db to its own val would infer a
  // path-dependent existential type that needs -language:existentials.
  private val dbConfig                   = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)
  private def await[T](f: scala.concurrent.Future[T]): T = Await.result(f, 60.seconds)

  /** Every throwaway user the suite creates, so afterAll can sweep their settings. */
  private val createdUserIds = scala.collection.mutable.Set[String]()

  /** Creates a throwaway anonymous user and registers it for afterAll cleanup. */
  private def newAnonUser(): SidewalkUserWithRole = {
    val generated = await(authService.generateUniqueAnonUser())
    val pwInfo    = PasswordInfo("bcrypt-sha256", "spec-only-not-a-hash", None)
    val user      = await(authService.createUser(generated, "credentials", pwInfo, oldUserId = None))
    createdUserIds += user.userId
    user
  }

  /** The user as a request would see them. */
  private def reload(userId: String): SidewalkUserWithRole = await(authService.findByUserId(userId)).value

  /** Deletes the settings rows. The bare user/auth rows are left behind, matching ExploreTutorialRouteSpec. */
  override def afterAll(): Unit = {
    val _ = run(TableQuery[UserSettingsTableDef].filter(_.userId inSet createdUserIds.toSeq).delete)
    super.afterAll()
  }

  "Account-wide settings" should {
    "all be at their defaults for a user who has never saved any" in {
      val user = reload(newAnonUser().userId)
      user.communityService mustBe false
      user.measurementSystem mustBe None
    }

    "save units and service-hours tracking without either one resetting the other" in {
      val userId = newAnonUser().userId
      await(userService.setCommunityService(userId, enabled = true))
      await(userService.setMeasurementSystem(userId, Some(MeasurementSystem.Metric)))

      val saved = reload(userId)
      saved.communityService mustBe true
      saved.measurementSystem mustBe Some(MeasurementSystem.Metric)

      await(userService.setMeasurementSystem(userId, None))
      val cleared = reload(userId)
      cleared.measurementSystem mustBe None
      cleared.communityService mustBe true
    }

    // An admin giving someone a new role mustn't turn off the service-hours tracking they asked for.
    "keep service-hours tracking on through a role change" in {
      val userId = newAnonUser().userId
      await(userService.setCommunityService(userId, enabled = true))
      await(authService.updateRole(userId, Role.Registered))

      reload(userId).communityService mustBe true
    }
  }
}
