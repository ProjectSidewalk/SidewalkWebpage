package models.utils

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pure (no DB, no app boot) tests for the /r/<slug> share-link slug helpers.
 *
 * The lookup half guards #5150: a route named "Demo for Yochai" is reachable at /r/demo-for-yochai, and the link
 * has to survive being retyped from the name instead of copied.
 */
class SlugUtilsSpec extends AnyFunSuite with Matchers {

  /**
   * Route names covering every shape the lookup fold could treat differently from slugify: adjacent punctuation,
   * accented Latin (decomposable and not), non-Latin scripts, and a name past the length cap.
   */
  private val routeNames: Seq[String] = Seq(
    "Demo for Yochai",
    "St. Louis Walk",
    "Ballard Ave / 20th",
    "Jon's Walk (v2)",
    "Route 1, North",
    "Café Walk",
    "Ødegård Loop",
    "Straße Tour",
    "台北 散步",
    "Прогулка",
    "Route 17",
    "x" * 80
  )

  test("slugify lowercases, dashes separators, and strips Latin diacritics") {
    SlugUtils.slugify("Demo for Yochai") shouldBe "demo-for-yochai"
    SlugUtils.slugify("Café Walk!") shouldBe "cafe-walk"
    SlugUtils.slugify("  Ballard   Ave / 20th  ") shouldBe "ballard-ave-20th"
  }

  test("slugify never emits consecutive, leading, or trailing dashes — evolution 344's '--' invariant") {
    SlugUtils.slugify("--- Park  ---  Walk ---") shouldBe "park-walk"
    SlugUtils.slugify("a - b -- c") shouldBe "a-b-c"
  }

  test("slugify caps length without leaving a trailing dash, and falls back when nothing usable remains") {
    val long: String = SlugUtils.slugify("x" * 80)
    long.length shouldBe SlugUtils.MaxSlugLength
    // The cap must not land mid-separator: "<59 chars>-<more>" would otherwise truncate to a trailing dash.
    SlugUtils.slugify("y" * 59 + " tail") shouldBe "y" * 59
    SlugUtils.slugify("!!!") shouldBe "route"
    SlugUtils.slugify("!!!", "fallback") shouldBe "fallback"
  }

  test("slugify with an empty fallback yields nothing, so an all-punctuation URL can't hit a route named 'route'") {
    SlugUtils.slugify("!!!", fallback = "") shouldBe ""
  }

  test("canonicalizeForLookup folds the ways a share link gets retyped") {
    SlugUtils.canonicalizeForLookup("demo-for-Yochai") shouldBe "demo-for-yochai"
    SlugUtils.canonicalizeForLookup("Demo-For-Yochai") shouldBe "demo-for-yochai"
    SlugUtils.canonicalizeForLookup("Demo for Yochai") shouldBe "demo-for-yochai"
    SlugUtils.canonicalizeForLookup("demo_for_yochai") shouldBe "demo-for-yochai"
  }

  test("canonicalizeForLookup leaves every slug the app can store untouched") {
    Seq(
      "demo-for-yochai",                   // A runtime slug.
      "walk-2",                            // The uniquifier's suffix.
      "route-17",                          // The default name of an unnamed route.
      "park-walk--42",                     // Evolution 344's backfill dedupe suffix: runs must NOT collapse.
      "x" * SlugUtils.MaxSlugLength + "-2" // A uniquified slug past the cap: no truncation here.
    ).foreach { slug => SlugUtils.canonicalizeForLookup(slug) shouldBe slug }
  }

  test("canonicalizeForLookup returns empty when a URL holds no usable slug") {
    SlugUtils.canonicalizeForLookup("---") shouldBe ""
    SlugUtils.canonicalizeForLookup("") shouldBe ""
  }

  // The invariant the whole /r/ lookup rests on: folding a stored slug is a no-op, so the extra candidates can only
  // add matches, never miss one the literal slug would have found. Holds only because both helpers share one fold.
  test("a stored slug is already both folded and slugified — the lookup candidates can only add matches") {
    routeNames.foreach { name =>
      val stored: String = SlugUtils.slugify(name)
      withClue(s"name '$name' stores as '$stored': ") {
        SlugUtils.canonicalizeForLookup(stored) shouldBe stored
        SlugUtils.slugify(stored) shouldBe stored
      }
    }
  }

  // Retyping a name with punctuation is what the fold alone can't handle, since it deliberately preserves the '--'
  // that evolution 344's dedupe suffix needs. slugify is the candidate that closes the gap (RouteServiceImpl).
  test("a name retyped with its punctuation needs slugify as a candidate, not just the fold") {
    SlugUtils.slugify("St. Louis Walk") shouldBe "st-louis-walk"
    SlugUtils.canonicalizeForLookup("St. Louis Walk") shouldBe "st--louis-walk"
    SlugUtils.slugify("St. Louis Walk", fallback = "") shouldBe "st-louis-walk"

    SlugUtils.slugify("Jon's Walk (v2)") shouldBe "jon-s-walk-v2"
    SlugUtils.canonicalizeForLookup("Jon's Walk (v2)") shouldBe "jon-s-walk--v2"
    SlugUtils.slugify("Jon's Walk (v2)", fallback = "") shouldBe "jon-s-walk-v2"
  }
}
