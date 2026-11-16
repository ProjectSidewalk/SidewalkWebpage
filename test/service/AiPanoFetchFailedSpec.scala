package service

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Only the AI server's own "no imagery" 502 may shut a label out of AI validation for good; a 502 from its proxy while
 * the server is down must leave the label for the next run.
 */
class AiPanoFetchFailedSpec extends AnyFunSuite with Matchers {

  test("the AI server's own no-imagery answer counts as a permanent failure") {
    AiService.panoFetchFailed("""{"error": "Failed to fetch panorama"}""") shouldBe true
    AiService.panoFetchFailed("""{"error":"Failed to fetch panorama"}""" + "\n") shouldBe true
  }

  test("a proxy error page, an empty body or another error does not") {
    AiService.panoFetchFailed("<html><head><title>502 Proxy Error</title></head></html>") shouldBe false
    AiService.panoFetchFailed("") shouldBe false
    AiService.panoFetchFailed("""{"error": "Inference error: boom"}""") shouldBe false
    AiService.panoFetchFailed("""["Failed to fetch panorama"]""") shouldBe false
  }
}
