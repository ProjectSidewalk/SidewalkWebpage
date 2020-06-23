package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import formats.json.LabelFormats._
import models.label._
import models.user.User
import play.api.libs.json._
import play.api.mvc.Action
import play.Logger

import scala.concurrent.Future


class LabelController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
    *
    * @param regionId Region id
    * @return
    */
  def getLabelsFromCurrentMission(regionId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val labels = LabelTable.getLabelsFromCurrentAuditMission(regionId, user.userId)
        val jsLabels = JsArray(labels.map(l => Json.toJson(l)))
        Future.successful(Ok(jsLabels))
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/label/currentMission?regionId=$regionId"))
    }
  }

  /**
    * Fetches the labels that a user has added in the current region they are working in.
    * @param regionId Region id
    * @return A list of labels
    */
  def getLabelsForMiniMap(regionId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val labels: List[LabelTable.MiniMapResumeMetadata] = LabelTable.resumeMiniMap(regionId, user.userId)
        val jsonList: List[JsObject] = labels.map { label =>
          Json.obj(
            "label_id" -> label.labelId,
            "label_type" -> label.labelType,
            "label_lat" -> label.lat,
            "label_lng" -> label.lng
          )
        }
        val featureCollection: JsObject = Json.obj("labels" -> jsonList)
        Future.successful(Ok(featureCollection))
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/label/currentMission?regionId=$regionId"))
    }
  }

  def getLabelsToResumeMission(regionId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val labels: List[LabelTable.ResumeLabelMetadata] = LabelTable.getLabelsFromUserInRegion(regionId, user.userId)
        Logger.debug("" + labels.size)
        val jsLabels: List[JsObject] = labels.map { label =>
          Json.obj(
            "canvasWidth" -> label.pointData.canvasWidth,
            "canvasHeight" -> label.pointData.canvasHeight,
            "canvasDistortionAlphaX" -> label.pointData.alphaX,
            "canvasDistortionAlphaY" -> label.pointData.alphaY,
            "labelId" -> label.labelData.labelId,
            "labelType" -> label.labelType,
            "labelDescription" -> label.description,
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
            "severity" -> label.severity,
            "tutorial" -> label.labelData.tutorial,
            "temporary_label_id" -> label.labelData.temporaryLabelId,
            "temporaryLabel" -> label.temporary,
            "description" -> label.description,
            "canvasX" -> label.pointData.canvasX,
            "canvasY" -> label.pointData.canvasY,
            "audit_task_id" -> label.labelData.auditTaskId,
            "labelLat" -> label.pointData.lat,
            "labelLng" -> label.pointData.lng
          )
        }
        val labelCollection: JsObject = Json.obj("labels" -> jsLabels)
        Future.successful(Ok(labelCollection))
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/label/currentMission?regionId=$regionId"))
    }
  }

  /**
    * Gets all tags in the database in JSON.
    *
    * @return
    */
  def getLabelTags() = Action.async { implicit request =>
    Future.successful(Ok(JsArray(TagTable.selectAllTags().map { tag => Json.obj(
      "tag_id" -> tag.tagId,
      "label_type" -> LabelTypeTable.labelTypeIdToLabelType(tag.labelTypeId),
      "tag" -> tag.tag
    )})))
  }
}
