package filters

import models.utils.SeoUtils
import org.apache.pekko.stream.Materializer
import play.api.Configuration
import play.api.mvc.{Filter, RequestHeader, Result}

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

/**
 * Sends `X-Robots-Tag: noindex, nofollow` on every response from a deployment that must not be indexed (#5120).
 *
 * This replaces the identical header that `lab/sidewalk-tools` hardcoded into every provisioned Apache vhost, which
 * applied to prod and non-prod alike and so suppressed all of production for years. Doing it here instead makes the
 * decision follow the city's own config ([[SeoUtils.isIndexable]]) rather than the shape of the vhost template.
 *
 * A header rather than only the `<meta name="robots">` tag in views.common.seoHead, because the meta tag reaches HTML
 * pages only: assets, the JSON/CSV/GeoPackage API responses, and error pages rendered outside a Twirl view all carry
 * no head. Google honours the header on any response type, which is why the Apache rule covered the whole surface.
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
