package models.validation

/**
 * Expert Validate's label filters; None means no limit. The label query and per-type counts share it so they agree.
 *
 * @param teamIds Labels placed by people currently on one of these teams (#5342).
 */
case class ValidationLabelFilter(
    userIds: Option[Set[String]] = None,
    regionIds: Option[Set[Int]] = None,
    teamIds: Option[Set[Int]] = None
)
