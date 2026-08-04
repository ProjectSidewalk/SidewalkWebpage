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

  // Adds a ipAddress method to RequestHeader for easy access to the client's IP address.
  // See: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/465
  implicit class RequestHeaderExtensions(request: RequestHeader) {

    /**
     * The client IP as resolved by Play's forwarded-header processing (`play.http.forwarded.*` in application.conf):
     * `remoteAddress` walks X-Forwarded-For right-to-left past trusted proxies (the prod Apache reverse proxy connects
     * from 127.0.0.1 and appends the true client IP) and yields the first untrusted hop. Unlike taking the header's
     * first value, a client-supplied X-Forwarded-For cannot spoof this, so it is safe to key rate limits on (#1102).
     * With no proxy in front (dev/Docker), it is simply the TCP peer address.
     */
    def ipAddress: String = request.remoteAddress
  }

  // Could add other common controller utilities here. Not sure if they should be here or in ControllerUtils.scala.
}
