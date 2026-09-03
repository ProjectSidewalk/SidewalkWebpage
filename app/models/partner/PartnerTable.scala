package models.partner

import models.user.SidewalkUserTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.ExecutionContext

/** A community-partner logo shown on the landing page (#4516). `cityId` None means global (every deployment). */
case class Partner(
    partnerId: Int,
    cityId: Option[String],
    name: String,
    url: Option[String],
    altText: Option[String],
    displayOrder: Int,
    logoImage: Array[Byte],
    logoMimeType: String,
    logoWidth: Int,
    logoHeight: Int,
    createdAt: OffsetDateTime,
    updatedAt: OffsetDateTime,
    createdBy: String,
    updatedBy: String
)

/**
 * Everything the landing page and the admin lists need — deliberately excludes the logo bytes, so list queries never
 * drag bytea through the wire; `updatedAt` doubles as the logo URL's cache-busting version.
 */
case class PartnerMetadata(
    partnerId: Int,
    cityId: Option[String],
    name: String,
    url: Option[String],
    altText: Option[String],
    displayOrder: Int,
    logoWidth: Int,
    logoHeight: Int,
    updatedAt: OffsetDateTime
) {

  /**
   * The logo URL's `?v=` cache-busting version — the one definition every renderer of the URL uses. Millisecond
   * granularity, so two logo replacements moments apart still mint distinct URLs (the bytes are served immutable
   * for a year, so a same-second collision would pin the older logo in caches).
   */
  def logoVersion: Long = PartnerMetadata.logoVersionOf(updatedAt)
}

object PartnerMetadata {

  /** See [[PartnerMetadata.logoVersion]] — for callers holding a bare `updated_at` rather than the metadata row. */
  def logoVersionOf(updatedAt: OffsetDateTime): Long = updatedAt.toInstant.toEpochMilli
}

class PartnerTableDef(tag: Tag) extends Table[Partner](tag, "partner") {
  def partnerId: Rep[Int]          = column[Int]("partner_id", O.PrimaryKey, O.AutoInc)
  def cityId: Rep[Option[String]]  = column[Option[String]]("city_id")
  def name: Rep[String]            = column[String]("name")            // CHECK btrim(name) <> '' in the DB.
  def url: Rep[Option[String]]     = column[Option[String]]("url")
  def altText: Rep[Option[String]] = column[Option[String]]("alt_text")
  def displayOrder: Rep[Int]       = column[Int]("display_order")      // CHECK >= 0 in the DB.
  def logoImage: Rep[Array[Byte]]  = column[Array[Byte]]("logo_image") // CHECK octet_length <= 1 MiB in the DB.
  def logoMimeType: Rep[String]    = column[String]("logo_mime_type")  // CHECK IN ('image/png','image/jpeg').
  def logoWidth: Rep[Int]          = column[Int]("logo_width")         // CHECK > 0 in the DB.
  def logoHeight: Rep[Int]         = column[Int]("logo_height")        // CHECK > 0 in the DB.
  // DEFAULT now() in the DB for both timestamps (O.Default holds a value, not an expression).
  def createdAt: Rep[OffsetDateTime] = column[OffsetDateTime]("created_at")
  def updatedAt: Rep[OffsetDateTime] = column[OffsetDateTime]("updated_at")
  def createdBy: Rep[String]         = column[String]("created_by")
  def updatedBy: Rep[String]         = column[String]("updated_by")

  def * = (partnerId, cityId, name, url, altText, displayOrder, logoImage, logoMimeType, logoWidth, logoHeight,
    createdAt, updatedAt, createdBy, updatedBy) <> ((Partner.apply _).tupled, Partner.unapply)

  def creator = foreignKey("partner_created_by_fkey", createdBy, TableQuery[SidewalkUserTableDef])(_.userId)
  def updater = foreignKey("partner_updated_by_fkey", updatedBy, TableQuery[SidewalkUserTableDef])(_.userId)
}

/**
 * Queries for community-partner logos (#4516). The table lives in the shared `sidewalk_login` schema (resolved via
 * search_path, like `user_utm`): a NULL city_id row is a global partner rendered on every deployment's landing page,
 * while a city-id'd row renders only on that city's. `display_order` is a dense 0..n-1 sequence within each scope.
 */
