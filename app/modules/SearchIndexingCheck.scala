package modules

import models.utils.SeoUtils
import modules.SearchIndexingCheck.{invalidStatuses, reportsAtBoot, verdict, ValidStatuses}
import play.api.{Configuration, Environment, Logger, Mode}

import javax.inject.{Inject, Singleton}
import scala.util.Try

/**
 * Boot-time check on the config that decides whether this deployment is crawled and indexed (#5120).
 *
 * Once the vhost `X-Robots-Tag` header is gone, `city-params.status.<cityId>` is the only thing keeping a private
 * deployment out of the index and a public one in it, and nothing else validates that string: an unrecognised value
 * reads as "not public", so a typo silently un-indexes a launched city. Logging the verdict makes the vhost rollout
 * verifiable from each instance's deploy log rather than by curling every host, and the public/total count is a
 * tripwire for a bulk flip — the Taiwan deployments all read `${city-params.status.taipei}`, so one edit moves six.
 *
 * Nothing here is fatal: a bad status costs discoverability, which is recoverable, while refusing to boot would take
 * the city offline — and one city's typo must never keep another city's instance down.
 */
@Singleton
class SearchIndexingCheck @Inject() (config: Configuration, environment: Environment) {
  private val logger = Logger(this.getClass)

  if (reportsAtBoot(environment.mode)) {
    // Wrapped so "nothing here is fatal" holds for config shapes we didn't anticipate: a wrongly-typed value throws
    // out of Configuration, and an eager singleton that throws stops every city built from that config.
    Try {
      invalidStatuses(config).foreach { invalid =>
        logger.error(
          s"city-params.status.${invalid.cityId} is ${invalid.value}, not one of " +
            s"${ValidStatuses.toSeq.sorted.mkString("/")}. Anything but \"public\" reads as private, so that city " +
            s"serves noindex and no sitemap."
        )
      }
      logger.info(verdict(config))
    }.failed.foreach(e => logger.error(s"Could not report search-indexing config: ${e.getMessage}", e))
  }
}

/**
 * The check's pure logic, split from the boot wiring so `SearchIndexingCheckSpec` can pin it without booting an
 * application — including against the bundled cityparams, which makes the repo's own status block lint-checked.
 */
object SearchIndexingCheck {

  /** The only two values `city-params.status.<cityId>` may take. */
  val ValidStatuses: Set[String] = Set("public", "private")

  /**
   * A city whose configured status is unusable.
   *
   * @param value The offending value, quoted, or `<missing>` where the key is absent.
   */
  case class InvalidStatus(cityId: String, value: String)

  /**
   * Every city in `city-params.city-ids` whose status is absent or not one of [[ValidStatuses]].
   *
   * Sweeps all cities, not just the one this instance runs, so a typo surfaces on whichever city boots first rather
   * than waiting for the affected deployment to restart.
   *
   * @return One entry per offending city, in configured order; empty when every status is valid.
   */
  def invalidStatuses(config: Configuration): Seq[InvalidStatus] =
    config.getOptional[Seq[String]]("city-params.city-ids").getOrElse(Seq.empty).flatMap { cityId =>
      // Try, because a status written as an object or list throws WrongType rather than returning None.
      Try(config.getOptional[String](s"city-params.status.$cityId")).toOption.flatten match {
        case Some(status) if ValidStatuses.contains(status) => None
        case Some(status)                                   => Some(InvalidStatus(cityId, s""""$status""""))
        case None                                           => Some(InvalidStatus(cityId, "<missing>"))
      }
    }

  /**
   * Whether this run reports at boot. Test mode is skipped: a suite that boots an app per spec would repeat the
   * report in every log. Extracted so a test pins the direction of that condition.
   */
  def reportsAtBoot(mode: Mode): Boolean = mode != Mode.Test

  /**
   * The one-line indexing verdict for this deployment, naming all three inputs so the log answers "why" on its own.
   *
   * @return A log line stating whether this deployment is indexable and on what basis.
   */
  def verdict(config: Configuration): String = {
    val cityId: String   = config.get[String]("city-id")
    val envType: String  = config.get[String]("environment-type")
    val status: String   = config.getOptional[String](s"city-params.status.$cityId").getOrElse("<missing>")
    val panoType: String = config.getOptional[String](s"city-params.pano-viewer-type.$cityId").getOrElse("<missing>")
    // From isIndexable(config), not the display strings below: "<missing>" would sail past the != infra3d test and
    // log INDEXABLE for a deployment the filter treats as private.
    val indexable            = SeoUtils.isIndexable(config)
    val cityIds: Seq[String] = config.get[Seq[String]]("city-params.city-ids")
    val publicCount: Int = cityIds.count(id => config.getOptional[String](s"city-params.status.$id").contains("public"))
    val state: String    = if (indexable) "INDEXABLE" else "NOT indexable"
    s"Search indexing: $cityId is $state (environment-type=$envType, status=$status, pano-viewer-type=$panoType); " +
      s"$publicCount of ${cityIds.size} configured cities are public. A vhost X-Robots-Tag header can still " +
      s"override this — see docs/deployment-and-stages.md."
  }
}
