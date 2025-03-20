package controllers

import javax.inject.{Inject, Singleton}
import play.api.libs.json._
import controllers.base._
import formats.json.RouteBuilderFormats.NewRoute
import service.StreetService

import scala.concurrent.ExecutionContext
import scala.concurrent.Future

@Singleton
class RouteBuilderController @Inject() (cc: CustomControllerComponents,
                                        streetService: StreetService
                                       )(implicit ec: ExecutionContext) extends CustomBaseController(cc) {

  def saveRoute = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[NewRoute]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      data => {
        streetService.saveRoute(data, request.identity.userId).map { routeId =>
          Ok(Json.obj("route_id" -> routeId))
        }
      }
    )
  }
}
