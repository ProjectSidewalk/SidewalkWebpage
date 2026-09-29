package views

import models.user.{Role, SidewalkUserWithRole}
import service.PublicProfile
import util.SidewalkSpec

/** The admin links an admin sees in the sidebar of a user's public profile (#5564). */
class PublicProfileViewSpec extends SidewalkSpec with ViewSpecFixtures {

  // A private profile renders without KPIs or a map, and the sidebar doesn't depend on visibility.
  private val privateProfile = Some(PublicProfile(user.username, visible = false, None, Seq.empty))
  private val adminLink      = s"/admin/user/${user.username}"

  private def viewer(role: Role.Role): SidewalkUserWithRole =
    user.copy(userId = "viewer", username = "viewer", email = "viewer@example.com", role = role)

  private def render(viewer: SidewalkUserWithRole, profile: Option[PublicProfile]): String =
    views.html.userDashboard.publicProfile(commonData, viewer, user.username, isMetric = false, profile, Seq.empty).body

  "A public profile's sidebar" should {
    "link administrators and owners to that user's admin pages" in {
      Seq(Role.Administrator, Role.Owner).foreach { role =>
        val page = render(viewer(role), privateProfile)
        page must include(s"""href="$adminLink"""")
        page must include(s"""href="$adminLink/manage"""")
      }
    }

    "not show the admin links to anyone below admin" in {
      Seq(Role.Anonymous, Role.Registered, Role.Turker, Role.Researcher).foreach { role =>
        render(viewer(role), privateProfile) must not include adminLink
      }
    }

    "not link to admin pages for a username that matches no account" in {
      render(viewer(Role.Administrator), None) must not include adminLink
    }
  }
}
