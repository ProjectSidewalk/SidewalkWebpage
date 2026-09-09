package models.utils

import java.text.Normalizer

/**
 * Profanity/abuse guard for user-supplied public text: usernames, team names and descriptions, stories, and route
 * names. One guard for every surface, so the rules can't drift apart (#4375).
 *
 * Matching is per word rather than over the whole string, so ordinary neighbors are never glued into a slur —
 * "Sofa Gallery" must not read as one.
 *
 * A first line of defense, NOT comprehensive — pair it with report/rename flows. Keep the list short and
 * unambiguous (the "Scunthorpe problem"); prefer letting a borderline name through over blocking a real word.
 */
object ProfanityGuard {

  // Rot13-encoded so the source file isn't itself a raw slur list. Terms that are common substrings of innocent
  // words are deliberately left out — "ass" (class, embassy), "rape" (grape, therapist), "cock" (peacock), "dick"
  // (Dickinson), and the anti-Hispanic slur that also starts "spicy"; reporting + rename handles those better.
  private val blockedRot13: Set[String] = Set(
    // Slurs / hate terms.
    "avttre", "avttn", "snttbg", "snt", "xvxr", "puvax", "jrgonpx", "gbjryurnq", "phag", "juber", "anmv", "uvgyre",
    "xxx", "genaal",
    // Common profanity.
    "shpx", "fuvg", "ovgpu", "onfgneq", "nffubyr", "qvpxurnq", "pbpxfhpxre", "obyybpxf", "jnax", "jnaxre", "gjng",
    "cvff", "fyhg", "qbhpur", "qnza"
  )

  private def rot13(s: String): String = s.map {
    case c if c >= 'a' && c <= 'z' => (((c - 'a' + 13) % 26) + 'a').toChar
    case c                         => c
  }

  // Read each row as "these all stand for 'a'". Stroked/dotless Latin letters carry no accent for `toWords` to strip.
  private val standIns: Map[Char, Char] = Seq(
    'a' -> "4@аα",
    'b' -> "8вβ",
    'c' -> "(<с",
    'd' -> "đ",
    'e' -> "3£€еёε",
    'g' -> "69",
    'h' -> "нħ",
    'i' -> "1!|іιı",
    'j' -> "ј",
    'k' -> "кκ",
    'l' -> "ł",
    'm' -> "м",
    'o' -> "0оοø",
    'p' -> "рρ",
    's' -> "5$ѕ",
    't' -> "7+тτŧ",
    'u' -> "υ",
    'v' -> "ν",
    'x' -> "хχ",
    'y' -> "у"
  ).flatMap { case (letter, chars) => chars.map(_ -> letter) }.toMap

  private val symbolStandIns: Map[Char, Char] = standIns.filterNot(_._1.isDigit)

  // A "word" this short is more likely one letter of something spelled out than a word of its own.
  private val maxSpelledOutPieceLength: Int = 2

  // Reading digits as letters invents letters nobody typed, so a short term turns up by sheer chance — a random hex
  // id reads as "...fag..." often enough to matter. Shorter terms are only matched against what was actually typed.
  private val minLeetspeakTermLength: Int = 4

  /** Squashes each run of the same letter down to one, so "fuuuuck" reads as "fuck". */
  private def squashRepeats(s: String): String =
    s.foldLeft(new StringBuilder)((out, c) => if (out.lastOption.contains(c)) out else out += c).toString

  /**
   * @param literal  Every term, looked for in the word as-is.
   * @param squashed Only terms spelling no doubled letter: squashing "kkk" leaves "k", which matches almost anything.
   */
  private case class TermSet(literal: Set[String], squashed: Set[String]) {
    def matches(word: String): Boolean =
      literal.exists(word.contains) || squashed.exists(squashRepeats(word).contains)
  }

  private object TermSet {
    def of(terms: Set[String]): TermSet = TermSet(terms, terms.filter(term => squashRepeats(term) == term))
  }

  private val typedTerms: TermSet     = TermSet.of(blockedRot13.map(rot13))
  private val leetspeakTerms: TermSet = TermSet.of(typedTerms.literal.filter(_.length >= minLeetspeakTermLength))

  /**
   * Folds text down to bare a-z words: accents stripped, stand-ins mapped back, anything else a word break.
   *
   * @param readDigitsAsLetters Whether digits become the letters they imitate ("sh1t" -> "shit"), or are dropped.
   */
  private def toWords(s: String, readDigitsAsLetters: Boolean): Seq[String] = {
    // Marks are dropped rather than treated as word breaks, which would split "shít" into two harmless pieces.
    val deaccented = Normalizer.normalize(s.toLowerCase, Normalizer.Form.NFKD).replaceAll("\\p{M}", "")
    val stands     = if (readDigitsAsLetters) standIns else symbolStandIns
    deaccented
      .map(c => stands.getOrElse(c, c))
      .map(c => if (c >= 'a' && c <= 'z') c else ' ')
      .split(' ')
      .filter(_.nonEmpty)
      .toSeq
  }

  /** Glues each stretch of very short words together, so "s h i t" reads as what it spells. */
  private def spelledOutRuns(words: Seq[String]): Seq[String] = {
    words
      .foldRight(List(List.empty[String])) { (word, runs) =>
        if (word.length > maxSpelledOutPieceLength) Nil :: runs else (word :: runs.head) :: runs.tail
      }
      .filter(_.length > 1)
      .map(_.mkString)
  }

  /**
   * @param text User-supplied public text (a username, team name, route name, story, …).
   * @return true if no word in the text folds down to something containing a blocked term.
   */
  def isClean(text: String): Boolean = {
    def clean(readDigitsAsLetters: Boolean, terms: TermSet): Boolean = {
      val words = toWords(text, readDigitsAsLetters)
      !(words ++ spelledOutRuns(words)).exists(terms.matches)
    }
    clean(readDigitsAsLetters = false, typedTerms) && clean(readDigitsAsLetters = true, leetspeakTerms)
  }
}
