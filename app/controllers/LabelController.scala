package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.label._
import models.user.User
import play.api.libs.json._
import play.api.mvc.Action
import scala.concurrent.Future
import models.gsv.GSVDataTable
import play.api.Logger
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
    val tags: List[Tag] = TagTable.getTagsForCurrentCity
    val tagCounts: List[TagCount] = LabelTable.getTagCounts()

    val tagCountMap: Map[(String, String), Int] = tagCounts.map(tc => (tc.labelType, tc.tag) -> tc.count).toMap
    
    val tagsWithCount: Seq[JsObject] = tags.map { tag =>
      val labelType = LabelTypeTable.labelTypeIdToLabelType(tag.labelTypeId).getOrElse("")
      val count = tagCountMap.getOrElse((labelType, tag.tag), 0)

      Json.obj(
        "tag_id" -> tag.tagId,
        "label_type" -> labelType,
        "tag" -> tag.tag,
        "mutually_exclusive_with" -> tag.mutuallyExclusiveWith,
        "count" -> count
      )
    }
    Future.successful(Ok(JsArray(tagsWithCount)))
  }

}

/**
 * API to check if panos are expired on a nightly basis.
 */
object LabelController {
  def checkForGSVImagery() =  {
    // Get as many as 5% of the panos with labels on them, or 1000, whichever is smaller. Check if the panos are expired
    // and update the database accordingly. If there aren't enough of those remaining that haven't been checked in the
    // last 6 months, check up to 2.5% or 500 (which ever is smaller) of the panos that are already marked as expired to
    // make sure that they weren't marked so incorrectly.
    val nPanos: Int = GSVDataTable.countPanosWithLabels
    val nUnexpiredPanosToCheck: Int = Math.max(50, Math.min(1000, 0.05 * nPanos).toInt)
    val panoIdsToCheck: List[String] = GSVDataTable.getPanoIdsToCheckExpiration(nUnexpiredPanosToCheck, expired = false)
    Logger.info(s"Checking ${panoIdsToCheck.length} unexpired panos.")

    val nExpiredPanosToCheck: Int = Math.max(25, Math.min(500, 0.025 * nPanos).toInt)
    val expiredPanoIdsToCheck: List[String] = if (panoIdsToCheck.length < nExpiredPanosToCheck) {
      val nRemainingExpiredPanosToCheck: Int = nExpiredPanosToCheck - panoIdsToCheck.length
      GSVDataTable.getPanoIdsToCheckExpiration(nRemainingExpiredPanosToCheck, expired = true)
    } else {
      List()
    }
    Logger.info(s"Checking ${expiredPanoIdsToCheck.length} expired panos.")

    val responses: List[Option[Boolean]] = (panoIdsToCheck ++ expiredPanoIdsToCheck).par.map { panoId =>
      LabelTable.panoExists(panoId)
    }.seq.toList
    Logger.info(s"Not expired: ${responses.count(x => x == Some(true))}. Expired: ${responses.count(x => x == Some(false))}. Errors: ${responses.count(x => x.isEmpty)}.")
  }
}
