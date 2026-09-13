package service

import models.label.{LabelTable, LabelTypeEnum, LabelTypeValidationsLeft, LabelValidationMetadata, StreetSide}
import models.pano.PanoSource.PanoSource
import models.utils.MyPostgresProfile.api._
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
      centerlineOffsetM: Option[Double] = None
  ): DBIO[Int] = {
    val (defaultStreetEdgeId, panoId) = fixtureAnchors
    val streetEdgeId                  = streetEdgeIdOpt.getOrElse(defaultStreetEdgeId)
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
      createdDaysAgo: Int = 30
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
      centerlineOffsetM
    )

  /**
   * Records an AI vote on a label: the validation row the counts already reflect, and the assessment that links the
   * label to it. Only the triage predicate reads this.
   *
   * @param labelId The label the AI assessed.
   * @param result  'Agree' or 'Disagree'.
   */
  private def insertAiVote(labelId: Int, result: String): DBIO[Unit] = {
    for {
      aiUserId <- sql"SELECT user_id FROM sidewalk_login.user_role WHERE role = 'AI' LIMIT 1".as[String].headOption
      userId = aiUserId.getOrElse(cancel("no user holds the AI role in this database"))
      missionId <- sql"""INSERT INTO mission
                             (mission_type, user_id, mission_start, mission_end, completed, pay, paid, skipped)
                         VALUES ('validation', $userId, now(), now(), TRUE, 0, FALSE, FALSE)
                         RETURNING mission_id""".as[Int].head
      validationId <- sql"""INSERT INTO label_validation
                                (label_id, validation_result, user_id, mission_id, heading, pitch, zoom, canvas_height,
                                 canvas_width, start_timestamp, end_timestamp, source, viewer_type)
                            VALUES ($labelId, $result::validation_option, $userId, $missionId, 0, 0, 1, 1, 1, now(),
                                    now(), 'SidewalkAI', 'StaticApi')
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
      .retrieveLabelListForValidationQuery(requester, viewer, labelType, queue, userIds = Some(labelerIds),
        unvalidatedOnly = unvalidatedOnly)
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

  "unvalidatedOnly" should {
    "narrow a queue to the labels that have no decision recorded" in {
      val (served, ids) = runRolledBack(for {
        (labeler, ids) <- queueFixture
        served         <- queueIds(ValidationQueue.NeedsVotes, Set(labeler), unvalidatedOnly = true)
      } yield (served, ids))

      served mustBe Set("A", "C", "D", "K", "L").map(ids)
    }
  }

  "getAvailableValidationsLabelsByType" should {
    "count each queue with the same predicates the label query filters on" in {
      def curbRampCounts: DBIO[LabelTypeValidationsLeft] =
        labelTable
          .getAvailableValidationsLabelsByType(requester, viewer, unvalidatedOnly = false)
          .map(
            _.find(_.labelType == LabelTypeEnum.CurbRamp)
              .getOrElse(LabelTypeValidationsLeft(LabelTypeEnum.CurbRamp, 0, 0, 0))
          )

      val (before, after) = runRolledBack(for {
        before <- curbRampCounts
        _      <- queueFixture
        after  <- curbRampCounts
      } yield (before, after))

      after.validationsAvailable - before.validationsAvailable mustBe 13
      after.needsVotes - before.needsVotes mustBe 8
      after.triage - before.triage mustBe 5
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
              userIds = Some(Set(newLabeler, oldLabeler))
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
      val counts    = run(labelTable.getAvailableValidationsLabelsByType(requester, viewer, unvalidatedOnly = false))
      val needed    = 3
      val shortType = counts.find(t => t.triage < needed && t.needsVotes >= needed)
      assume(shortType.isDefined, "no label type in this schema has a short triage queue and a full NeedsVotes queue")
      val labelType = shortType.get.labelType

      val triageOnly = await(
        labelService.retrieveLabelListForValidation(requester, needed, viewer, labelType, Seq(ValidationQueue.Triage))
      )
      val cascaded = await(
        labelService.retrieveLabelListForValidation(
          requester,
          needed,
          viewer,
          labelType,
          Seq(ValidationQueue.Triage, ValidationQueue.NeedsVotes, ValidationQueue.Any)
        )
      )

      triageOnly.size must be < needed
      assume(cascaded.nonEmpty, "no imagery available for this schema's labels, so nothing could be served")
      cascaded.size must be > triageOnly.size
      cascaded.map(_.labelId).distinct.size mustBe cascaded.size
    }

    "serve only labels that still need votes when NeedsVotes is the whole cascade" in {
      val counts   = run(labelTable.getAvailableValidationsLabelsByType(requester, viewer, unvalidatedOnly = false))
      val fullType = counts.find(_.needsVotes >= 5)
      assume(fullType.isDefined, "no label type in this schema has enough labels needing votes")

      val served = await(
        labelService.retrieveLabelListForValidation(requester, 5, viewer, fullType.get.labelType,
          Seq(ValidationQueue.NeedsVotes))
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

  "countNoSidewalkFacesNeedingVotes" should {
    "count the requester's servable sided faces short of the settled support, and honour unvalidatedOnly" in {
      def faces(me: String, unvalidatedOnly: Boolean): DBIO[Int] =
        labelTable.countNoSidewalkFacesNeedingVotes(me, viewer, unvalidatedOnly)

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
              ValidationQueue.NeedsVotes, userIds = labelers)
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
      // streets have been touched once.
      ids(LabelServiceImpl.spreadAcrossFaces(ordered, Set.empty, 3)) mustBe Seq(1, 6, 8)
      // Nothing to fall back to within the rule: the fourth slot stays empty rather than repeating a face.
      ids(LabelServiceImpl.spreadAcrossFaces(ordered, Set.empty, 4)) mustBe Seq(1, 6, 8)
      // A face the mission already holds is skipped, and the highest-ranked label of each face wins.
      val held = Set(LabelServiceImpl.FaceKey(100, Some(StreetSide.Left), None))
      ids(LabelServiceImpl.spreadAcrossFaces(ordered, held, 3)) mustBe Seq(6, 8)
      // Two unsided labels on one street are two faces, not one.
      val twoUnsided = Seq(label(8, 100, None), label(9, 100, None))
      ids(LabelServiceImpl.spreadAcrossFaces(twoUnsided, Set.empty, 2)) mustBe Seq(8, 9)
    }
  }

  "Type selection" should {
    "weight NoSidewalk by faces still needing votes in the crowd's queue, and gate it on labels like any type" in {
      val missionLength = 10
      val noSidewalk    = LabelTypeValidationsLeft(LabelTypeEnum.NoSidewalk, 500, 12, 0, facesNeedingVotes = Some(3))
      val curbRamp      = LabelTypeValidationsLeft(LabelTypeEnum.CurbRamp, 500, 50, 3)

      // 12 labels pass the 10-label gate even though only 3 faces need votes; the lottery then weighs the 3.
      val (queue, types) =
        LabelServiceImpl.chooseQueueAndTypes(Seq(noSidewalk, curbRamp), ValidationQueue.crowdCascade, missionLength)
      queue mustBe ValidationQueue.NeedsVotes
      types must contain(noSidewalk)
      LabelServiceImpl.typeWeight(ValidationQueue.NeedsVotes, noSidewalk) mustBe 3
      LabelServiceImpl.typeWeight(ValidationQueue.Any, noSidewalk) mustBe 1
      LabelServiceImpl.typeWeight(ValidationQueue.Triage, noSidewalk.copy(triage = 7)) mustBe 7

      // A small city with 8 faces across 40 labels still gets NoSidewalk missions: the gate is on labels.
      val smallCity = noSidewalk.copy(needsVotes = 40, facesNeedingVotes = Some(8))
      LabelServiceImpl.chooseQueueAndTypes(Seq(smallCity), ValidationQueue.crowdCascade, missionLength)._2 mustBe
        Seq(smallCity)
      // And a type without a face count weighs by its labels, as before.
      LabelServiceImpl.typeWeight(ValidationQueue.NeedsVotes, curbRamp) mustBe 50
    }

    "use the first queue in the cascade that can fill a mission, and weight uniformly once it falls back to Any" in {
      val missionLength                                                                  = 10
      def counts(needsVotes: Int, triage: Int, available: Int): LabelTypeValidationsLeft =
        LabelTypeValidationsLeft(LabelTypeEnum.CurbRamp, available, needsVotes, triage)

      val plenty = counts(needsVotes = 50, triage = 3, available = 500)
      val thin   = counts(needsVotes = 2, triage = 0, available = 500).copy(labelType = LabelTypeEnum.Crosswalk)

      // The crowd's cascade stops at NeedsVotes as soon as one type can fill a mission from it.
      val (crowdQueue, crowdTypes) =
        LabelServiceImpl.chooseQueueAndTypes(Seq(plenty, thin), ValidationQueue.crowdCascade, missionLength)
      crowdQueue mustBe ValidationQueue.NeedsVotes
      crowdTypes mustBe Seq(plenty)

      // With nothing left to settle anywhere, it falls through to Any so the game does not end (#2929).
      val (fallbackQueue, fallbackTypes) =
        LabelServiceImpl.chooseQueueAndTypes(Seq(thin), ValidationQueue.crowdCascade, missionLength)
      fallbackQueue mustBe ValidationQueue.Any
      fallbackTypes mustBe Seq(thin)
      LabelServiceImpl.typeWeight(ValidationQueue.Any, thin) mustBe 1

      // An expert's cascade skips a triage queue too thin to fill a mission and lands on the crowd's queue.
      val (expertQueue, expertTypes) =
        LabelServiceImpl.chooseQueueAndTypes(Seq(plenty), ValidationQueue.expertCascade, missionLength)
      expertQueue mustBe ValidationQueue.NeedsVotes
      expertTypes mustBe Seq(plenty)
      LabelServiceImpl.typeWeight(ValidationQueue.NeedsVotes, plenty) mustBe 50

      // And no queue at all leaves the caller with no type to serve.
      val (emptyQueue, emptyTypes) =
        LabelServiceImpl.chooseQueueAndTypes(Seq.empty, ValidationQueue.expertCascade, missionLength)
      emptyQueue mustBe ValidationQueue.Any
      emptyTypes mustBe Seq.empty
    }
  }
}
