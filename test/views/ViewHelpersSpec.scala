package views

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.{JsString, Json}

/**
 * Pure (no DB, no app boot) tests for `ViewHelpers.jsonForScript`, the inline-`<script>` JSON serializer (#4451).
 *
 * The contract under test: JSON escaping alone leaves `<` intact, so a value containing `</script>` closes the
 * surrounding inline script block and the rest of the payload parses as markup — a reflected XSS when the value came
 * from a URL parameter. `jsonForScript` must emit no `<` at all while staying valid JSON (and therefore valid JS), so
 * the browser's HTML parser can never see a tag boundary inside the block.
 */
class ViewHelpersSpec extends AnyFunSuite with Matchers {

  test("a </script> payload comes out with every < escaped, so the block can't be closed early") {
    val out = ViewHelpers.jsonForScript("</script><script>alert(1)</script>").body
    out should not include "<"
    out should include("\\u003c")
  }

  test("output is valid JSON that round-trips the original string exactly") {
    val hostile = "</script><!-- \" \\ \n --> ' `"
    val out     = ViewHelpers.jsonForScript(hostile).body
    Json.parse(out) shouldBe JsString(hostile)
  }

  test("quotes and backslashes cannot terminate the JS string literal") {
    val out = ViewHelpers.jsonForScript("""a"b\c""").body
    out shouldBe """"a\"b\\c""""
  }

  test("a JsValue passes through with the same guarantee applied to nested strings") {
    val out = ViewHelpers.jsonForScript(Json.obj("name" -> "<b>hi</b>", "n" -> 3)).body
    out should not include "<"
    (Json.parse(out) \ "name").as[String] shouldBe "<b>hi</b>"
    (Json.parse(out) \ "n").as[Int] shouldBe 3
  }

  test("a benign string is plain JSON, untouched") {
    ViewHelpers.jsonForScript("Teaneck High School").body shouldBe "\"Teaneck High School\""
  }
}
