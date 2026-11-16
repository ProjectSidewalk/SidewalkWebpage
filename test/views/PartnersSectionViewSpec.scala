package views

import models.partner.PartnerMetadata
import models.utils.OfficialContact
import util.SidewalkSpec

import java.time.OffsetDateTime

/**
 * Renders the landing page's partners partial directly, so where the official-contact notice lands (#5462) is pinned
 * for both shapes of city: whether a city has partner logos depends on shared DB rows a route spec can't control.
 */
class PartnersSectionViewSpec extends SidewalkSpec with ViewSpecFixtures {

  private val contact = OfficialContact("the City of Burnaby", "https://www.burnaby.ca/our-city/contact-us")

  private val partner =
    PartnerMetadata(1, Some("burnaby"), "City of Burnaby", None, None, 0, 800, 200, OffsetDateTime.now)

  private def projectWide(id: Int, name: String) =
    PartnerMetadata(id, None, name, Some("https://example.org/"), None, 0, 800, 200, OffsetDateTime.now)

  private def render(partners: Seq[PartnerMetadata], officialContact: Option[OfficialContact]): String =
    views.html.landing._partners(partners, officialContact, "Burnaby").body

  "The partners section" should {
    "put the notice under the city's logos, before the created-by credit" in {
      val body = render(Seq(partner), Some(contact))
      body.indexOf("partners-official-contact") must be > body.indexOf("partners-title")
      body.indexOf("partners-official-contact") must be < body.indexOf("creators-title")
    }

    "move the notice to the foot of the section when the city has no logos" in {
      val body = render(Seq.empty, Some(contact))
      body must not include "partners-title"
      body.indexOf("partners-official-contact") must be > body.indexOf("partners-credit")
    }

    "render the notice exactly once, with its LabelMap and Stories links" in {
      Seq(Seq(partner), Seq.empty, Seq(projectWide(2, "SciStarter"))).foreach { partners =>
        val body = render(partners, Some(contact))
        "partners-official-contact".r.findAllMatchIn(body).length mustBe 1
        body must include("""href="/labelMap" data-partner-source="official-contact-labelmap"""")
        body must include("""href="/stories" data-partner-source="official-contact-stories"""")
      }
    }

    "keep the notice with the city's logos, above the project-wide partners" in {
      val body = render(Seq(partner, projectWide(2, "SciStarter")), Some(contact))
      body.indexOf("partners-official-contact") must be < body.indexOf("project-partners-title")
    }

    "put the notice at the foot when only project-wide partners render, not under their row" in {
      val body = render(Seq(projectWide(2, "SciStarter")), Some(contact))
      body.indexOf("partners-official-contact") must be > body.indexOf("partners-credit")
    }

    "leave the notice out when the city has none" in {
      Seq(Seq(partner), Seq.empty).foreach(partners =>
        render(partners, None) must not include "partners-official-contact"
      )
    }
  }

  "The Project-Wide Partners row (#5984)" should {
    "sit between the city's partners and the created-by credit" in {
      val body = render(Seq(projectWide(2, "SciStarter"), partner), None)
      body.indexOf("""id="partners-title"""") must be < body.indexOf("project-partners-title")
      body.indexOf("project-partners-title") must be < body.indexOf("creators-title")
      body.indexOf("City of Burnaby") must be < body.indexOf("project-partners-title")
      body.indexOf("SciStarter") must be > body.indexOf("project-partners-title")
    }

    "render without a city heading when the city has no partners of its own" in {
      val body = render(Seq(projectWide(2, "SciStarter")), None)
      body must not include """id="partners-title""""
      body must include("project-partners-title")
      body must include("SciStarter")
    }

    "leave out a project-wide partner the city also lists, ignoring case and spacing" in {
      val body = render(Seq(projectWide(2, "city of\u00a0 burnaby "), projectWide(3, "SciStarter"), partner), None)
      "partnerLogo/2".r.findAllMatchIn(body).length mustBe 0
      body must include("partnerLogo/1")
      body must include("partnerLogo/3")
    }

    "drop the heading entirely when every project-wide partner is one of the city's own" in {
      val body = render(Seq(projectWide(2, "City of Burnaby"), partner), None)
      body must not include "project-partners-title"
    }
  }
}
