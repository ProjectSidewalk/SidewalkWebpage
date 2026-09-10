package models.street

import models.label.StreetSide
import models.utils.MyPostgresProfile.api._
import org.scalatest.OptionValues
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, StreetFixtures}

import scala.io.Source

/**
 * The derived sidewalk presence table (#5279): what the rebuild makes of a street's labels and audits, and that it
 * reproduces evolution 383 — against the connected Postgres+PostGIS database, every case inside a rolled-back
 * transaction.
 *
 * Labels are seeded with an explicit `centerline_offset_m` rather than a position, since the side that offset
 * derives is the input here; `StreetSideSpec` covers the geometry that produces the offset. The seeded rows borrow
 * an existing label's task, mission and pano for their foreign keys, so a schema without any label (CI's) cancels
 * the label-bearing cases rather than failing them.
 *
 * A [[util.StreetFixtures.insertUser]] mapper has no `user_stat` row, which the derivation reads as not-excluded, so
 * every case here counts unless it calls `excludeUser`.
 */
class SidewalkPresenceTableSpec
    extends PlaySpec
    with GuiceOneAppPerSuite
    with RolledBackDb
    with StreetFixtures
    with OptionValues {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val table: SidewalkPresenceTable = app.injector.instanceOf[SidewalkPresenceTable]

  /** The tag whose presence on the other face fills an unlabeled face, spelled as the `tag` table spells it. */
  private val NoSidewalksTag = "street has no sidewalks"

  /**
   * Seeds a label on a street with a given signed centerline offset (metres, positive = left), or none.
   *
   * @param offsetM The offset the label sits at; None leaves the point unpositioned. Inside a metre it has no side.
   * @param daysAgo How old the label is, so first/last dates can be told apart.
   */
  private def insertLabel(
      streetEdgeId: Int,
      userId: String,
      labelType: String,
      offsetM: Option[Double],
      tags: Seq[String] = Seq.empty,
      deleted: Boolean = false,
      tutorial: Boolean = false,
      daysAgo: Int = 0
  ): DBIO[Int] = {
    val tagsLiteral = tags.map(t => s"'${t.replace("'", "''")}'").mkString("ARRAY[", ", ", "]::text[]")
    for {
      labelId <- sql"""INSERT INTO label (label_id, audit_task_id, mission_id, user_id, pano_id, label_type, deleted,
                                          temporary_label_id, time_created, tutorial, street_edge_id, tags)
                       SELECT (SELECT COALESCE(MAX(label_id), 0) + 1 FROM label), audit_task_id, mission_id, $userId,
                              pano_id, CAST($labelType AS label_type), $deleted, 0,
                              now() - make_interval(days => $daysAgo), $tutorial, $streetEdgeId, #$tagsLiteral
                       FROM label
                       LIMIT 1
                       RETURNING label_id""".as[Int].headOption
      _ = assume(labelId.isDefined, "no labels in this schema; seeding a label needs a seeded DB")
      _ <- sqlu"""INSERT INTO label_point (label_point_id, label_id, pano_x, pano_y, canvas_x, canvas_y, heading, pitch,
                                           zoom, lat, lng, geom, computation_method, centerline_offset_m)
                  VALUES ((SELECT COALESCE(MAX(label_point_id), 0) + 1 FROM label_point), ${labelId.get}, 0, 0, 0, 0,
                          0, 0, 1, 0.0005, 0.5, ST_SetSRID(ST_MakePoint(0.5, 0.0005), 4326), 'approximation3',
                          $offsetM)"""
    } yield labelId.get
  }

  private def facesOf(streetEdgeId: Int): DBIO[Map[StreetSide.Value, SidewalkPresence]] =
    table.sidewalkPresence.filter(_.streetEdgeId === streetEdgeId).result.map(_.map(f => f.streetSide -> f).toMap)

  "the sidewalk presence rebuild" should {
    "reproduce exactly what evolution 383 populated, so the two copies of the derivation agree" in {
      // The evolution's data statement, run on the schema as it stands, then the Scala rebuild over the same
      // labels: a derivation that drifted would insert, update, or delete something.
      val ups: String = {
        val source = Source.fromFile("conf/evolutions/default/383.sql", "UTF-8")
        try source.mkString.split("# --- !Downs").head
        finally source.close()
      }
      val dataStatements: Seq[String] = ups
        .split("(?<!;);(?!;)")
        .map(_.linesIterator.filterNot(_.trim.startsWith("--")).mkString("\n").trim)
        .filter(_.startsWith("WITH"))
        .toSeq
      dataStatements must have size 1

      val (populated, rebuilt) = runRolledBack(for {
        _         <- sqlu"DELETE FROM sidewalk_presence"
        _         <- sqlu"#${dataStatements.head}"
        populated <- sql"SELECT COUNT(*) FROM sidewalk_presence".as[Int].head
        rebuilt   <- table.rebuild
      } yield (populated, rebuilt))

      rebuilt.total mustBe populated
      rebuilt.inserted mustBe 0
      rebuilt.updated mustBe 0
      rebuilt.deleted mustBe 0
    }

    "give every street two faces, unknown until the street is audited" in {
      val (faces, counts) = runRolledBack(for {
        streetEdgeId <- insertStreet()
        counts       <- table.rebuild
        faces        <- facesOf(streetEdgeId)
      } yield (faces, counts))

      // At least: streets other specs seeded since the table was populated get their faces on this rebuild too.
      counts.inserted must be >= 2
      faces.keySet mustBe Set(StreetSide.Left, StreetSide.Right)
      faces.values.foreach { face =>
        face.presence mustBe SidewalkPresenceStatus.Unknown
        face.presenceBasis mustBe SidewalkPresenceBasis.Unaudited
        face.auditCount mustBe 0
        face.labelCount mustBe 0
      }
    }

    "call the side with NoSidewalk labels absent and the audited other side present, ignoring what carries no side" in {
      val faces = runRolledBack(for {
        streetEdgeId <- insertStreet()
        user1        <- insertUser()
        user2        <- insertUser()
        _            <- audit(streetEdgeId, user1)
        // Two contributors on the left, the older label first.
        _ <- insertLabel(streetEdgeId, user1, "NoSidewalk", Some(3.0), daysAgo = 30)
        _ <- insertLabel(streetEdgeId, user2, "NoSidewalk", Some(2.5))
        // A problem label on the right describes the roadway, not a missing sidewalk.
        _ <- insertLabel(streetEdgeId, user1, "Obstacle", Some(-3.0))
        // None of these is evidence: inside the metre floor, unpositioned, deleted, or from the tutorial.
        _     <- insertLabel(streetEdgeId, user1, "NoSidewalk", Some(-0.5))
        _     <- insertLabel(streetEdgeId, user1, "NoSidewalk", None)
        _     <- insertLabel(streetEdgeId, user1, "NoSidewalk", Some(-3.0), deleted = true)
        _     <- insertLabel(streetEdgeId, user1, "NoSidewalk", Some(-3.0), tutorial = true)
        _     <- table.rebuild
        faces <- facesOf(streetEdgeId)
      } yield faces)

      val left = faces(StreetSide.Left)
      left.presence mustBe SidewalkPresenceStatus.Absent
      left.presenceBasis mustBe SidewalkPresenceBasis.NoSidewalkLabels
      left.noSidewalkLabelCount mustBe 2
      left.noSidewalkUserCount mustBe 2
      left.labelCount mustBe 2
      left.auditCount mustBe 1
      left.firstNoSidewalkLabelAt.value must be < left.lastNoSidewalkLabelAt.value

      val right = faces(StreetSide.Right)
      right.presence mustBe SidewalkPresenceStatus.Present
      right.presenceBasis mustBe SidewalkPresenceBasis.AuditedNoLabels
      right.noSidewalkLabelCount mustBe 0
      right.noSidewalkUserCount mustBe 0
      right.labelCount mustBe 1
      right.auditCount mustBe 1
      right.firstNoSidewalkLabelAt mustBe None
      right.lastNoSidewalkLabelAt mustBe None
    }

    "fill an unlabeled face from the other face's 'street has no sidewalks' tag, and only from that tag" in {
      val (tagged, untagged) = runRolledBack(for {
        taggedStreet   <- insertStreet()
        untaggedStreet <- insertStreet()
        user           <- insertUser()
        _              <- audit(taggedStreet, user)
        _              <- audit(untaggedStreet, user)
        _ <- insertLabel(taggedStreet, user, "NoSidewalk", Some(3.0), tags = Seq(NoSidewalksTag, "gravel/dirt road"))
        _ <- insertLabel(untaggedStreet, user, "NoSidewalk", Some(3.0), tags = Seq("street has a sidewalk"))
        _ <- table.rebuild
        tagged   <- facesOf(taggedStreet)
        untagged <- facesOf(untaggedStreet)
      } yield (tagged, untagged))

      tagged(StreetSide.Left).presenceBasis mustBe SidewalkPresenceBasis.NoSidewalkLabels
      tagged(StreetSide.Right).presence mustBe SidewalkPresenceStatus.Absent
      tagged(StreetSide.Right).presenceBasis mustBe SidewalkPresenceBasis.OtherSideTag
      // The fill is the other face's evidence, so this face's own counts stay at zero.
      tagged(StreetSide.Right).noSidewalkLabelCount mustBe 0
      tagged(StreetSide.Right).firstNoSidewalkLabelAt mustBe None

      untagged(StreetSide.Right).presence mustBe SidewalkPresenceStatus.Present
      untagged(StreetSide.Right).presenceBasis mustBe SidewalkPresenceBasis.AuditedNoLabels
    }

    "ignore an excluded contributor's labels and their audit, leaving the street unknown rather than present" in {
      // Dropping only the labels would leave the audit standing, and an audit with no labels is what calls a face
      // `present` -- so a banned contributor would flip the very faces they mislabeled.
      val (excludedOnly, alsoAudited) = runRolledBack(for {
        excludedOnlyStreet <- insertStreet()
        alsoAuditedStreet  <- insertStreet()
        banned             <- insertUser()
        good               <- insertUser()
        _                  <- excludeUser(banned)
        // Everything on this street came from the banned contributor: no evidence at all remains.
        _ <- audit(excludedOnlyStreet, banned)
        _ <- insertLabel(excludedOnlyStreet, banned, "NoSidewalk", Some(3.0))
        // Here a good contributor also walked it, so the street stays audited and its counts hold only their work.
        _            <- audit(alsoAuditedStreet, banned)
        _            <- audit(alsoAuditedStreet, good)
        _            <- insertLabel(alsoAuditedStreet, banned, "NoSidewalk", Some(3.0))
        _            <- insertLabel(alsoAuditedStreet, good, "Obstacle", Some(3.0))
        _            <- table.rebuild
        excludedOnly <- facesOf(excludedOnlyStreet)
        alsoAudited  <- facesOf(alsoAuditedStreet)
      } yield (excludedOnly, alsoAudited))

      excludedOnly.values.foreach { face =>
        face.presence mustBe SidewalkPresenceStatus.Unknown
        face.presenceBasis mustBe SidewalkPresenceBasis.Unaudited
        face.auditCount mustBe 0
        face.labelCount mustBe 0
      }

      val left = alsoAudited(StreetSide.Left)
      left.presence mustBe SidewalkPresenceStatus.Present
      left.presenceBasis mustBe SidewalkPresenceBasis.AuditedNoLabels
      left.noSidewalkLabelCount mustBe 0
      left.labelCount mustBe 1
      left.auditCount mustBe 1
      left.firstNoSidewalkLabelAt mustBe None
    }

    "count a labeled face absent even before any audit completes, and leave the other side unknown" in {
      val faces = runRolledBack(for {
        streetEdgeId <- insertStreet()
        user         <- insertUser()
        // An audit in progress: its labels are real, but the street has not been walked end to end.
        _     <- audit(streetEdgeId, user, completed = false)
        _     <- insertLabel(streetEdgeId, user, "NoSidewalk", Some(-3.0))
        _     <- table.rebuild
        faces <- facesOf(streetEdgeId)
      } yield faces)

      faces(StreetSide.Right).presence mustBe SidewalkPresenceStatus.Absent
      faces(StreetSide.Right).auditCount mustBe 0
      faces(StreetSide.Left).presence mustBe SidewalkPresenceStatus.Unknown
      faces(StreetSide.Left).presenceBasis mustBe SidewalkPresenceBasis.Unaudited
    }

    "change nothing on a second run, update only the faces whose evidence changed, and follow a deleted street" in {
      val (again, afterLabel, remaining) = runRolledBack(for {
        streetEdgeId <- insertStreet()
        // A second street with nothing hanging off it, so it can be deleted outright.
        bareStreetId <- insertStreet()
        user         <- insertUser()
        _            <- audit(streetEdgeId, user)
        _            <- table.rebuild
        again        <- table.rebuild
        _            <- insertLabel(streetEdgeId, user, "NoSidewalk", Some(3.0))
        afterLabel   <- table.rebuild
        _            <- sqlu"DELETE FROM street_edge WHERE street_edge_id = $bareStreetId"
        remaining    <- facesOf(bareStreetId)
      } yield (again, afterLabel, remaining))

      again.inserted mustBe 0
      again.updated mustBe 0
      again.deleted mustBe 0
      // The new label touches its own face only; the other face's row is left alone.
      afterLabel.updated mustBe 1
      afterLabel.inserted mustBe 0
      remaining mustBe empty
    }
  }
}
