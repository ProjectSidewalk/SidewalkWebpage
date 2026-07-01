package models.utils

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pure (no DB, no app boot) unit test for the team-name / username moderation guard.
 *
 * Pins both directions: blocked terms are caught even when spacing/punctuation is inserted (the normalize step), and
 * the deliberately-excluded innocent substrings ("class", "grape", "peacock", "Dickinson") are NOT false-positived.
 * To be unified with the sign-up moderation in #4375.
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

  test("normalize catches terms split by spaces or punctuation (letters-only match)") {
    ProfanityGuard.isClean("s h i t") shouldBe false
    ProfanityGuard.isClean("s-h-i-t") shouldBe false
    ProfanityGuard.isClean("B.I.T.C.H") shouldBe false
  }

  test("innocent words that merely CONTAIN an excluded term are allowed (no false positives)") {
    ProfanityGuard.isClean("classic pass in the embassy") shouldBe true // 'ass' excluded
    ProfanityGuard.isClean("grape and therapist") shouldBe true         // 'rape' excluded
    ProfanityGuard.isClean("peacock in the cockpit") shouldBe true      // 'cock' excluded
    ProfanityGuard.isClean("Emily Dickinson") shouldBe true             // 'dick' excluded
  }
}
