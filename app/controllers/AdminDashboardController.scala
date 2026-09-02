package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import models.auth.{WithAdmin, WithOwner}
import play.api.Configuration
import models.street.StreetPriorityForAdmin
import play.api.libs.json.Json
import service.HealthService.dbHealthDataWrites
import service.{
  ConfigService,
  HealthService,
  ImageryFreshnessReportService,
  LabelService,
  StreetLifecycleService,
  StreetService
}

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
    configService: ConfigService,
    labelService: LabelService,
    healthService: HealthService,
    streetLifecycleService: StreetLifecycleService,
    imageryFreshnessReportService: ImageryFreshnessReportService,
    streetService: StreetService
)(implicit ec: ExecutionContext)
    extends CustomBaseController(cc) {
  implicit val implicitConfig: Configuration = config

  /**
   * Renders the Overview landing page: an at-a-glance snapshot that routes into the detailed pages.
   *
   * Answers "how is this deployment doing, in one screen?" — a scannable card per lens (coverage, data quality,
   * contributors, recent activity, humans-vs-AI, and API usage), each with a top-line KPI and a deep link to the page
   * that owns that lens. Deliberately introduces no new analysis of its own; it's driven by the lightweight
   * `/adminapi/overviewSummary` endpoint, which composes existing aggregate queries rather than re-fetching each page.
   */
  def overview = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin_Overview")
      Ok(views.html.admin.dashboard.overview(commonData, request.identity))
    }
  }

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
   * Renders the Street Status page: a per-segment map colored by street availability plus a per-region breakdown.
   *
   * Answers "which streets are auditable, and where is imagery missing or are streets disabled?" — the operational
   * counterpart to Coverage's "how much is audited". Driven client-side from `/v3/api/streets`, which returns every
   * street (regardless of status) tagged with its `street_edge_status` (#3888).
   */
  def streetStatus = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin_StreetStatus")
      Ok(views.html.admin.dashboard.streetStatus(commonData, request.identity))
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

  /**
   * Renders the Activity page: the time/tempo lens on the deployment — how much work happens, and when.
   *
   * Answers "what's our activity over time, and what just happened?" — daily/weekly volume of labels, validations,
   * audits, missions, sign-ins, and new users, an active-users-over-time line (registered vs anonymous), and a
   * recent-activity feed. Stays aggregate (per-person ranking is Contributors') and volume-focused (quality-over-time
   * is Data Quality's, cumulative coverage is Coverage's). Driven by the unified `/adminapi/activityByDay` series plus
   * the recent-comments and recent-labels feeds.
   */
  def activity = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin_Activity")
      Ok(views.html.admin.dashboard.activity(commonData, request.identity))
    }
  }

  /**
   * Renders the Stories moderation page (#4054): the review queue for lived-experience stories.
   *
   * Answers "what have people shared, and does anything need moderation?" — every story newest-first (hidden ones
   * included, visually quarantined), each with its author, text, photo, and label, plus the hide/unhide and
   * permanent-delete controls. Stories are public on submit, so this queue is the after-the-fact safety net.
   */
  def stories = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin_Stories")
      Ok(views.html.admin.dashboard.stories(commonData, request.identity))
    }
  }

  /**
   * Renders the API Analytics page: v3 public-API usage, framed around real external adoption vs our own docs traffic.
   *
   * Answers "is our public API being used, by whom, for what?" — external vs apiDocs call volume over time, top
   * endpoints, formats requested, and unique clients. Driven client-side from the source-split analytics endpoint.
   */
  def apiAnalytics = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin_ApiAnalytics")
      Ok(views.html.admin.dashboard.apiAnalytics(commonData, request.identity))
    }
  }

  /**
   * Renders the Humans vs AI page: the cross-cutting comparison between human and AI contributions.
   *
   * Answers "how does the AI compare to people?" across all three AI roles — as a labeler (volume, type mix, severity,
   * and acceptance rate when validated), as a validator (verdict mix), and as a tagger (tag distribution vs the human
   * baseline). Driven client-side from the unified `/adminapi/humanVsAi` endpoint; the AI side shows per-lens empty
   * states on deployments without AI activity.
   */
  def humansVsAi = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin_HumansVsAI")
      Ok(views.html.admin.dashboard.humansVsAi(commonData, request.identity))
    }
  }

  /**
   * Renders the Label Map page: an interactive per-label point map for spatially exploring and inspecting labels.
   *
   * Answers "where are the labels, and what's there?" — every label as a point colored by type, with the shared map
   * sidebar (filter by label type, severity, tags, validation status, and the admin-only "not validated by an admin"
   * filter), and click-to-open the label-detail popup. A label-ID search box jumps straight to any label's popup. This
   * is the redesign's home for the legacy admin "Map" tab; it reuses the shared PSMap component and `/adminapi/labels/all`.
   */
  def labelMap = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    for {
      commonData <- configService.getCommonPageData(request2Messages.lang)
      tags       <- labelService.getTagsForCurrentCity
    } yield {
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin_LabelMap")
      Ok(views.html.admin.dashboard.labelMap(commonData, request.identity, tags))
    }
  }

  /**
   * Renders the Management page: the admin's operational console for the actions the read-only lens pages don't carry.
   *
   * Homes the deployment-wide, state-changing tools that used to live on the legacy `/admin` index — a full searchable
   * user directory with inline role assignment, team open/closed and visible/hidden toggles, and the maintenance jobs
   * (clear cache, recalculate user stats, recalculate street priority). Per-user actions (quality, infra3d, task flags)
   * remain on `/admin/user/:username`. Driven client-side from `/adminapi/getUserStats` (users + teams) and the
   * existing admin mutation endpoints; introduces no new backend.
   */
  def management = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin_Management")
      Ok(views.html.admin.dashboard.management(commonData, request.identity))
    }
  }

  /**
   * Renders the Across Cities page: a cross-deployment overview comparing every Project Sidewalk city at once (#4329).
   *
   * Answers "how is the whole project doing, and which deployments need attention?" — a per-city scorecard (coverage,
   * labels, validations, contributors, AI share, last activity) plus server-computed anomaly flags (stalled, low
   * coverage, outlier validation disagreement). Owner-gated rather than admin-gated: every city lives in one database,
   * so per-city Administrators must not see other cities' detail. Driven client-side from `/adminapi/cityScorecards`.
   */
  def acrossCities = cc.securityService.SecuredAction(WithOwner()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin_AcrossCities")
      Ok(views.html.admin.dashboard.acrossCities(commonData, request.identity))
    }
  }

  /**
   * Renders the Health page: an at-a-glance view of database and application operational-health signals (#4561).
   *
   * Surfaces the class of problem that is invisible in the app log and otherwise only found by hand-inspecting server
   * logs — blocking locks, idle-in-transaction sessions, stuck evolutions, table bloat, and connection pressure.
   * Owner-gated because the signals are cluster-wide (all cities share one database). Driven client-side by a poller
   * hitting `/adminapi/dbHealth`.
   */
  def health = cc.securityService.SecuredAction(WithOwner()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin_Health")
      Ok(views.html.admin.dashboard.health(commonData, request.identity))
    }
  }

  /**
   * The Health dashboard's data endpoint: the current database/app health payload as snake_case JSON, polled by the
   * page. Owner-gated like the page itself. Deliberately NOT activity-logged: the page polls this every ~20s, so
   * logging each hit would flood `webpage_activity`; the one-time page visit is logged by [[health]] instead.
   */
  def getDbHealth = cc.securityService.SecuredAction(WithOwner()) { _ =>
    healthService.getDbHealth.map(data => Ok(Json.toJson(data)))
  }

  /**
   * The Street Status page's trend endpoint: what changed over the last `weeks` weeks, as snake_case JSON (#4928).
   *
   * Admin- rather than Owner-gated, and scoped to this city's schema, because it is a per-city operational lens like
   * the map and table it sits under. Fetched separately from the page's street GeoJSON so a trend failure leaves the
   * snapshot intact.
   *
   * @param weeks Window size; clamped by [[StreetLifecycleService.clampWeeks]], so a junk value is a narrow chart
   *              rather than an error.
   */
  def getStreetStatusTrend(weeks: Int) = cc.securityService.SecuredAction(WithAdmin()) { _ =>
    streetLifecycleService.getStreetStatusTrend(weeks).map(trend => Ok(Json.toJson(trend)))
  }

  /**
   * Reopens a no_imagery street from the Street Status page's "Regained imagery" review queue (#4929).
   *
   * Guarded on the street's current status, so a stale queue row can't reopen a street twice (409) or invent
   * one (404).
   */
  def reopenStreet(streetEdgeId: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    streetLifecycleService.reopenStreet(streetEdgeId).map {
      case StreetLifecycleService.Reopened =>
        cc.loggingService.insert(request.identity.userId, request.ipAddress, s"ReopenStreet_Street=$streetEdgeId")
        Ok(Json.obj("status" -> "success", "street_edge_id" -> streetEdgeId))
      case StreetLifecycleService.NotNoImagery(current) =>
        Conflict(Json.obj("status" -> "Error", "message" -> s"Street $streetEdgeId is '$current', not 'no_imagery'."))
      case StreetLifecycleService.StreetNotFound =>
        NotFound(Json.obj("status" -> "Error", "message" -> s"No street with id $streetEdgeId."))
    }
  }

  /**
   * Dismisses a "Regained imagery" reopen candidate without changing the street (#4929). Idempotent: dismissing a
   * street with no queued candidate succeeds with `dismissed = 0`, since the admin's goal — no queue entry — holds.
   * Only a dismissal that changed something is logged, so the activity trail counts judgements rather than clicks.
   */
  def dismissReopenCandidate(streetEdgeId: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    streetLifecycleService.dismissReopenCandidate(streetEdgeId).map { dismissed =>
      if (dismissed > 0) {
        cc.loggingService.insert(
          request.identity.userId,
          request.ipAddress,
          s"DismissReopenCandidate_Street=$streetEdgeId"
        )
      }
      Ok(Json.obj("status" -> "success", "street_edge_id" -> streetEdgeId, "dismissed" -> dismissed))
    }
  }

  /**
   * Renders the Imagery page: where the re-audit work sits, and whether the pipeline that finds it is alive (#4908).
   *
   * The #4384 pipeline surfaces which streets need a re-audit but not the ranking Explore actually routes on, and its
   * nightly poll — the only thing that can raise a re-audit flag — reports solely to the application log, where a
   * poller that stopped firing leaves no evidence at all. This page renders both: a priority-colored street map with
   * the audit counts behind each value, and the poll's own recorded rotation and flag counts.
   */
  def imagery = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin_Imagery")
      Ok(views.html.admin.dashboard.imagery(commonData, request.identity))
    }
  }

  /**
   * Renders the Partners page: the community-partner logos shown on the landing page (#4516).
   *
   * Any admin manages the current city's partners here; the global list (every deployment's landing page) is
   * rendered for context but editable only by Owners, enforced on the /adminapi/globalPartners routes.
   */
  def partners = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin_Partners")
      Ok(views.html.admin.dashboard.partners(commonData, request.identity))
    }
  }

  /**
   * The Imagery page's pipeline endpoint: nightly poll/flag counts and job state as snake_case JSON (#4908).
   *
   * @param days Window size; clamped by [[ImageryFreshnessReportService.clampDays]], so a junk value narrows the
   *             chart rather than erroring.
   */
  def getImageryFreshness(days: Int) = cc.securityService.SecuredAction(WithAdmin()) { _ =>
    imageryFreshnessReportService.getReport(days).map(report => Ok(Json.toJson(report)))
  }

  /**
   * The Imagery page's per-street endpoint: every routable street's priority plus the audit counts it derives from.
   *
   * Geometry is deliberately absent — the page joins these rows to the street GeoJSON it already fetches from
   * `/v3/api/streets`, which keeps this payload small enough to also drive the tables and the rotation roll-ups.
   * Admin-only rather than published on the v3 API: priority is an internal routing weight, and exposing it there
   * would freeze it into a public contract that the multi-factor prioritization work (#4894) is expected to change.
   */
  def getStreetPriority = cc.securityService.SecuredAction(WithAdmin()) { _ =>
    streetService.getPriorityWithInputs.map(streets => Ok(StreetPriorityForAdmin.payload(streets)))
  }
}