@Singleton
class PartnerTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
    extends HasDatabaseConfigProvider[MyPostgresProfile] {

  val partners = TableQuery[PartnerTableDef]

  /** The metadata projection shared by every list query, so `logo_image` is never selected outside `getLogo`. */
  private def metadataOf(query: Query[PartnerTableDef, Partner, Seq]) = query.map { p =>
    (p.partnerId, p.cityId, p.name, p.url, p.altText, p.displayOrder, p.logoWidth, p.logoHeight, p.updatedAt)
  }

  private val toMetadata = (PartnerMetadata.apply _).tupled

  /** The partners a city's landing page shows: global partners first, then the city's own, each in display order. */
  def getForLanding(cityId: String): DBIO[Seq[PartnerMetadata]] = {
    metadataOf(
      partners
        .filter(p => p.cityId.isEmpty || p.cityId === cityId)
        .sortBy(p => (p.cityId.isDefined, p.displayOrder))
    ).result.map(_.map(toMetadata))
  }

  /** All partners in one scope (None = global), in display order. */
  def getByScope(cityId: Option[String]): DBIO[Seq[PartnerMetadata]] = {
    metadataOf(scopeQuery(cityId).sortBy(_.displayOrder)).result.map(_.map(toMetadata))
  }

  def get(partnerId: Int): DBIO[Option[PartnerMetadata]] = {
    metadataOf(partners.filter(_.partnerId === partnerId)).result.headOption.map(_.map(toMetadata))
  }

  def getLogo(partnerId: Int): DBIO[Option[(Array[Byte], String, OffsetDateTime)]] = {
    partners.filter(_.partnerId === partnerId).map(p => (p.logoImage, p.logoMimeType, p.updatedAt)).result.headOption
  }

  /** Inserts at the end of its scope's display order; returns the new row's metadata. */
  def insert(partner: Partner): DBIO[PartnerMetadata] = {
    (for {
      maxOrder <- scopeQuery(partner.cityId).map(_.displayOrder).max.result
      inserted <- (partners returning partners.map(_.partnerId)) += partner
        .copy(displayOrder = maxOrder.map(_ + 1).getOrElse(0))
      metadata <- get(inserted)
    } yield metadata.get).transactionally
  }

  /** Updates the text fields (and the logo when `newLogo` is present); returns the count of rows updated. */
  def update(
      partnerId: Int,
      name: String,
      url: Option[String],
      altText: Option[String],
      newLogo: Option[(Array[Byte], String, Int, Int)],
      updatedBy: String,
      now: OffsetDateTime
  ): DBIO[Int] = {
    val row = partners.filter(_.partnerId === partnerId)
    newLogo match {
      case Some((bytes, mime, width, height)) =>
        row
          .map(p =>
            (p.name, p.url, p.altText, p.logoImage, p.logoMimeType, p.logoWidth, p.logoHeight, p.updatedAt, p.updatedBy)
          )
          .update((name, url, altText, bytes, mime, width, height, now, updatedBy))
      case None =>
        row
          .map(p => (p.name, p.url, p.altText, p.updatedAt, p.updatedBy))
          .update((name, url, altText, now, updatedBy))
    }
  }

  def delete(partnerId: Int): DBIO[Int] = partners.filter(_.partnerId === partnerId).delete

  /**
   * Validates that `orderedIds` is a permutation of exactly the scope's current ids — nothing missing, nothing
   * foreign, so a reorder can never move a row between scopes or drop one — and rewrites `display_order` to match
   * (position = index). Check and writes share one transaction, so a create or delete can't slip between them and
   * leave a half-applied order.
   *
   * @return Whether the order was applied; false (with no writes) when the id sets differ.
   */
  def reorderScope(cityId: Option[String], orderedIds: Seq[Int]): DBIO[Boolean] = {
    (for {
      currentIds <- scopeQuery(cityId).map(_.partnerId).result
      matches = orderedIds.sorted == currentIds.sorted
      _ <-
        if (matches) {
          DBIO.sequence(orderedIds.zipWithIndex.map { case (id, position) =>
            partners.filter(_.partnerId === id).map(_.displayOrder).update(position)
          })
        } else DBIO.successful(Seq.empty[Int])
    } yield matches).transactionally
  }

  private def scopeQuery(cityId: Option[String]): Query[PartnerTableDef, Partner, Seq] = cityId match {
    case Some(city) => partners.filter(_.cityId === city)
    case None       => partners.filter(_.cityId.isEmpty)
  }
}
