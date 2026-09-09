package filters

import models.utils.SeoUtils
import org.apache.pekko.stream.Materializer
import play.api.Configuration
import play.api.mvc.{Filter, RequestHeader, Result}

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

/**
 * Sends `X-Robots-Tag: noindex, nofollow` from a deployment that must not be indexed ([[SeoUtils.isIndexable]], #5120).
 *
 * A header rather than only seoHead's `<meta name="robots">`, which reaches HTML pages alone: static assets, API
 * bodies, redirects, and error pages rendered outside a Twirl view carry no head.
 *
 * **Must stay first in `play.filters.enabled`.** Play composes that list outermost-first, so anything a filter ahead
 * of it short-circuits — a CSRF or AllowedHosts rejection — never reaches it. `SeoPrivateCitySpec` pins the ordering.
 *
 * The header is omitted entirely on an indexable deployment: `X-Robots-Tag: all` says nothing a missing header does
 * not, and an absent header is one less thing to get wrong in front of a crawler.
 *
 * @param config Application configuration; the indexability predicate is static, so it is evaluated once here.
 */
@Singleton
class SeoRobotsFilter @Inject() (config: Configuration)(implicit val mat: Materializer, ec: ExecutionContext)
    extends Filter {

  /** Static per-deployment config, so this is decided once at startup rather than per request. */
  private val indexable: Boolean = SeoUtils.isIndexable(config)

  def apply(next: RequestHeader => Future[Result])(request: RequestHeader): Future[Result] = {
    if (indexable) next(request)
    else next(request).map(_.withHeaders("X-Robots-Tag" -> "noindex, nofollow"))
  }
}
