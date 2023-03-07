package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.label._
import models.user.User
import play.api.libs.json._
import play.api.mvc.Action
import play.api.Play
import play.api.Play.current
import scala.collection.JavaConverters._
import scala.concurrent.Future

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
    request.identity match {
      case Some(user) =>
        val labels: List[LabelTable.ResumeLabelMetadata] = LabelTable.getLabelsFromUserInRegion(regionId, user.userId)
        val jsLabels: List[JsObject] = labels.map { label =>
          Json.obj(
            "labelId" -> label.labelData.labelId,
            "labelType" -> label.labelType,
            "panoId" -> label.labelData.gsvPanoramaId,
            "panoramaLat" -> label.labelData.panoramaLat,
            "panoramaLng" -> label.labelData.panoramaLng,
            "panoramaHeading" -> label.pointData.heading,
            "panoramaPitch" -> label.pointData.pitch,
            "panoramaZoom" -> label.pointData.zoom,
            "photographerHeading" -> label.labelData.photographerHeading,
            "photographerPitch" -> label.labelData.photographerPitch,
            "svImageWidth" -> label.svImageWidth,
            "svImageHeight" -> label.svImageHeight,
            "tagIds" -> label.tagIds,
            "severity" -> label.labelData.severity,
            "tutorial" -> label.labelData.tutorial,
            "temporaryLabelId" -> label.labelData.temporaryLabelId,
            "temporaryLabel" -> label.labelData.temporary,
            "description" -> label.labelData.description,
            "canvasX" -> label.pointData.canvasX,
            "canvasY" -> label.pointData.canvasY,
            "svImageX" -> label.pointData.svImageX,
            "svImageY" -> label.pointData.svImageY,
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
    val cityStr: String = Play.configuration.getString("city-id").get
    val excludedTags: List[String] = Play.configuration.getStringList("city-params.excluded-tags." + cityStr).get.asScala.toList
    val tags: List[Tag] = TagTable.selectAllTags().filter( tag => !excludedTags.contains(tag.tag))
    Future.successful(Ok(JsArray(tags.map { tag => Json.obj(
      "tag_id" -> tag.tagId,
      "label_type" -> LabelTypeTable.labelTypeIdToLabelType(tag.labelTypeId),
      "tag" -> tag.tag
    )})))
  }
}
