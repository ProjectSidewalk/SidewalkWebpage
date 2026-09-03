package models.route

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}

case class RouteSlugAlias(slug: String, routeId: Int, createdAt: OffsetDateTime)

class RouteSlugAliasTableDef(tag: slick.lifted.Tag) extends Table[RouteSlugAlias](tag, "route_slug_alias") {
  def slug: Rep[String] = column[String]("slug", O.PrimaryKey)
  def routeId: Rep[Int] = column[Int]("route_id")
  // DEFAULT now() in the DB (O.Default holds a value, not an expression).
  def createdAt: Rep[OffsetDateTime] = column[OffsetDateTime]("created_at")

  def * = (slug, routeId, createdAt) <> ((RouteSlugAlias.apply _).tupled, RouteSlugAlias.unapply)

  def route = foreignKey("route_slug_alias_route_id_fkey", routeId, TableQuery[RouteTableDef])(_.routeId)
}

@ImplementedBy(classOf[RouteSlugAliasTable])
trait RouteSlugAliasTableRepository {}

/**
 * Retired slugs of renamed routes. A rename regenerates the route's slug from the new name and parks the retiring
 * slug here, so every /r/<slug> link a route has ever had keeps redirecting to it.
 */
@Singleton
class RouteSlugAliasTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends RouteSlugAliasTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val slugAliases = TableQuery[RouteSlugAliasTableDef]

  def insert(alias: RouteSlugAlias): DBIO[Int] = {
    slugAliases += alias
  }

  /** Gets the (slug, route id) pairs of the retired slugs matching any spelling of an incoming share link. */
  def getRouteIdsBySlugs(slugs: Seq[String]): DBIO[Seq[(String, Int)]] = {
    slugAliases.filter(_.slug.inSet(slugs)).map(a => (a.slug, a.routeId)).result
  }

  /**
   * Whether this slug has ever been retired here, including by a route since deleted — which is what keeps a dead
   * share link dead rather than letting it be reread as a bare route id (#5157).
   */
  def slugReserved(slug: String): DBIO[Boolean] = {
    slugAliases.filter(_.slug === slug).exists.result
  }

  /**
   * Gets aliases whose slug is the given base or starts with "<base>-", with their owning route ids — the
   * candidate set the slug uniquifier must avoid (an alias owned by the route being renamed is reclaimable).
   */
  def slugsStartingWith(base: String): DBIO[Seq[(String, Int)]] = {
    slugAliases
      .filter(a => a.slug === base || a.slug.startsWith(base + "-"))
      .map(a => (a.slug, a.routeId))
      .result
  }

  /**
   * Deletes a route's own alias for the given slug, freeing it for reuse (renaming a route back to an earlier
   * name reclaims the earlier slug instead of getting a "-2" suffix).
   */
  def deleteOwnAlias(slug: String, routeId: Int): DBIO[Int] = {
    slugAliases.filter(a => a.slug === slug && a.routeId === routeId).delete
  }
}
