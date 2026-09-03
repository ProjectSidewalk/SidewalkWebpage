package util

import com.google.inject.{Injector => GuiceInjector, Key, TypeLiteral}
import models.auth.DefaultEnv
import models.user.Role
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.db.slick.DatabaseConfigProvider
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.silhouette.api.Silhouette
import service.AuthenticationService

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Mints signed-in sessions holding a given role, for specs that pin a role-gated route with a real caller.
 *
 * Seeds its own accounts rather than hunting the schema for an existing admin: a spec that `assume`s one away
 * cancels on an empty CI database, which reads as passing. Each session is minted through the real anonymous-signup
 * route and promoted with a DB write, mirroring how a throwaway admin is made for QA; the promotion is undone in
 * `afterAll` so no standing admin is left in a shared development database. The account is identified by resolving
 * the session's own authenticator, so concurrently running suites minting their own sessions can't be confused for
 * it. Mix into a `PlaySpec` **before** `GuiceOneAppPerSuite` (`PlaySpec with RoleSession with GuiceOneAppPerSuite
 * with AnonSession`): the demotion in `afterAll` needs the app's DB pool, and a trait mixed in later would run its
 * `afterAll` outside the app's lifetime.
 */
trait RoleSession extends BeforeAndAfterAll { this: PlaySpec with GuiceOneAppPerSuite with AnonSession =>

  private lazy val roleSessionDbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  /** The accounts promoted by this suite, remembered so they can be demoted again. */
  private var promotedUserIds: List[String] = Nil

  /**
   * A fresh session holding `role`.
   *
   * A bare signup carries the Anonymous role, which is sent to sign in whatever role an action wants; only a
   * registered role (e.g. "Registered", "Administrator") reaches the branch that refuses by name.
   */
  protected def sessionAs(role: Role.Value): Seq[Cookie] = {
    val cookies = freshAnonSession()
    val userId  = userIdOf(cookies)
    promotedUserIds ::= userId
    setRole(userId, role)
    cookies
  }

  /** The user id behind a session's cookies, read back through Silhouette from the authenticator they carry. */
  protected def userIdOf(cookies: Seq[Cookie]): String = {
    // Resolved through Guice's TypeLiteral rather than injector.instanceOf: the latter takes a ClassTag, so the
    // DefaultEnv parameter erases and Guice looks for a raw Silhouette binding that does not exist.
    val silhouetteKey = Key.get(new TypeLiteral[Silhouette[DefaultEnv]]() {})
    val env           = app.injector.instanceOf[GuiceInjector].getInstance(silhouetteKey).env
    val authenticator =
      Await.result(env.authenticatorService.retrieve(FakeRequest().withCookies(cookies: _*)), 30.seconds)
    val user = authenticator.flatMap { auth =>
      Await.result(app.injector.instanceOf[AuthenticationService].retrieve(auth.loginInfo), 30.seconds)
    }
    user.map(_.userId).getOrElse(fail("The minted session's cookies resolve to no user."))
  }

  /** Sets the account's role directly in the DB; roles are resolved per request, so the session picks it up. */
  protected def setRole(userId: String, role: Role.Value): Unit = {
    val _ = Await.result(
      roleSessionDbConfig.db.run(
        // The cast is required: the URL sets no stringtype=unspecified, so pgjdbc binds this as varchar, and Postgres
        // has no varchar-to-enum assignment cast. Qualified so it doesn't depend on search_path.
        sqlu"""UPDATE sidewalk_login.user_role
               SET role = ${role.toString}::sidewalk_login.role
               WHERE user_id = $userId"""
      ),
      60.seconds
    )
  }

  override def afterAll(): Unit = {
    promotedUserIds.foreach(id => setRole(id, Role.Anonymous))
    super.afterAll()
  }
}
