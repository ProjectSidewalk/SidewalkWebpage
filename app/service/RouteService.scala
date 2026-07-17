package service

import com.google.inject.ImplementedBy
import formats.json.RouteBuilderFormats.NewRoute
import models.route.{Route, RouteStreet, RouteStreetTable, RouteTable, RouteWithStats}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

/**
 * Business logic for user-created routes (RouteBuilder): saving, listing, renaming, and soft-deleting.
 */
@ImplementedBy(classOf[RouteServiceImpl])
trait RouteService {
  def saveRoute(route: NewRoute, userId: String): Future[(Int, String)]
  def getRoutesForUser(userId: String): Future[Seq[RouteWithStats]]
  def getRouteStreets(routeId: Int): Future[Option[Seq[RouteStreet]]]
  def renameRoute(routeId: Int, userId: String, newName: String): Future[Boolean]
  def deleteRoute(routeId: Int, userId: String): Future[Boolean]
}

@Singleton
class RouteServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    routeTable: RouteTable,
    routeStreetTable: RouteStreetTable,
    implicit val ec: ExecutionContext
) extends RouteService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  /**
   * Saves a new route and its ordered streets.
   *
   * The order of the streets is preserved when saving to db (route_street's serial id carries the sequence).
   * If no name was submitted, the route is named "Route <id>".
   *
   * @return The new route's id and its saved name.
   */
  def saveRoute(route: NewRoute, userId: String): Future[(Int, String)] = {
    val submittedName: Option[String] = route.name.map(_.trim).filter(_.nonEmpty)
    db.run((for {
      routeId: Int <- routeTable.insert(
        Route(0, userId, route.regionId, submittedName.getOrElse(""), public = false, deleted = false,
          OffsetDateTime.now)
      )
      savedName: String = submittedName.getOrElse(s"Route $routeId")
      _ <- if (submittedName.isEmpty) routeTable.rename(routeId, userId, savedName) else DBIO.successful(0)
      newRouteStreets = route.streets.map(street => RouteStreet(0, routeId, street.streetId, street.reverse))
      _ <- routeStreetTable.insertMultiple(newRouteStreets)
    } yield (routeId, savedName)).transactionally)
  }

  def getRoutesForUser(userId: String): Future[Seq[RouteWithStats]] = db.run(routeTable.getRoutesForUser(userId))

  /**
   * Gets a route's ordered street list. No ownership restriction: routes are shareable by id (/explore?routeId=),
   * so the street list carries no more than the share link already exposes.
   *
   * @return None when the route doesn't exist or has been soft-deleted.
   */
  def getRouteStreets(routeId: Int): Future[Option[Seq[RouteStreet]]] =
    db.run(routeTable.getRoute(routeId)).flatMap {
      case Some(_) => db.run(routeStreetTable.getRouteStreets(routeId)).map(Option(_))
      case None    => Future.successful(None)
    }

  /**
   * Renames a route owned by the given user.
   *
   * @return False if the route doesn't exist, is deleted, or isn't owned by userId.
   */
  def renameRoute(routeId: Int, userId: String, newName: String): Future[Boolean] =
    db.run(routeTable.rename(routeId, userId, newName)).map(_ > 0)

  /**
   * Soft-deletes a route owned by the given user. Share links to the route stop working.
   *
   * @return False if the route doesn't exist, is already deleted, or isn't owned by userId.
   */
  def deleteRoute(routeId: Int, userId: String): Future[Boolean] =
    db.run(routeTable.softDelete(routeId, userId)).map(_ > 0)
}
