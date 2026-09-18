package models.pano

import com.google.inject.ImplementedBy
import models.user.SidewalkUserTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}

/**
 * One Mapillary source this deployment is restricted to (#5407), managed from /admin/imagery.
 *
 * @param sourceType  What kind of thing `sourceValue` names; see [[MapillaryAllowedSource.Creator]].
 * @param sourceValue The Mapillary username, spelled exactly as Mapillary spells it.
 * @param addedBy     The admin who added it, or None when the onboarding tooling seeded it before any user existed.
 * @param addedAt     When it was added.
 */
case class MapillaryAllowedSource(
    sourceType: String,
    sourceValue: String,
    addedBy: Option[String],
    addedAt: OffsetDateTime
)

object MapillaryAllowedSource {

  /** A Mapillary username. The only source type so far, and the DB CHECK (396.sql) admits no other. */
  val Creator: String = "creator"
}

class MapillaryAllowedSourceTableDef(tag: Tag) extends Table[MapillaryAllowedSource](tag, "mapillary_allowed_source") {
  def sourceType: Rep[String]      = column[String]("source_type")      // DB CHECK (396.sql): IN ('creator').
  def sourceValue: Rep[String]     = column[String]("source_value")     // DB CHECK (396.sql): non-empty, trimmed.
  def addedBy: Rep[Option[String]] = column[Option[String]]("added_by")
  def addedAt: Rep[OffsetDateTime] = column[OffsetDateTime]("added_at") // DEFAULT now() in the DB.

  def * = (sourceType, sourceValue, addedBy, addedAt) <> (
    (MapillaryAllowedSource.apply _).tupled,
    MapillaryAllowedSource.unapply
  )

  def pk = primaryKey("mapillary_allowed_source_pkey", (sourceType, sourceValue))

  def addedByUser =
    foreignKey("mapillary_allowed_source_added_by_fkey", addedBy, TableQuery[SidewalkUserTableDef])(_.userId.?)
}

@ImplementedBy(classOf[MapillaryAllowedSourceTable])
trait MapillaryAllowedSourceTableRepository {}

/**
 * DAO over the deployment's Mapillary source restriction (#5407).
 *
 * An empty table means the deployment is unfiltered, which is every deployment's state until an admin adds a source.
 * One row or more turns the restriction on for the three places that discover Mapillary panos: the pano viewer's
 * location search, the street imagery scan, and the nightly imagery-age poll.
 */
@Singleton
class MapillaryAllowedSourceTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends MapillaryAllowedSourceTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val allowedSources = TableQuery[MapillaryAllowedSourceTableDef]
  val sidewalkUsers  = TableQuery[SidewalkUserTableDef]

  /** Every allowed source, oldest first, which is the order an admin added them in. */
  def all: DBIO[Seq[MapillaryAllowedSource]] = allowedSources.sortBy(s => (s.addedAt, s.sourceValue)).result

  /**
   * Every allowed source paired with the username of the admin who added it, for the admin list. The username is
   * None for a source the onboarding tooling seeded.
   */
  def allWithAdder: DBIO[Seq[(MapillaryAllowedSource, Option[String])]] = {
    allowedSources
      .joinLeft(sidewalkUsers)
      .on(_.addedBy === _.userId)
      .sortBy { case (source, _) => (source.addedAt, source.sourceValue) }
      .map { case (source, user) => (source, user.map(_.username)) }
      .result
  }

  /**
   * Adds a creator to the allowlist. Idempotent: re-adding a listed creator changes nothing, so the original
   * `added_by` and `added_at` keep saying who turned the restriction on and when.
   *
   * @param username The Mapillary username, already trimmed and verified to exist by the caller.
   * @param addedBy  The admin adding it.
   * @return 1 if a row was inserted, 0 if the creator was already listed.
   */
  def addCreator(username: String, addedBy: String): DBIO[Int] = {
    sqlu"""
      INSERT INTO mapillary_allowed_source (source_type, source_value, added_by)
      VALUES (${MapillaryAllowedSource.Creator}, $username, $addedBy)
      ON CONFLICT (source_type, source_value) DO NOTHING;
    """
  }

  /** Removes a creator from the allowlist, returning the number of rows deleted (0 or 1). */
  def removeCreator(username: String): DBIO[Int] = {
    allowedSources
      .filter(s => s.sourceType === MapillaryAllowedSource.Creator && s.sourceValue === username)
      .delete
  }
}
