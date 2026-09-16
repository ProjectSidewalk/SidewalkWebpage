package modules

import play.api.Logger
import play.api.db.evolutions.ApplicationEvolutions
import service.AiService

import javax.inject.{Inject, Singleton}
import scala.concurrent.Await
import scala.concurrent.duration._
import scala.util.{Failure, Success, Try}

/**
 * Boot-time self-heal for the SidewalkAI account's per-schema rows (#5349).
 *
 * 281.sql seeded the AI's user_stat row and its `aiValidation` missions once per schema, so a schema that never ran
 * 281 as an evolution — one cloned from a donor city by create-new-schema.sh, or restored from an onboarding dump,
 * both of which carry 281 as applied — has none of them, and no runtime path creates them. Seeding here rather than
 * in the clone or the dump means every way a schema can come into being is covered, including the cities already
 * deployed without the rows, which heal on their next boot. [[AiService.ensureSeedRows]] has the details.
 *
 * `ApplicationEvolutions` is injected for ordering: Guice constructs a dependency before its dependent, so the pending
 * evolutions have been applied by the time this runs, and the repair never sees a schema mid-evolution. Its `upToDate`
 * covers the one boot that survives with evolutions still pending — dev mode with `autoApply` off, where Play boots
 * and serves the "apply evolutions" page instead of throwing (every other mode either applies them or fails the boot;
 * with evolutions disabled it reads true, so this is no guard against a schema managed some other way). This repo
 * turns autoApply on, so the skip is not expected to fire; when it does, a restart is what re-runs the seed.
 *
 * The seed is awaited rather than left to run: the rows must exist before the first request, and a boot that is
 * stopped at once (a spec's throwaway app) would otherwise see the write rejected by a pool already shut down. It is
 * one small transaction, so the wait is milliseconds; the limit sits above Hikari's 30 s connectionTimeout so that a
 * starved pool reports as Hikari's diagnostic rather than a bare timeout.
 *
 * Nothing here is fatal: a failed seed costs one city's AI visibility, which the next boot retries, while an eager
 * singleton that throws keeps that city down.
 */
@Singleton
class AiSeedRowsRepair @Inject() (aiService: AiService, evolutions: ApplicationEvolutions) {
  private val logger = Logger(this.getClass)

  if (!evolutions.upToDate) {
    logger.warn("SidewalkAI seed rows: skipped, the schema has evolutions pending; restart once they are applied.")
  } else {
    Try(Await.result(aiService.ensureSeedRows(), 60.seconds)) match {
      case Success(seeded) if seeded.nothingInserted => logger.info("SidewalkAI seed rows: present.")
      case Success(seeded)                           =>
        val what = Seq(
          Option.when(seeded.statRowInserted)("its user_stat row"),
          Option.when(seeded.missionsInserted.nonEmpty)(
            s"aiValidation missions for ${seeded.missionsInserted.mkString(", ")}"
          )
        ).flatten.mkString(" and ")
        logger.warn(s"SidewalkAI seed rows: inserted $what. This schema was created without 281.sql's rows (#5349).")
      case Failure(e) =>
        // A foreign-key failure means sidewalk_login has no SidewalkAI account (a users dump predating 281.sql), which
        // no retry fixes: the same line recurs every boot until the account is added.
        logger.error(
          s"Could not seed the SidewalkAI rows, so AI labels are invisible here. If this is a foreign-key failure, " +
            s"sidewalk_login.sidewalk_user lacks the SidewalkAI account (see 281.sql): ${e.getMessage}",
          e
        )
    }
  }
}
