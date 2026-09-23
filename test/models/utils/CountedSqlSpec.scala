package models.utils

import models.api.StreetFiltersForApi
import models.label.LabelTable
import models.street.StreetEdgeTable
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, StreetFixtures}

/**
 * The shared "what counts" SQL fragments (#5287): each keeps exactly what its Slick twin keeps, and the queries built
 * on them drop what they should. Runs against the connected database, every seeded case inside a rolled-back
 * transaction.
 *
 * Seeded labels borrow an existing label's mission and pano for their foreign keys, so a schema without any label
 * (CI's) cancels those cases rather than failing them.
 */
class CountedSqlSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb with StreetFixtures {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val labelTable: LabelTable           = app.injector.instanceOf[LabelTable]
  private lazy val streetEdgeTable: StreetEdgeTable = app.injector.instanceOf[StreetEdgeTable]

  /**
   * Seeds a label on a street, filed under the given audit so the tutorial-street check sees the seeded street.
   *
   * @return The new label_id.
   */
  private def insertLabel(
      streetEdgeId: Int,
      auditTaskId: Int,
      userId: String,
      labelType: String = "Obstacle"
  ): DBIO[Int] =
    for {
      labelId <- sql"""INSERT INTO label (label_id, audit_task_id, mission_id, user_id, pano_id, label_type, deleted,
                                          temporary_label_id, time_created, tutorial, street_edge_id, tags)
                       SELECT (SELECT COALESCE(MAX(label_id), 0) + 1 FROM label), $auditTaskId, mission_id, $userId,
                              pano_id, CAST($labelType AS label_type), FALSE, 0, now(), FALSE, $streetEdgeId,
                              ARRAY[]::text[]
                       FROM label
                       LIMIT 1
                       RETURNING label_id""".as[Int].headOption
      _ = assume(labelId.isDefined, "no labels in this schema; seeding a label needs a seeded DB")
    } yield labelId.get

  /** Seeds one vote on a label, as the given type. */
  private def vote(labelId: Int, userId: String, labelType: String): DBIO[Int] =
    sqlu"""INSERT INTO label_validation (label_id, validation_result, user_id, mission_id, heading, pitch, zoom,
                                         canvas_height, canvas_width, start_timestamp, end_timestamp, source,
                                         viewer_type, label_type)
           SELECT $labelId, 'Agree', $userId, label.mission_id, 0, 0, 1, 0, 0, now(), now(), 'Validate', 'Default',
                  CAST($labelType AS label_type)
           FROM label
           WHERE label.label_id = $labelId"""

  /** What's in one set but not the other, a few of each, so a mismatch reads as ids rather than two huge sets. */
  private def differences(slick: Seq[Int], raw: Seq[Int]): (Seq[Int], Seq[Int]) = {
    val (slickSet, rawSet) = (slick.toSet, raw.toSet)
    ((slickSet -- rawSet).toSeq.sorted.take(10), (rawSet -- slickSet).toSeq.sorted.take(10))
  }

  "CountedSql.labels" should {
    "keep exactly the labels LabelTable.labels keeps" in {
      val (slick, raw) = run(for {
        slick <- labelTable.labels.map(_.labelId).result
        raw   <- sql"SELECT label_id FROM #${CountedSql.labels()}".as[Int]
      } yield (slick, raw))

      differences(slick, raw) mustBe ((Seq.empty, Seq.empty))
      raw.size mustBe raw.distinct.size
    }
  }

  "CountedSql.completedAudits" should {
    "keep exactly the audits StreetEdgeTable.completedAuditTasks keeps, once limited to the same streets" in {
      val (slick, raw) = run(for {
        slick <- streetEdgeTable.completedAuditTasks.map(_.auditTaskId).result
        raw   <- sql"""SELECT audit_task.audit_task_id
                       FROM #${CountedSql.completedAudits()}
                       INNER JOIN street_edge ON audit_task.street_edge_id = street_edge.street_edge_id
                       WHERE street_edge.status = 'open'
                           AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)""".as[Int]
      } yield (slick, raw))

      differences(slick, raw) mustBe ((Seq.empty, Seq.empty))
    }
  }

  "CountedSql.verdictVotes" should {
    "keep only votes on the label's current type, from someone other than its author who isn't excluded" in {
      val (kept, countedVoter) = runRolledBack(for {
        streetEdgeId <- insertStreet()
        author       <- insertUser()
        counted      <- insertUser()
        banned       <- insertUser()
        outdated     <- insertUser()
        _            <- excludeUser(banned)
        auditTaskId  <- audit(streetEdgeId, author)
        labelId      <- insertLabel(streetEdgeId, auditTaskId, author)
        _            <- vote(labelId, counted, "Obstacle")
        _            <- vote(labelId, author, "Obstacle")
        _            <- vote(labelId, banned, "Obstacle")
        _            <- vote(labelId, outdated, "CurbRamp")
        kept         <- sql"""SELECT label_validation.user_id
                              FROM #${CountedSql.verdictVotes()}
                              WHERE label_validation.label_id = $labelId""".as[String]
      } yield (kept, counted))

      kept mustBe Seq(countedVoter)
    }
  }

  "/v3/api/streets" should {
    "leave an excluded user's labels and audits out of every count (#5287)" in {
      val (street, goodUser) = runRolledBack(for {
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        _            <- sqlu"""INSERT INTO osm_way_street_edge (osm_way_street_edge_id, osm_way_id, street_edge_id)
                               VALUES ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 1 FROM osm_way_street_edge),
                                       900000000100, $streetEdgeId)"""
        good        <- insertUser()
        banned      <- insertUser()
        _           <- excludeUser(banned)
        goodAudit   <- audit(streetEdgeId, good)
        bannedAudit <- audit(streetEdgeId, banned)
        _           <- insertLabel(streetEdgeId, goodAudit, good)
        _           <- insertLabel(streetEdgeId, bannedAudit, banned)
        _           <- insertLabel(streetEdgeId, bannedAudit, banned)
        streets     <- streetEdgeTable.getStreetsForApi(StreetFiltersForApi(regionId = Some(regionId)))
      } yield (streets.find(_.streetEdgeId == streetEdgeId), good))

      street mustBe defined
      street.get.labelCount mustBe 1
      street.get.auditCount mustBe 1
      street.get.userIds mustBe Seq(goodUser)
    }
  }
}
