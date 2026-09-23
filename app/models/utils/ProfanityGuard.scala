package models.utils

import java.text.Normalizer

/**
 * Profanity/abuse guard for user-supplied public text: usernames, team names, stories, and route names (#4375).
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
    'e' -> "3£€еε",
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

  // A "word" this short is more likely a piece of something split up than a word of its own.
  private val maxShortWordLength: Int = 2

  // Reading digits as letters invents letters nobody typed, so a short term turns up by sheer chance — a random hex
  // id reads as "...fag..." often enough to matter. Shorter terms are only matched against what was actually typed.
  private val minLeetspeakTermLength: Int = 4

  // Only a run longer than any a real word doubles up is treated as stretching. Collapsing doubles instead would
  // read "shiitake" as "shitake", "snazziest" as "snaziest" and "whittler" as "whitler" — all blocked, none diagnosable.
  private val minStretchedRun: Int = 3

  /** Collapses runs of 3+ of the same letter to one, so "shiiiiit" reads as "shit" but "shiitake" is left alone. */
  private def unstretch(s: String): String = {
    val out = new StringBuilder
    var i   = 0
    while (i < s.length) {
      var run = 1
      while (i + run < s.length && s(i + run) == s(i)) run += 1
      out ++= s(i).toString * (if (run >= minStretchedRun) 1 else run)
      i += run
    }
    out.toString
  }

  /**
   * @param literal   Every term, looked for in the word as-is.
   * @param unstretched Only terms spelling no doubled letter: collapsing "kkk" leaves "k", which matches anything.
   */
  private case class TermSet(literal: Set[String], unstretched: Set[String]) {
    def matches(word: String): Boolean =
      literal.exists(word.contains) || unstretched.exists(unstretch(word).contains)
  }

  private object TermSet {
    def of(terms: Set[String]): TermSet = TermSet(terms, terms.filter(term => unstretch(term) == term))
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

  /**
   * The ways a word could have been broken up to hide it, glued back together: "s h i t" and "shi t".
   *
   * Only joins where a short word is involved, so ordinary neighbours stay apart — "Sofa Gallery" must not read as
   * a slur. The cost is that a run of short words still joins, so "the ramp up is so steep" is refused.
   */
  private def hiddenJoins(words: Seq[String]): Seq[String] = {
    def isShort(word: String) = word.length <= maxShortWordLength
    val runs                  = words
      .foldRight(List(List.empty[String])) { (word, acc) =>
        if (isShort(word)) (word :: acc.head) :: acc.tail else Nil :: acc
      }
      .filter(_.length > 1)
      .map(_.mkString)
    val pairs = words.sliding(2).collect { case Seq(a, b) if isShort(a) || isShort(b) => a + b }.toSeq
    runs ++ pairs
  }

  /**
   * @param text User-supplied public text (a username, team name, route name, story, …).
   * @return true if no word in the text folds down to something containing a blocked term.
   */
  def isClean(text: String): Boolean = {
    def clean(readDigitsAsLetters: Boolean, terms: TermSet): Boolean = {
      val words = toWords(text, readDigitsAsLetters)
      !(words ++ hiddenJoins(words)).exists(terms.matches)
    }
    clean(readDigitsAsLetters = false, typedTerms) && clean(readDigitsAsLetters = true, leetspeakTerms)
  }
}
