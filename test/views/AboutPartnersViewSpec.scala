package views

import models.partner.PartnerMetadata
import util.SidewalkSpec

import java.time.OffsetDateTime

/**
 * Renders the /about page with a chosen partner table, so the logo grid (#5980) is pinned for shapes of the shared
 * table a route spec can't control: empty (a fresh dev database), project-wide only, and many cities' rows.
 */
class AboutPartnersViewSpec extends SidewalkSpec with ViewSpecFixtures {

  private def row(id: Int, cityId: Option[String], name: String, url: Option[String] = None) =
    PartnerMetadata(id, cityId, name, url, None, 0, 800, 200, OffsetDateTime.now)

  // Cities from config rather than literals, so the spec follows whatever the test environment marks public.
  private val publicCity  = commonData.allCityInfo.find(_.isPublic).get.cityId
  private val privateCity = commonData.allCityInfo.find(!_.isPublic).map(_.cityId)

  private def render(partners: Seq[PartnerMetadata]): String =
    views.html.about(commonData, "About", Some(user), partners).body

  /** Just the partners band, so a partner name elsewhere on the page (the body prose) can't satisfy an assertion. */
  private def partnersBand(body: String): String = {
    val start = body.indexOf("""id="about-partners"""")
    body.substring(start, body.indexOf("</section>", start))
  }

  "The About page's partner grid" should {
    "show only the prose, with no headings, when the partner table is empty" in {
      val band = partnersBand(render(Seq.empty))
      band must include("Community partners")
      band must not include "about-project-partners-title"
      band must not include "about-city-partners-title"
      band must not include "about-partner-logos"
    }

    "put the project-wide partners first, then each other organization once, alphabetically" in {
      val band = partnersBand(
        render(
          Seq(
            row(4, Some(publicCity), "Walkable Seattle"),
            row(2, Some(publicCity), "Hackensack Meridian"),
            row(6, Some(publicCity), "hackensack  meridian"),
            row(9, None, "SciStarter"),
            row(3, Some(publicCity), "scistarter")
          )
        )
      )
      band.indexOf("about-project-partners-title") must be < band.indexOf("partnerLogo/9")
      band.indexOf("partnerLogo/9") must be < band.indexOf("about-city-partners-title")
      band.indexOf("about-city-partners-title") must be < band.indexOf("partnerLogo/2")
      band.indexOf("partnerLogo/2") must be < band.indexOf("partnerLogo/4")
      Seq("partnerLogo/3", "partnerLogo/6").foreach(dropped => band must not include dropped)
    }

    "leave out the partners of a city that isn't public" in {
      val city = privateCity.getOrElse(fail("cityparams.conf configures no private city to test with"))
      val band = partnersBand(render(Seq(row(4, Some(city), "Unlaunched Partner"), row(5, Some(publicCity), "Shown"))))
      band must not include "partnerLogo/4"
      band must include("partnerLogo/5")
    }

    "drop the city heading when every partner is project-wide" in {
      val band = partnersBand(render(Seq(row(9, None, "SciStarter"))))
      band must include("about-project-partners-title")
      band must not include "about-city-partners-title"
    }

    "link a logo with a URL, name it in a tooltip, and fall back to a translated alt" in {
      val band = partnersBand(render(Seq(row(4, Some(publicCity), "Walkable Seattle", Some("https://example.org/")))))
      band must include("""data-ps-tooltip="Walkable Seattle"""")
      band must include("""href="https://example.org/" data-partner-source="walkable-seattle"""")
      band must include("""alt="Walkable Seattle logo"""")
    }

    "render a bare image, with no link, for a partner without a URL" in {
      val band = partnersBand(render(Seq(row(4, Some(publicCity), "Walkable Seattle"))))
      band must include("partnerLogo/4")
      band must not include "data-partner-source"
    }
  }
}
