package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import models.auth.WithAdmin
import play.api.Configuration
import service.ConfigService

import javax.inject._
import scala.concurrent.ExecutionContext

/**
 * Controller for the redesigned Admin dashboard (issue #4272).
 *
 * These pages are a clean-slate rebuild of the legacy `/admin` monolith, structured one page per route and styled
 * after the API docs shell (left nav + content + right "On this page" TOC). They are built incrementally and coexist
 * with the legacy `/admin` page until they reach parity; only then does `/admin` flip to this dashboard. Each action
 * is admin-gated and renders a self-contained Twirl page that loads just the libraries that page needs.
 */
@Singleton
class AdminDashboardController @Inject() (
    cc: CustomControllerComponents,
    val config: Configuration,
    implicit val assets: AssetsFinder,
    configService: ConfigService
)(implicit ec: ExecutionContext)
    extends CustomBaseController(cc) {
  implicit val implicitConfig: Configuration = config

  /**
   * Renders the Coverage page: a region choropleth linked to a per-region coverage bar chart.
   *
   * Answers "what is our data coverage like, by region?". Both views are driven by a single call to the v3
   * `/v3/api/regions` endpoint so the map polygons and the bars can never disagree.
   */
  def coverage = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin_Coverage")
      Ok(views.html.admin.dashboard.coverage(commonData, request.identity))
    }
  }

  /**
   * Renders the Data Quality page: per-label-type label counts, severity, validation agreement, and tag usage.
   *
   * Answers "how good is the data?" for the current deployment. Driven client-side from the per-city v3 overallStats
   * endpoint (counts, severity mean/SD, validation agreement incl. a human-vs-AI split) plus label tag counts.
   */
  def quality = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin_Quality")
      Ok(views.html.admin.dashboard.quality(commonData, request.identity))
    }
  }

  /**
   * Renders the Contributors page: aggregate view of who produces the data and how good their contributions are.
   *
   * Answers "what are our contributors doing, and can we trust them?" — counts by quality and role, the share of
   * labels coming from high- vs low-quality users, and the distribution of contributor accuracy. Driven client-side
   * from the admin user-stats endpoint (per-user quality flag, label counts, and accuracy).
   */
  def contributors = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin_Contributors")
      Ok(views.html.admin.dashboard.contributors(commonData, request.identity))
    }
  }
}
