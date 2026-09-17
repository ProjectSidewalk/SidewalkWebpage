package models.validation

import models.audit.AuditTaskTableDef
import models.label.LabelTableDef
import models.user.{UserStatTable, UserStatTableDef}
import models.utils.MyPostgresProfile.api._

import java.time.{Duration, OffsetDateTime}

/**
 * The one definition of which labels Validate serves and how they are prioritized (#4715).
 *
 * Every number here is a policy choice, so it lives in code with its rationale rather than in conf: the predicates are
 * Slick expressions shared by the label query and the per-type counts, and the specs pin them. Lifting a value into
 * `application.conf` is a one-file change if a deployment ever needs a different one.
 *
 * Rationale for the values (Seattle, Sept 2026; see docs/validation-queue.md for the tables): votes still arriving on
 * an undecided label fall from 203k at the first vote to 2k at the fifth while their Unsure share climbs from 7% to
 * 26%, so five crowd votes without a decision is where the crowd stops and an expert takes over.
 */
object ValidationQueuePolicy {

  /** Agree and disagree must differ by this much for a label to count as settled. */
  val SettledMargin: Int = 2

  /** Votes (agree + disagree + unsure) a still-unsettled label may carry before the crowd stops being asked. */
  val MaxCrowdVotes: Int = 5

  /** Unsure votes at or above which, when they also outnumber agree + disagree, a label is "unsure-heavy". */
  val UnsureHeavyMinVotes: Int = 2

  /**
   * A labeler with fewer own labels validated than this is new, and their labels get [[NewLabelerBonus]]. It is the
   * same threshold under which `user_stat.high_quality` stops trusting accuracy: too few verdicts to judge them yet.
   */
  val NewLabelerOwnLabelsValidated: Int = UserStatTable.OwnLabelsValidatedToJudge

  val NewLabelerBonus: Double         = 150
  val HighQualityLabelerBonus: Double = 50
  val ConsensusNeedMax: Double        = 200
  val RecencyBonus: Double            = 25
  val RecencyWindowDays: Int          = 7

  /** Highest score a label can have, which the sampler spec sizes its bands from. NoSidewalk adds its face terms. */
  val MaxScore: Double = NewLabelerBonus + HighQualityLabelerBonus + ConsensusNeedMax + RecencyBonus

  /**
   * Pick probability is proportional to score to this power, which is how much of the additive score survives into the
   * serve rate. On Seattle's pool, labels by a new labeler are 14% of the pool and take 22% of picks at exponent 1
   * against 35% at 2; [[NewLabelerBonus]] is the other half of that dial.
   */
  val PickWeightExponent: Double = 2

  /**
   * NoSidewalk is scored per block face, not per label (#5285). A face is one side of one street edge,
   * `(label.street_edge_id, label_point.street_side)`; people drop a NoSidewalk label every pano or two along a
   * stretch with no sidewalk, so per label the work is endless (Seattle: 36k of 48k sided labels sit on 3.5k faces
   * with five or more) while per face it is finite (~9.7k faces). The #5222 study found the false "no sidewalk" calls
   * concentrate on faces that rest on a single labeler, so that is the largest term.
   *
   * Weight of "only one person ever said this face has no sidewalk", divided by the square of the number of distinct
   * human labelers on the face: 200 for one, 50 for two, 22 for three. Set so that a lone-labeler face outscores the
   * whole #4715 base score of an established labeler's unvoted label (200).
   */
  val FaceSingleLabelerBonus: Double = 200

  /**
   * Older labels first, at this many points per year of age, capped at [[AgeBonusMax]]. The cap is where 2019 and
   * 2020 labels (three quarters of the study's false faces) tie rather than 2019 dominating.
   */
  val AgePointsPerYear: Double = 10
  val AgeBonusMax: Double      = 60

  /**
   * Agreeing human votes on a face at which it stops counting toward NoSidewalk's share of missions. Its labels stay
   * servable — a face is never retired, only deprioritized by the support factor — so this mirrors [[SettledMargin]]
   * for the mission lottery alone.
   */
  val FaceSettledSupport: Int = 2

  /** Which subset of labels a Validate page draws from. Cascades are drained in order until a mission is full. */
  sealed trait ValidationQueue
  object ValidationQueue {

    /** Labels the crowd can still settle: no votes yet, or unsettled and under the vote cap. */
    case object NeedsVotes extends ValidationQueue

    /** Labels the crowd is stuck on: capped out, unsure-heavy, or the humans and the AI disagree. */
    case object Triage extends ValidationQueue

    /** Everything the viewer can render; the fallback that keeps the game endless (#2929). */
    case object Any extends ValidationQueue

    val crowdCascade: Seq[ValidationQueue]  = Seq(NeedsVotes, Any)
    val expertCascade: Seq[ValidationQueue] = Seq(Triage, NeedsVotes, Any)
  }

  /** Every vote cast on the label, Unsure included: an Unsure vote costs a validator the same minute an Agree does. */
  def totalVotes(l: LabelTableDef): Rep[Int] = l.agreeCount + l.disagreeCount + l.unsureCount

