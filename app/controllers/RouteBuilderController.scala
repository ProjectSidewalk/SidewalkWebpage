package controllers

import controllers.base._
import formats.json.RouteBuilderFormats.{routeWithStatsWrites, NewRoute}
import models.route.Route
import models.utils.ProfanityGuard
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.mvc.Result
import service.RouteService

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class RouteBuilderController @Inject() (cc: CustomControllerComponents, routeService: RouteService)(implicit
    ec: ExecutionContext
) extends CustomBaseController(cc) {

  /**
   * Validates a user-supplied route name: None if acceptable, or Some(400 response) with a localized message.
   *
   * An absent/empty name is acceptable — the service falls back to a default name.
   */
  private def routeNameError(name: Option[String])(implicit messages: Messages): Option[Result] = {
    val trimmed: String          = name.map(_.trim).getOrElse("")
    val errorKey: Option[String] =
      if (trimmed.length > Route.MaxNameLength) Some("routebuilder.name.error.length")
      else if (trimmed.nonEmpty && !ProfanityGuard.isClean(trimmed)) Some("routebuilder.name.error.allowed")
      else None
    errorKey.map { key => BadRequest(Json.obj("status" -> "Error", "message" -> Messages(key, Route.MaxNameLength))) }
  }

  def saveRoute = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[NewRoute]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      data => {
        routeNameError(data.name) match {
          case Some(error) => Future.successful(error)
          case None        =>
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
    (request.body \ "name").validate[String].map(_.trim) match {
      case JsSuccess(name, _) if name.nonEmpty =>
        routeNameError(Some(name)) match {
          case Some(error) => Future.successful(error)
          case None        =>
            routeService.renameRoute(routeId, request.identity.userId, name).map {
              case true  => Ok(Json.obj("route_id" -> routeId, "name" -> name))
              case false => NotFound(Json.obj("status" -> "Error", "message" -> "Route not found"))
            }
        }
      case _ =>
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
