package models.user

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/** Pins the validator reliability formula (#5063). Pure math, no DB. */
class ValidatorReliabilitySpec extends AnyFunSuite with Matchers {

  private val Tolerance = 1e-4
  private val Prior     = ValidatorReliability.PriorVotes

  test("a validator with nothing graded has no score") {
    ValidatorReliability.score(0, 0, 0.8) shouldBe None
  }

  test("a validator with few graded votes sits near the city's rate, whatever their own record") {
    ValidatorReliability.score(1, 1, 0.8).get shouldBe 0.8 +- 0.05
    ValidatorReliability.score(0, 1, 0.8).get shouldBe 0.8 +- 0.05
  }

  test("a validator with many graded votes is scored on their own record") {
    ValidatorReliability.score(900, 1000, 0.5).get shouldBe 0.9 +- 0.02
    ValidatorReliability.score(300, 1000, 0.8).get shouldBe 0.3 +- 0.02
  }

  test("the score always lies between the validator's own match rate and the city's") {
    for {
      matched  <- Seq(0, 3, 5)
      cityRate <- Seq(0.2, 0.6, 1.0)
    } {
      val own   = matched / 5.0
      val score = ValidatorReliability.score(matched, 5, cityRate).get
      score should (be >= math.min(own, cityRate) - Tolerance and be <= math.max(own, cityRate) + Tolerance)
    }
  }

  test("at the prior's vote count the score is halfway between the validator's match rate and the city's") {
    ValidatorReliability.score(Prior, Prior, 0.6).get shouldBe 0.8 +- Tolerance
  }
}
