package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.user.User

import scala.concurrent.Future

import scala.sys.process._


class ClusteringController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  // Helper methods
  def isAdmin(user: Option[User]): Boolean = user match {
    case Some(user) =>
      if (user.roles.getOrElse(Seq()).contains("Administrator")) true else false
    case _ => false
  }

  // Pages
  def index = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val clusteringOutput = "python label_clustering.py".!!
      println(clusteringOutput)
      Future.successful(Ok(views.html.clustering("Project Sidewalk", request.identity)))
    } else {
      Future.successful(Redirect("/"))
    }
  }

}