  /** How lopsided the agree/disagree split is; [[SettledMargin]] or more means the crowd has decided. */
  def margin(l: LabelTableDef): Rep[Int] = (l.agreeCount - l.disagreeCount).abs

  /**
   * The retirement rule, inverted: true while the crowd should still be asked about this label.
   *
   * A lone AI vote leaves a label at margin 1 with one vote, so it stays here until a human concurs — nothing is ever
   * retired on the AI's word alone.
   */
  def needsVotes(l: LabelTableDef): Rep[Boolean] =
    totalVotes(l) === 0 || (margin(l) < SettledMargin && totalVotes(l) < MaxCrowdVotes)

  /** The crowd has spent [[MaxCrowdVotes]] votes on this label without reaching a margin. */
  def crowdCappedOut(l: LabelTableDef): Rep[Boolean] = margin(l) < SettledMargin && totalVotes(l) >= MaxCrowdVotes

  /** Validators keep answering "unsure" rather than deciding, so the label needs a better look than a vote. */
  def unsureHeavy(l: LabelTableDef): Rep[Boolean] =
    margin(l) < SettledMargin && l.unsureCount >= UnsureHeavyMinVotes &&
      l.unsureCount >= l.agreeCount + l.disagreeCount

  /**
   * The AI voted one way and the humans lean the other. The AI's own vote sits inside agree_count/disagree_count, so it
   * is subtracted out before the two sides are compared. Only unsettled labels qualify: humans who have already
   * out-voted the AI are done, not in need of triage.
   *
   * @param l        The label being judged.
   * @param aiResult The AI's vote on this label, absent when the AI never assessed it.
   */
  def aiContested(l: LabelTableDef, aiResult: Rep[Option[ValidationOption.Value]]): Rep[Boolean] = {
    val aiAgreed: Rep[Boolean]    = (aiResult === ValidationOption.Agree).getOrElse(false)
    val aiDisagreed: Rep[Boolean] = (aiResult === ValidationOption.Disagree).getOrElse(false)
    margin(l) < SettledMargin &&
    ((aiAgreed && l.disagreeCount > l.agreeCount - 1) || (aiDisagreed && l.agreeCount > l.disagreeCount - 1))
  }

  /** Labels the crowd cannot finish on its own, which is what Expert Validate exists to clear. */
  def triage(l: LabelTableDef, aiResult: Rep[Option[ValidationOption.Value]]): Rep[Boolean] =
    crowdCappedOut(l) || unsureHeavy(l) || aiContested(l, aiResult)

  /**
   * The membership test for one queue, so the label query and the per-type counts can never disagree on it.
   *
   * @param q        The queue being drawn from.
   * @param l        The label being judged.
   * @param aiResult The AI's vote on this label; only [[ValidationQueue.Triage]] reads it.
   */
  def inQueue(q: ValidationQueue, l: LabelTableDef, aiResult: Rep[Option[ValidationOption.Value]]): Rep[Boolean] =
    q match {
      case ValidationQueue.NeedsVotes => needsVotes(l)
      case ValidationQueue.Triage     => triage(l, aiResult)
      case ValidationQueue.Any        => true: Rep[Boolean]
    }

  /**
   * Deterministic priority, 0 < score ≤ [[MaxScore]].
   *
   * The bonuses are additive so the doc can list them one line each; [[pickKey]] is what turns the sum into a serve
   * rate. The consensus term divides by `1 + margin² + unsure`, which makes an Unsure vote lower the priority exactly
   * as far as a lone Agree does — the label is no closer to a decision either way.
   *
   * @param l  The label being scored.
   * @param at The audit task the label was placed on; a low-quality or stale task forfeits the new-labeler bonus.
   * @param us The labeler's stats.
   */
  def priorityScore(l: LabelTableDef, at: AuditTaskTableDef, us: UserStatTableDef): Rep[Double] = {
    // The bonus follows `needsVotes` rather than `correct IS NULL`, because a single AI Agree flips `correct` and
    // would otherwise strip the emphasis off a new labeler's still-unconfirmed labels.
    val newLabeler: Rep[Double] = Case
      .If(us.ownLabelsValidated < NewLabelerOwnLabelsValidated && needsVotes(l) && !at.lowQuality && !at.stale)
      .Then(NewLabelerBonus.bind)
      .Else(0d.bind)
    val highQuality: Rep[Double] = Case.If(us.highQuality).Then(HighQualityLabelerBonus.bind).Else(0d.bind)

    val consensusMargin: Rep[Int]  = margin(l)
    val consensusNeed: Rep[Double] = ConsensusNeedMax.bind /
      (1d.bind + (consensusMargin * consensusMargin + l.unsureCount).asColumnOf[Double])

    val now: Rep[OffsetDateTime] = SimpleLiteral[OffsetDateTime]("current_timestamp")
    val window: Rep[Duration]    = SimpleLiteral[Duration](s"interval '$RecencyWindowDays days'")
    val recency: Rep[Double]     = Case.If(l.timeCreated > now --- window).Then(RecencyBonus.bind).Else(0d.bind)

    newLabeler + highQuality + consensusNeed + recency
  }

