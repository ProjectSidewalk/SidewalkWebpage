package service

import com.google.inject.ImplementedBy
import formats.json.RouteBuilderFormats.{NewRoute, NewRouteStreet, RouteUpdate}
import models.route._
import models.utils.{MyPostgresProfile, PolylineEncoder, ProfanityGuard, SlugUtils}
import models.utils.MyPostgresProfile.api._
import org.postgresql.util.PSQLException
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import java.util.UUID
import javax.inject._
import scala.collection.mutable
import scala.concurrent.{ExecutionContext, Future}

/**
 * Business logic for user-created routes (RouteBuilder): saving, listing, updating, and soft-deleting.
 */
@ImplementedBy(classOf[RouteServiceImpl])
trait RouteService {
  def saveRoute(route: NewRoute, userId: String): Future[Either[RouteRejection, (Int, String, String)]]
  def getRoutesForUser(userId: String): Future[Seq[RouteWithStats]]
  def getRouteStreets(routeId: Int): Future[Option[Seq[RouteStreet]]]
  def updateRoute(
      routeId: Int,
      userId: String,
      update: RouteUpdate
  ): Future[Either[RouteRejection, Option[(String, String)]]]
  def resolveSlug(slug: String): Future[Option[Int]]
  def deleteRoute(routeId: Int, userId: String): Future[Boolean]
}

