package models.street

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.{LocalDate, OffsetDateTime}
import javax.inject.{Inject, Singleton}

/**
 * Per-street imagery age (#4348): the capture-date range of the street-view panos observed on one street.
 *
 * Complements street_edge_status (#3888): status says whether a street has imagery; this says how old it is (a street
 * can be `open` yet years out of date). One row per street, aggregated across providers.
 *
 * @param streetEdgeId  The street this imagery summary is for.
 * @param oldestCapture Earliest observed capture date, standardized to a date (`None` if none were parseable).
 * @param newestCapture Latest observed capture date, standardized to a date (`None` if none were parseable).
 * @param nPanos        Number of distinct dated panos observed on the street.
 * @param dataSource    Which feeder produced this row: `pano_data` (in-app backfill) or `imagery_scan` (the
 *                      check_streets_for_imagery.py summary).
 * @param updatedAt     When this row was last written.
 */
case class StreetImagery(
    streetEdgeId: Int,
    oldestCapture: Option[LocalDate],
    newestCapture: Option[LocalDate],
    nPanos: Int,
    dataSource: String,
    updatedAt: OffsetDateTime
)

class StreetImageryTableDef(tag: Tag) extends Table[StreetImagery](tag, "street_imagery") {
  def streetEdgeId: Rep[Int]                = column[Int]("street_edge_id", O.PrimaryKey)
  def oldestCapture: Rep[Option[LocalDate]] = column[Option[LocalDate]]("oldest_capture")
  def newestCapture: Rep[Option[LocalDate]] = column[Option[LocalDate]]("newest_capture")
  def nPanos: Rep[Int]                      = column[Int]("n_panos")
  def dataSource: Rep[String]               = column[String]("data_source")
  def updatedAt: Rep[OffsetDateTime]        = column[OffsetDateTime]("updated_at")

  def * = (streetEdgeId, oldestCapture, newestCapture, nPanos, dataSource, updatedAt) <>
    ((StreetImagery.apply _).tupled, StreetImagery.unapply)

  def streetEdge =
    foreignKey("street_imagery_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(_.streetEdgeId)
}

@ImplementedBy(classOf[StreetImageryTable]) trait StreetImageryTableRepository {}

/**
 * Read-only DAO for the street_imagery table. The table is populated out-of-band by the two feeders (the evolution-326
 * pano_data backfill and db/scripts/import-street-imagery.sh); this DAO exists so app code can read imagery age. Exposure
 * (admin viz, a /v3 field) is a separate follow-up.
 */
@Singleton
class StreetImageryTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends StreetImageryTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  import profile.api._
  val streetImageryRecords = TableQuery[StreetImageryTableDef]

  /**
   * Imagery age for a single street.
   *
   * @param streetEdgeId The street to look up.
   * @return The street's imagery summary, or `None` if no imagery has been recorded for it.
   */
  def getForStreet(streetEdgeId: Int): DBIO[Option[StreetImagery]] = {
    streetImageryRecords.filter(_.streetEdgeId === streetEdgeId).result.headOption
  }

  /**
   * Number of streets that have a recorded imagery summary.
   */
  def count: DBIO[Int] = streetImageryRecords.length.result
}
