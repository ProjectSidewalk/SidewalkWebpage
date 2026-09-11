package util

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.db.slick.DatabaseConfigProvider
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._

import java.util.UUID
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Signs up real, registered accounts through `/signUp` for specs that need someone signed in, and deletes them again
 * in `afterAll`. The HTTP path can't share a rolled-back transaction, so this is the delete-by-id cleanup that
 * docs/testing-and-ci.md asks of a spec that writes rows, done once here rather than in each spec.
 *
 * Mix into a `PlaySpec` **before** `GuiceOneAppPerSuite` (`PlaySpec with SignedUpAccounts with GuiceOneAppPerSuite`):
 * the cleanup needs the app's DB pool, and a trait mixed in later would run its `afterAll` after the app has stopped.
 * A spec that writes other rows for these users must delete those in its own `afterAll` first, which runs before this.
 */
trait SignedUpAccounts extends BeforeAndAfterAll { this: PlaySpec with GuiceOneAppPerSuite =>

  /** The password every account here is created with; it meets `PasswordPolicy`. */
  protected val signUpPassword: String = "TestPass1"

  private lazy val accountsDbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  /** Ids of the accounts this suite created, deleted in `afterAll`. */
  protected var createdUserIds: Set[String] = Set.empty

  /**
   * A new account, signed in.
   *
   * @return The account's user id, its email, and the cookies that keep it signed in.
   */
  protected def signUpFreshUser(): (String, String, Seq[Cookie]) = {
    val tag    = UUID.randomUUID().toString.replace("-", "").take(20)
    val email  = s"spec.$tag@example.test"
    val signUp = route(
      app,
      FakeRequest(POST, "/signUp")
        .withHeaders("X-Requested-With" -> "XMLHttpRequest")
        .withFormUrlEncodedBody(
          "username"        -> s"spec$tag",
          "email"           -> email,
          "password"        -> signUpPassword,
          "passwordConfirm" -> signUpPassword,
          "terms"           -> "true",
          "returnUrl"       -> "/"
        )
        .withCSRFToken
    ).get
    status(signUp) mustBe OK
    val userId = runAccounts(sql"SELECT user_id FROM sidewalk_login.sidewalk_user WHERE email = $email".as[String]).head
    createdUserIds += userId
    (userId, email, cookies(signUp).toSeq)
  }

  /**
   * Everything a sign-up and a signed-in visit write for a user, children before the account itself. The city tables
   * are unqualified so they resolve to the app's own schema.
   */
  private def deleteAccount(userId: String): DBIO[Unit] =
    DBIO
      .seq(
        sqlu"DELETE FROM webpage_activity WHERE user_id = $userId",
        sqlu"DELETE FROM user_current_region WHERE user_id = $userId",
        sqlu"DELETE FROM user_stat WHERE user_id = $userId",
        sqlu"DELETE FROM auth_tokens WHERE user_id = $userId",
        sqlu"DELETE FROM sidewalk_login.user_settings WHERE user_id = $userId",
        sqlu"DELETE FROM sidewalk_login.user_account_state WHERE user_id = $userId",
        sqlu"DELETE FROM sidewalk_login.user_utm WHERE user_id = $userId",
        sqlu"DELETE FROM sidewalk_login.user_role WHERE user_id = $userId",
        sqlu"""DELETE FROM sidewalk_login.user_password_info
               WHERE login_info_id IN (
                 SELECT login_info_id FROM sidewalk_login.user_login_info WHERE user_id = $userId
               )""",
        sqlu"""WITH unlinked AS (
                 DELETE FROM sidewalk_login.user_login_info WHERE user_id = $userId RETURNING login_info_id
               )
               DELETE FROM sidewalk_login.login_info WHERE login_info_id IN (SELECT login_info_id FROM unlinked)""",
        sqlu"DELETE FROM sidewalk_login.sidewalk_user WHERE user_id = $userId"
      )
      .transactionally

  private def runAccounts[R](action: DBIO[R]): R = Await.result(accountsDbConfig.db.run(action), 60.seconds)

  override def afterAll(): Unit = {
    try createdUserIds.foreach(id => runAccounts(deleteAccount(id)))
    finally super.afterAll()
  }
}
