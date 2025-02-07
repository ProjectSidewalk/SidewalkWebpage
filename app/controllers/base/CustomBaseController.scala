package controllers.base

import play.api.mvc._
import play.api.i18n.I18nSupport

abstract class CustomBaseController(cc: CustomControllerComponents)
  extends ControllerHelpers with BaseController with I18nSupport {

  // Standard components
  override protected def controllerComponents: ControllerComponents = cc

  // Could make custom components easily accessible. Choosing not to for clarity.
  //  protected def loggingService: LoggingService = cc.loggingService
  //  protected def securityService: CustomControllerComponents = cc.securityService

  // Could add other common controller utilities here. Not sure if they should be here or in ControllerUtils.scala.
}
