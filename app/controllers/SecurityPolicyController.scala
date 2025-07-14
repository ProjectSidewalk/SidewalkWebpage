package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import play.api.Logger
import play.api.mvc.Action
import play.filters.csp.{CSPReportActionBuilder, ScalaCSPReport}

import javax.inject.{Inject, Singleton}

/**
 * Controller for handling security policies, specifically Content Security Policy (CSP) reports.
 */
@Singleton
class SecurityPolicyController @Inject() (cc: CustomControllerComponents, cspReportAction: CSPReportActionBuilder)
    extends CustomBaseController(cc) {
  private val logger = Logger(this.getClass)

  /**
   * Handles CSP violation reports. Logs violations and returns 204 No Content.
   */
  val cspReport: Action[ScalaCSPReport] = cspReportAction { request =>
    val report = request.body
    logger.warn(
      s"CSP violation: violated-directive = ${report.violatedDirective} -- " +
        s"blocked = ${report.blockedUri} -- " +
        s"policy = ${report.originalPolicy}"
    )
    NoContent
  }
}
