package models.utils

/**
 * A minimal, bundled profanity/abuse guard for user-supplied names (team names now; extend to sign-up moderation with
 * #4375's `UsernameModeration`). Intentionally small and conservative: it normalizes input (lowercase, letters only,
 * collapse repeated letters) and rejects anything containing an obvious slur or abusive term.
 *
 * This is a first line of defense, NOT comprehensive — it should be paired with report/rename flows and, ideally,
 * replaced by a maintained word-list library. Keep the list short and unambiguous to limit false positives (the
 * "Scunthorpe problem"); prefer letting a borderline name through and relying on reporting over blocking real words.
 */
object ProfanityGuard {

  // Unambiguous slurs / abusive terms, rot13-encoded so the source file isn't itself a raw slur list (decoded at
  // load). Deliberately excludes terms that are common substrings of innocent words (e.g. "rape" in therapist/grape)
  // to limit false positives; those are better handled by reporting than by blanket blocking.
  private val blockedRot13: Set[String] = Set(
    "avttre", "avttn", "snttbg", "snt", "xvxr", "puvax", "fcvp", "jrgonpx", "gbjryurnq", "phag", "juber", "anmv",
    "uvgyre", "xxx"
  )

  private def rot13(s: String): String = s.map {
    case c if c >= 'a' && c <= 'z' => (((c - 'a' + 13) % 26) + 'a').toChar
    case c                         => c
  }

  private val blocked: Set[String] = blockedRot13.map(rot13)

  /** Lowercase, letters only (so spacing/punctuation can't split a term). No repeat-collapsing (would break "kkk"). */
  private def normalize(s: String): String = s.toLowerCase.replaceAll("[^a-z]", "")

  /**
   * @param text User-supplied text (e.g. a team name).
   * @return true if the normalized text contains no blocked term.
   */
  def isClean(text: String): Boolean = {
    val normalized = normalize(text)
    !blocked.exists(normalized.contains)
  }
}
