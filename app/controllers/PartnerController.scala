package controllers

import controllers.base._
import models.auth.{DefaultEnv, WithAdmin, WithOwner}
import models.partner.{PartnerLogoUpload, PartnerMetadata, PartnerRejection}
import models.user.SidewalkUserWithRole
import play.api.Configuration
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{AnyContent, Result}
import play.silhouette.api.actions.SecuredRequest
import service.{ConfigService, PartnerService}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/**
 * HTTP surface for community-partner logos (#4516): the admin CRUD under /adminapi and the public logo bytes the
 * landing page renders. City-scoped writes are admin-gated; the global (all-cities) scope is Owner-only, split onto
 * its own /adminapi/globalPartners routes so the posture is visible in the routes file.
 */
@Singleton
class PartnerController @Inject() (
    cc: CustomControllerComponents,
    implicit val config: Configuration,
    configService: ConfigService,
    partnerService: PartnerService,
    implicit val ec: ExecutionContext
) extends CustomBaseController(cc) {

  // Wire cap plus 1 MiB of multipart-framing headroom, so a valid max-size logo isn't cut off by its own boundaries.
  private val bodyCap: Long = partnerService.logoUploadMaxBytes + (1L << 20)

  /** Both scopes' partner lists for the admin page, plus what the caller may edit. */
  def getPartners = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    partnerService.getAdminLists.map { case (city, global) =>
      Ok(
        Json.obj(
          "city_id"         -> configService.getCityId,
          "is_owner"        -> isOwner(request.identity),
          "city_partners"   -> city.map(metadataJson),
          "global_partners" -> global.map(metadataJson)
        )
      )
    }
  }

  /** Creates a partner in the current city's scope (any admin). */
  def createCityPartner = cc.securityService.SecuredAction(WithAdmin(), parse.anyContent(Some(bodyCap))) {
    implicit request => create(Some(configService.getCityId))
  }

  /** Creates a global partner — every deployment's landing page (Owners only). */
  def createGlobalPartner = cc.securityService.SecuredAction(WithOwner(), parse.anyContent(Some(bodyCap))) {
    implicit request => create(None)
  }

  /**
   * Updates a partner's fields, and its logo when a new file is attached. Admins may touch only current-city rows;
   * Owners also global rows — anything else 404s exactly like a missing id.
   */
  def updatePartner(partnerId: Int) = cc.securityService.SecuredAction(WithAdmin(), parse.anyContent(Some(bodyCap))) {
    implicit request =>
      // Parsed as `anyContent` rather than multipart: the body parser runs before the auth guard, and a typed
      // multipart parser answers a non-multipart body with a 400 — so an anonymous caller would get a parser error
      // where every other `/adminapi/` write gives a 401 (RouteAuthPostureSpec).
      request.body.asMultipartFormData match {
        case None       => Future.successful(BadRequest(Json.obj("success" -> false, "error" -> "Expected a form")))
        case Some(body) =>
          def dataPart(name: String): Option[String] = body.dataParts.get(name).flatMap(_.headOption)
          cc.loggingService.insert(
            request.identity.userId,
            request.ipAddress,
            s"Click_module=AdminPartnerUpdate_partnerId=$partnerId"
          )
          partnerService
            .updatePartner(
              partnerId,
              allowedScopes(request.identity),
              dataPart("name").getOrElse(""),
              dataPart("url"),
              dataPart("alt_text"),
              body.file("logo").map(filePart => PartnerLogoUpload(filePart.ref.path.toFile)),
              request.identity.userId
            )
            .map {
              case Right(_)        => Ok(Json.obj("success" -> true))
              case Left(rejection) => rejectionResult(rejection)
            }
      }
  }

  /** Deletes a partner, with the same scope rules as update. */
  def deletePartner(partnerId: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    cc.loggingService.insert(
      request.identity.userId,
      request.ipAddress,
      s"Click_module=AdminPartnerDelete_partnerId=$partnerId"
    )
    partnerService.deletePartner(partnerId, allowedScopes(request.identity)).map {
      case Right(_)        => Ok(Json.obj("success" -> true))
      case Left(rejection) => rejectionResult(rejection)
    }
  }

  /** Reorders the current city's partners to the posted `partner_ids` (any admin). */
  def reorderCityPartners = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    reorder(Some(configService.getCityId))
  }

  /** Reorders the global partners to the posted `partner_ids` (Owners only). */
  def reorderGlobalPartners = cc.securityService.SecuredAction(WithOwner()) { implicit request => reorder(None) }

  /**
   * The logo bytes for one partner. Public and unauthenticated — the landing page it renders on is public — and
   * cached hard: every rendered URL carries `?v=<updated-at>`, so replacing a logo mints a new URL and the old one
   * can be cached forever.
   */
  def servePartnerLogo(partnerId: Int) = Action.async {
    partnerService.getLogoForServing(partnerId).map {
      case None                   => NotFound("Partner logo not found.")
      case Some((bytes, mime, _)) =>
        Ok(bytes).as(mime).withHeaders("Cache-Control" -> "public, max-age=31536000, immutable")
    }
  }

  /** Shared body of the two create actions; `cityId` is the scope the route already authorized. */
  private def create(
      cityId: Option[String]
  )(implicit request: SecuredRequest[DefaultEnv, AnyContent]): Future[Result] = {
    request.body.asMultipartFormData match {
      case None       => Future.successful(BadRequest(Json.obj("success" -> false, "error" -> "Expected a form")))
      case Some(body) =>
        def dataPart(name: String): Option[String] = body.dataParts.get(name).flatMap(_.headOption)
        cc.loggingService.insert(
          request.identity.userId,
          request.ipAddress,
          s"Click_module=AdminPartnerCreate_scope=${cityId.getOrElse("global")}"
        )
        partnerService
          .createPartner(
            cityId,
            dataPart("name").getOrElse(""),
            dataPart("url"),
            dataPart("alt_text"),
            body.file("logo").map(filePart => PartnerLogoUpload(filePart.ref.path.toFile)),
            request.identity.userId
          )
          .map {
            case Right(metadata) => Ok(Json.obj("success" -> true, "partner" -> metadataJson(metadata)))
            case Left(rejection) => rejectionResult(rejection)
          }
    }
  }

  /** Shared body of the two reorder actions; `cityId` is the scope the route already authorized. */
  private def reorder(
      cityId: Option[String]
  )(implicit request: SecuredRequest[DefaultEnv, AnyContent]): Future[Result] = {
    request.body.asJson.flatMap(json => (json \ "partner_ids").asOpt[Seq[Int]]) match {
      case None      => Future.successful(BadRequest(Json.obj("success" -> false, "error" -> "Expected partner_ids")))
      case Some(ids) =>
        cc.loggingService.insert(
          request.identity.userId,
          request.ipAddress,
          s"Click_module=AdminPartnerReorder_scope=${cityId.getOrElse("global")}"
        )
        partnerService.reorderPartners(cityId, ids).map {
          case Right(_)        => Ok(Json.obj("success" -> true))
          case Left(rejection) => rejectionResult(rejection)
        }
    }
  }

  private def isOwner(user: SidewalkUserWithRole): Boolean = user.role == "Owner"

  private def allowedScopes(user: SidewalkUserWithRole): Set[Option[String]] = {
    if (isOwner(user)) Set(None, Some(configService.getCityId)) else Set(Some(configService.getCityId))
  }

  private def metadataJson(p: PartnerMetadata): JsObject = Json.obj(
    "partner_id"    -> p.partnerId,
    "city_id"       -> p.cityId,
    "name"          -> p.name,
    "url"           -> p.url,
    "alt_text"      -> p.altText,
    "display_order" -> p.displayOrder,
    "logo_width"    -> p.logoWidth,
    "logo_height"   -> p.logoHeight,
    "logo_url"      -> s"${routes.PartnerController.servePartnerLogo(p.partnerId).url}?v=${p.updatedAt.toEpochSecond}"
  )

  private def rejectionResult(rejection: PartnerRejection): Result = rejection match {
    case PartnerRejection.NotFound       => NotFound(Json.obj("success" -> false, "error" -> "not_found"))
    case PartnerRejection.LogoRequired   => BadRequest(Json.obj("success" -> false, "error" -> "logo_required"))
    case PartnerRejection.LogoTooLarge   => BadRequest(Json.obj("success" -> false, "error" -> "logo_too_large"))
    case PartnerRejection.LogoInvalid    => BadRequest(Json.obj("success" -> false, "error" -> "logo_invalid"))
    case PartnerRejection.NameInvalid    => BadRequest(Json.obj("success" -> false, "error" -> "name_invalid"))
    case PartnerRejection.UrlInvalid     => BadRequest(Json.obj("success" -> false, "error" -> "url_invalid"))
    case PartnerRejection.AltTextInvalid => BadRequest(Json.obj("success" -> false, "error" -> "alt_text_invalid"))
    case PartnerRejection.BadOrder       => BadRequest(Json.obj("success" -> false, "error" -> "bad_order"))
  }
}
