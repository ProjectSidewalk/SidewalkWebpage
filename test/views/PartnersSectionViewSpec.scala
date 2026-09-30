package views

import models.partner.PartnerMetadata
import models.utils.OfficialContact
import org.scalatestplus.play.PlaySpec

import java.time.OffsetDateTime

/**
 * Renders the landing page's partners partial directly, so where the official-contact notice lands (#5462) is pinned
 * for both shapes of city: whether a city has partner logos depends on shared DB rows a route spec can't control.
 */
class PartnersSectionViewSpec extends PlaySpec with ViewSpecFixtures {

  private val contact = OfficialContact("the City of Burnaby", "https://www.burnaby.ca/our-city/contact-us")

  private val partner =
    PartnerMetadata(1, Some("burnaby"), "City of Burnaby", None, None, 0, 800, 200, OffsetDateTime.now)

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
      Seq(Seq(partner), Seq.empty).foreach { partners =>
        val body = render(partners, Some(contact))
        "partners-official-contact".r.findAllMatchIn(body).length mustBe 1
        body must include("""href="/labelMap" data-partner-source="official-contact-labelmap"""")
        body must include("""href="/stories" data-partner-source="official-contact-stories"""")
      }
    }

    "leave the notice out when the city has none" in {
      Seq(Seq(partner), Seq.empty).foreach(partners =>
        render(partners, None) must not include "partners-official-contact"
      )
    }
  }
}
