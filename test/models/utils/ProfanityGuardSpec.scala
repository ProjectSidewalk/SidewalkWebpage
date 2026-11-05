package models.utils

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pins both directions, because the false-positive half is the one that costs a real user their name: blocked terms
 * are caught through the usual dodges, and innocent text is not.
 */
class ProfanityGuardSpec extends AnyFunSuite with Matchers {

  test("clean text passes") {
    ProfanityGuard.isClean("Ms. Rivera's 7th Grade") shouldBe true
    ProfanityGuard.isClean("UW Mapping Club") shouldBe true
    ProfanityGuard.isClean("") shouldBe true
  }

  test("common profanity is blocked, including as a substring of another word") {
    ProfanityGuard.isClean("what the shit") shouldBe false
    ProfanityGuard.isClean("bullshit") shouldBe false // 'shit' substring
    ProfanityGuard.isClean("you bitch") shouldBe false
    ProfanityGuard.isClean("damn") shouldBe false
  }

  test("terms spelled out with spaces or punctuation are caught") {
    ProfanityGuard.isClean("s h i t") shouldBe false
    ProfanityGuard.isClean("s-h-i-t") shouldBe false
    ProfanityGuard.isClean("B.I.T.C.H") shouldBe false
    ProfanityGuard.isClean("sh it") shouldBe false
  }

  test("leetspeak and lookalike letters from other alphabets are caught") {
    ProfanityGuard.isClean("sh1t") shouldBe false
    ProfanityGuard.isClean("$h1t") shouldBe false
    ProfanityGuard.isClean("b!tch") shouldBe false
    ProfanityGuard.isClean("ѕhit") shouldBe false         // Cyrillic 'ѕ'.
    ProfanityGuard.isClean("shıt") shouldBe false         // Dotless 'ı'.
    ProfanityGuard.isClean("shít") shouldBe false         // Accented 'í' folds back to 'i'.
    ProfanityGuard.isClean("Ñuñoa Mappers") shouldBe true // Folding accents must not invent a blocked term.
  }

  test("stretched-out letters are caught, and a term spelled with a doubled letter still works") {
    ProfanityGuard.isClean("shiiiiit") shouldBe false
    ProfanityGuard.isClean("fuuuuck") shouldBe false
    ProfanityGuard.isClean("bollocks") shouldBe false
  }

  test("innocent words that merely CONTAIN an excluded term are allowed (no false positives)") {
    ProfanityGuard.isClean("classic pass in the embassy") shouldBe true // 'ass' excluded
    ProfanityGuard.isClean("grape and therapist") shouldBe true         // 'rape' excluded
    ProfanityGuard.isClean("peacock in the cockpit") shouldBe true      // 'cock' excluded
    ProfanityGuard.isClean("Emily Dickinson") shouldBe true             // 'dick' excluded
    ProfanityGuard.isClean("Spicy Mappers") shouldBe true               // 'spic' excluded
  }

  test("a short term is not matched against letters that leetspeak invented, only against typed ones") {
    // Reading every digit as a letter turns random ids into words: these hex-tagged names all produce "fag".
    ProfanityGuard.isClean("spec94f49d11") shouldBe true
    ProfanityGuard.isClean("spec1c3f46bd") shouldBe true
    // The deliberate cost: a three-letter slur typed in leetspeak gets through, and reporting catches it.
    ProfanityGuard.isClean("f4g") shouldBe true
  }

  test("ordinary neighboring words are not glued into a slur") {
    ProfanityGuard.isClean("Sofa Gallery") shouldBe true // 'sofagallery' would contain a blocked term.
    ProfanityGuard.isClean("Beacon Hill Walkers") shouldBe true
    ProfanityGuard.isClean("map-nerd-42") shouldBe true
  }

  test("a run of nothing but tiny words is still glued, false positives included") {
    // The known cost of catching "s h i t": prose that strings short words together can be refused, and the author
    // isn't told which ones did it. Pinned so the limitation stays visible rather than being assumed fixed.
    ProfanityGuard.isClean("The ramp up is so steep.") shouldBe false
  }
}
