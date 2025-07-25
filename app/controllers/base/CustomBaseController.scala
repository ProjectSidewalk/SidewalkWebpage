package controllers.base

import play.api.i18n.I18nSupport
import play.api.mvc._

abstract class CustomBaseController(cc: CustomControllerComponents)
    extends ControllerHelpers
    with BaseController
    with I18nSupport {

  // Standard components
  override protected def controllerComponents: ControllerComponents = cc

  // Could make custom components easily accessible. Choosing not to for clarity.
  //  protected def loggingService: LoggingService = cc.loggingService
  //  protected def securityService: CustomControllerComponents = cc.securityService

  // Adds a ipAddress method to RequestHeader for easy access to the client's IP address (cleaner than remoteAddress).
  // See: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/465
  implicit class RequestHeaderExtensions(request: RequestHeader) {
    def ipAddress: String = {
      request.headers.get("X-Forwarded-For")
        .map(_.split(",").head.trim)
        .filter(_.nonEmpty)
        .orElse(request.headers.get("X-Real-IP"))
        .getOrElse(request.remoteAddress.split(",").head.trim)
    }
  }

  // Could add other common controller utilities here. Not sure if they should be here or in ControllerUtils.scala.
}
