package models.pano

import com.google.inject.ImplementedBy
import models.user.SidewalkUserTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}

/**
 * One Mapillary source this deployment favours (#5407), managed from /admin/imagery. How it is favoured is the
 * deployment's [[MapillarySourceMode]].
 *
 * @param sourceType  What kind of thing `sourceValue` names; see [[MapillarySource.Creator]].
 * @param sourceValue The Mapillary username, spelled exactly as Mapillary spells it.
 * @param addedBy     The admin who added it, or None for a row added by hand in SQL.
 * @param addedAt     When it was added.
 */
case class MapillarySource(
    sourceType: String,
    sourceValue: String,
    addedBy: Option[String],
    addedAt: OffsetDateTime
)

object MapillarySource {

  /** A Mapillary username. The only source type so far, and the DB CHECK (411.sql) admits no other. */
  val Creator: String = "creator"
}

/**
 * How a deployment's listed Mapillary sources apply (`config.mapillary_source_mode`, #5407). Ignored while no source
 * is listed.
 */
sealed abstract class MapillarySourceMode(val name: String)

object MapillarySourceMode {

  /**
   * A listed creator's pano wins when one is within `preferredCreatorMaxDistanceMeters` (conf/pano-scoring.json) of
   * the target; everyone's imagery is ranked as usual otherwise. Which streets have imagery is unchanged.
   */
  case object Prefer extends MapillarySourceMode("prefer")

  /** Only listed creators' imagery is used at all. The default the DB column takes is [[Prefer]]. */
  case object Restrict extends MapillarySourceMode("restrict")

  val all: Seq[MapillarySourceMode] = Seq(Prefer, Restrict)

  /** Parses a mode by name, as stored in the DB CHECK (411.sql) and sent by the admin page. */
  def fromName(name: String): Option[MapillarySourceMode] = all.find(_.name == name)
}

class MapillarySourceTableDef(tag: Tag) extends Table[MapillarySource](tag, "mapillary_source") {
  def sourceType: Rep[String]      = column[String]("source_type")      // DB CHECK (411.sql): IN ('creator').
  def sourceValue: Rep[String]     = column[String]("source_value")     // DB CHECK (411.sql): non-empty, trimmed.
  def addedBy: Rep[Option[String]] = column[Option[String]]("added_by")
  def addedAt: Rep[OffsetDateTime] = column[OffsetDateTime]("added_at") // DEFAULT now() in the DB.

  def * = (sourceType, sourceValue, addedBy, addedAt) <> (
    (MapillarySource.apply _).tupled,
    MapillarySource.unapply
  )

  def pk = primaryKey("mapillary_source_pkey", (sourceType, sourceValue))

  def addedByUser =
    foreignKey("mapillary_source_added_by_fkey", addedBy, TableQuery[SidewalkUserTableDef])(_.userId.?)
}

@ImplementedBy(classOf[MapillarySourceTable])
trait MapillarySourceTableRepository {}

/**
 * DAO over the Mapillary sources a deployment favours (#5407).
 *
 * An empty table means no source is favoured, which is every deployment's state until an admin adds one. What a
 * listed source does (preferred or exclusive) is the deployment's [[MapillarySourceMode]], kept in `config`.
 */
@Singleton
class MapillarySourceTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends MapillarySourceTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val sources       = TableQuery[MapillarySourceTableDef]
  val sidewalkUsers = TableQuery[SidewalkUserTableDef]

  /** Every listed source, oldest first, which is the order an admin added them in. */
  def all: DBIO[Seq[MapillarySource]] = sources.sortBy(s => (s.addedAt, s.sourceValue)).result

  /**
   * Every listed source paired with the username of the admin who added it, for the admin list. The username is
   * None for a source added by hand in SQL.
   */
  def allWithAdder: DBIO[Seq[(MapillarySource, Option[String])]] = {
    sources
      .joinLeft(sidewalkUsers)
      .on(_.addedBy === _.userId)
      .sortBy { case (source, _) => (source.addedAt, source.sourceValue) }
      .map { case (source, user) => (source, user.map(_.username)) }
      .result
  }

  /**
   * Adds a creator to the list. Idempotent: re-adding a listed creator changes nothing, so the original `added_by`
   * and `added_at` keep saying who listed them and when.
   *
   * @param username The Mapillary username, already trimmed and verified to exist by the caller.
   * @param addedBy  The admin adding it.
   * @return 1 if a row was inserted, 0 if the creator was already listed.
   */
  def addCreator(username: String, addedBy: String): DBIO[Int] = {
    sqlu"""
      INSERT INTO mapillary_source (source_type, source_value, added_by)
      VALUES (${MapillarySource.Creator}, $username, $addedBy)
      ON CONFLICT (source_type, source_value) DO NOTHING;
    """
  }

  /** Removes a creator from the list, returning the number of rows deleted (0 or 1). */
  def removeCreator(username: String): DBIO[Int] = {
    sources
      .filter(s => s.sourceType === MapillarySource.Creator && s.sourceValue === username)
      .delete
  }
}
