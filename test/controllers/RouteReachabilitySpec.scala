package controllers

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.routing.Router

import scala.collection.mutable
import scala.util.matching.Regex

/**
 * Structural guard against unreachable ("shadowed") routes in conf/routes -- the class of bug that shipped the #456
 * regression to the -test servers.
 *
 * Play matches routes top-to-bottom and COMMITS to the first route whose path pattern matches: if a typed path
 * parameter then fails to bind it returns 400, it does NOT fall through to a later route. So when the share route
 *   GET /label/:labelId   controllers.ShareController.label(labelId: Int)
 * was declared above the literal GET /label/tags, every /label/tags request matched the wildcard, failed to bind
 * "tags" as an Int, and 400'd -- silently breaking the Explore tag menu, mission-resume, region-count, and the
 * Gallery tag filter, none of which had a test that exercised the shadowed literal.
 *
 * This spec reconstructs the declared route table (in declaration order) from the live Router.documentation and
 * asserts that no route is fully shadowed by an earlier same-method route. For each route it generates a couple of
 * diverse concrete example paths from that route's own pattern, then flags it if some earlier same-method route's
 * pattern matches ALL of them (i.e. that earlier route already claims every request this one could receive). It
 * reasons purely about path patterns -- it runs no controller action -- so it is a cheap, exhaustive backstop for the
 * whole ordering-bug class, not just the one literal we happened to fix.
 *
 * Boots the app like the sibling controller specs (see ShareControllerSpec); requires the dev/CI Postgres+PostGIS DB.
 */
class RouteReachabilitySpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors; we only read the route table.
      .build()

  private val router = app.injector.instanceOf[Router]

  /** (httpMethod, pathPattern, handler) for every declared route, in declaration (match-priority) order. */
  private val declaredRoutes: Seq[(String, String, String)] = router.documentation

  // A dynamic segment as it appears in Router.documentation: "$name<regex>" (e.g. $labelId<[^/]+>), plus the raw
  // ":name" / "*name" forms as a defensive fallback in case the format ever changes.
  private val DynTok: Regex = """\$[^<]+<[^>]*>|:[^/]+|\*[^/]+""".r

  /** The regex a single dynamic token constrains its segment to. */
  private def innerRegexOf(tok: String): String =
    if (tok.startsWith("$")) tok.substring(tok.indexOf('<') + 1, tok.length - 1)
    else if (tok.startsWith("*")) ".+" // rest-of-path capture
    else "[^/]+"                       // :name -> one path segment

  /** Diverse candidate tokens; picking >1 that satisfy a segment defeats subset-regex false positives. */
  private val samplePool: Seq[String] = Seq("1", "zqx", "abc123", "12", "a-b_c")

  private def matchesFully(regex: String, candidate: String): Boolean =
    ("^(?:" + regex + ")$").r.pattern.matcher(candidate).matches()

  /** Turns a documentation path pattern into an anchored regex over request paths. */
  private def patternToRegex(pattern: String): Regex = {
    val sb  = new StringBuilder("^")
    var idx = 0
    for (m <- DynTok.findAllMatchIn(pattern)) {
      sb.append(Regex.quote(pattern.substring(idx, m.start)))
      sb.append("(?:").append(innerRegexOf(m.matched)).append(")")
      idx = m.end
    }
    sb.append(Regex.quote(pattern.substring(idx)))
    sb.append("$")
    sb.toString.r
  }

  /**
   * A couple of concrete example request paths this route accepts (one per diverse token choice), or None if any
   * segment's regex is too exotic to sample -- in which case we don't treat the route as a shadow *victim* (it can
   * still act as a shadower via its own pattern).
   */
  private def pathSamples(pattern: String): Option[Seq[String]] = {
    val literals = mutable.ArrayBuffer.empty[String]
    val dynCands = mutable.ArrayBuffer.empty[Seq[String]]
    var idx      = 0
    var bad      = false
    for (m <- DynTok.findAllMatchIn(pattern)) {
      literals += pattern.substring(idx, m.start)
      val cands = samplePool.filter(c => matchesFully(innerRegexOf(m.matched), c)).take(2)
      if (cands.isEmpty) bad = true else dynCands += cands
      idx = m.end
    }
    literals += pattern.substring(idx)
    if (bad) return None

    val k       = if (dynCands.isEmpty) 1 else math.min(2, dynCands.map(_.size).max)
    val samples = (0 until k).map { i =>
      val sb = new StringBuilder
      for (p <- dynCands.indices) {
        sb.append(literals(p))
        val cs = dynCands(p)
        sb.append(cs(math.min(i, cs.size - 1)))
      }
      sb.append(literals.last)
      sb.toString
    }
    Some(samples.distinct)
  }

  "conf/routes" should {
    "declare no route that is unreachable (fully shadowed by an earlier same-method route)" in {
      val compiled   = declaredRoutes.map { case (m, p, h) => (m, p, h, patternToRegex(p)) }.toIndexedSeq
      val skipped    = mutable.ArrayBuffer.empty[String]
      val violations = mutable.ArrayBuffer.empty[String]

      for (j <- compiled.indices) {
        val (mth, pat, handler, _) = compiled(j)
        pathSamples(pat) match {
          case None          => skipped += s"$mth $pat"
          case Some(samples) =>
            (0 until j)
              .map(compiled)
              .find { case (mi, _, _, rxi) =>
                mi == mth && samples.forall(s => rxi.pattern.matcher(s).matches())
              }
              .foreach { case (mi, pi, hi, _) =>
                violations += s"  $mth $pat -> $handler\n      is shadowed by earlier  $mi $pi -> $hi"
              }
        }
      }

      withClue(
        s"Found ${violations.size} unreachable route(s). Each is already fully matched by an earlier same-method " +
          "route, so Play never reaches it -- a typed-param mismatch 400s (as /label/tags did) instead of falling " +
          "through. Move the more specific route ABOVE the broader one in conf/routes.\n" +
          violations.mkString("\n") + "\n" +
          (if (skipped.nonEmpty) s"[patterns skipped as unsampleable: ${skipped.mkString(", ")}]\n" else "")
      ) {
        violations mustBe empty
      }
    }
  }
}
