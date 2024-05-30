package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.label._
import models.user.User
import models.attribute.ConfigTable
import play.api.libs.json._
import play.api.mvc.Action
import scala.concurrent.Future
import models.gsv.GSVDataTable
/**
 * Holds the HTTP requests associated with getting label data.
 *
 * @param env The Silhouette environment.
 */
class LabelController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
   * Fetches the labels that a user has added in the current region they are working in.
   *
   * @param regionId Region id
   * @return A list of labels
   */
  def getLabelsToResumeMission(regionId: Int) = UserAwareAction.async { implicit request =>
    // TODO move this to a format file.
    request.identity match {
      case Some(user) =>
        val allTags: List[Tag] = TagTable.selectAllTags
        val labels: List[LabelTable.ResumeLabelMetadata] = LabelTable.getLabelsFromUserInRegion(regionId, user.userId)
        val jsLabels: List[JsObject] = labels.map { label =>
          Json.obj(
            "labelId" -> label.labelData.labelId,
            "labelType" -> label.labelType,
            "panoId" -> label.labelData.gsvPanoramaId,
            "panoLat" -> label.panoLat,
            "panoLng" -> label.panoLng,
            "originalPov" -> Json.obj(
              "heading" -> label.pointData.heading,
              "pitch" -> label.pointData.pitch,
              "zoom" -> label.pointData.zoom
            ),
            "cameraHeading" -> label.cameraHeading,
            "cameraPitch" -> label.cameraPitch,
            "panoWidth" -> label.panoWidth,
            "panoHeight" -> label.panoHeight,
            // TODO Simplify this after removing the `tag` table.
            "tagIds" -> label.labelData.tags.flatMap(t => allTags.filter(at => at.tag == t && Some(at.labelTypeId) == LabelTypeTable.labelTypeToId(label.labelType)).map(_.tagId).headOption),
            "severity" -> label.labelData.severity,
            "tutorial" -> label.labelData.tutorial,
            "temporaryLabelId" -> label.labelData.temporaryLabelId,
            "temporaryLabel" -> label.labelData.temporary,
            "description" -> label.labelData.description,
            "canvasX" -> label.pointData.canvasX,
            "canvasY" -> label.pointData.canvasY,
            "panoX" -> label.pointData.panoX,
            "panoY" -> label.pointData.panoY,
            "auditTaskId" -> label.labelData.auditTaskId,
            "missionId" -> label.labelData.missionId,
            "labelLat" -> label.pointData.lat,
            "labelLng" -> label.pointData.lng
          )
        }
        val labelCollection: JsObject = Json.obj("labels" -> jsLabels)
        Future.successful(Ok(labelCollection))
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/label/resumeMission?regionId=$regionId"))
    }
  }

  /**
    * Gets all tags in the database in JSON.
    */
  def getLabelTags() = Action.async { implicit request =>
    val excludedTags: List[String] = ConfigTable.getExcludedTags
    val tags: List[Tag] = TagTable.selectAllTags.filter( tag => !excludedTags.contains(tag.tag))
    Future.successful(Ok(JsArray(tags.map { tag => Json.obj(
      "tag_id" -> tag.tagId,
      "label_type" -> LabelTypeTable.labelTypeIdToLabelType(tag.labelTypeId).get,
      "tag" -> tag.tag
    )})))
  }


}
/**
 * API to get 500 gsv_panorama_ids to check if image is expired.
 */
object LabelController {
  def test() =  {
    val panoramaIds = GSVDataTable.getPanoramaIdsForValidation()
    panoramaIds.map { panoId =>
      val result = LabelTable.checkLabelsAndExpiration(panoId)
      panoId -> result
    }
  }
}