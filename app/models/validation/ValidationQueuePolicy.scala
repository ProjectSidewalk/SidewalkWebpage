package models.validation

import models.audit.AuditTaskTableDef
import models.label.LabelTableDef
import models.user.UserStatTableDef
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

  /** A labeler with fewer own labels validated than this is new, and their labels get [[NewLabelerBonus]]. */
  val NewLabelerOwnLabelsValidated: Int = 50

  val NewLabelerBonus: Double         = 150
  val HighQualityLabelerBonus: Double = 50
  val ConsensusNeedMax: Double        = 200
  val RecencyBonus: Double            = 25
  val RecencyWindowDays: Int          = 7

  /** Highest score a label can have; documented for readers, not used in the sort. */
  val MaxScore: Double = NewLabelerBonus + HighQualityLabelerBonus + ConsensusNeedMax + RecencyBonus

  /**
   * Pick probability is proportional to score to this power, which is how much of the additive score survives into the
   * serve rate. On Seattle's pool, labels by a new labeler are 14% of the pool and take 22% of picks at exponent 1
   * against 35% at 2; [[NewLabelerBonus]] is the other half of that dial.
   */
  val PickWeightExponent: Double = 2

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

  private val random   = SimpleFunction.nullary[Double]("random")
  private val ln       = SimpleFunction.unary[Double, Double]("ln")
  private val power    = SimpleFunction.binary[Double, Double, Double]("power")
  private val greatest = SimpleFunction.binary[Double, Double, Double]("greatest")

  /**
   * Efraimidis–Spirakis key: order by this descending and take the top k, and the k rows are a weighted random sample
   * without replacement with P(pick) ∝ score^[[PickWeightExponent]]. So a label scoring twice another is served four
   * times as often, noise never inverts priority, and no label is ever certain to be served.
   *
   * This is the exponential-race form, `ln(U) / weight`: it is the logarithm of the textbook `U^(1/weight)` key, which
   * orders identically and keeps the arithmetic away from the 1-epsilon corner where every key of a large weight would
   * round to the same double. `greatest(score, 1)` guards the division in case a future tunable lets the score reach 0;
   * `random()` is in [0, 1), and the ln(0) = -infinity that yields simply sorts last, which is harmless.
   *
   * @param score The label's deterministic priority, from [[priorityScore]].
   */
  def pickKey(score: Rep[Double]): Rep[Double] =
    ln(random) / power(greatest(score, 1d.bind), PickWeightExponent.bind)
}
