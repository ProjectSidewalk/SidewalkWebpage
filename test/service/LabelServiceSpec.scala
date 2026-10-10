package service

import models.gallery.{GalleryOrder, GallerySort}
import models.label.{LabelTable, LabelType, LabelValidationMetadata}
import models.pano.PanoSource
import models.utils.MyPostgresProfile.api.given
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec}

import scala.concurrent.Await
import scala.concurrent.duration.*

/**
 * DB-backed tests for LabelService tag lookups (the Gallery page's tag-filter source), for the gallery label query
 * the landing-page validation grid draws from (#1638), and for the by-id review-list query behind `?labelIds=`
 * (#5444), which deliberately drops the quality gates the filtered query applies.
 *
 * Read-only: requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 * Scheduling actors are disabled so background actors can't do work during the run.
 */
class LabelServiceSpec extends SidewalkSpec with RolledBackDb with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val labelService                               = app.injector.instanceOf[LabelService]
  private val labelTable                                 = app.injector.instanceOf[LabelTable]
  private val configService                              = app.injector.instanceOf[ConfigService]
  private def await[T](f: scala.concurrent.Future[T]): T = Await.result(f, 60.seconds)

  /**
   * Renderable labels that fail the public Gallery's disagree-ratio gate (`disagreeCount < 3 || disagreeCount <
   * agreeCount * 2`): the crowd has rejected them, and the random Gallery leaves them out.
   */
  private def contestedLabelIds(viewer: PanoSource): Seq[Int] = run(
    labelTable.labels
      .join(labelTable.labelPoints)
      .on(_.labelId === _.labelId)
      .join(labelTable.panoData)
      .on(_._1.panoId === _.panoId)
      .filter { case ((lb, lp), pd) =>
        lb.disagreeCount >= 3 && lb.disagreeCount >= lb.agreeCount * 2 &&
        pd.source === viewer && lp.lat.isDefined && lp.lng.isDefined
      }
      .map(_._1._1.labelId)
      .take(5)
      .result
  )

  "LabelService.selectTagsByLabelType" should {
    "return exactly the tags belonging to the requested label type" in {
      val allTags = await(labelService.selectAllTagsFuture)
      assume(allTags.nonEmpty, "connected DB has no tags to test against")

      // Pick a label type that's guaranteed to have tags in the connected DB, whatever city it holds.
      val labelType = allTags.head.labelType

      val tags = await(labelService.selectTagsByLabelType(labelType))
      tags must not be empty
      tags.map(_.tag).toSet mustBe allTags.filter(_.labelType == labelType).map(_.tag).toSet
    }
  }

  "LabelTable.getGalleryLabelsQuery" should {
    // All correctness options = no correctness filtering, so the query returns whatever the connected DB holds.
    val allValOptions = Set("correct", "incorrect", "unsure", "unvalidated")
    val noUser        = "00000000-0000-0000-0000-000000000000"
    def query(
        order: GalleryOrder,
        types: Set[LabelType] = Set(LabelType.CurbRamp),
        tags: Map[LabelType, Set[String]] = Map.empty
    ) = labelTable.getGalleryLabelsQuery(
      configService.getPanoSource, types, Set.empty, allValOptions, Set.empty, Set.empty, tags, Set.empty, noUser, order
    )
    def sorted(sort: GallerySort, types: Set[LabelType]) =
      run(query(GalleryOrder.Sorted(sort), types).take(100).result)

    /** Asserts `rows` is in `sort`'s order, by the same in-memory ordering the service restores after the imagery check. */
    def mustBeOrdered(rows: Seq[LabelValidationMetadata], sort: GallerySort): Unit =
      rows.zip(rows.drop(1)).foreach { case (first, second) => sort.ordering.compare(first, second) must be <= 0 }

    "order labels newest-first for the landing grid's recent pool" in {
      val timestamps = run(query(GalleryOrder.RecentPool).take(50).result).map(_.timestamp)
      timestamps.zip(timestamps.drop(1)).foreach { case (newer, older) => newer.isBefore(older) mustBe false }
    }

    "return the same labels for the random order and the recent pool, and no fewer for a sorted one" in {
      val randomCount = run(query(GalleryOrder.Random).length.result)
      run(query(GalleryOrder.RecentPool).length.result) mustBe randomCount
      // A sorted order waives the disagree-ratio gate, so it can only add labels; see the gate test below.
      run(query(GalleryOrder.Sorted(GallerySort.Newest)).length.result) must be >= randomCount
    }

    // The SQL order and the in-memory one have to agree, or paging in sorted mode (#2705) skips or repeats labels
    // at a page boundary: the service restores the in-memory order after the imagery check reshuffles a batch.
    "order a sorted query the way GallerySort.ordering does, for every sort" in {
      val rated = Set(LabelType.CurbRamp, LabelType.Obstacle, LabelType.SurfaceProblem)
      for (sort <- GallerySort.values.filterNot(_ == GallerySort.Random)) {
        val rows = sorted(sort, rated)
        withClue(s"$sort: ") { mustBeOrdered(rows, sort) }
      }
    }

    "put unrated labels last whichever way severity sorts" in {
      // NoSidewalk is unrated, so a mixed set has labels with no severity to send to the end.
      val types = Set(LabelType.CurbRamp, LabelType.NoSidewalk)
      for (sort <- Seq(GallerySort.MostSevere, GallerySort.LeastSevere)) {
        val severities = sorted(sort, types).map(_.severity)
        withClue(s"$sort: ") { severities.dropWhile(_.isDefined).forall(_.isEmpty) mustBe true }
      }
    }

    "rank the most-disputed sort by the share of disagreeing votes, unvalidated last" in {
      val rows = sorted(GallerySort.MostDisputed, Set(LabelType.CurbRamp, LabelType.Obstacle))
      def votes(l: LabelValidationMetadata) =
        l.validationInfo.agreeCount + l.validationInfo.disagreeCount + l.validationInfo.unsureCount
      rows.dropWhile(votes(_) > 0).forall(votes(_) == 0) mustBe true
      val ratios = rows.takeWhile(votes(_) > 0).map(l => l.validationInfo.disagreeCount.toDouble / votes(l))
      ratios.zip(ratios.drop(1)).foreach { case (higher, lower) => higher must be >= lower }
    }

    // "Most disputed" exists to find the labels the gate drops, so a sorted order (admin tooling) waives it; the
    // random Gallery, which anyone sees, keeps it.
    "waive the disagree-ratio gate in a sorted order only" in {
      val contested = contestedLabelIds(configService.getPanoSource).toSet
      assume(contested.nonEmpty, "connected DB has no renderable label that the disagree-ratio gate drops")
      val everyType = LabelType.values.toSet

      val sortedIds = run(query(GalleryOrder.Sorted(GallerySort.MostDisputed), everyType).map(_.labelId).result)
      val randomIds = run(query(GalleryOrder.Random, everyType).map(_.labelId).result)
      sortedIds.toSet.intersect(contested) must not be empty
      randomIds.toSet.intersect(contested) mustBe empty
    }

    // A tag narrows only the type it belongs to (#2705 runs one query across several types, so this is where a
    // curb-ramp tag could otherwise leak onto obstacles, or an obstacle be dropped for lacking one).
    "scope tags to their own label type in a multi-type query" in {
      val tag = run(
        labelTable
          .getGalleryLabelsQuery(
            configService.getPanoSource, Set(LabelType.CurbRamp), Set.empty, allValOptions, Set.empty, Set.empty,
            Map.empty, Set.empty, noUser, GalleryOrder.Random
          )
          .take(50)
          .result
      ).flatMap(_.tags).headOption
      assume(tag.isDefined, "connected database has no tagged curb ramp")

      val rows = run(
        query(
          GalleryOrder.Sorted(GallerySort.Newest),
          Set(LabelType.CurbRamp, LabelType.Obstacle),
          Map(LabelType.CurbRamp -> Set(tag.get))
        ).take(200).result
      )
      rows.filter(_.labelType == LabelType.CurbRamp).foreach(_.tags must contain(tag.get))
      rows.map(_.labelType).toSet must contain(LabelType.CurbRamp)
      // The other half of the scope: the type nobody narrowed is still served, tag or no tag.
      val obstacles = run(query(GalleryOrder.Random, Set(LabelType.Obstacle)).take(1).result)
      if (obstacles.nonEmpty) rows.map(_.labelType).toSet must contain(LabelType.Obstacle)
    }
  }

  "LabelTable.getGalleryLabelsByIdQuery" should {
    val viewer = configService.getPanoSource
    val userId = "00000000-0000-0000-0000-000000000000"

    // Ids the filtered gallery query already serves, so they are known to be renderable in the connected city.
    lazy val servedIds: Seq[Int] = run(
      labelTable
        .getGalleryLabelsQuery(
          viewer,
          Set(LabelType.CurbRamp),
          Set.empty,
          Set("correct", "incorrect", "unsure", "unvalidated"),
          Set.empty,
          Set.empty,
          Map.empty,
          Set.empty,
          userId
        )
        .take(3)
        .result
    ).map(_._1)

    "return exactly the labels asked for, and each of them once" in {
      assume(servedIds.size >= 2, "connected DB serves fewer than two gallery labels")

      // Asked for in reverse: the query applies no ordering of its own (the service sorts the result back into the
      // requested order), so what is pinned here is the *set* — the same labels come back whatever order is asked
      // for, and none is dropped for being out of order.
      val returned = run(labelTable.getGalleryLabelsByIdQuery(viewer, servedIds.reverse, userId).result).map(_._1)
      returned.toSet mustBe servedIds.toSet
      // A fanned-out join would show up here as a label appearing twice, which the Gallery would page through twice.
      returned.distinct.size mustBe returned.size
    }

    "return nothing for an id this city does not have" in {
      run(labelTable.getGalleryLabelsByIdQuery(viewer, Seq(Int.MaxValue), userId).length.result) mustBe 0
    }

    "return a label the filtered query drops for its disagree ratio" in {
      // A review list has to show the labels the gate drops anyway.
      val contested: Seq[Int] = contestedLabelIds(viewer)
      assume(contested.nonEmpty, "connected DB has no renderable label that the disagree-ratio gate drops")

      run(labelTable.getGalleryLabelsByIdQuery(viewer, contested, userId).result).map(_._1).toSet mustBe contested.toSet
    }
  }

  "the ui_source enum (evolution 332)" should {
    "include the LandingPage value" in {
      run(sql"SELECT 'LandingPage'::ui_source::text".as[String].head) mustBe "LandingPage"
    }
  }
}
