package controllers

import controllers.base._
import formats.json.RouteBuilderFormats.{routeWithStatsWrites, NewRoute}
import models.route.Route
import models.utils.ProfanityGuard
import play.api.i18n.Messages
import play.api.libs.json._
import service.RouteService

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class RouteBuilderController @Inject() (cc: CustomControllerComponents, routeService: RouteService)(implicit
    ec: ExecutionContext
) extends CustomBaseController(cc) {

  /**
   * Validates a user-supplied route name: None if acceptable, or Some(error message key) if not.
   *
   * An absent/empty name is acceptable — the service falls back to a default name.
   */
  private def validateRouteName(name: Option[String]): Option[String] = {
    val trimmed: String = name.map(_.trim).getOrElse("")
    if (trimmed.length > Route.MaxNameLength) Some("routebuilder.name.error.length")
    else if (trimmed.nonEmpty && !ProfanityGuard.isClean(trimmed)) Some("routebuilder.name.error.allowed")
    else None
  }

  def saveRoute = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[NewRoute]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      data => {
        validateRouteName(data.name) match {
          case Some(errorKey) =>
            Future.successful(
              BadRequest(Json.obj("status" -> "Error", "message" -> Messages(errorKey, Route.MaxNameLength)))
            )
          case None =>
            routeService.saveRoute(data, request.identity.userId).map { case (routeId, name) =>
              Ok(Json.obj("route_id" -> routeId, "name" -> name))
            }
        }
      }
    )
  }

  /** Returns the signed-in (or anonymous) user's saved routes as JSON, newest first. */
  def getUserRoutes = cc.securityService.SecuredAction { implicit request =>
    routeService.getRoutesForUser(request.identity.userId).map { routes => Ok(Json.toJson(routes)) }
  }

  /**
   * Renames a route owned by the requesting user. Body: {"name": "..."}.
   *
   * @param routeId ID of the route to rename; 404 if it doesn't exist or isn't owned by the requesting user.
   */
  def renameRoute(routeId: Int) = cc.securityService.SecuredAction(parse.json) { implicit request =>
    (request.body \ "name").validate[String] match {
      case JsSuccess(name, _) =>
        val trimmed: String = name.trim
        validateRouteName(Some(trimmed)) match {
          case Some(errorKey) =>
            Future.successful(
              BadRequest(Json.obj("status" -> "Error", "message" -> Messages(errorKey, Route.MaxNameLength)))
            )
          case None if trimmed.isEmpty =>
            Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> "Missing name")))
          case None =>
            routeService.renameRoute(routeId, request.identity.userId, trimmed).map {
              case true  => Ok(Json.obj("route_id" -> routeId, "name" -> trimmed))
              case false => NotFound(Json.obj("status" -> "Error", "message" -> "Route not found"))
            }
        }
      case JsError(_) =>
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> "Missing name")))
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
