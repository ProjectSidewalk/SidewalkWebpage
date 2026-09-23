package service

import models.utils.OfficialContact
import org.scalatestplus.play.PlaySpec

/**
 * Unit tests for [[ConfigService.validateOfficialContact]] (#5462). The URL lands in an href on the public landing
 * page, so the rules that keep a bad value out of it are pinned here without an app or a database.
 */
class OfficialContactValidationSpec extends PlaySpec {
  import ConfigService.{validateOfficialContact => validate}

  private val url = "https://www.burnaby.ca/our-city/contact-us"

  "validateOfficialContact" should {
    "accept an https contact, trimmed" in {
      validate("  the City of Burnaby ", s" $url ") mustBe Right(Some(OfficialContact("the City of Burnaby", url)))
    }

    "accept an uppercase scheme" in {
      validate("x", "HTTPS://example.org").isRight mustBe true
    }

    "turn the notice off for a blank URL, whatever the name" in {
      validate("", "") mustBe Right(None)
      validate("the City of Burnaby", "   ") mustBe Right(None)
    }

    "reject a blank name when a URL is given" in {
      validate("  ", url).isLeft mustBe true
    }

    "reject anything that isn't an absolute https URL" in {
      Seq("http://example.org", "javascript:alert(1)", "//example.org", "example.org", "https://", "https://a b")
        .foreach(bad => withClue(bad)(validate("x", bad).isLeft mustBe true))
    }

    "reject values over the length caps" in {
      validate("x" * (ConfigService.OfficialContactMaxNameLength + 1), url).isLeft mustBe true
      validate("x", "https://example.org/" + "a" * ConfigService.OfficialContactMaxUrlLength).isLeft mustBe true
      validate("x" * ConfigService.OfficialContactMaxNameLength, url).isRight mustBe true
    }
  }
}
