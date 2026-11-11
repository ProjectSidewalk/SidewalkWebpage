package service

import util.SidewalkSpec

/**
 * Pure tests for the re-audit backlog (#5828): the derived km and the "reaudit_backlog" flag's two gates.
 *
 * Synthetic scorecards rather than the DB, because the dev DB has no audits on outdated imagery, so mapped and current
 * km are equal there and neither gate would ever be exercised.
 */
class ReauditBacklogSpec extends SidewalkSpec {

  /** A scorecard that is all zeros except its mapped and current km, the only fields the backlog reads. */
  private def scorecard(mappedKm: Double, auditedKm: Double): CityScorecard =
    CityScorecard(
      cityId = "test", totalStreets = 0, auditedStreets = 0, coverage = 0.0, totalKm = mappedKm, auditedKm = auditedKm,
      walkedKm = mappedKm, mappedKm = mappedKm, totalLabels = 0, aiLabels = 0, labelsWithSeverity = 0,
      labelsSeverityEligible = 0, labelsWithTags = 0, labelsTagEligible = 0, labelsValidated = 0, totalValidations = 0,
      validationsAgree = 0, validationsDisagree = 0, aiValidations = 0, byLabelType = Map.empty, activeContributors = 0,
      lowQualityContributors = 0, labels7d = 0, labels30d = 0, validations7d = 0, validations30d = 0, audits7d = 0,
      audits30d = 0, lastActivity = None, weeklyTrend = Seq.empty, labelsPerUserMedian = 0.0, labelsPerUserP90 = 0.0,
      numLabelers = 0, validationsPerUserMedian = 0.0, validationsPerUserP90 = 0.0, numValidators = 0,
      validationSecondsMedian = 0.0
    )

  "ConfigService.reauditKm" should {
    "be mapped minus current" in {
      ConfigService.reauditKm(scorecard(mappedKm = 20.0, auditedKm = 12.5)) mustBe 7.5
    }

    "clamp float noise below zero to zero" in {
      ConfigService.reauditKm(scorecard(mappedKm = 10.0, auditedKm = 10.0000001)) mustBe 0.0
    }
  }

  "ConfigService.hasReauditBacklog" should {
    "flag a city at exactly the share threshold once it has enough mapped km" in {
      val mapped = ConfigService.MinMappedKmForReauditFlag
      ConfigService.hasReauditBacklog(
        scorecard(mapped, auditedKm = mapped * (1 - ConfigService.ReauditBacklogShare))
      ) mustBe true
    }

    "not flag a city just under the share threshold" in {
      ConfigService.hasReauditBacklog(scorecard(mappedKm = 100.0, auditedKm = 61.0)) mustBe false
    }

    "never flag a city with too little mapped km, however stale" in {
      val mapped = ConfigService.MinMappedKmForReauditFlag - 0.1
      ConfigService.hasReauditBacklog(scorecard(mapped, auditedKm = 0.0)) mustBe false
    }
  }
}
