package views

import org.scalatestplus.play.PlaySpec

/**
 * Renders the post-signup welcome page directly.
 *
 * The page is only reachable right after a real registration, so the privacy panel added for #4375 — which is the
 * whole point of putting the choice in front of a brand-new user — has no route spec that can reach it.
 */
class WelcomeViewSpec extends PlaySpec with ViewSpecFixtures {

  private def render(
      onLeaderboard: Boolean = true,
      publicProfile: Boolean = true,
      privateByDefault: Boolean = false
  ): String =
    views.html.authentication
      .welcome(commonData, user, "/explore", resumed = false, onLeaderboard, publicProfile, privateByDefault)
      .body

  /** Whether the named checkbox rendered ticked, without pinning Twirl's attribute order or spacing. */
  private def isChecked(body: String, id: String): Boolean =
    s"""<input[^>]*id="$id"[^>]*>""".r.findFirstIn(body) match {
      case Some(tag) => tag.contains("checked")
      case None      => fail(s"no checkbox rendered with id $id")
    }

  "The welcome page" should {
    "tell a new user where their username shows up" in {
      val body = render()
      body must include("wl-privacy")
      body must include(user.username)
      body must include(messages("welcome.privacy.title"))
    }

    "check each privacy box only when the user's flag is actually on" in {
      val bothOn = render(onLeaderboard = true, publicProfile = true)
      isChecked(bothOn, "wl-on-leaderboard") mustBe true
      isChecked(bothOn, "wl-public-profile") mustBe true

      val bothOff = render(onLeaderboard = false, publicProfile = false)
      isChecked(bothOff, "wl-on-leaderboard") mustBe false
      isChecked(bothOff, "wl-public-profile") mustBe false
    }

    "leave the boxes disabled for the server to render, so no-JS visitors can't silently lose a privacy choice" in {
      val body = render()
      """<input[^>]*id="wl-on-leaderboard"[^>]*>""".r.findFirstIn(body).value must include("disabled")
      body must include(messages("welcome.privacy.noscript", "/dashboard/settings"))
    }

    "explain the private-by-default setting only on deployments that use it" in {
      render(privateByDefault = true) must include(messages("welcome.privacy.default.private"))
      render(privateByDefault = false) must not include messages("welcome.privacy.default.private")
    }
  }
}
