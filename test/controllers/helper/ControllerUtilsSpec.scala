package controllers.helper

import org.scalatestplus.play.PlaySpec
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Unit tests for pure helpers in ControllerUtils. No application/DB boot required.
 */
class ControllerUtilsSpec extends PlaySpec {

  "ControllerUtils.internalKeyValid" should {
    val key = "s3cr3t-internal-key"

    "accept a request whose bearer token equals the configured key" in {
      ControllerUtils.internalKeyValid(FakeRequest().withHeaders("Authorization" -> s"Bearer $key"), key) mustBe true
    }

    "accept a case-insensitive Bearer prefix and trim the token" in {
      ControllerUtils.internalKeyValid(FakeRequest().withHeaders("Authorization" -> s"bearer $key  "), key) mustBe true
    }

    "reject a wrong token" in {
      ControllerUtils.internalKeyValid(FakeRequest().withHeaders("Authorization" -> "Bearer wrong"), key) mustBe false
    }

    "reject when the Authorization header is absent" in {
      ControllerUtils.internalKeyValid(FakeRequest(), key) mustBe false
    }

    "reject a non-bearer Authorization scheme" in {
      ControllerUtils.internalKeyValid(FakeRequest().withHeaders("Authorization" -> s"Basic $key"), key) mustBe false
    }

    "fail closed when the configured key is blank, even with a matching-looking header" in {
      ControllerUtils.internalKeyValid(FakeRequest().withHeaders("Authorization" -> "Bearer "), "") mustBe false
    }
  }

  "ControllerUtils.safeLocalPath" should {
    "pass through same-origin relative paths unchanged" in {
      ControllerUtils.safeLocalPath("/explore") mustBe "/explore"
      ControllerUtils.safeLocalPath("/validate?foo=bar&baz=1") mustBe "/validate?foo=bar&baz=1"
      ControllerUtils.safeLocalPath("/") mustBe "/"
    }

    "reject absolute, scheme, and protocol-relative URLs (open-redirect guard)" in {
      ControllerUtils.safeLocalPath("https://evil.example") mustBe "/"
      ControllerUtils.safeLocalPath("http://evil.example/x") mustBe "/"
      ControllerUtils.safeLocalPath("//evil.example") mustBe "/"
      ControllerUtils.safeLocalPath("/\\evil.example") mustBe "/" // browsers normalize /\ to //
      ControllerUtils.safeLocalPath("javascript:alert(1)") mustBe "/"
      ControllerUtils.safeLocalPath("evil.example/path") mustBe "/"
    }

    "trim surrounding whitespace before classifying" in {
      ControllerUtils.safeLocalPath("  //evil.example") mustBe "/"
      ControllerUtils.safeLocalPath("  /explore") mustBe "/explore"
    }

    "fall back to the supplied default when the target is unsafe" in {
      ControllerUtils.safeLocalPath("https://evil.example", "/signIn") mustBe "/signIn"
    }
  }

  "ControllerUtils.anonSignupRedirect" should {
    "return 401 for a fetch/XHR request so the client's fetch fails cleanly (Sec-Fetch-Mode present and != navigate)" in {
      val result = ControllerUtils.anonSignupRedirect(
        FakeRequest(GET, "/task").withHeaders("Sec-Fetch-Mode" -> "cors")
      )
      result.header.status mustBe UNAUTHORIZED
    }

    "303-redirect a top-level navigation to /anonSignUp, preserving the path and query (Sec-Fetch-Mode: navigate)" in {
      val result = ControllerUtils.anonSignupRedirect(
        FakeRequest(GET, "/explore?lat=1&lng=2").withHeaders("Sec-Fetch-Mode" -> "navigate")
      )
      result.header.status mustBe SEE_OTHER
      val location = result.header.headers("Location")
      location must startWith("/anonSignUp")
      location must include("url=%2Fexplore")
      location must include("lat=1")
    }

    "303-redirect when Sec-Fetch-Mode is absent, the conservative default for curl/crawlers/tests" in {
      val result = ControllerUtils.anonSignupRedirect(FakeRequest(GET, "/task"))
      result.header.status mustBe SEE_OTHER
      result.header.headers("Location") must startWith("/anonSignUp")
    }
  }
}
