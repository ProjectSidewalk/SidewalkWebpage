package controllers

import controllers.base.*
import models.auth.WithAdmin
import models.validation.{GoldExampleSummary, ValidationReason}
import play.api.libs.json.{JsObject, Json}
import service.{GoldExampleRejection, GoldExampleService, PanoDataService}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/** Training examples (#1445) are per city, so any admin may pin and unpin. */
@Singleton
class GoldExampleController @Inject() (
    cc: CustomControllerComponents,
    goldExampleService: GoldExampleService,
    panoDataService: PanoDataService
)(using ec: ExecutionContext)
    extends CustomBaseController(cc) {

  /** Every pin in the city, newest first, with how validators have done on it. */
  def getGoldExamples = cc.securityService.SecuredAction(WithAdmin()) { _ =>
    goldExampleService.listSummaries.map(summaries => Ok(Json.obj("gold_examples" -> summaries.map(summaryJson))))
  }

  /** Takes `{"label_id": <int>, "reason": "<reason id>"}`; a reason the type doesn't offer for a Disagree is refused. */
  def pinGoldExample = cc.securityService.SecuredAction(WithAdmin(), parse.json) { implicit request =>
    val labelId: Option[Int]     = (request.body \ "label_id").asOpt[Int]
    val reasonId: Option[String] = (request.body \ "reason").asOpt[String]
    cc.loggingService.insert(
      request.identity.userId,
      request.ipAddress,
      s"Click_module=AdminGoldExamplePin_labelId=${labelId.getOrElse(-1)}_reason=${reasonId.getOrElse("")}"
    )
    (labelId, reasonId.flatMap(ValidationReason.withNameOption)) match {
      case (Some(id), Some(reason)) =>
        goldExampleService.pin(id, reason, request.identity.userId).map {
          case Right(pinned)   => Ok(Json.obj("success" -> true, "reason" -> pinned.reason.name))
          case Left(rejection) => rejectionResult(rejection)
        }
      case _ => Future.successful(BadRequest(Json.obj("success" -> false, "error" -> "bad_request")))
    }
  }

  /** Stops serving the label as an example; the answers already given stay on record. 404 when it isn't pinned. */
  def unpinGoldExample(labelId: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    cc.loggingService.insert(
      request.identity.userId,
      request.ipAddress,
      s"Click_module=AdminGoldExampleUnpin_labelId=$labelId"
    )
    goldExampleService.unpin(labelId).map {
      case true  => Ok(Json.obj("success" -> true))
      case false => NotFound(Json.obj("success" -> false, "error" -> "not_found"))
    }
  }

  private def summaryJson(s: GoldExampleSummary): JsObject = Json.obj(
    "label_id"   -> s.example.labelId,
    "label_type" -> s.labelType.name,
    "reason"     -> s.example.reason.name,
    "pinned_by"  -> s.pinnedByUsername,
    "pinned_at"  -> s.example.pinnedAt,
    "unservable" -> s.unservable,
    "answered"   -> s.answered,
    "missed"     -> s.missed,
    "crop_url"   -> panoDataService.cropUrl(s.example.labelId, s.labelType)
  )

  private def rejectionResult(rejection: GoldExampleRejection) = rejection match {
    case GoldExampleRejection.NoSuchLabel      => NotFound(Json.obj("success" -> false, "error" -> "no_such_label"))
    case GoldExampleRejection.LabelUnusable    => BadRequest(Json.obj("success" -> false, "error" -> "label_unusable"))
    case GoldExampleRejection.ReasonNotOffered =>
      BadRequest(Json.obj("success" -> false, "error" -> "reason_not_offered"))
  }
}
