package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{ Environment, Silhouette }
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.user.User
import play.api.Play.current
import play.api.Play

import scala.concurrent.Future


class MapController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
   * Returns an index page.
 *
   * @return
   */
  def edit = UserAwareAction.async { implicit request =>
    val cityStr: String = Play.configuration.getString("city-id").get
    request.identity match {
      case Some(user) =>Future.successful(Ok(views.html.mapEdit("Project Sidewalk", Some(user), cityStr)))
      case None => Future.successful(Redirect("/anonSignUp?url=/map/edit"))
    }
  }
}
