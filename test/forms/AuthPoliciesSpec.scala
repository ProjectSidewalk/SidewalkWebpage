package forms

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pure (no DB, no app boot) unit test for the shared credential rules (#4375).
 *
 * The load-bearing invariant: the per-rule password checklist that the sign-up UI renders (and evaluates live in the
 * browser via `RegExp.test`) must accept a password exactly when the whole-form `PasswordPolicy.pattern` +
 * minLength do. If they ever drift, the checklist could go all-green on a password the server then rejects (or vice
 * versa). This test pins that equivalence, plus the username charset/length contract shared by sign-up and rename.
 */
class AuthPoliciesSpec extends AnyFunSuite with Matchers {

  /** Mirrors the browser's `new RegExp(src).test(pw)` (a partial match), which is how the live checklist evaluates. */
  private def jsTest(regexSource: String, pw: String): Boolean = regexSource.r.findFirstIn(pw).isDefined

  /** True when every checklist rule passes — i.e. the live UI would show all dots green. */
  private def allChecklistRulesMet(pw: String): Boolean =
    PasswordPolicy.checklist.forall { case (_, regexSource) => jsTest(regexSource, pw) }

  /** True when the server-side form constraints (whole-password pattern + min length) accept the password. */
  private def serverAccepts(pw: String): Boolean =
    pw.length >= PasswordPolicy.minLength && PasswordPolicy.pattern.matches(pw)

  private val passwordSamples = Seq(
    "", "short1A",               // 7 chars: too short, otherwise complete
    "TestPass1",                 // valid
    "testpass1",                 // no uppercase
    "TESTPASS1",                 // no lowercase
    "TestPassword",              // no digit
    "aB3aB3aB",                  // exactly 8, all classes
    "correcthorsebatterystaple", // long but no upper/digit
    "P@ssw0rd!",                 // symbols present, all classes
    "        1Aa"                // leading spaces then all classes (>=8)
  )

  test("the live checklist and the server rule accept exactly the same passwords (no drift)") {
    passwordSamples.foreach { pw =>
      withClue(s"password=[$pw]: checklist-all-green must equal server-accepts: ") {
        allChecklistRulesMet(pw) shouldBe serverAccepts(pw)
      }
    }
  }

  test("the checklist has one rule per requirement, keyed on real message keys") {
    PasswordPolicy.checklist.map(_._1) shouldBe Seq(
      "authenticate.pw.rule.length",
      "authenticate.pw.rule.uppercase",
      "authenticate.pw.rule.lowercase",
      "authenticate.pw.rule.digit"
    )
  }

  test("the length rule tracks minLength so the two can't drift") {
    val lengthRuleSource = PasswordPolicy.checklist.head._2
    jsTest(lengthRuleSource, "x" * (PasswordPolicy.minLength - 1)) shouldBe false
    jsTest(lengthRuleSource, "x" * PasswordPolicy.minLength) shouldBe true
  }

  test("username charset accepts letters, numbers, hyphens, and underscores") {
    Seq("abc", "ABC123", "a-b_c", "user-name_1", "___", "---").foreach { name =>
      withClue(s"[$name] should match charset: ")(UsernamePolicy.pattern.matches(name) shouldBe true)
    }
  }

  test("username charset rejects spaces, punctuation, and other symbols") {
    Seq("has space", "bang!", "dot.dot", "emoji😀", "slash/", "tab\tx", "a+b").foreach { name =>
      withClue(s"[$name] should be rejected: ")(UsernamePolicy.pattern.matches(name) shouldBe false)
    }
  }

  test("the JS username pattern agrees with the charset + length contract") {
    val jsRegex                             = UsernamePolicy.jsPattern
    def jsMatches(s: String): Boolean       = jsRegex.r.findFirstIn(s).isDefined
    def contractAccepts(s: String): Boolean =
      s.length >= UsernamePolicy.minLength && s.length <= UsernamePolicy.maxLength && UsernamePolicy.pattern.matches(s)

    val samples = Seq(
      "ab",
      "abc",
      "a" * UsernamePolicy.maxLength,
      "a" * (UsernamePolicy.maxLength + 1),
      "good-name_1",
      "bad name",
      "bad!",
      ""
    )
    samples.foreach { s =>
      withClue(s"[$s]: JS pattern must agree with the server contract: ")(jsMatches(s) shouldBe contractAccepts(s))
    }
  }
}