@Singleton
class RouteServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    routeTable: RouteTable,
    routeStreetTable: RouteStreetTable,
    routeSlugAliasTable: RouteSlugAliasTable,
    auditTaskUserRouteTable: AuditTaskUserRouteTable,
    implicit val ec: ExecutionContext
) extends RouteService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  /** SQLState for a Postgres unique-constraint violation, the backstop for concurrent slug generation. */
  private val UniqueViolation: String = "23505"

  /**
   * Runs a slug-generating action, retrying once if a concurrent save grabbed the same slug between our
   * uniqueness check and the insert (the action recomputes the slug, so the retry picks the next free suffix).
   */
  private def withSlugRetry[T](action: => Future[T]): Future[T] = {
    action.recoverWith { case e: PSQLException if e.getSQLState == UniqueViolation => action }
  }

  /**
   * Picks a unique slug for the given name: the slugified name itself, or the first free "-2"/"-3"/... variant.
   *
   * Slugs of deleted routes and retired slugs in route_slug_alias stay reserved so recycled slugs can't point an
   * old share link at a different route. The route's own current slug and own aliases are treated as free —
   * renaming a route back to an earlier name reclaims the earlier slug (its alias row is deleted here so the
   * slug can become current again).
   *
   * @param name        The route name to slugify.
   * @param ownRouteId  The route being renamed, if any; its own slugs don't block the candidate.
   */
  private def uniqueSlugAction(name: String, ownRouteId: Option[Int]): DBIO[String] = {
    val base: String = SlugUtils.slugify(name)
    for {
      routeSlugs: Seq[(String, Int)] <- routeTable.slugsStartingWith(base)
      aliasSlugs: Seq[(String, Int)] <- routeSlugAliasTable.slugsStartingWith(base)
      taken: Set[String] = (routeSlugs ++ aliasSlugs).collect {
        case (slug, routeId) if !ownRouteId.contains(routeId) => slug
      }.toSet
      candidate: String =
        if (!taken.contains(base)) { base }
        else { LazyList.from(2).map(n => s"$base-$n").find(!taken.contains(_)).get }
      // If the candidate is one of the route's own retired slugs, reclaim it (no-op otherwise).
      _ <- ownRouteId.map(routeSlugAliasTable.deleteOwnAlias(candidate, _)).getOrElse(DBIO.successful(0))
    } yield candidate
  }

  /** Trims a submitted description, mapping blank to None (a cleared/absent description is stored as NULL). */
  private def cleanDescription(description: Option[String]): Option[String] =
    description.map(_.trim).filter(_.nonEmpty)

  /**
   * Checks one piece of user-supplied route text against its length limit and the profanity guard.
   *
   * @param value     The raw submitted text; absent or blank is acceptable (name falls back to a default,
   *                  description is simply cleared).
   * @param maxLength The limit for this field, interpolated into the length message.
   * @param field     The key segment naming the field ("name"/"description").
   * @return          The first failing check, or None when the text is acceptable.
   */
  private def textRejection(value: Option[String], maxLength: Int, field: String): Option[RouteRejection] = {
    val trimmed: String = value.map(_.trim).getOrElse("")
    if (trimmed.length > maxLength) Some(RouteRejection(s"routebuilder.$field.error.length", maxLength))
    else if (trimmed.nonEmpty && !ProfanityGuard.isClean(trimmed))
      Some(RouteRejection(s"routebuilder.$field.error.allowed", maxLength))
    else None
  }

  /**
   * Applies the content contract to a route's user-supplied name and description, so every entry point enforces
   * the same limits rather than each caller re-implementing them.
   *
   * @return The first failing check, or None when both are acceptable.
   */
  private def contentRejection(name: Option[String], description: Option[String]): Option[RouteRejection] =
    textRejection(name, Route.MaxNameLength, "name")
      .orElse(textRejection(description, Route.MaxDescriptionLength, "description"))

  /**
   * Saves a new route and its ordered streets, generating a unique URL slug from the route's name.
   *
   * If no name was submitted, the route is named "Route <id>" (which needs the id, so the row is inserted with a
   * placeholder slug that is replaced in the same transaction).
   *
   * @return The new route's id, saved name, and slug, or Left if the name or description was rejected.
   */
  def saveRoute(route: NewRoute, userId: String): Future[Either[RouteRejection, (Int, String, String)]] =
    contentRejection(route.name, route.description) match {
      case Some(rejection) => Future.successful(Left(rejection))
      case None            => saveRouteAction(route, userId).map(Right(_))
    }

  private def saveRouteAction(route: NewRoute, userId: String): Future[(Int, String, String)] = withSlugRetry {
    val submittedName: Option[String] = route.name.map(_.trim).filter(_.nonEmpty)
    val description: Option[String]   = cleanDescription(route.description)
    db.run((for {
      initialSlug: String <- submittedName
        .map(uniqueSlugAction(_, None))
        .getOrElse(DBIO.successful(s"route-tmp-${UUID.randomUUID}"))
      routeId: Int <- routeTable.insert(
        Route(0, userId, route.regionId, submittedName.getOrElse(""), initialSlug, description, public = false,
          deleted = false, OffsetDateTime.now)
      )
      savedName: String = submittedName.getOrElse(s"Route $routeId")
      savedSlug: String <-
        if (submittedName.isEmpty) {
          for {
            slug: String <- uniqueSlugAction(savedName, Some(routeId))
            _            <- routeTable.updateNameAndSlug(routeId, userId, savedName, slug)
          } yield slug
        } else { DBIO.successful(initialSlug) }
      newRouteStreets = route.streets.zipWithIndex.map { case (street, position) =>
        RouteStreet(0, routeId, street.streetId, street.reverse, position)
      }
      _ <- routeStreetTable.insertMultiple(newRouteStreets)
    } yield (routeId, savedName, savedSlug)).transactionally)
  }

  /**
   * Gets a user's routes with display stats, usage counts (how many users started/completed each in Explore), and
   * an encoded-polyline geometry for static-map thumbnails.
   */
  def getRoutesForUser(userId: String): Future[Seq[RouteWithStats]] = {
    db.run(routeTable.getRoutesForUser(userId)).flatMap { routes =>
      val routeIds = routes.map(_.routeId)
      if (routeIds.isEmpty) {
        Future.successful(routes)
      } else {
        for {
          usage      <- db.run(routeTable.getUsageCounts(routeIds))
          geometries <- db.run(routeTable.getStreetGeometries(routeIds))
        } yield {
          val polylines: Map[Int, String] = geometries.groupBy(_._1).map { case (routeId, streets) =>
            // Concatenate the streets' coordinates in walking order (flipping reversed streets), then thin the
            // path — thumbnails are tiny, and the polyline rides in a URL.
            val coords: Seq[(Double, Double)] = streets.flatMap { case (_, reverse, geom) =>
              val pts = geom.getCoordinates.map(c => (c.x, c.y)).toSeq
              if (reverse) pts.reverse else pts
            }
            routeId -> PolylineEncoder.encode(PolylineEncoder.decimate(coords, 60))
          }
          routes.map { route =>
            val (started, completed) = usage.getOrElse(route.routeId, (0, 0))
            route.copy(
              startedCount = started,
              completedCount = completed,
              encodedPolyline = polylines.getOrElse(route.routeId, "")
            )
          }
        }
      }
    }
  }

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
   * Updates a route owned by the given user: any subset of its name (regenerating the slug and retiring the old
   * one as a redirect alias), its public description, and its full street list (reconciled in place so the route
   * keeps its id, stats, and share links).
   *
   * @return The route's resulting (name, slug); Right(None) if the route doesn't exist, is deleted, or isn't
   *         owned by userId; Left if the name or description was rejected.
   */
  def updateRoute(
      routeId: Int,
      userId: String,
      update: RouteUpdate
  ): Future[Either[RouteRejection, Option[(String, String)]]] =
    contentRejection(update.name, update.description) match {
      case Some(rejection) => Future.successful(Left(rejection))
      case None            => updateRouteAction(routeId, userId, update).map(Right(_))
    }

  private def updateRouteAction(routeId: Int, userId: String, update: RouteUpdate): Future[Option[(String, String)]] =
    withSlugRetry {
      db.run((for {
        routeOpt: Option[Route] <- routeTable.getRouteOwned(routeId, userId)
        result                  <- routeOpt match {
          case None        => DBIO.successful(None)
          case Some(route) =>
            val newName: Option[String] = update.name.map(_.trim).filter(n => n.nonEmpty && n != route.name)
            for {
              nameAndSlug: (String, String) <- newName match {
                case None       => DBIO.successful((route.name, route.slug))
                case Some(name) =>
                  for {
                    slug: String <- uniqueSlugAction(name, Some(routeId))
                    _            <- routeTable.updateNameAndSlug(routeId, userId, name, slug)
                    // Retire the outgoing slug so its share links keep redirecting.
                    _ <-
                      if (slug != route.slug) {
                        routeSlugAliasTable.insert(RouteSlugAlias(route.slug, routeId, OffsetDateTime.now))
                      } else { DBIO.successful(0) }
                  } yield (name, slug)
              }
              _ <- update.description match {
                case Some(desc) => routeTable.updateDescription(routeId, userId, cleanDescription(Some(desc)))
                case None       => DBIO.successful(0)
              }
              _ <- update.streets match {
                case Some(streets) => reconcileStreetsAction(routeId, streets)
                case None          => DBIO.successful(())
              }
            } yield Some(nameAndSlug)
        }
      } yield result).transactionally)
    }

  /**
   * Replaces a route's street list in place, preserving the route_street rows of streets that stay in the route.
   *
   * Preserving surviving rows matters because audit_task_user_route rows (a user's route progress in Explore)
   * FK-reference them: an in-progress exploration keeps its progress on surviving streets, loses it only for
   * removed streets, and picks up added streets — completion recomputes naturally on the user's next submission.
   * Rows are matched greedily in walking order by street_edge_id, which also handles a street appearing twice in
   * one route (e.g. an out-and-back).
   *
   * Statement order works around the non-deferrable UNIQUE (route_id, position) from evolution 344. Removals go
   * first to free their positions; then every row whose position changes is parked out past the end of both the
   * old and the new walking order before any final value is written. Without that parking pass, any edit that
   * isn't a pure tail append — reverse, reorder, mid-route insert, non-tail removal — transiently duplicates a
   * (route_id, position) pair and the whole transaction fails with a 23505.
   */
  private def reconcileStreetsAction(routeId: Int, newStreets: Seq[NewRouteStreet]): DBIO[Unit] = {
    routeStreetTable.getRouteStreets(routeId).flatMap { existing =>
      val unmatched: mutable.Map[Int, mutable.Queue[RouteStreet]] =
        mutable.Map.from(existing.groupBy(_.streetEdgeId).view.mapValues(rows => mutable.Queue.from(rows)))

      // Pair each street of the new walking order with the surviving row it reuses, or None when it's new.
      val matched: Seq[(NewRouteStreet, Int, Option[RouteStreet])] = newStreets.zipWithIndex.map {
        case (street, position) =>
          val row: Option[RouteStreet] =
            unmatched.get(street.streetId).flatMap(queue => if (queue.nonEmpty) Some(queue.dequeue()) else None)
          (street, position, row)
      }
      val removedIds: Seq[Int]                     = unmatched.values.flatten.map(_.routeStreetId).toSeq
      val reused: Seq[(RouteStreet, Int, Boolean)] = matched.collect { case (street, position, Some(row)) =>
        (row, position, street.reverse)
      }
      // A row that keeps its position is never collided with, since the target positions are distinct, so only
      // the rows that actually move need parking.
      val movers: Seq[(RouteStreet, Int, Boolean)] = reused.filter { case (row, position, _) =>
        row.position != position
      }
      val rewrites: Seq[(RouteStreet, Int, Boolean)] = reused.filter { case (row, position, reverse) =>
        row.position != position || row.reverse != reverse
      }
      val additions: Seq[RouteStreet] = matched.collect { case (street, position, None) =>
        RouteStreet(0, routeId, street.streetId, street.reverse, position)
      }
      // Parking spots sit past the end of both the old and the new order, so they collide with neither, and stay
      // non-negative for route_street's CHECK (position >= 0).
      val parkOffset: Int = math.max(existing.size, newStreets.size)

      for {
        // Progress links FK-reference the removed rows, so they go first; the audit tasks themselves survive.
        _ <-
          if (removedIds.nonEmpty) auditTaskUserRouteTable.deleteForRouteStreets(removedIds)
          else DBIO.successful(0)
        _ <- if (removedIds.nonEmpty) routeStreetTable.deleteByIds(removedIds) else DBIO.successful(0)
        _ <- DBIO.sequence(movers.map { case (row, position, _) =>
          routeStreetTable.updatePosition(row.routeStreetId, position + parkOffset)
        })
        _ <- DBIO.sequence(rewrites.map { case (row, position, reverse) =>
          routeStreetTable.updatePositionAndReverse(row.routeStreetId, position, reverse)
        })
        _ <- if (additions.nonEmpty) routeStreetTable.insertMultiple(additions) else DBIO.successful(Seq.empty[Int])
      } yield ()
    }
  }

  /**
   * Resolves a share slug to a route id: the current slug of a live route, or a retired slug still redirecting.
   *
   * @return None if the slug is unknown or its route has been soft-deleted.
   */
  def resolveSlug(slug: String): Future[Option[Int]] =
    db.run(routeTable.getRouteIdBySlug(slug)).flatMap {
      case Some(routeId) => Future.successful(Some(routeId))
      case None          =>
        db.run(routeSlugAliasTable.getRouteIdBySlug(slug)).flatMap {
          case Some(routeId) => db.run(routeTable.getRoute(routeId)).map(_.map(_.routeId))
          case None          => Future.successful(None)
        }
    }

  /**
   * Soft-deletes a route owned by the given user. Share links to the route stop working.
   *
   * @return False if the route doesn't exist, is already deleted, or isn't owned by userId.
   */
  def deleteRoute(routeId: Int, userId: String): Future[Boolean] =
    db.run(routeTable.softDelete(routeId, userId)).map(_ > 0)
}
