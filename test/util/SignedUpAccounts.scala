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
 * Signs up real accounts through `/signUp` and deletes them in `afterAll`, since the HTTP path can't use a rolled-back
 * transaction. Mix in before `GuiceOneAppPerSuite`, because the cleanup needs the app's DB pool. A spec's own
 * `afterAll` runs first, so it can delete any other rows it wrote for these users.
 */
trait SignedUpAccounts extends BeforeAndAfterAll { this: PlaySpec with GuiceOneAppPerSuite =>

  /** The password every account here is created with; it meets `PasswordPolicy`. */
  protected val signUpPassword: String = "TestPass1"

  private lazy val accountsDbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  /** Ids of the accounts this suite created, deleted in `afterAll`. */
  protected var createdUserIds: Set[String] = Set.empty

  /** @return A new signed-in account's user id, email, and session cookies. */
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

  /** Everything a sign-up and signed-in visits write for a user, children first; city tables are the app's schema. */
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
