package models.gallery

import models.label.{LabelValidationMetadata, LabelValidationMetadataRep}
import models.utils.MyPostgresProfile.api.{given, *}
import models.utils.{NamedEnum, NamedEnumCompanion}
import slick.lifted.{Case, Ordered}

import java.time.Instant

/**
 * The orderings the Gallery's admin-only "Sort by" control offers (#2705).
 *
 * This enum is the one definition of the option list: the page renders its `<select>` from `values`, the card query
 * reads the chosen `name` back, and the frontend never re-declares the options (backend is the source of truth).
 * Each value carries both halves of its ordering. `orderBy` is the SQL `ORDER BY` for the card query; `ordering` is
 * the same order in memory, applied after the imagery check, which returns crop-backed labels first and so loses the
 * query's order. The two have to agree, or paging (which excludes already-loaded ids and asks for the next ranked
 * ones) would skip or repeat a label at every page boundary. Every ordering ends on `label_id DESC` so it is total,
 * which is what makes that paging deterministic.
 *
 * Severity sorts on the raw 1-3 rating whatever the type's scale reads as: for a quality-scale type (curb ramps) 3 is
 * the worst rating too, so "most severe" is "worst" for every type. Labels without a rating sort last both ways, and a
 * label nobody has validated has no dispute ratio and sorts last in [[MostDisputed]].
 */
enum GallerySort(val name: String) extends NamedEnum {

  /** The Gallery's default and the only order non-admins ever see; carries no SQL order of its own. */
  case Random       extends GallerySort("random")
  case Newest       extends GallerySort("newest")
  case Oldest       extends GallerySort("oldest")
  case MostSevere   extends GallerySort("most_severe")
  case LeastSevere  extends GallerySort("least_severe")
  case MostDisputed extends GallerySort("most_disputed")

  /**
   * The SQL ordering for this sort, over the Gallery's row projection.
   * @param r The projected row.
   * @return  The `ORDER BY` key: the sort's own column(s), then `label_id DESC` as the tiebreak.
   */
  def orderBy(r: LabelValidationMetadataRep): Ordered = {
    val primary: Ordered = this match {
      case Random       => r.labelId.desc // Unreachable through the query (Random keeps `random()`); total anyway.
      case Newest       => r.timestamp.desc
      case Oldest       => r.timestamp.asc
      case MostSevere   => r.severity.desc.nullsLast
      case LeastSevere  => r.severity.asc.nullsLast
      case MostDisputed =>
        val (agree, disagree, unsure, _, _, _) = r.validationInfo
        val total: Rep[Int]                    = agree + disagree + unsure
        // NULL (not 0) for an unvalidated label, so `NULLS LAST` can send it to the end rather than ranking it with
        // the labels everyone agreed on.
        val ratio: Rep[Option[Double]] =
          Case
            .If(total === 0)
            .Then(None: Option[Double])
            .Else((disagree.asColumnOf[Double] / total.asColumnOf[Double]).?)
        ratio.desc.nullsLast
    }
    new Ordered(primary.columns ++ r.labelId.desc.columns)
  }

  /** The same order as [[orderBy]], for sorting rows the query has already returned. */
  def ordering: Ordering[LabelValidationMetadata] = {
    val labelIdDesc: Ordering[LabelValidationMetadata] = Ordering.by[LabelValidationMetadata, Int](_.labelId).reverse
    val primary: Ordering[LabelValidationMetadata]     = this match {
      case Random       => labelIdDesc
      case Newest       => Ordering.by[LabelValidationMetadata, Instant](_.timestamp.toInstant).reverse
      case Oldest       => Ordering.by[LabelValidationMetadata, Instant](_.timestamp.toInstant)
      case MostSevere   => GallerySort.nullsLast(Ordering.Int.reverse).on(_.severity)
      case LeastSevere  => GallerySort.nullsLast(Ordering.Int).on(_.severity)
      case MostDisputed =>
        GallerySort.nullsLast(Ordering.Double.TotalOrdering.reverse).on { l =>
          val v     = l.validationInfo
          val total = v.agreeCount + v.disagreeCount + v.unsureCount
          // The same double division Postgres does, so a ratio that ties in SQL ties here.
          if (total == 0) None else Some(v.disagreeCount.toDouble / total.toDouble)
        }
    }
    primary.orElse(labelIdDesc)
  }
}

object GallerySort extends NamedEnumCompanion[GallerySort] {

  /** Postgres `NULLS LAST` over an `Option` key: `Some`s in `inner`'s order, then every `None`. */
  private def nullsLast[T](inner: Ordering[T]): Ordering[Option[T]] = {
    case (Some(a), Some(b)) => inner.compare(a, b)
    case (Some(_), None)    => -1
    case (None, Some(_))    => 1
    case (None, None)       => 0
  }
}

/**
 * How a Gallery card query orders what it returns, as the service and query see it.
 *
 * Three orders, not two, because the landing page's validation grid asks for `sort: "recent"` and means something
 * different from the admin's [[GallerySort.Newest]]: a *pool* of the newest labels that is then shuffled, so the grid
 * varies between visits. [[Sorted]] is the strict order an admin asked for, with no shuffle anywhere.
 */
enum GalleryOrder {

  /** `ORDER BY random()`, then the type-spread and shuffle the Gallery has always done. */
  case Random

  /** Newest-first query, shuffled per batch: the landing grid's recent pool. */
  case RecentPool

  /** One strict order across every selected type, kept all the way to the client (#2705). */
  case Sorted(sort: GallerySort)
}

object GalleryOrder {

  /**
   * The order a card request's `sort` field asks for.
   *
   * @param sort The request's `sort`, if any. `"recent"` is the landing grid's pool; a [[GallerySort]] name other than
   *             `random` is a strict sort; anything else, including nothing, is the random default.
   */
  def fromRequest(sort: Option[String]): GalleryOrder = sort match {
    case Some("recent") => RecentPool
    case Some(name)     =>
      GallerySort.withNameOption(name).filter(_ != GallerySort.Random).map(Sorted.apply).getOrElse(Random)
    case None => Random
  }
}
