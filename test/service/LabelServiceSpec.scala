package service

import models.label.{LabelTable, LabelTypeEnum}
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed tests for LabelService tag lookups (the Gallery page's tag-filter source), for the gallery label query
 * the landing-page validation grid draws from (#1638), and for the by-id review-list query behind `?labelIds=`
 * (#5444), which deliberately drops the quality gates the filtered query applies.
 *
 * Read-only: requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 * Scheduling actors are disabled so background actors can't do work during the run.
 */
class LabelServiceSpec extends PlaySpec with RolledBackDb with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val labelService                               = app.injector.instanceOf[LabelService]
  private val labelTable                                 = app.injector.instanceOf[LabelTable]
  private val configService                              = app.injector.instanceOf[ConfigService]
  private def await[T](f: scala.concurrent.Future[T]): T = Await.result(f, 60.seconds)

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
    val allValOptions               = Set("correct", "incorrect", "unsure", "unvalidated")
    def query(recentFirst: Boolean) = labelTable.getGalleryLabelsQuery(
      configService.getPanoSource, LabelTypeEnum.CurbRamp, Set.empty, allValOptions, Set.empty, Set.empty, Set.empty,
      Set.empty, "00000000-0000-0000-0000-000000000000", recentFirst
    )

    "order labels newest-first when recentFirst is set" in {
      // Tuple position 7 is the label's timestamp (see LabelValidationMetadataTuple).
      val timestamps = run(query(recentFirst = true).take(50).result).map(_._7)
      timestamps.zip(timestamps.drop(1)).foreach { case (newer, older) => newer.isBefore(older) mustBe false }
    }

    "return the same number of labels regardless of ordering mode" in {
      run(query(recentFirst = true).length.result) mustBe run(query(recentFirst = false).length.result)
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
          LabelTypeEnum.CurbRamp,
          Set.empty,
          Set("correct", "incorrect", "unsure", "unvalidated"),
          Set.empty,
          Set.empty,
          Set.empty,
          Set.empty,
          userId
        )
        .take(3)
        .result
    ).map(_._1)

    "return exactly the labels asked for, and each of them once" in {
      assume(servedIds.size >= 2, "connected DB serves fewer than two gallery labels")

      // Reversed, to pin that the query itself imposes no order — the service is what puts the list back in order.
      val returned = run(labelTable.getGalleryLabelsByIdQuery(viewer, servedIds.reverse, userId).result).map(_._1)
      returned.toSet mustBe servedIds.toSet
      // A fanned-out join would show up here as a label appearing twice, which the Gallery would page through twice.
      returned.distinct.size mustBe returned.size
    }

    "return nothing for an id this city does not have" in {
      run(labelTable.getGalleryLabelsByIdQuery(viewer, Seq(Int.MaxValue), userId).length.result) mustBe 0
    }

    "return a label the filtered query drops for its disagree ratio" in {
      // The gate getGalleryLabelsQuery applies is `disagreeCount < 3 || disagreeCount < agreeCount * 2`; these are
      // the renderable labels that fail it, and a review list has to show them anyway.
      val contested: Seq[Int] = run(
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
