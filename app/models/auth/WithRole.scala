package models.auth

import com.mohiva.play.silhouette.api.Authorization
import models.user.SidewalkUserWithRole

import scala.concurrent.Future
import play.api.mvc.Request

case class WithRole(role: String) extends Authorization[SidewalkUserWithRole, DefaultEnv#A] {
  override def isAuthorized[B](identity: SidewalkUserWithRole, authenticator: DefaultEnv#A)(implicit request: Request[B]): Future[Boolean] = {
    Future.successful(identity.role == role)
  }
}

case class WithAdmin() extends Authorization[SidewalkUserWithRole, DefaultEnv#A] {
  override def isAuthorized[B](identity: SidewalkUserWithRole, authenticator: DefaultEnv#A)(implicit request: Request[B]): Future[Boolean] = {
    Future.successful(Seq("Administrator", "Owner").contains(identity.role))
  }
}

case class WithSignedIn() extends Authorization[SidewalkUserWithRole, DefaultEnv#A] {
  override def isAuthorized[B](identity: SidewalkUserWithRole, authenticator: DefaultEnv#A)(implicit request: Request[B]): Future[Boolean] = {
    Future.successful(identity.role != "Anonymous")
  }
}
