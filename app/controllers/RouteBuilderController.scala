package controllers

import controllers.base._
import formats.json.RouteBuilderFormats.{routeWithStatsWrites, NewRoute, RouteUpdate}
import models.route.RouteRejection
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, Result}
import service.RouteService

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class RouteBuilderController @Inject() (cc: CustomControllerComponents, routeService: RouteService)(implicit
    ec: ExecutionContext
) extends CustomBaseController(cc) {

  /** Turns a service-layer rejection into a 400 carrying the message localized for this request. */
  private def rejected(rejection: RouteRejection)(implicit messages: Messages): Result =
    BadRequest(Json.obj("status" -> "Error", "message" -> Messages(rejection.messageKey, rejection.maxLength)))

  def saveRoute = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[NewRoute]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      data => {
        routeService.saveRoute(data, request.identity.userId).map {
          case Left(rejection)              => rejected(rejection)
          case Right((routeId, name, slug)) =>
            Ok(Json.obj("route_id" -> routeId, "name" -> name, "slug" -> slug))
        }
      }
    )
  }

  /** Returns the signed-in (or anonymous) user's saved routes as JSON, newest first. */
  def getUserRoutes = cc.securityService.SecuredAction { implicit request =>
    routeService.getRoutesForUser(request.identity.userId).map { routes => Ok(Json.toJson(routes)) }
  }

  /**
   * Returns a route's ordered street list, matching the POST /saveRoute wire format, so the client can draw the
   * route from its local street GeoJSON. No ownership check — routes are shareable by id (/explore?routeId=).
   *
   * @param routeId ID of the route; 404 if it doesn't exist or has been deleted.
   */
  def getRouteStreets(routeId: Int) = cc.securityService.SecuredAction { _ =>
    routeService.getRouteStreets(routeId).map {
      case Some(streets) =>
        Ok(
          Json.obj(
            "route_id" -> routeId,
            "streets"  -> streets.map(s => Json.obj("street_id" -> s.streetEdgeId, "reverse" -> s.reverse))
          )
        )
      case None => NotFound(Json.obj("status" -> "Error", "message" -> "Route not found"))
    }
  }

  /**
   * Updates a route owned by the requesting user: any subset of {"name", "description", "streets"}. A rename
   * regenerates the route's slug (the old slug keeps redirecting); a streets update replaces the walking order
   * in place, so the route keeps its id, usage stats, and share links.
   *
   * @param routeId ID of the route to update; 404 if it doesn't exist or isn't owned by the requesting user.
   */
  def updateRoute(routeId: Int) = cc.securityService.SecuredAction(parse.json) { implicit request =>
    request.body
      .validate[RouteUpdate]
      .fold(
        errors => Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))),
        update => {
          val shapeError: Option[Result] =
            if (update.name.isEmpty && update.description.isEmpty && update.streets.isEmpty) {
              Some(BadRequest(Json.obj("status" -> "Error", "message" -> "Nothing to update")))
            } else if (update.name.exists(_.trim.isEmpty)) {
              Some(BadRequest(Json.obj("status" -> "Error", "message" -> "Missing name")))
            } else if (update.streets.exists(_.isEmpty)) {
              Some(BadRequest(Json.obj("status" -> "Error", "message" -> "A route must have at least one street")))
            } else { None }
          shapeError match {
            case Some(error) => Future.successful(error)
            case None        =>
              routeService.updateRoute(routeId, request.identity.userId, update).map {
                case Left(rejection)           => rejected(rejection)
                case Right(Some((name, slug))) =>
                  Ok(Json.obj("route_id" -> routeId, "name" -> name, "slug" -> slug))
                case Right(None) => NotFound(Json.obj("status" -> "Error", "message" -> "Route not found"))
              }
          }
        }
      )
  }

  /**
   * Redirects a /r/<slug> share link to the route in Explore. Unauthenticated so share links work logged-out
   * (/explore handles anonymous sign-up itself); retired slugs of renamed routes keep redirecting via the alias
   * table.
   *
   * @param slug The route's slug; 404 if unknown or the route has been deleted.
   */
  def routeBySlug(slug: String): Action[AnyContent] = Action.async { implicit request =>
    routeService.resolveSlug(slug).map {
      case Some(routeId) => Redirect(s"/explore?routeId=$routeId", FOUND)
      case None          => NotFound(views.html.errors.onHandlerNotFound(request))
    }
  }

  /**
   * Soft-deletes a route owned by the requesting user; its share links stop working.
   *
   * @param routeId ID of the route to delete; 404 if it doesn't exist or isn't owned by the requesting user.
   */
  def deleteRoute(routeId: Int) = cc.securityService.SecuredAction { implicit request =>
    routeService.deleteRoute(routeId, request.identity.userId).map {
      case true  => Ok(Json.obj("route_id" -> routeId, "deleted" -> true))
      case false => NotFound(Json.obj("status" -> "Error", "message" -> "Route not found"))
    }
  }
}
