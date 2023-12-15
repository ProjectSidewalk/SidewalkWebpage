package controllers

import controllers.helper.FileUtils
import models.user.User
import play.api.mvc.Action

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader

import java.io.File
import scala.concurrent.Future

class CVHelper @Inject()(implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

	def getCVResults(labelId: String) = Action { implicit request =>

		val CVresults = FileUtils.readFileToBase64String(".cv-results" + File.separator + labelId + ".json")
		Ok(CVresults)

	}

}
