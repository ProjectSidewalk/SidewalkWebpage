package models.story

import models.utils.MyPostgresProfile.api.*
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec}

import java.time.{OffsetDateTime, ZoneOffset}

/**
 * The region-scoped story listing a neighborhood report reads (#5900): a region gets exactly the visible stories whose
 * label sits on one of its streets, each knowing its street. Runs in a rolled-back transaction, so the shared dev DB
 * keeps no story from here.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class StoryTableSpec extends SidewalkSpec with RolledBackDb with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val storyTable = app.injector.instanceOf[StoryTable]

  /** A live label in a region, with its street and region, and a region it is not in; None when the DB has none. */
  private val labelInRegion: DBIO[Option[(Int, Int, Int, Int)]] =
    sql"""
      SELECT label.label_id, label.street_edge_id, street_edge_region.region_id,
             (SELECT MIN(region_id) FROM region WHERE region_id <> street_edge_region.region_id AND deleted = FALSE)
      FROM label
      INNER JOIN street_edge_region ON street_edge_region.street_edge_id = label.street_edge_id
      INNER JOIN region ON region.region_id = street_edge_region.region_id AND region.deleted = FALSE
      WHERE label.deleted = FALSE
      ORDER BY label.label_id
      LIMIT 1
    """.as[(Int, Int, Int, Int)].headOption

  // Two authors, since a user may tell one story per label.
  private val twoUserIds: DBIO[Seq[String]] =
    sql"SELECT user_id FROM sidewalk_login.sidewalk_user ORDER BY user_id LIMIT 2".as[String]

  private def story(labelId: Int, userId: String, text: String, visible: Boolean): Story =
    Story(0, labelId, userId, text, Story.DisplayNameAnonymous, visible, None, None, OffsetDateTime.now(ZoneOffset.UTC))

  "getVisibleForCity" must {
    "give a region only the visible stories on its streets, each with its street" in {
      runRolledBack(labelInRegion.flatMap {
        case None => DBIO.successful(cancel("The connected database has no label in a region."))
        case Some((labelId, streetEdgeId, regionId, otherRegion)) =>
          for {
            users     <- twoUserIds
            shownId   <- storyTable.insert(story(labelId, users.head, "A story the report shows", visible = true))
            _         <- storyTable.insert(story(labelId, users(1), "A story moderators hid", visible = false))
            inRegion  <- storyTable.getVisibleForCity(100, Some(regionId))
            elsewhere <- storyTable.getVisibleForCity(100, Some(otherRegion))
            cityWide  <- storyTable.getVisibleForCity(100)
          } yield {
            val mine = inRegion.filter(_._1.labelId == labelId)
            mine.map(_._1.storyId) mustBe Seq(shownId)
            mine.head._5 mustBe streetEdgeId
            mine.head._6 mustBe regionId
            inRegion.map(_._6).distinct mustBe Seq(regionId)
            elsewhere.map(_._1.storyId) must not contain shownId
            cityWide.map(_._1.storyId) must contain(shownId)
          }
      })
    }
  }
}
