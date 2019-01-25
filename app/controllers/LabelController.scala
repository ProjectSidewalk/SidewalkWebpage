package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{ Environment, Silhouette }
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import controllers.helper.LabelControllerHelper
import formats.json.LabelFormats._
import models.label._
import models.user.User
import play.api.libs.json._
import play.api.mvc.Action
import play.api.mvc.Results._
//import play.api.Play.current
//import play.api.i18n.Messages.Implicits._
import play.api.i18n.{ I18nSupport, MessagesApi }

import scala.concurrent.Future

import scala.concurrent.ExecutionContext.Implicits.global

class LabelController @Inject() (implicit val env: Environment[User, SessionAuthenticator], override val messagesApi: MessagesApi)
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader with I18nSupport {

  /**
   *
   * @param regionId Region id
   * @return
   */
  def getLabelsFromCurrentMission(regionId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        LabelControllerHelper._helpGetLabelsFromCurrentMission(regionId, user.userId).flatMap { labels =>
          val jsLabels = JsArray(labels.map(l => Json.toJson(l)))
          Future.successful(Ok(jsLabels))
        }
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
    var tagList: List[Tag] = Nil
    TagTable.selectAllTags().flatMap { tags =>
      tagList = tags
      LabelTypeTable.labelTypeByIds(tags.map(_.labelTypeId).toSet.toList)
    }.map { tagTypes =>
      val tagTypeMap = tagTypes.toMap
      Ok(JsArray(tagList.map { tag =>
        Json.obj(
          "tag_id" -> tag.tagId,
          "label_type" -> tagTypeMap(tag.labelTypeId),
          "tag" -> tag.tag)
      }))
    }
  }
}
