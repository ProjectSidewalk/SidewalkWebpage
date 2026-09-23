package models.utils

/** Which contributors' work a [[CountedSql]] fragment keeps. */
sealed trait Contributors

object Contributors {

  /** Everyone an admin hasn't excluded. The default everywhere. */
  case object NotExcluded extends Contributors

  /** Only high-quality users, for the public API's `filterLowQuality` option. */
  case object HighQualityOnly extends Contributors

  /** Everyone, excluded users included, e.g. a user's own dashboard. */
  case object Everyone extends Contributors
}

/**
 * The rules for which labels, audits and votes count, written once for raw SQL (#5287), so copies can't drift apart.
 *
 * Each is a subquery named after the table it replaces: swap `FROM label` for `FROM #${CountedSql.labels()}`.
 * `CountedSqlSpec` checks each against its Slick twin.
 */
object CountedSql {

  /** A table in the given city's schema, or in the current one. */
  private def table(schema: Option[String], name: String): String = schema.fold(name)(s => s""""$s".$name""")

  /**
   * Whose work counts, for a query that already has `user_stat`.
   *
   * @param userStat The name `user_stat` goes by in the query.
   * @return         A boolean SQL expression.
   */
  def contributorFilter(contributors: Contributors, userStat: String = "user_stat"): String = contributors match {
    case Contributors.NotExcluded     => s"NOT $userStat.excluded"
    case Contributors.HighQualityOnly => s"$userStat.high_quality AND NOT $userStat.excluded"
    case Contributors.Everyone        => "TRUE"
  }

  /**
   * Whose work counts, for a query without `user_stat`.
   *
   * @param userIdColumn The column holding the user's id, e.g. `label.user_id`.
   * @return             A boolean SQL expression.
   */
  def userCounts(schema: Option[String], userIdColumn: String, contributors: Contributors): String =
    contributors match {
      case Contributors.Everyone => "TRUE"
      case _                     =>
        s"EXISTS (SELECT 1 FROM ${table(schema, "user_stat")} AS user_stat " +
          s"WHERE user_stat.user_id = $userIdColumn AND ${contributorFilter(contributors)})"
    }

  /**
   * Labels that count: not deleted, not tutorial, not by an excluded user, not on the tutorial street. Twin of
   * `LabelTable.labels`. The tutorial street is checked on the audit too, since a tutorial label can land on a real
   * street.
   *
   * @param schema A city schema to read instead of the current one.
   * @return       A subquery for a FROM or JOIN clause.
   */
  def labels(
      schema: Option[String] = None,
      contributors: Contributors = Contributors.NotExcluded
  ): String = {
    val tutorialStreet = s"(SELECT tutorial_street_edge_id FROM ${table(schema, "config")})"
    s"""(
         SELECT label.*
         FROM ${table(schema, "label")} AS label
         INNER JOIN ${table(schema, "audit_task")} AS audit_task ON label.audit_task_id = audit_task.audit_task_id
         WHERE label.deleted = FALSE
             AND label.tutorial = FALSE
             AND label.street_edge_id <> $tutorialStreet
             AND audit_task.street_edge_id <> $tutorialStreet
             AND ${userCounts(schema, "label.user_id", contributors)}
       ) AS label"""
  }

  /**
   * The labels a user's accuracy is based on (#3591), minus tutorial ones. Includes excluded users.
   *
   * @return   A subquery for a FROM or JOIN clause.
   */
  def accuracyLabels: String =
    s"""(
         SELECT label.*
         FROM label
         INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
         WHERE ${models.label.LabelTable.countsTowardAccuracySql}
             AND label.tutorial = FALSE
             AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
             AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
       ) AS label"""

  /**
   * Completed audits by users who count, on any street. Twin of `StreetEdgeTable.countedAuditTasks`.
   *
   * @param schema A city schema to read instead of the current one.
   * @return       A subquery for a FROM or JOIN clause.
   */
  def completedAudits(
      schema: Option[String] = None,
      contributors: Contributors = Contributors.NotExcluded
  ): String =
    s"""(
         SELECT audit_task.*
         FROM ${table(schema, "audit_task")} AS audit_task
         WHERE audit_task.completed = TRUE
             AND ${userCounts(schema, "audit_task.user_id", contributors)}
       ) AS audit_task"""

  /**
   * Whether a vote counts: on the label's current type, not by its author, not by an excluded user. Same rule as
   * `ValidationService`. For a query that already has the label; otherwise use [[verdictVotes]].
   *
   * @param voteTypeKnown False for a schema before evolution 395, which skips the type check.
   * @return              A boolean SQL expression.
   */
  def isVerdictVote(
      schema: Option[String] = None,
      voteTypeKnown: Boolean = true
  ): String = {
    val typeCheck = if (voteTypeKnown) "AND label_validation.label_type = label.label_type" else ""
    s"label_validation.user_id <> label.user_id $typeCheck AND " +
      userCounts(schema, "label_validation.user_id", Contributors.NotExcluded)
  }

  /**
   * Votes that count ([[isVerdictVote]]).
   *
   * @param schema A city schema to read instead of the current one.
   * @return       A subquery for a FROM or JOIN clause.
   */
  def verdictVotes(
      schema: Option[String] = None,
      voteTypeKnown: Boolean = true
  ): String =
    s"""(
         SELECT label_validation.*
         FROM ${table(schema, "label_validation")} AS label_validation
         INNER JOIN ${table(schema, "label")} AS label ON label_validation.label_id = label.label_id
         WHERE ${isVerdictVote(schema, voteTypeKnown)}
       ) AS label_validation"""

  /**
   * Every vote by a user who counts, on any label. For "how many validations happened" totals.
   *
   * @param schema A city schema to read instead of the current one.
   * @return       A subquery for a FROM or JOIN clause.
   */
  def votesCast(
      schema: Option[String] = None,
      contributors: Contributors = Contributors.NotExcluded
  ): String =
    s"""(
         SELECT label_validation.*
         FROM ${table(schema, "label_validation")} AS label_validation
         WHERE ${userCounts(schema, "label_validation.user_id", contributors)}
       ) AS label_validation"""
}
