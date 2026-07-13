package service

import models.label.{LabelTable, LabelTypeEnum}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed tests for LabelService tag lookups (the Gallery page's tag-filter source) and for the gallery label query
 * the landing-page validation grid draws from (#1638).
 *
 * Read-only: requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 * Scheduling actors are disabled so background actors can't do work during the run.
 */
class LabelServiceSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val labelService  = app.injector.instanceOf[LabelService]
  private val labelTable    = app.injector.instanceOf[LabelTable]
  private val configService = app.injector.instanceOf[ConfigService]
  // Keep the DatabaseConfig as a stable val and call .db.run inline; binding .db to its own val would infer a
  // path-dependent existential type that needs -language:existentials.
  private val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def await[T](f: scala.concurrent.Future[T]): T = Await.result(f, 60.seconds)
  private def run[T](action: DBIO[T]): T                 = Await.result(dbConfig.db.run(action), 60.seconds)

  "LabelService.selectTagsByLabelType" should {
    "return exactly the tags belonging to the requested label type" in {
      val allTags = await(labelService.selectAllTagsFuture)
      assume(allTags.nonEmpty, "connected DB has no tags to test against")

      // Pick a label type that's guaranteed to have tags in the connected DB, whatever city it holds.
      val labelTypeId: Int  = allTags.head.labelTypeId
      val labelType: String = LabelTypeEnum.byId(labelTypeId).name

      val tags = await(labelService.selectTagsByLabelType(labelType))
      tags must not be empty
      tags.map(_.tag).toSet mustBe allTags.filter(_.labelTypeId == labelTypeId).map(_.tag).toSet
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

  "the ui_source enum (evolution 332)" should {
    "include the LandingPage value" in {
      run(sql"SELECT 'LandingPage'::ui_source::text".as[String].head) mustBe "LandingPage"
    }
  }
}