  /**
   * The block-face evidence the NoSidewalk score reads, as the left-joined columns of
   * `LabelTable.noSidewalkFaceEvidence`. Both are absent for a label with no side (within 1 m of the centerline),
   * which has no face to share evidence with.
   *
   * @param labelerCount Distinct human labelers who placed a NoSidewalk label on the face.
   * @param support      Agreeing human votes across the face's NoSidewalk labels; the AI's Agree is subtracted out.
   */
  case class FaceEvidenceRep(labelerCount: Rep[Option[Int]], support: Rep[Option[Int]])

  private val now: Rep[OffsetDateTime] = SimpleFunction.nullary[OffsetDateTime]("now")

  /** Not Postgres's `age()`, which counts every month as 30 days and so shortchanges an older label by days. */
  private def ageSeconds(timeCreated: Rep[OffsetDateTime]): Rep[Double] = (now - timeCreated).part("epoch")
  private val SecondsPerYear: Double                                    = 365.25 * 24 * 3600

  /**
   * NoSidewalk's priority, `(priorityScore + face evidence need + age bonus) × 1 / (1 + face support)` (#5285).
   *
   * The face terms make the block face the unit of work: a lone-labeler face no human has confirmed scores about 460
   * against about 74 for a three-labeler face with two agreeing votes, so under [[pickKey]] it is served about 39×
   * as often. Each agreeing vote on any of the face's labels halves, then thirds, the rest of the face — soft
   * deprioritization, never retirement, so a face can always be looked at again. Disagreeing votes are deliberately
   * absent from the factor: a rejected label makes the face contested, and its remaining labels should keep coming up
   * so someone else can weigh in. A face with no human labeler at all (every label the AI's) needs a look at least
   * as much as a one-labeler face, so `labelerCount` is floored at 1.
   *
   * @param l    The label being scored.
   * @param at   The audit task the label was placed on.
   * @param us   The labeler's stats.
   * @param face The label's face evidence; both columns NULL for an unsided label, which then gets the base score
   *             plus the age bonus and no face factor.
   */
  def noSidewalkPriorityScore(
      l: LabelTableDef,
      at: AuditTaskTableDef,
      us: UserStatTableDef,
      face: FaceEvidenceRep
  ): Rep[Double] = {
    val labelers: Rep[Double]     = greatest(face.labelerCount.getOrElse(0).asColumnOf[Double], 1d.bind)
    val evidenceNeed: Rep[Double] = Case
      .If(face.labelerCount.isDefined)
      .Then(FaceSingleLabelerBonus.bind / (labelers * labelers))
      .Else(0d.bind)
    val ageBonus: Rep[Double] =
      least(AgeBonusMax.bind, AgePointsPerYear.bind * ageSeconds(l.timeCreated) / SecondsPerYear.bind)
    val supportFactor: Rep[Double] = 1d.bind / (1d.bind + face.support.getOrElse(0).asColumnOf[Double])
    (priorityScore(l, at, us) + evidenceNeed + ageBonus) * supportFactor
  }

  /**
   * Whether a face still counts toward NoSidewalk's share of missions: fewer than [[FaceSettledSupport]] agreeing human
   * votes across its labels. Faces past it are still served, just weighted down by [[noSidewalkPriorityScore]].
   *
   * @param support The face's agreeing human votes, NULL for an unsided label (which is not a face and never counts).
   */
  def faceNeedsVotes(support: Rep[Option[Int]]): Rep[Boolean] =
    support.isDefined && support.getOrElse(0) < FaceSettledSupport

  private val ln       = SimpleFunction.unary[Double, Double]("ln")
  private val power    = SimpleFunction.binary[Double, Double, Double]("power")
  private val greatest = SimpleFunction.binary[Double, Double, Double]("greatest")
  private val least    = SimpleFunction.binary[Double, Double, Double]("least")

  /**
   * Efraimidis–Spirakis key: order by this descending and take the top k, and the k rows are a weighted random sample
   * without replacement with P(pick) ∝ score^[[PickWeightExponent]]. So a label scoring twice another is served four
   * times as often, noise never inverts priority, and no label is ever certain to be served.
   *
   * This is the exponential-race form, `ln(U) / weight`: it is the logarithm of the textbook `U^(1/weight)` key, which
   * orders identically and keeps the arithmetic away from the 1-epsilon corner where every key of a large weight would
   * round to the same double. `greatest(score, 1)` guards the division in case a future tunable lets the score reach 0.
   * The draw is `1 - random()`, in (0, 1]: `random()` itself can return exactly 0, and Postgres's `ln(0)` raises
   * "cannot take logarithm of zero" rather than returning -infinity, which would fail the whole query.
   *
   * @param score The label's deterministic priority, from [[priorityScore]].
   */
  def pickKey(score: Rep[Double]): Rep[Double] =
    ln(1d.bind - random) / power(greatest(score, 1d.bind), PickWeightExponent.bind)
}
