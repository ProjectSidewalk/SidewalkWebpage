package models.auth

import models.auth.AuthorizationResult.*
import models.user.{Role, SidewalkUserWithRole}
import play.api.test.FakeRequest
import play.silhouette.api.LoginInfo
import play.silhouette.impl.authenticators.CookieAuthenticator
import util.SidewalkSpec

import java.time.ZonedDateTime
import scala.concurrent.Await
import scala.concurrent.duration.*

/**
 * Every role against each check in `WithRole.scala` (#5841). Which route uses which check is `RoleCheckRoutesSpec`.
 */
class WithRoleSpec extends SidewalkSpec {

  private val SelfId  = "self-user-id"
  private val OtherId = "other-user-id"

  // Spelled out rather than read from Role.ADMIN_ROLES, so a change there fails here.
  private val AdminRoles: Set[Role] = Set(Role.Administrator, Role.Owner)

  private def user(role: Role): SidewalkUserWithRole =
    SidewalkUserWithRole(SelfId, "someone", "someone@example.test", role, communityService = false,
      infra3dAccess = false, measurementSystem = None)

  // None of the checks read the authenticator, but the signature needs one.
  private val authenticator = CookieAuthenticator(
    "id",
    LoginInfo("credentials", SelfId),
    ZonedDateTime.now(),
    ZonedDateTime.now().plusDays(1),
    None,
    None,
    None
  )

  /** @return What `check` says to a user with `role`. */
  private def result(
      check: RoleBasedAuthorization[SidewalkUserWithRole, DefaultEnv#A],
      role: Role
  ): AuthorizationResult = {
    given request: FakeRequest[?] = FakeRequest()
    Await.result(check.checkAuthorization(user(role), authenticator), 5.seconds)
  }

  /** @return Whether `check` lets a user with `role` through. */
  private def allows(check: RoleBasedAuthorization[SidewalkUserWithRole, DefaultEnv#A], role: Role): Boolean =
    result(check, role) == Authorized

  private def verb(allowed: Boolean): String = if (allowed) "allow" else "refuse"

  "WithAdmin" should {
    Role.values.foreach { role =>
      val expected = AdminRoles.contains(role)
      s"${verb(expected)} the ${role.name} role" in {
        allows(WithAdmin(), role) mustBe expected
      }
    }
  }

  "WithOwner" should {
    Role.values.foreach { role =>
      val expected = role == Role.Owner
      s"${verb(expected)} the ${role.name} role" in {
        allows(WithOwner(), role) mustBe expected
      }
    }
  }

  "WithSignedIn" should {
    Role.values.foreach { role =>
      val expected = role != Role.Anonymous
      s"${verb(expected)} the ${role.name} role" in {
        allows(WithSignedIn(), role) mustBe expected
      }
    }
  }

  "WithAdminOrIsUser" should {
    Role.values.foreach { role =>
      s"allow the ${role.name} role on their own data" in {
        allows(WithAdminOrIsUser(SelfId), role) mustBe true
      }
      val expected = AdminRoles.contains(role)
      s"${verb(expected)} the ${role.name} role on someone else's data" in {
        allows(WithAdminOrIsUser(OtherId), role) mustBe expected
      }
    }
  }

  "WithAdminOrRegisteredAndIsUser" should {
    Role.values.foreach { role =>
      val ownExpected = role != Role.Anonymous
      s"${verb(ownExpected)} the ${role.name} role on their own data" in {
        allows(WithAdminOrRegisteredAndIsUser(SelfId), role) mustBe ownExpected
      }
      val otherExpected = AdminRoles.contains(role)
      s"${verb(otherExpected)} the ${role.name} role on someone else's data" in {
        allows(WithAdminOrRegisteredAndIsUser(OtherId), role) mustBe otherExpected
      }
    }

    // The sign-in prompt names the required role, and an anonymous user on their own data only needs to sign in.
    "ask an anonymous user on their own data to sign in, not to be an admin" in {
      result(WithAdminOrRegisteredAndIsUser(SelfId), Role.Anonymous) mustBe
        NotAuthorized(currRole = Role.Anonymous, requiredRole = Role.Registered)
    }
    "ask an anonymous user on someone else's data to be an admin" in {
      result(WithAdminOrRegisteredAndIsUser(OtherId), Role.Anonymous) mustBe
        NotAuthorized(currRole = Role.Anonymous, requiredRole = Role.Administrator)
    }
  }
}
