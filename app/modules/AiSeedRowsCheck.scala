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
 * evolutions have been applied by the time this runs, and the check never sees a schema mid-evolution. Its `upToDate`
 * is the belt to that brace: a deployment that applies evolutions some other way gets the check skipped, not run
 * against a schema that may still lack a column the seed writes.
 *
 * The seed is awaited rather than left to run: the rows must exist before the first request, and a boot that is
 * stopped at once (a spec's throwaway app) would otherwise see the write rejected by a pool already shut down. It is
 * one small transaction, so the wait is milliseconds.
 *
 * Nothing here is fatal: a failed seed costs one city's AI visibility, which the next boot retries, while an eager
 * singleton that throws keeps that city down.
 */
@Singleton
class AiSeedRowsCheck @Inject() (aiService: AiService, evolutions: ApplicationEvolutions) {
  private val logger = Logger(this.getClass)

  if (!evolutions.upToDate) {
    logger.warn("SidewalkAI seed rows: skipped, the schema has evolutions pending.")
  } else {
    Try(Await.result(aiService.ensureSeedRows(), 30.seconds)) match {
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
        logger.error(
          s"Could not seed the SidewalkAI rows; AI labels may be invisible here until the next boot: ${e.getMessage}",
          e
        )
    }
  }
}
