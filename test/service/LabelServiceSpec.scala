package service

import models.label.LabelTypeEnum
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed tests for LabelService tag lookups (the Gallery page's tag-filter source).
 *
 * Read-only: requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 * Scheduling actors are disabled so background actors can't do work during the run.
 */
class LabelServiceSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val labelService = app.injector.instanceOf[LabelService]

  private def await[T](f: scala.concurrent.Future[T]): T = Await.result(f, 60.seconds)

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
}
