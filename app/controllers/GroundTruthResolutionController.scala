package controllers

import java.util.UUID
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, LogoutEvent, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import formats.json.TaskFormats._
import models.daos.slick.DBTableDefinitions.UserTable
import models.label.LabelTable.LabelMetadata
import models.label.{LabelPointTable, LabelTable}
import models.user.{User, WebpageActivityTable}
import models.daos.UserDAOImpl
import models.user.UserRoleTable
import org.geotools.geometry.jts.JTS
import org.geotools.referencing.CRS
import play.api.libs.json.{JsArray, JsObject, JsValue, Json}
import forms.SignInForm

import scala.concurrent.Future

/**
  * Todo. This controller is written quickly and not well thought out. Someone could polish the controller together with the model code that was written kind of ad-hoc.
  * @param env
  */
class GroundTruthResolutionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {


  // TODO: when merging with develop, change this isAdmin to match develop's isAdmin function in AdminController
  def isAdmin(user: Option[User]): Boolean = user match {
    case Some(user) =>
      if (user.roles.getOrElse(Seq()).contains("Administrator")) true else false
    case _ => false
  }
  def index = UserAwareAction.async { implicit request =>
    if(isAdmin(request.identity)){
      Future.successful(Ok(views.html.gtresolution("Ground Truth Resolution")))
    }
    else {
      request.identity match{
        case Some(user) => Future.successful(Ok(views.html.signIn(SignInForm.form, "/gtresolution", Some(user))))
        case None => Future.successful(Ok(views.html.signIn(SignInForm.form, "/gtresolution")))
      }
      
    }
  }

  def getLabelData(labelId: Int) = UserAwareAction.async { implicit request =>
  	LabelPointTable.find(labelId) match {
    	case Some(labelPointObj) =>
    	  val labelMetadata = LabelTable.getLabelMetadata(labelId)
    	  val labelMetadataJson: JsObject = LabelTable.labelMetadataToJson(labelMetadata)
    	  Future.successful(Ok(labelMetadataJson))
    	case _ => Future.successful(Ok(Json.obj("error" -> "no such label")))
  	}
  }
}
  