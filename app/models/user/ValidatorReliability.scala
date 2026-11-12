package models.user

/** How much to trust a validator's votes (#5063); `UserStatTable.validatorTallies` decides which votes are graded. */
object ValidatorReliability {

  /** How many votes at the city's match rate every validator starts with, so a few votes can't swing their score. */
  val PriorVotes: Int = 20

  /**
   * The validator's match rate, counted as if they had also cast [[PriorVotes]] votes at the city's rate.
   * @param cityMatchRate The share of all graded votes in the city that matched.
   * @return A weight between the validator's own match rate and the city's, or None when they have no graded votes.
   */
  def score(matched: Int, graded: Int, cityMatchRate: Double): Option[Double] =
    Option.when(graded > 0)((matched + PriorVotes * cityMatchRate) / (graded + PriorVotes))
}
