package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.clustering_session.{ClusteringSessionTable}
import models.user.User
import play.api.libs.json.{JsObject, Json}

import scala.concurrent.Future

class ClusteringSessionController @Inject()(implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
    * Returns all records in clusterin_session table that are not marked as deleted.
    */
  def getClusteringSessionsWithoutDeleted = UserAwareAction.async { implicit request =>
    val clusteringSessions= ClusteringSessionTable.selectSessionsWithoutDeleted

    val ses: List[JsObject] = clusteringSessions.map { clusteringSession =>
      val clusteringSessionId: Int = clusteringSession.clusteringSessionId
      val routeId: Int = clusteringSession.routeId
      val clustering_threshold: Double = clusteringSession.clustering_threshold
      val time_created: java.sql.Timestamp = clusteringSession.time_created
      val deleted: Boolean = clusteringSession.deleted
      Json.obj("clusteringSessionId" -> clusteringSessionId, "routeId" -> routeId,
               "clustering_threshold" -> clustering_threshold, "time_created" -> time_created, "deleted" -> deleted)
    }
    val sessionCollection = Json.obj("sessions" -> ses)
    Future.successful(Ok(sessionCollection))
  }

}