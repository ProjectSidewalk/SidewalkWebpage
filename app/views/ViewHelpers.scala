package views

import play.api.libs.json.{Json, Writes}
import play.twirl.api.Html

/** Helpers shared across Twirl templates. */
object ViewHelpers {

  /**
   * Serialize a value as JSON for embedding directly inside an inline `<script>` block.
   *
   * Use this instead of `Html(Json.stringify(...))` for **any** value interpolated into inline JavaScript. JSON
   * escaping alone is not sufficient there: it escapes quotes and backslashes but leaves `<` untouched, so a value
   * containing a literal `</script>` closes the surrounding block early and everything after it is parsed as markup.
   * Any value reaching a template from a URL parameter, a form, or the database can carry that sequence.
   *
   * Escaping `<` as its `\u003c` form closes the hole while keeping the output valid JSON — and therefore valid
   * JavaScript — because a JSON string may encode any character as a `\uXXXX` escape.
   *
   * @param value Value to serialize; any type with a `Writes` (a `JsValue` passes through unchanged).
   * @return      The JSON, safe to drop into a `<script>` block.
   */
  def jsonForScript[A](value: A)(implicit writes: Writes[A]): Html =
    Html(Json.stringify(Json.toJson(value)).replace("<", "\\u003c"))
}
