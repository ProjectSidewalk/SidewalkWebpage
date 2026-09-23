package models.utils

import models.api.StreetFiltersForApi
import models.audit.AuditTaskTable
import models.label.LabelTable
import models.street.StreetEdgeTable
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, StreetFixtures}

/**
 * The shared "what counts" SQL (#5287) keeps exactly what its Slick twin keeps. Seeded cases are rolled back, and
 * are skipped on a database with no labels to borrow ids from (CI's).
 */
class FilteredTablesSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb with StreetFixtures {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val labelTable: LabelTable           = app.injector.instanceOf[LabelTable]
  private lazy val streetEdgeTable: StreetEdgeTable = app.injector.instanceOf[StreetEdgeTable]
  private lazy val auditTaskTable: AuditTaskTable   = app.injector.instanceOf[AuditTaskTable]

  /**
   * Seeds a label on a street, under the given audit.
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

  /** Up to 10 ids from each side that the other lacks, so a failure is readable. */
  private def differences(slick: Seq[Int], raw: Seq[Int]): (Seq[Int], Seq[Int]) = {
    val (slickSet, rawSet) = (slick.toSet, raw.toSet)
    ((slickSet -- rawSet).toSeq.sorted.take(10), (rawSet -- slickSet).toSeq.sorted.take(10))
  }

  "FilteredTables.labels" should {
    "keep exactly the labels LabelTable.labels keeps" in {
      val (slick, raw) = run(for {
        slick <- labelTable.labels.map(_.labelId).result
        raw   <- sql"SELECT label_id FROM #${FilteredTables.labels()}".as[Int]
      } yield (slick, raw))

      differences(slick, raw) mustBe ((Seq.empty, Seq.empty))
      raw.size mustBe raw.distinct.size
    }
  }

  "FilteredTables.accuracyLabels" should {
    "keep exactly the labels LabelTable.labelsForAccuracy keeps" in {
      val (slick, raw) = run(for {
        slick <- labelTable.labelsForAccuracy.map(_.labelId).result
        raw   <- sql"SELECT label_id FROM #${FilteredTables.accuracyLabels}".as[Int]
      } yield (slick, raw))

      differences(slick, raw) mustBe ((Seq.empty, Seq.empty))
    }
  }

  "FilteredTables.completedAudits" should {
    "keep exactly the audits StreetEdgeTable.countedAuditTasks keeps" in {
      val (slick, raw) = run(for {
        slick <- streetEdgeTable.countedAuditTasks.map(_.auditTaskId).result
        raw   <- sql"SELECT audit_task_id FROM #${FilteredTables.completedAudits()}".as[Int]
      } yield (slick, raw))

      differences(slick, raw) mustBe ((Seq.empty, Seq.empty))
    }

    "keep exactly the audits StreetEdgeTable.completedAuditTasks keeps, once limited to the same streets" in {
      val (slick, raw) = run(for {
        slick <- streetEdgeTable.completedAuditTasks.map(_.auditTaskId).result
        raw   <- sql"""SELECT audit_task.audit_task_id
                       FROM #${FilteredTables.completedAudits()}
                       INNER JOIN street_edge ON audit_task.street_edge_id = street_edge.street_edge_id
                       WHERE street_edge.status = 'open'
                           AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)""".as[Int]
      } yield (slick, raw))

      differences(slick, raw) mustBe ((Seq.empty, Seq.empty))
    }
  }

  "FilteredTables.verdictVotes" should {
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
                              FROM #${FilteredTables.verdictVotes()}
                              WHERE label_validation.label_id = $labelId""".as[String]
      } yield (kept, counted))

      kept mustBe Seq(countedVoter)
    }
  }

  "AuditTaskTable.hasUpToDateAuditFor" should {
    "not count a street as up to date when only an excluded user has audited it" in {
      val (bannedOnly, alsoCounted) = runRolledBack(for {
        bannedStreet  <- insertStreet()
        countedStreet <- insertStreet()
        banned        <- insertUser()
        good          <- insertUser()
        _             <- excludeUser(banned)
        _             <- audit(bannedStreet, banned)
        _             <- audit(countedStreet, banned)
        _             <- audit(countedStreet, good)
        bannedOnly    <- auditTaskTable.hasUpToDateAuditFor(bannedStreet)
        alsoCounted   <- auditTaskTable.hasUpToDateAuditFor(countedStreet)
      } yield (bannedOnly, alsoCounted))

      bannedOnly mustBe false
      alsoCounted mustBe true
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
