package forms

import scala.util.matching.Regex

/**
 * Password rules shared by every surface that creates a password (sign-up dialog, full-page, mobile).
 *
 * Single source of truth per CLAUDE.md's backend-is-source-of-truth rule: the Play form constraint composes from
 * these values, and the sign-up views inject `checklist` into `data-*` attributes so the frontend's live checklist
 * reads the same rules instead of re-declaring them (#4375).
 */
object PasswordPolicy {
  val minLength: Int = 8

  /** Whole-password constraint used by `SignUpForm`; the per-rule breakdown below must stay its decomposition. */
  val pattern: Regex = """^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).*$""".r

  /**
   * Per-rule checks for the live sign-up checklist, as (message key, JS-compatible regex source) pairs.
   *
   * The length rule is derived from `minLength` so the two can't drift.
   */
  val checklist: Seq[(String, String)] = Seq(
    ("authenticate.pw.rule.length", s".{$minLength,}"),
    ("authenticate.pw.rule.uppercase", "[A-Z]"),
    ("authenticate.pw.rule.lowercase", "[a-z]"),
    ("authenticate.pw.rule.digit", "\\d")
  )
}

/**
 * Username rules shared by sign-up (`SignUpForm`) and rename (`UserService.changeUsername`) so the two flows can't
 * drift apart (#4375).
 */
object UsernamePolicy {
  val minLength: Int = 3
  val maxLength: Int = 30

  /** Charset-only rule; length is enforced separately so users get a specific error. */
  val pattern: Regex = "^[A-Za-z0-9_-]+$".r

  /** Complete rule (charset + length) as a JS-compatible regex source for live frontend feedback. */
  val jsPattern: String = s"^[A-Za-z0-9_-]{$minLength,$maxLength}$$"
}
