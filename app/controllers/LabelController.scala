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
import play.api.Play
import play.api.Play.current

import scala.collection.JavaConverters._
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

  /**
    * Gets all tags in the database in JSON.
    *
    * @return
    */
  def getLabelTags() = Action.async { implicit request =>
    val cityStr: String = Play.configuration.getString("city-id").get
    val countryID: String = Play.configuration.getString("city-params.country-id." + cityStr).get
    val excludedTags: List[String] = Play.configuration.getList("city-params.excluded-tags." + countryID).get.unwrapped().asInstanceOf[java.util.List[String]].asScala.toList
    val tags: List[Tag] = TagTable.selectAllTags().filter( tag => !excludedTags.contains(tag.tag))
    Future.successful(Ok(JsArray(tags.map { tag => Json.obj(
      "tag_id" -> tag.tagId,
      "label_type" -> LabelTypeTable.labelTypeIdToLabelType(tag.labelTypeId),
      "tag" -> tag.tag
    )})))
  }
}
