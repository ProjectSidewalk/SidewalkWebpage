package controllers.helper

import play.api.Configuration
import play.api.test.FakeRequest
import util.SidewalkSpec

/**
 * Unit tests for the Referer/Origin gate in SignedMediaUtils. No application/DB boot required.
 */
class SignedMediaUtilsSpec extends SidewalkSpec {
  private val config = Configuration.from(
    Map("play.filters.hosts.allowed" -> Seq("sidewalk-sea.cs.washington.edu", ".projectsidewalk.org", "localhost:9000"))
  )
  private def allowed(headers: (String, String)*): Boolean =
    SignedMediaUtils.refererAllowed(FakeRequest().withHeaders(headers*), config)

  "SignedMediaUtils.refererAllowed" should {
    "allow a request with neither header" in {
      allowed() mustBe true
    }

    "allow an allowed host, with a port, and any subdomain of a dotted pattern" in {
      allowed("Referer" -> "https://sidewalk-sea.cs.washington.edu/validate?x=1") mustBe true
      allowed("Referer" -> "http://localhost:9000/explore") mustBe true
      allowed("Origin" -> "https://sidewalk-chicago.projectsidewalk.org") mustBe true
    }

    "reject another host in either header" in {
      allowed("Referer" -> "https://example.com/page") mustBe false
      allowed("Origin" -> "https://example.com") mustBe false
      allowed("Referer" -> "https://sidewalk-sea.cs.washington.edu/", "Origin" -> "https://example.com") mustBe false
    }

    "reject another host whose page URL carries characters a strict URL parser refuses" in {
      allowed("Referer" -> "https://example.com/a|b[c]^d") mustBe false
      allowed("Referer" -> "https://user:pw@example.com:8443/x?q=a|b") mustBe false
    }

    "allow a header that is not a URL at all" in {
      allowed("Origin" -> "null") mustBe true
    }
  }
}
