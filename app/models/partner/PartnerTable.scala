package models.partner

import models.user.SidewalkUserTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api.*
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.*
import scala.concurrent.ExecutionContext

/**
 * A community-partner logo shown on the landing page (#4516). `cityId` None means project-wide: shown on every
 * deployment, under "Project-Wide Partners" (#5984). The code and routes call that scope "global". Every deployment's
 * /about page shows every row, private cities' included, one logo per organization
 * ([[PartnerMetadata.groupForAbout]], #5980).
 */
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

  /**
   * Splits a landing page's partners into the city's own row and the Project-Wide Partners row (#5984). A project-wide
   * partner that is also one of this city's own (same [[nameKey]]) is left out of the project-wide row, so a home
   * city credits it once, in the more specific place.
   *
   * @return (the city's partners, the project-wide partners to show), each in the order given
   */
  def splitForLanding(partners: Seq[PartnerMetadata]): (Seq[PartnerMetadata], Seq[PartnerMetadata]) = {
    val (city, projectWide) = partners.partition(_.cityId.isDefined)
    val cityNames           = city.map(p => nameKey(p.name)).toSet
    (city, projectWide.filterNot(p => cityNames.contains(nameKey(p.name))))
  }

  /**
   * Groups every city's partners for the /about page's logo grid (#5980). Private cities' partners are included:
   * the grid credits the organizations behind the project as a whole, and naming a partner doesn't reveal the
   * private deployment's site or data.
   *
   * The table holds one row per organization per city, so each organization (by [[nameKey]]) shows once. One with any
   * project-wide row is a project-wide partner, shown with the lowest-id project-wide row's logo, in the project-wide
   * display order the admins set. Every other organization shows its lowest-id row's logo, sorted alphabetically with
   * a root-locale collator, so an accented or non-Latin initial sorts with its base letter rather than after Z. A
   * winning row with no URL or alt text takes the first one its sibling rows have, lowest id first, since an
   * Administrator can't edit another city's row to add the link there.
   *
   * {{{
   * // Rows: 4 = Seattle "Public Nudge", 2 = Chicago "public nudge", 9 = project-wide "SciStarter", 5 = Taipei "Foo".
   * groupForAbout(Seq(row4, row2, row9, row5)) // == (Seq(row9), Seq(row2, row5))
   * }}}
   *
   * @return (the project-wide partners, every other organization), each with one row per organization
   */
  def groupForAbout(partners: Seq[PartnerMetadata]): (Seq[PartnerMetadata], Seq[PartnerMetadata]) = {
    val (projectWide, others) = partners.groupBy(p => nameKey(p.name)).values.toSeq.partitionMap { rows =>
      val byId     = rows.sortBy(_.partnerId)
      val winner   = byId.find(_.cityId.isEmpty).getOrElse(byId.head)
      val gapsFill = winner.copy(
        url = winner.url.orElse(byId.flatMap(_.url).headOption),
        altText = winner.altText.orElse(byId.flatMap(_.altText).headOption)
      )
      if (winner.cityId.isEmpty) Left(gapsFill) else Right(gapsFill)
    }
    val collator = java.text.Collator.getInstance(java.util.Locale.ROOT)
    collator.setStrength(java.text.Collator.SECONDARY)
    val alphabetical = Ordering.fromLessThan[PartnerMetadata] { (a, b) =>
      val byCollator = collator.compare(nameKey(a.name), nameKey(b.name))
      if (byCollator != 0) byCollator < 0 else nameKey(a.name) < nameKey(b.name)
    }
    (projectWide.sortBy(p => (p.displayOrder, p.partnerId)), others.sorted(using alphabetical))
  }

  /**
   * Partner identity across scopes: project-wide and city rows aren't linked, so the admin-typed name is the only
   * shared key. Case and spacing are ignored so a stray capital doesn't show a logo twice.
   */
  def nameKey(name: String): String =
    name.replaceAll("[\\s\\p{Z}]+", " ").trim.toLowerCase(java.util.Locale.ROOT) // \p{Z}: pasted no-break spaces.
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
    createdAt, updatedAt, createdBy, updatedBy).mapTo[Partner]

  def creator = foreignKey("partner_created_by_fkey", createdBy, TableQuery[SidewalkUserTableDef])(_.userId)
  def updater = foreignKey("partner_updated_by_fkey", updatedBy, TableQuery[SidewalkUserTableDef])(_.userId)
}

/**
 * Queries for community-partner logos (#4516). The table lives in the shared `sidewalk_login` schema (resolved via
 * search_path, like `user_utm`): a NULL city_id row is a global partner rendered on every deployment's landing page,
 * while a city-id'd row renders only on that city's. `display_order` is a dense 0..n-1 sequence within each scope.
 */
@Singleton
class PartnerTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(using ec: ExecutionContext)
    extends HasDatabaseConfigProvider[MyPostgresProfile] {

  val partners = TableQuery[PartnerTableDef]

  /** The metadata projection shared by every list query, so `logo_image` is never selected outside `getLogo`. */
  private def metadataOf(query: Query[PartnerTableDef, Partner, Seq]) = query.map { p =>
    (p.partnerId, p.cityId, p.name, p.url, p.altText, p.displayOrder, p.logoWidth, p.logoHeight, p.updatedAt)
      .mapTo[PartnerMetadata]
  }

  /** The partners a city's landing page shows: global partners first, then the city's own, each in display order. */
  def getForLanding(cityId: String): DBIO[Seq[PartnerMetadata]] = {
    metadataOf(
      partners
        .filter(p => p.cityId.isEmpty || p.cityId === cityId)
        .sortBy(p => (p.cityId.isDefined, p.displayOrder))
    ).result
  }

  /** Every partner of every city plus the project-wide ones, unordered: the /about page's grid (#5980). */
  def getAll: DBIO[Seq[PartnerMetadata]] = metadataOf(partners).result

  /** All partners in one scope (None = global), in display order. */
  def getByScope(cityId: Option[String]): DBIO[Seq[PartnerMetadata]] = {
    metadataOf(scopeQuery(cityId).sortBy(_.displayOrder)).result
  }

  def get(partnerId: Int): DBIO[Option[PartnerMetadata]] = {
    metadataOf(partners.filter(_.partnerId === partnerId)).result.headOption
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
