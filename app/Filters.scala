import javax.inject.Inject

import play.api.http.HttpFilters
import play.filters.gzip.GzipFilter

// https://www.playframework.com/documentation/2.4.x/GzipEncoding
class Filters @Inject() (gzipFilter: GzipFilter) extends HttpFilters {
  def filters = Seq(gzipFilter)
}
