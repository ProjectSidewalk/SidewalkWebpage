package controllers

import controllers.base._
import formats.json.LabelFormats
import models.auth.DefaultEnv
import models.label._
import play.api.libs.json._
import play.silhouette.api.Silhouette
import service.LabelService

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

@Singleton
class LabelController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    implicit val ec: ExecutionContext,
    labelService: LabelService
) extends CustomBaseController(cc) {

  /**
   * Fetches the labels that a user has added in the current region they are working in.
   * @param regionId Region id
   * @return A list of labels
   */
  def getLabelsToResumeMission(regionId: Int) = cc.securityService.SecuredAction { implicit request =>
    for {
      labels: Seq[ResumeLabelMetadata] <- labelService.getLabelsFromUserInRegion(regionId, request.identity.userId)
      allTags: Seq[Tag]                <- labelService.selectAllTagsFuture
    } yield {
      Ok(Json.obj("labels" -> labels.map(l => LabelFormats.resumeLabelMetadatatoJson(l, allTags))))
    }
  }

  /**
   * Gets all tags in the database in JSON.
   */
  def getLabelTags = silhouette.UserAwareAction.async { implicit request =>
    cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

    // TODO this should use implicit conversion maybe?
    labelService.getTagsForCurrentCity.map { tags =>
      Ok(JsArray(tags.map { tag =>
        Json.obj(
          "tag_id"                  -> tag.tagId,
          "label_type"              -> LabelTypeEnum.labelTypeIdToLabelType(tag.labelTypeId),
          "tag"                     -> tag.tag,
          "mutually_exclusive_with" -> tag.mutuallyExclusiveWith
        )
      }))
    }
  }
}
