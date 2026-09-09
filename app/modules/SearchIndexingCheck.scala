package modules

import models.utils.SeoUtils
import modules.SearchIndexingCheck.{invalidStatuses, verdict}
import play.api.{Configuration, Environment, Logger, Mode}

import javax.inject.{Inject, Singleton}

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

  // Skipped under Mode.Test: a suite that boots an application per spec would repeat this in every log.
  if (environment.mode != Mode.Test) {
    invalidStatuses(config).foreach { invalid =>
      logger.error(
        s"city-params.status.${invalid.cityId} is ${invalid.value}, not one of " +
          s"${SearchIndexingCheck.ValidStatuses.toSeq.sorted.mkString("/")}. Anything but \"public\" reads as " +
          s"private, so that city serves noindex and no sitemap."
      )
    }
    logger.info(verdict(config))
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
    config.get[Seq[String]]("city-params.city-ids").flatMap { cityId =>
      config.getOptional[String](s"city-params.status.$cityId") match {
        case Some(status) if ValidStatuses.contains(status) => None
        case Some(status)                                   => Some(InvalidStatus(cityId, s""""$status""""))
        case None                                           => Some(InvalidStatus(cityId, "<missing>"))
      }
    }

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
    val indexable        = SeoUtils.isIndexable(envType, status, panoType)
    val publicCount: Int = config
      .get[Seq[String]]("city-params.city-ids")
      .count(id => config.getOptional[String](s"city-params.status.$id").contains("public"))
    val totalCount: Int = config.get[Seq[String]]("city-params.city-ids").size
    val state: String   = if (indexable) "INDEXABLE" else "NOT indexable"
    s"Search indexing: $cityId is $state (environment-type=$envType, status=$status, pano-viewer-type=$panoType); " +
      s"$publicCount of $totalCount configured cities are public. A vhost X-Robots-Tag header can still override " +
      s"this — see docs/deployment-and-stages.md."
  }
}
