package service

import models.label.{LabelTable, LabelTypeEnum, LabelTypeValidationsLeft, LabelValidationMetadata, StreetSide}
import models.pano.PanoSource.PanoSource
import models.utils.MyPostgresProfile.api._
import models.validation.ValidationLabelFilter
import models.validation.ValidationQueuePolicy.ValidationQueue
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

import java.util.UUID
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed tests for the queue policy Validate selects labels with (#4715), and for NoSidewalk's per-block-face
 * variant of it (#5285).
 *
 * The queue predicates and the sampler are the whole point of the change, and both live in SQL, so they are pinned by
 * running the real query against a real Postgres rather than by re-implementing the arithmetic in Scala. Fixtures are
 * synthesized inside a transaction that is always rolled back, and every query call filters to the fixture's own
 * labelers so the schema's real labels can't move an assertion.
 *
 * Two structural constraints shape the fixtures. Labels hang off a chain of foreign keys (mission → audit_task →
 * label → label_point, plus pano_data), so a labeler costs a handful of inserts. And the fixture labels point at a
 * pano row the schema already holds rather than one they insert: `PanoDataService.getReusableImageryStatus` runs on
 * its own connection and would not see an uncommitted pano, which would send the imagery check to the provider.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI). Scheduling
 * actors are disabled so background jobs can't write while a test is measuring.
 */
class ValidationQueueSpec extends PlaySpec with RolledBackDb with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val labelTable                                 = app.injector.instanceOf[LabelTable]
  private val labelService                               = app.injector.instanceOf[LabelService]
  private val configService                              = app.injector.instanceOf[ConfigService]
  private def await[T](f: scala.concurrent.Future[T]): T = Await.result(f, 120.seconds)

  private val viewer: PanoSource = configService.getPanoSource

  private val NoFilter = ValidationLabelFilter()

  /** Nobody: the caller the queries run as, so no fixture label is ever "placed by the requester". */
  private val requester: String = UUID.randomUUID().toString

  /**
   * Two streets the queries will accept: each has a region, neither is the tutorial street, and neither carries a
   * NoSidewalk label already, so the face evidence the fixtures produce on them is entirely their own.
   */
  private lazy val fixtureStreetEdgeIds: Seq[Int] = run(
    sql"""SELECT street_edge_region.street_edge_id
          FROM street_edge_region
          WHERE street_edge_region.street_edge_id <> (SELECT config.tutorial_street_edge_id FROM config)
            AND NOT EXISTS (SELECT 1 FROM label
                            WHERE label.street_edge_id = street_edge_region.street_edge_id
                              AND label.label_type = 'NoSidewalk')
          ORDER BY street_edge_region.street_edge_id
          LIMIT 2""".as[Int]
  )

  /**
   * A pano the queries will join: same source the page uses and unexpired. One checked within the past week is
   * preferred, so a future case that goes through the service's imagery check (`getReusableImageryStatus`, TTL 7
   * days) is answered from the row rather than by a provider; the query-level cases here never make that call.
   */
  private lazy val fixturePanoId: Option[String] = run(
    sql"""SELECT pano_data.pano_id
          FROM pano_data
          WHERE pano_data.source = ${viewer.toString}::pano_source
            AND NOT pano_data.expired
          ORDER BY (pano_data.last_checked >= now() - INTERVAL '6 days') DESC NULLS LAST
          LIMIT 1""".as[String].headOption
  )

  /** Both fixture anchors, or a cancelled test — a schema without them can't say anything about the queues. */
  private def fixtureAnchors: (Int, String) = (
    fixtureStreetEdgeIds.headOption.getOrElse(cancel("no non-tutorial street_edge_region row in this database")),
    fixturePanoId.getOrElse(cancel("no unexpired pano for this city's viewer in this database"))
  )

  /** A second street, for the cases that need faces on distinct streets. */
  private def secondStreetEdgeId: Int =
    fixtureStreetEdgeIds
      .lift(1)
      .getOrElse(cancel("fewer than two NoSidewalk-free non-tutorial streets in this database"))

  /** `centerline_offset_m` values that the DB turns into each side (377.sql: ≥ 1 m is left, ≤ −1 m is right). */
  private val LeftOfStreet: Option[Double]  = Some(3.0)
  private val RightOfStreet: Option[Double] = Some(-3.0)
  private val Unsided: Option[Double]       = None

  /**
   * Inserts a labeler whose labels the queues will consider.
   *
   * @param ownLabelsValidated How many of their own labels have been validated; under the policy's threshold makes
   *                           them a "new labeler" and earns their labels the priority bonus.
   * @param highQuality        Their `user_stat.high_quality` flag.
   * @return                   The new user's id.
   */
  private def insertLabeler(ownLabelsValidated: Int, highQuality: Boolean): DBIO[String] = {
    val userId   = UUID.randomUUID().toString
    val username = s"spec-4715-${userId.take(8)}"
    for {
      _ <- sqlu"""INSERT INTO sidewalk_user (user_id, username, email)
                  VALUES ($userId, $username, $username || '@example.test')"""
      _ <- sqlu"INSERT INTO user_role (user_id, role) VALUES ($userId, 'Registered')"
      _ <- sqlu"""INSERT INTO user_stat
                      (user_id, meters_audited, high_quality, excluded, on_leaderboard, public_profile,
                       own_labels_validated)
                  VALUES ($userId, 0, $highQuality, FALSE, FALSE, FALSE, $ownLabelsValidated)"""
    } yield userId
  }

  /**
   * Inserts one label with exactly the vote counts given, plus the mission, audit task and label point it needs.
   *
   * The counts are written straight onto the label row rather than accumulated by inserting validations: they are the
   * fixture's statement of fact, and going through `ValidationService` would move them.
   *
   * @param labelerId         Who placed it.
   * @param agree             `agree_count`.
   * @param disagree          `disagree_count`.
   * @param unsure            `unsure_count`.
   * @param correct           `correct`, the decision the counts have already produced; `unvalidatedOnly` filters on it.
   * @param createdDaysAgo    Age of the label, which decides the recency bonus (and NoSidewalk's age bonus).
   * @param labelType         The label's type, by name.
   * @param streetEdgeIdOpt   The street it is on; defaults to the fixture's first street.
   * @param centerlineOffsetM `label_point.centerline_offset_m`, which the DB turns into the label's `street_side`
   *                          (the block face); None leaves the label unsided.
   * @param panoIdOpt         The pano it was placed on; defaults to the fixture's pano.
   * @return                  The new label's id.
   */
  private def insertLabel(
      labelerId: String,
      agree: Int,
      disagree: Int,
      unsure: Int,
      correct: Option[Boolean],
      createdDaysAgo: Int = 30,
      labelType: String = "CurbRamp",
      streetEdgeIdOpt: Option[Int] = None,
      centerlineOffsetM: Option[Double] = None,
      panoIdOpt: Option[String] = None
  ): DBIO[Int] = {
    val (defaultStreetEdgeId, defaultPanoId) = fixtureAnchors
    val streetEdgeId                         = streetEdgeIdOpt.getOrElse(defaultStreetEdgeId)
    val panoId                               = panoIdOpt.getOrElse(defaultPanoId)
    for {
      missionId <- sql"""INSERT INTO mission
                             (mission_type, user_id, mission_start, mission_end, completed, pay, paid, skipped)
                         VALUES ('audit', $labelerId, now(), now(), TRUE, 0, FALSE, FALSE)
                         RETURNING mission_id""".as[Int].head
      auditTaskId <- sql"""INSERT INTO audit_task
                               (user_id, street_edge_id, task_start, task_end, completed, current_lat, current_lng,
                                low_quality, stale)
                           VALUES ($labelerId, $streetEdgeId, now(), now(), FALSE, 0, 0, FALSE, FALSE)
                           RETURNING audit_task_id""".as[Int].head
      labelId <- sql"""INSERT INTO label
                           (audit_task_id, pano_id, label_type, deleted, temporary_label_id, time_created, mission_id,
                            tutorial, street_edge_id, agree_count, disagree_count, unsure_count, correct, tags, user_id)
                       VALUES ($auditTaskId, $panoId, $labelType::label_type, FALSE, 1,
                               now() - make_interval(days => $createdDaysAgo), $missionId, FALSE, $streetEdgeId,
                               $agree, $disagree, $unsure, $correct, '{}', $labelerId)
                       RETURNING label_id""".as[Int].head
      // The lat/lng is arbitrary; the side comes from the explicit offset, never from the position.
      _ <- sqlu"""INSERT INTO label_point
                      (label_id, pano_x, pano_y, canvas_x, canvas_y, heading, pitch, zoom, lat, lng,
                       centerline_offset_m)
                  VALUES ($labelId, 100, 100, 100, 100, 0, 0, 1, 40.9, -74.0, $centerlineOffsetM)"""
    } yield labelId
  }

  /** A NoSidewalk label with no votes, on the given street and side. */
  private def insertNoSidewalk(
      labelerId: String,
      streetEdgeId: Int,
      centerlineOffsetM: Option[Double],
      agree: Int = 0,
      createdDaysAgo: Int = 30,
      panoIdOpt: Option[String] = None
  ): DBIO[Int] =
    insertLabel(
      labelerId,
      agree,
      0,
      0,
      if (agree > 0) Some(true) else None,
      createdDaysAgo,
      "NoSidewalk",
      Some(streetEdgeId),
      centerlineOffsetM,
      panoIdOpt
    )

  /**
   * A pano the service's imagery check answers from the row: the viewer's source, unexpired, and checked just now,
   * so `PanoDataService.getReusableImageryStatus` reuses it (its TTL is 7 days) and never asks the provider.
   *
   * @return The new pano's id.
   */
  private def insertPano(): DBIO[String] = {
    val panoId = s"spec-4715-${UUID.randomUUID().toString.take(8)}"
    sqlu"""INSERT INTO pano_data (pano_id, capture_date, expired, last_viewed, last_checked, source)
            VALUES ($panoId, '2024-01', FALSE, now(), now(), ${viewer.toString}::pano_source)""".map(_ => panoId)
  }

  /**
   * Runs `body` against fixture rows the service can see, then deletes them whatever the outcome.
   *
   * The service checks imagery on its own connections, which cannot see a rolled-back fixture, so the cases that go
   * through it commit theirs: a pano of their own plus every row the labelers' labels hang off.
   *
   * @param fixture Inserts the rows; given the committed pano's id, returns the labelers it created and a value for
   *                the body.
   * @param body    The assertions, given the fixture's value.
   */
  private def withCommittedFixture[T](fixture: String => DBIO[(Seq[String], T)])(body: T => Any): Unit = {
    val panoId                = run(insertPano())
    var labelers: Seq[String] = Seq.empty
    try {
      val (created, value) = run(fixture(panoId))
      labelers = created
      val _ = body(value)
    } finally {
      val perLabeler = labelers.flatMap { id =>
        Seq(
          sqlu"DELETE FROM label_point WHERE label_id IN (SELECT label_id FROM label WHERE user_id = $id)",
          sqlu"DELETE FROM label WHERE user_id = $id",
          sqlu"DELETE FROM audit_task WHERE user_id = $id",
          sqlu"DELETE FROM mission WHERE user_id = $id",
          sqlu"DELETE FROM user_stat WHERE user_id = $id",
          sqlu"DELETE FROM user_role WHERE user_id = $id",
          sqlu"DELETE FROM sidewalk_user WHERE user_id = $id"
        )
      }
      run(DBIO.seq(perLabeler :+ sqlu"DELETE FROM pano_data WHERE pano_id = $panoId": _*).transactionally)
    }
  }

  /**
   * Records an AI vote on a label: the validation row the counts already reflect, and the assessment that links the
   * label to it. Only the triage predicate reads this.
   *
   * @param labelId   The label the AI assessed.
   * @param result    'Agree' or 'Disagree'.
   * @param labelType The type the AI judged, when it isn't the label's current one (a vote from before a type change).
   */
  private def insertAiVote(labelId: Int, result: String, labelType: Option[String] = None): DBIO[Unit] = {
    for {
      aiUserId <- sql"SELECT user_id FROM sidewalk_login.user_role WHERE role = 'AI' LIMIT 1".as[String].headOption
      userId = aiUserId.getOrElse(cancel("no user holds the AI role in this database"))
      missionId <- sql"""INSERT INTO mission
                             (mission_type, user_id, mission_start, mission_end, completed, pay, paid, skipped)
                         VALUES ('validation', $userId, now(), now(), TRUE, 0, FALSE, FALSE)
                         RETURNING mission_id""".as[Int].head
      validationId <- sql"""INSERT INTO label_validation
                                (label_id, label_type, validation_result, user_id, mission_id, heading, pitch, zoom,
                                 canvas_height, canvas_width, start_timestamp, end_timestamp, source, viewer_type)
                            SELECT $labelId, COALESCE($labelType::label_type, label_type), $result::validation_option,
                                   $userId, $missionId, 0, 0, 1, 1, 1, now(), now(), 'SidewalkAI', 'StaticApi'
                            FROM label WHERE label_id = $labelId
                            RETURNING label_validation_id""".as[Int].head
      _ <- sqlu"""INSERT INTO label_ai_assessment
                      (label_id, validation_result, validation_accuracy, validation_confidence, api_version,
                       validator_model_id, validator_training_date, timestamp, label_validation_id, ai_image_source)
                  VALUES ($labelId, $result::validation_option, 0.95, 0.95, 'spec-4715', 'spec-4715', now(), now(),
                          $validationId, 'download')"""
    } yield ()
  }

  /** The ids the given queue serves out of one labeler's labels. */
  private def queueIds(
      queue: ValidationQueue,
      labelerIds: Set[String],
      unvalidatedOnly: Boolean = false,
      labelType: LabelTypeEnum.Base = LabelTypeEnum.CurbRamp
  ): DBIO[Set[Int]] = {
    labelTable
      .retrieveLabelListForValidationQuery(requester, viewer, labelType, queue,
        filter = ValidationLabelFilter(userIds = Some(labelerIds)), unvalidatedOnly = unvalidatedOnly)
      .map(_._1)
      .result
      .map(_.toSet)
  }

  /** The face evidence rows on the fixture's streets, keyed by (street, side). */
  private def fixtureFaceEvidence: DBIO[Map[(Int, StreetSide.Value), (Int, Int, Int)]] =
    labelTable.getNoSidewalkFaceEvidence.map(
      _.filter(f => fixtureStreetEdgeIds.contains(f.streetEdgeId))
        .map(f => (f.streetEdgeId, f.streetSide) -> (f.labelerCount, f.support, f.labelCount))
        .toMap
    )

  /**
   * One labeler and thirteen labels covering every branch of the queue predicates, keyed by the letters the
   * assertions use.
   *
   * @return (labeler id, label id by name).
   */
  private def queueFixture: DBIO[(String, Map[String, Int])] = {
    for {
      labeler <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
      a       <- insertLabel(labeler, 0, 0, 0, None)        // no votes at all
      b       <- insertLabel(labeler, 1, 0, 0, Some(true))  // one vote, undecided
      c       <- insertLabel(labeler, 1, 1, 0, None)        // tied
      d       <- insertLabel(labeler, 0, 0, 1, None)        // unsure only, one vote
      e       <- insertLabel(labeler, 2, 0, 0, Some(true))  // settled
      f       <- insertLabel(labeler, 3, 1, 0, Some(true))  // settled with more votes
      g       <- insertLabel(labeler, 2, 2, 1, None)        // capped out at the vote limit, still tied
      h       <- insertLabel(labeler, 0, 0, 5, None)        // capped out on unsure votes alone
      i       <- insertLabel(labeler, 1, 0, 4, None)        // capped out, one agree short of nothing
      j       <- insertLabel(labeler, 1, 0, 0, Some(true))  // the AI's vote and nobody else's
      k       <- insertLabel(labeler, 1, 1, 2, None)        // unsure-heavy but under the cap
      l       <- insertLabel(labeler, 1, 1, 0, None)        // AI agreed, a human disagreed
      m       <- insertLabel(labeler, 0, 1, 0, Some(false)) // AI disagreed and the humans have not pushed back
      _       <- insertAiVote(j, "Agree")
      _       <- insertAiVote(l, "Agree")
      _       <- insertAiVote(m, "Disagree")
    } yield (
      labeler,
      Map(
        "A" -> a,
        "B" -> b,
        "C" -> c,
        "D" -> d,
        "E" -> e,
        "F" -> f,
        "G" -> g,
        "H" -> h,
        "I" -> i,
        "J" -> j,
        "K" -> k,
        "L" -> l,
        "M" -> m
      )
    )
  }

  "The NeedsVotes queue" should {
    "serve unvoted, undecided and unsure-only labels, and nothing settled or capped out" in {
      val (served, ids) = runRolledBack(for {
        (labeler, ids) <- queueFixture
        served         <- queueIds(ValidationQueue.NeedsVotes, Set(labeler))
      } yield (served, ids))

      served mustBe Set("A", "B", "C", "D", "J", "K", "L", "M").map(ids)
    }

    "still serve a label whose only vote is the AI's" in {
      val (needsVotes, triage, ids) = runRolledBack(for {
        (labeler, ids) <- queueFixture
        needsVotes     <- queueIds(ValidationQueue.NeedsVotes, Set(labeler))
        triage         <- queueIds(ValidationQueue.Triage, Set(labeler))
      } yield (needsVotes, triage, ids))

      // A lone AI Agree leaves the label one vote from settled, which is the crowd's job, not an expert's.
      needsVotes must contain(ids("J"))
      triage must not contain ids("J")
    }
  }

  "The Any queue" should {
    "serve every label the viewer can render, settled ones included" in {
      val (served, ids) = runRolledBack(for {
        (labeler, ids) <- queueFixture
        served         <- queueIds(ValidationQueue.Any, Set(labeler))
      } yield (served, ids))

      served mustBe ids.values.toSet
    }
  }

  "The Triage queue" should {
    "serve capped-out, unsure-heavy and AI-contested labels, and nothing else" in {
      val (served, ids) = runRolledBack(for {
        (labeler, ids) <- queueFixture
        served         <- queueIds(ValidationQueue.Triage, Set(labeler))
      } yield (served, ids))

      served mustBe Set("G", "H", "I", "K", "L").map(ids)
    }
  }

  /** A human vote on a label, cast on `labelType` (the label's current type when None), under a mission of its own. */
  private def insertVote(labelId: Int, userId: String, result: String, labelType: Option[String] = None): DBIO[Int] =
    for {
      missionId <- sql"""INSERT INTO mission
                             (mission_type, user_id, mission_start, mission_end, completed, pay, paid, skipped)
                         VALUES ('validation', $userId, now(), now(), TRUE, 0, FALSE, FALSE)
                         RETURNING mission_id""".as[Int].head
      inserted <- sqlu"""INSERT INTO label_validation
                             (label_id, label_type, validation_result, user_id, mission_id, heading, pitch, zoom,
                              canvas_height, canvas_width, start_timestamp, end_timestamp, source, viewer_type)
                         SELECT $labelId, COALESCE($labelType::label_type, label_type), $result::validation_option,
                                $userId, $missionId, 0, 0, 1, 1, 1, now(), now(), 'Validate', 'Default'
                         FROM label WHERE label_id = $labelId"""
    } yield inserted

  "A vote cast before the label's type changed" should {
    "not stop the validator being served the label again" in {
      val (servedBefore, servedAfter, labelId) = runRolledBack(for {
        labeler   <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
        validator <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
        labelId   <- insertLabel(labeler, 0, 0, 0, None)
        served = labelTable
          .retrieveLabelListForValidationQuery(validator, viewer, LabelTypeEnum.CurbRamp, ValidationQueue.Any,
            userIds = Some(Set(labeler)))
          .map(_._1)
          .result
          .map(_.toSet)
        _            <- insertVote(labelId, validator, "Agree", Some("NoCurbRamp"))
        servedBefore <- served
        _            <- insertVote(labelId, validator, "Agree")
        servedAfter  <- served
      } yield (servedBefore, servedAfter, labelId))

      servedBefore must contain(labelId)
      servedAfter must not contain labelId
    }

    "not make the label AI-contested" in {
      val (triage, labelId) = runRolledBack(for {
        labeler <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
        // The same shape as fixture label L, except the AI judged an earlier type.
        labelId <- insertLabel(labeler, 0, 1, 0, Some(false))
        _       <- insertAiVote(labelId, "Agree", Some("NoCurbRamp"))
        triage  <- queueIds(ValidationQueue.Triage, Set(labeler))
      } yield (triage, labelId))

      triage must not contain labelId
    }
  }

  "unvalidatedOnly" should {
    "narrow a queue to the labels that have no decision recorded" in {
      val (served, ids) = runRolledBack(for {
        (labeler, ids) <- queueFixture
        served         <- queueIds(ValidationQueue.NeedsVotes, Set(labeler), unvalidatedOnly = true)
      } yield (served, ids))

      served mustBe Set("A", "C", "D", "K", "L").map(ids)
    }
  }

  "The team filter" should {
    "serve and count only labels from the team's members, and nothing for an empty team list" in {
      def curbRampAvailable(filter: ValidationLabelFilter): DBIO[Int] =
        labelTable
          .getAvailableValidationsLabelsByType(requester, viewer, unvalidatedOnly = false, ValidationQueue.crowdCascade,
            None, filter)
          .map(_.find(_.labelType == LabelTypeEnum.CurbRamp).map(_.validationsAvailable).getOrElse(0))

      def served(filter: ValidationLabelFilter): DBIO[Set[Int]] =
        labelTable
          .retrieveLabelListForValidationQuery(requester, viewer, LabelTypeEnum.CurbRamp, ValidationQueue.Any,
            filter = filter)
          .map(_._1)
          .result
          .map(_.toSet)

      val (memberLabels, byTeam, byTeamAndUser, countByTeam, byNoTeam, countByNoTeam) = runRolledBack(for {
        member   <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
        outsider <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
        teamId   <-
          sql"INSERT INTO team (name, description) VALUES (${s"spec-5342-${System.nanoTime()}"}, '') RETURNING team_id"
            .as[Int]
            .head
        _    <- sqlu"INSERT INTO user_team (user_id, team_id) VALUES ($member, $teamId)"
        mine <- DBIO.sequence((1 to 3).map(_ => insertLabel(member, 0, 0, 0, None)))
        _    <- DBIO.sequence((1 to 2).map(_ => insertLabel(outsider, 0, 0, 0, None)))
        teamOnly = ValidationLabelFilter(teamIds = Some(Set(teamId)))
        byTeam    <- served(teamOnly)
        both      <- served(teamOnly.copy(userIds = Some(Set(member, outsider))))
        count     <- curbRampAvailable(teamOnly)
        noTeam    <- served(ValidationLabelFilter(teamIds = Some(Set.empty)))
        noTeamCnt <- curbRampAvailable(ValidationLabelFilter(teamIds = Some(Set.empty)))
      } yield (mine.toSet, byTeam, both, count, noTeam, noTeamCnt))

      byTeam mustBe memberLabels
      // The filters stack: naming the outsider as a user does not let their labels past the team filter.
      byTeamAndUser mustBe memberLabels
      countByTeam mustBe memberLabels.size
      byNoTeam mustBe empty
      countByNoTeam mustBe 0
    }
  }

  "getAvailableValidationsLabelsByType" should {
    "count each queue with the same predicates the label query filters on" in {
      def curbRampCounts(queues: Seq[ValidationQueue]): DBIO[LabelTypeValidationsLeft] =
        labelTable
          .getAvailableValidationsLabelsByType(requester, viewer, unvalidatedOnly = false, queues, None, NoFilter)
          .map(
            _.find(_.labelType == LabelTypeEnum.CurbRamp)
              .getOrElse(LabelTypeValidationsLeft(LabelTypeEnum.CurbRamp, 0, 0, 0))
          )

      val (before, after, crowd) = runRolledBack(for {
        before <- curbRampCounts(ValidationQueue.expertCascade)
        _      <- queueFixture
        after  <- curbRampCounts(ValidationQueue.expertCascade)
        crowd  <- curbRampCounts(ValidationQueue.crowdCascade)
      } yield (before, after, crowd))

      after.validationsAvailable - before.validationsAvailable mustBe 13
      after.needsVotes - before.needsVotes mustBe 8
      after.triage - before.triage mustBe 5
      // The crowd's cascade never reads the triage count, so its query is not run at all.
      crowd.triage mustBe 0
      crowd.needsVotes mustBe after.needsVotes
    }

    "take the face count only for a cascade that could serve NoSidewalk from NeedsVotes" in {
      def noSidewalkCounts(
          queues: Seq[ValidationQueue],
          required: Option[LabelTypeEnum.Base]
      ): DBIO[Option[LabelTypeValidationsLeft]] =
        labelTable
          .getAvailableValidationsLabelsByType(requester, viewer, unvalidatedOnly = false, queues, required, NoFilter)
          .map(_.find(_.labelType == LabelTypeEnum.NoSidewalk))

      val (crowd, pinnedElsewhere, triageOnly, pinnedHere) = runRolledBack(for {
        labeler         <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
        _               <- insertNoSidewalk(labeler, fixtureAnchors._1, LeftOfStreet)
        crowd           <- noSidewalkCounts(ValidationQueue.crowdCascade, None)
        pinnedElsewhere <- noSidewalkCounts(ValidationQueue.crowdCascade, Some(LabelTypeEnum.CurbRamp))
        triageOnly      <- noSidewalkCounts(Seq(ValidationQueue.Triage), None)
        pinnedHere      <- noSidewalkCounts(ValidationQueue.expertCascade, Some(LabelTypeEnum.NoSidewalk))
      } yield (crowd, pinnedElsewhere, triageOnly, pinnedHere))

      crowd.flatMap(_.facesNeedingVotes).isDefined mustBe true
      pinnedHere.flatMap(_.facesNeedingVotes).isDefined mustBe true
      // A mission pinned to another type, or a cascade without NeedsVotes, has nothing to weigh the faces for.
      pinnedElsewhere.flatMap(_.facesNeedingVotes) mustBe None
      triageOnly.flatMap(_.facesNeedingVotes) mustBe None
    }
  }

  "The sampler" should {
    "serve a high-priority label far more often than uniform, without ever making it certain" in {
      // One label at the maximum score (new labeler, high quality, no votes, fresh) against twenty at score 100 (an
      // established labeler, one vote, a month old). Weights are score², so 425² = 180,625 against 20 x 100² =
      // 200,000: the high scorer wins the top slot 47.5% of the time, where uniform would give it 4.8%.
      val Draws           = 200
      val (hits, winners) = runRolledBack(for {
        newLabeler <- insertLabeler(ownLabelsValidated = 0, highQuality = true)
        oldLabeler <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
        top        <- insertLabel(newLabeler, 0, 0, 0, None, createdDaysAgo = 0)
        _          <- DBIO.sequence((1 to 20).map(_ => insertLabel(oldLabeler, 1, 0, 0, None)))
        drawn      <- DBIO.sequence((1 to Draws).map { _ =>
          labelTable
            .retrieveLabelListForValidationQuery(
              requester,
              viewer,
              LabelTypeEnum.CurbRamp,
              ValidationQueue.NeedsVotes,
              filter = ValidationLabelFilter(userIds = Some(Set(newLabeler, oldLabeler)))
            )
            .map(_._1)
            .take(1)
            .result
            .map(_.head)
        })
      } yield (drawn.count(_ == top), drawn.toSet))

      // Binomial(200, 0.4746) has mean 95 and sd 7.1, so this band is five standard deviations wide either way and
      // still nowhere near the ~10 hits a uniform sort would produce.
      hits must be >= 60
      hits must be <= 140
      // Weighted sampling, not a ranking: the low scorers still win the top slot sometimes.
      winners.size must be > 1
    }
  }

  "The queue cascade" should {
    "top a queue that cannot fill a mission up from the next queue in the list" in {
      // This one runs against the schema's own labels: the service checks imagery on its own connection, which cannot
      // see a rolled-back fixture's rows.
      val counts = run(
        labelTable.getAvailableValidationsLabelsByType(requester, viewer, unvalidatedOnly = false,
          ValidationQueue.expertCascade, None, NoFilter)
      )
      val needed    = 3
      val shortType = counts.find(t => t.triage < needed && t.needsVotes >= needed)
      assume(shortType.isDefined, "no label type in this schema has a short triage queue and a full NeedsVotes queue")
      val labelType = shortType.get.labelType

      val triageOnly = await(
        labelService.retrieveLabelListForValidation(requester, needed, viewer, labelType, Seq(ValidationQueue.Triage),
          NoFilter)
      )
      val cascaded = await(
        labelService.retrieveLabelListForValidation(
          requester,
          needed,
          viewer,
          labelType,
          Seq(ValidationQueue.Triage, ValidationQueue.NeedsVotes, ValidationQueue.Any),
          NoFilter
        )
      )

      triageOnly.size must be < needed
      assume(cascaded.nonEmpty, "no imagery available for this schema's labels, so nothing could be served")
      cascaded.size must be > triageOnly.size
      cascaded.map(_.labelId).distinct.size mustBe cascaded.size
    }

    "serve only labels that still need votes when NeedsVotes is the whole cascade" in {
      val counts = run(
        labelTable.getAvailableValidationsLabelsByType(requester, viewer, unvalidatedOnly = false,
          ValidationQueue.expertCascade, None, NoFilter)
      )
      val fullType = counts.find(_.needsVotes >= 5)
      assume(fullType.isDefined, "no label type in this schema has enough labels needing votes")

      val served = await(
        labelService.retrieveLabelListForValidation(requester, 5, viewer, fullType.get.labelType,
          Seq(ValidationQueue.NeedsVotes), NoFilter)
      )
      assume(served.nonEmpty, "no imagery available for this schema's labels, so nothing could be served")

      served.foreach { label =>
        val info   = label.validationInfo
        val total  = info.agreeCount + info.disagreeCount + info.unsureCount
        val margin = (info.agreeCount - info.disagreeCount).abs
        withClue(s"label ${label.labelId} (a=${info.agreeCount} d=${info.disagreeCount} u=${info.unsureCount}): ") {
          (total == 0 || (margin < 2 && total < 5)) mustBe true
        }
      }
    }
  }

  "NoSidewalk face evidence" should {
    "count human labelers and agreeing human votes per (street, side), and give unsided labels no face" in {
      val (evidence, streetA, streetB) = runRolledBack(for {
        labelerOne <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
        labelerTwo <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
        streetA = fixtureAnchors._1
        streetB = secondStreetEdgeId
        // Street A, left: three labels by one person, none voted on.
        _ <- insertNoSidewalk(labelerOne, streetA, LeftOfStreet)
        _ <- insertNoSidewalk(labelerOne, streetA, LeftOfStreet)
        _ <- insertNoSidewalk(labelerOne, streetA, LeftOfStreet)
        // Street A, right: two labelers, one human Agree and one label whose only Agree is the AI's.
        _      <- insertNoSidewalk(labelerOne, streetA, RightOfStreet, agree = 1)
        aiOnly <- insertNoSidewalk(labelerTwo, streetA, RightOfStreet, agree = 1)
        _      <- insertAiVote(aiOnly, "Agree")
        // Street B: one unsided label, which is nobody's face.
        _        <- insertNoSidewalk(labelerTwo, streetB, Unsided)
        evidence <- fixtureFaceEvidence
      } yield (evidence, streetA, streetB))

      evidence.get((streetA, StreetSide.Left)) mustBe Some((1, 0, 3))
      evidence.get((streetA, StreetSide.Right)) mustBe Some((2, 1, 2))
      evidence.keys.filter(_._1 == streetB) mustBe empty
    }
  }

  "NoSidewalk face evidence and the label query" should {
    "leave out every label on an excluded face, and nothing else" in {
      val (served, aRight, bLeft, unsided) = runRolledBack(for {
        labeler <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
        streetA = fixtureAnchors._1
        streetB = secondStreetEdgeId
        _       <- insertNoSidewalk(labeler, streetA, LeftOfStreet)
        _       <- insertNoSidewalk(labeler, streetA, LeftOfStreet)
        aRight  <- insertNoSidewalk(labeler, streetA, RightOfStreet)
        bLeft   <- insertNoSidewalk(labeler, streetB, LeftOfStreet)
        unsided <- insertNoSidewalk(labeler, streetA, Unsided)
        served  <- labelTable
          .retrieveLabelListForValidationQuery(
            requester,
            viewer,
            LabelTypeEnum.NoSidewalk,
            ValidationQueue.Any,
            filter = ValidationLabelFilter(userIds = Some(Set(labeler))),
            excludedFaces = Set((streetA, StreetSide.Left))
          )
          .map(_._1)
          .result
      } yield (served, aRight, bLeft, unsided))

      // The other side of the same street, another street, and an unsided label on the street are all still served.
      served.toSet mustBe Set(aRight, bLeft, unsided)
    }
  }

  "countNoSidewalkFacesNeedingVotes" should {
    "count the requester's servable sided faces short of the settled support, and honour unvalidatedOnly" in {
      def faces(me: String, unvalidatedOnly: Boolean): DBIO[Int] =
        labelTable.countNoSidewalkFacesNeedingVotes(me, viewer, unvalidatedOnly, NoFilter)

      val (before, after, beforeUnvalidated, afterUnvalidated) = runRolledBack(for {
        // The requester is a real user here, so they can own a label of their own.
        me                <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
        labeler           <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
        before            <- faces(me, unvalidatedOnly = false)
        beforeUnvalidated <- faces(me, unvalidatedOnly = true)
        streetA = fixtureAnchors._1
        streetB = secondStreetEdgeId
        // Face A: unvoted, so it counts.
        _ <- insertNoSidewalk(labeler, streetA, LeftOfStreet)
        _ <- insertNoSidewalk(labeler, streetA, LeftOfStreet)
        // Face B: two agreeing votes across its labels, so it is settled for the lottery (its labels stay servable).
        _ <- insertNoSidewalk(labeler, streetA, RightOfStreet, agree = 1)
        _ <- insertNoSidewalk(labeler, streetA, RightOfStreet, agree = 1)
        // An unsided label is not a face.
        _ <- insertNoSidewalk(labeler, streetB, Unsided)
        // A face whose only labels are the requester's own is not servable to them.
        _                <- insertNoSidewalk(me, streetB, LeftOfStreet)
        after            <- faces(me, unvalidatedOnly = false)
        afterUnvalidated <- faces(me, unvalidatedOnly = true)
      } yield (before, after, beforeUnvalidated, afterUnvalidated))

      after - before mustBe 1
      // Face A's labels have no decision, so it still counts under unvalidatedOnly; face B's do, so it never did.
      afterUnvalidated - beforeUnvalidated mustBe 1
    }
  }

  "The NoSidewalk sampler" should {
    "serve a lone-labeler face far more often than a well-supported one, and still serve unsided labels" in {
      // One label on a face nobody else has labeled or confirmed, against twenty labels on a face five people labeled
      // and four votes have confirmed, plus one unsided label. Per the face score the lone label is about 460 (200
      // base + 200 lone-labeler + 60 age) against about (200 + 8 + 60) / 5 ≈ 54 for each of the twenty (≈ 34 for the
      // four that carry the votes) and ≈ 201 for the unsided one, so under score² it wins the top slot about 70% of
      // the time; uniform would give it 4.5%.
      val Draws                                = 200
      val (hits, winners, needsVotes, unsided) = runRolledBack(for {
        lone  <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
        crowd <- DBIO.sequence((1 to 5).map(_ => insertLabeler(ownLabelsValidated = 100, highQuality = false)))
        streetA = fixtureAnchors._1
        streetB = secondStreetEdgeId
        top <- insertNoSidewalk(lone, streetA, LeftOfStreet, createdDaysAgo = 365 * 7)
        _   <- DBIO.sequence(
          (1 to 20).map(i =>
            insertNoSidewalk(
              crowd(i % 5),
              streetB,
              LeftOfStreet,
              agree = if (i <= 4) 1 else 0,
              createdDaysAgo = 365 * 7
            )
          )
        )
        unsided <- insertNoSidewalk(lone, streetA, Unsided)
        labelers = Some(Set(lone) ++ crowd)
        drawn <- DBIO.sequence((1 to Draws).map { _ =>
          labelTable
            .retrieveLabelListForValidationQuery(requester, viewer, LabelTypeEnum.NoSidewalk,
              ValidationQueue.NeedsVotes, filter = ValidationLabelFilter(userIds = labelers))
            .map(_._1)
            .take(1)
            .result
            .map(_.head)
        })
        needsVotes <- queueIds(ValidationQueue.NeedsVotes, labelers.get, labelType = LabelTypeEnum.NoSidewalk)
      } yield (drawn.count(_ == top), drawn.toSet, needsVotes, unsided))

      // Binomial(200, 0.70) has mean 140 and sd 6.5, so the band is ±4.6 sd and nowhere near uniform's ~9 hits.
      hits must be >= 110
      hits must be <= 170
      winners.size must be > 1
      // No face row for an unsided label means NULL evidence, not a NULL score: it is still served.
      needsVotes must contain(unsided)
    }
  }

  "The NoSidewalk cascade" should {
    "hold one label per face across the queues it drains" in {
      assume(models.pano.PanoSource.providerCheckedSources.contains(viewer), "the imagery check is not row-answerable")
      // Face A carries a label the crowd is stuck on (five votes, no margin) and an unvoted one; face B an unvoted one.
      // An expert's cascade fills a two-label mission from Triage first, which yields A's stuck label, and the queue
      // after it must then go to B rather than back to A.
      withCommittedFixture { panoId =>
        for {
          labeler <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
          streetA = fixtureAnchors._1
          streetB = secondStreetEdgeId
          stuck <- insertLabel(labeler, 2, 2, 1, None, labelType = "NoSidewalk", streetEdgeIdOpt = Some(streetA),
            centerlineOffsetM = LeftOfStreet, panoIdOpt = Some(panoId))
          _ <- insertNoSidewalk(labeler, streetA, LeftOfStreet, panoIdOpt = Some(panoId))
          _ <- insertNoSidewalk(labeler, streetB, LeftOfStreet, panoIdOpt = Some(panoId))
        } yield (Seq(labeler), (labeler, streetA, streetB, stuck))
      } { case (labeler, streetA, streetB, stuck) =>
        val served = await(
          labelService.retrieveLabelListForValidation(requester, 2, viewer, LabelTypeEnum.NoSidewalk,
            ValidationQueue.expertCascade, filter = ValidationLabelFilter(userIds = Some(Set(labeler))))
        )
        served.map(_.labelId) must contain(stuck)
        served.map(l => (l.streetEdgeId, l.streetSide)).toSet mustBe
          Set((streetA, Some(StreetSide.Left)), (streetB, Some(StreetSide.Left)))
      }
    }

    "top a mission up from a face it does not hold, however many labels outrank it on a held face" in {
      assume(models.pano.PanoSource.providerCheckedSources.contains(viewer), "the imagery check is not row-answerable")
      // Face A: six lone-labeler labels seven years old, the top of the queue under the face score. Face B: one label
      // with an agreeing vote, scoring far below them. A client holding one of A's labels asks for one more; it must
      // come from B, even though A's other five outrank it and a five-row batch would be all A.
      withCommittedFixture { panoId =>
        for {
          labeler <- insertLabeler(ownLabelsValidated = 100, highQuality = false)
          streetA = fixtureAnchors._1
          streetB = secondStreetEdgeId
          onA <- DBIO.sequence(
            (1 to 6).map(_ =>
              insertNoSidewalk(labeler, streetA, LeftOfStreet, createdDaysAgo = 365 * 7, panoIdOpt = Some(panoId))
            )
          )
          onB <- insertNoSidewalk(labeler, streetB, LeftOfStreet, agree = 1, panoIdOpt = Some(panoId))
        } yield (Seq(labeler), (labeler, onA.head, onB))
      } { case (labeler, held, onB) =>
        (1 to 5).foreach { _ =>
          val served = await(
            labelService.retrieveLabelListForValidation(requester, 1, viewer, LabelTypeEnum.NoSidewalk,
              ValidationQueue.crowdCascade, filter = ValidationLabelFilter(userIds = Some(Set(labeler))),
              excludedLabelIds = Set(held))
          )
          served.map(_.labelId) mustBe Seq(onB)
        }
      }
    }
  }

  "spreadAcrossFaces" should {
    "take one label per face, distinct streets first, and fall back to a repeat face only when short" in {
      def label(id: Int, street: Int, side: Option[StreetSide.Value]): LabelValidationMetadata = {
        // Only the face fields matter to the spread; the rest is filler.
        LabelValidationMetadata(
          id,
          LabelTypeEnum.NoSidewalk,
          "pano",
          viewer,
          expired = false,
          "2020-01",
          java.time.OffsetDateTime.now(),
          models.label.LatLng(0, 0),
          models.label.POV(0, 0, 1),
          models.label.LocationXY(0, 0),
          None,
          None,
          street,
          1,
          side,
          models.label.LabelValidationInfo(0, 0, 0, None, None, None),
          Seq.empty,
          None,
          None,
          None,
          aiGenerated = false
        )
      }
      val faceA   = (1 to 5).map(i => label(i, 100, Some(StreetSide.Left)))
      val faceB   = (6 to 7).map(i => label(i, 200, Some(StreetSide.Right)))
      val unsided = label(8, 100, None)
      val ordered = faceA.take(1) ++ faceB.take(1) ++ faceA.drop(1) ++ Seq(unsided) ++ faceB.drop(1)
      def ids(labels: Seq[LabelValidationMetadata]): Seq[Int] = labels.map(_.labelId)

      // Three faces available: one of each, in the candidates' order, and street 100's unsided label after both
      // streets have been touched once. Nothing repeats a face, however many candidates a face has.
      ids(LabelServiceImpl.spreadAcrossFaces(ordered, Set.empty)) mustBe Seq(1, 6, 8)
      // A face the mission already holds is skipped, and the highest-ranked label of each face wins.
      val held = Set(LabelServiceImpl.FaceKey(100, Some(StreetSide.Left), None))
      ids(LabelServiceImpl.spreadAcrossFaces(ordered, held)) mustBe Seq(6, 8)
      // Two unsided labels on one street are two faces, not one.
      val twoUnsided = Seq(label(8, 100, None), label(9, 100, None))
      ids(LabelServiceImpl.spreadAcrossFaces(twoUnsided, Set.empty)) mustBe Seq(8, 9)
    }
  }

  "Type selection" should {
    "weight NoSidewalk by faces still needing votes in the crowd's queue, and gate it on labels like any type" in {
      val missionLength = 10
      val noSidewalk    = LabelTypeValidationsLeft(LabelTypeEnum.NoSidewalk, 500, 12, 0, facesNeedingVotes = Some(3))
      val curbRamp      = LabelTypeValidationsLeft(LabelTypeEnum.CurbRamp, 500, 50, 3)

      // 12 labels pass the 10-label gate even though only 3 faces need votes; the lottery then weighs the 3.
      val (queue, types) =
        LabelServiceImpl.chooseQueueAndTypes(
          Seq(noSidewalk, curbRamp),
          ValidationQueue.crowdCascade,
          missionLength,
          allowShortMission = false
        )
      queue mustBe ValidationQueue.NeedsVotes
      types must contain(noSidewalk)
      noSidewalk.weightFor(ValidationQueue.NeedsVotes) mustBe 3
      noSidewalk.weightFor(ValidationQueue.Any) mustBe 1
      noSidewalk.copy(triage = 7).weightFor(ValidationQueue.Triage) mustBe 7

      // A small city with 8 faces across 40 labels still gets NoSidewalk missions: the gate is on labels.
      val smallCity = noSidewalk.copy(needsVotes = 40, facesNeedingVotes = Some(8))
      LabelServiceImpl
        .chooseQueueAndTypes(Seq(smallCity), ValidationQueue.crowdCascade, missionLength, allowShortMission = false)
        ._2 mustBe
        Seq(smallCity)
      // Labels enough but every face settled: NoSidewalk cannot be the crowd's queue's winner, or every mission would
      // land on faces the crowd has finished, so the cascade falls through to Any.
      val settledFaces = noSidewalk.copy(facesNeedingVotes = Some(0))
      settledFaces.canFill(ValidationQueue.NeedsVotes, missionLength) mustBe false
      LabelServiceImpl.chooseQueueAndTypes(
        Seq(settledFaces),
        ValidationQueue.crowdCascade,
        missionLength,
        allowShortMission = false
      ) mustBe
        ((ValidationQueue.Any, Seq(settledFaces)))
      // The face count only ever weighs NoSidewalk; any other type weighs by its labels whatever it carries.
      curbRamp.weightFor(ValidationQueue.NeedsVotes) mustBe 50
      curbRamp.copy(facesNeedingVotes = Some(8)).weightFor(ValidationQueue.NeedsVotes) mustBe 50
    }

    "use the first queue in the cascade that can fill a mission, and weight uniformly once it falls back to Any" in {
      val missionLength                                                                  = 10
      def counts(needsVotes: Int, triage: Int, available: Int): LabelTypeValidationsLeft =
        LabelTypeValidationsLeft(LabelTypeEnum.CurbRamp, available, needsVotes, triage)

      val plenty = counts(needsVotes = 50, triage = 3, available = 500)
      val thin   = counts(needsVotes = 2, triage = 0, available = 500).copy(labelType = LabelTypeEnum.Crosswalk)

      // The crowd's cascade stops at NeedsVotes as soon as one type can fill a mission from it.
      val (crowdQueue, crowdTypes) =
        LabelServiceImpl.chooseQueueAndTypes(
          Seq(plenty, thin),
          ValidationQueue.crowdCascade,
          missionLength,
          allowShortMission = false
        )
      crowdQueue mustBe ValidationQueue.NeedsVotes
      crowdTypes mustBe Seq(plenty)

      // With nothing left to settle anywhere, it falls through to Any so the game does not end (#2929).
      val (fallbackQueue, fallbackTypes) =
        LabelServiceImpl.chooseQueueAndTypes(
          Seq(thin),
          ValidationQueue.crowdCascade,
          missionLength,
          allowShortMission = false
        )
      fallbackQueue mustBe ValidationQueue.Any
      fallbackTypes mustBe Seq(thin)
      thin.weightFor(ValidationQueue.Any) mustBe 1

      // An expert's cascade skips a triage queue too thin to fill a mission and lands on the crowd's queue.
      val (expertQueue, expertTypes) =
        LabelServiceImpl.chooseQueueAndTypes(
          Seq(plenty),
          ValidationQueue.expertCascade,
          missionLength,
          allowShortMission = false
        )
      expertQueue mustBe ValidationQueue.NeedsVotes
      expertTypes mustBe Seq(plenty)
      plenty.weightFor(ValidationQueue.NeedsVotes) mustBe 50

      // And no queue at all leaves the caller with no type to serve.
      val (emptyQueue, emptyTypes) =
        LabelServiceImpl.chooseQueueAndTypes(
          Seq.empty,
          ValidationQueue.expertCascade,
          missionLength,
          allowShortMission = false
        )
      emptyQueue mustBe ValidationQueue.Any
      emptyTypes mustBe Seq.empty
    }

    "settle for a queue short of a whole mission only when short missions are allowed, and still prefer a full one" in {
      val missionLength = 10
      val few           = LabelTypeValidationsLeft(LabelTypeEnum.CurbRamp, 7, 7, 0)
      val some          = LabelTypeValidationsLeft(LabelTypeEnum.Obstacle, 4, 0, 0)
      val full          = LabelTypeValidationsLeft(LabelTypeEnum.Crosswalk, 12, 0, 0)

      LabelServiceImpl.chooseQueueAndTypes(
        Seq(few, some),
        ValidationQueue.crowdCascade,
        missionLength,
        allowShortMission = false
      ) mustBe ((ValidationQueue.Any, Seq.empty))
      // The cascade keeps its order: NeedsVotes holds CurbRamp's 7, so it wins over Any's 11 across both types.
      LabelServiceImpl.chooseQueueAndTypes(
        Seq(few, some),
        ValidationQueue.crowdCascade,
        missionLength,
        allowShortMission = true
      ) mustBe ((ValidationQueue.NeedsVotes, Seq(few)))
      LabelServiceImpl.chooseQueueAndTypes(
        Seq(few, full),
        ValidationQueue.crowdCascade,
        missionLength,
        allowShortMission = true
      ) mustBe ((ValidationQueue.Any, Seq(full)))
    }
  }
}
