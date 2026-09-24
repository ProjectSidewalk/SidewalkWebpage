package models.utils

/** Which contributors' work a [[FilteredTables]] fragment keeps. */
sealed trait Contributors

object Contributors {

  /** Everyone an admin hasn't excluded. The default everywhere. */
  case object NotExcluded extends Contributors

  /** Only high-quality users, for the public API's `filterLowQuality` option. */
  case object HighQualityOnly extends Contributors

  /** Everyone, excluded users included, e.g. a user's own dashboard. */
  case object Everyone extends Contributors

  /** For a high-quality-only toggle like the API's `filterLowQuality`. */
  def apply(highQualityOnly: Boolean): Contributors = if (highQualityOnly) HighQualityOnly else NotExcluded
}

/**
 * The rules for which streets, labels, audits and votes count, written once for raw SQL (#5287), so copies can't
 * drift apart.
 *
 * Each is a subquery named after the table it replaces: swap `FROM label` for `FROM #${FilteredTables.labels()}`.
 * `FilteredTablesSpec` checks each against its Slick twin.
 */
object FilteredTables {

  /** A table in the given city's schema, or in the current one. */
  private def table(schema: Option[String], name: String): String = schema.fold(name)(s => s""""$s".$name""")

  /** The tutorial street's id, as a scalar subquery. */
  def tutorialStreetId(schema: Option[String] = None): String =
    s"(SELECT tutorial_street_edge_id FROM ${table(schema, "config")})"

  /**
   * Whether a street isn't the tutorial street, for a query that keeps streets of every status.
   *
   * @param streetIdColumn The column holding the street's id, e.g. `audit_task.street_edge_id`.
   * @return               A boolean SQL expression.
   */
  def notTutorialStreet(streetIdColumn: String, schema: Option[String] = None): String =
    s"$streetIdColumn <> ${tutorialStreetId(schema)}"

  /**
   * Streets that count: open and not the tutorial street. Twin of `StreetEdgeTable.streets`.
   *
   * @param schema A city schema to read instead of the current one.
   * @return       A subquery for a FROM or JOIN clause.
   */
  def streets(schema: Option[String] = None): String =
    s"""(
         SELECT street_edge.*
         FROM ${table(schema, "street_edge")} AS street_edge
         WHERE street_edge.status = 'open'
             AND ${notTutorialStreet("street_edge.street_edge_id", schema)}
       ) AS street_edge"""

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
      // Written as "no excluded row" so it uses the tiny index of excluded users (evolution 404).
      case Contributors.NotExcluded =>
        s"NOT EXISTS (SELECT 1 FROM ${table(schema, "user_stat")} AS user_stat " +
          s"WHERE user_stat.user_id = $userIdColumn AND user_stat.excluded)"
      case Contributors.HighQualityOnly =>
        s"EXISTS (SELECT 1 FROM ${table(schema, "user_stat")} AS user_stat " +
          s"WHERE user_stat.user_id = $userIdColumn AND ${contributorFilter(contributors)})"
    }

  /**
   * Labels that count: not deleted, not tutorial, not by an excluded user, not on the tutorial street. Twin of
   * `LabelTable.labels`. Also checks the audit's street, since a tutorial label can land on a real street.
   *
   * @param schema A city schema to read instead of the current one.
   * @return       A subquery for a FROM or JOIN clause.
   */
  def labels(
      schema: Option[String] = None,
      contributors: Contributors = Contributors.NotExcluded
  ): String =
    s"""(
         SELECT label.*
         FROM ${table(schema, "label")} AS label
         INNER JOIN ${table(schema, "audit_task")} AS audit_task ON label.audit_task_id = audit_task.audit_task_id
         WHERE label.deleted = FALSE
             AND label.tutorial = FALSE
             AND ${notTutorialStreet("label.street_edge_id", schema)}
             AND ${notTutorialStreet("audit_task.street_edge_id", schema)}
             AND ${userCounts(schema, "audit_task.user_id", contributors)}
       ) AS label"""

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
             AND ${notTutorialStreet("label.street_edge_id")}
             AND ${notTutorialStreet("audit_task.street_edge_id")}
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

  /**
   * Votes voided by the #4842 repair, from users who count. The votes no longer decide anything, but the work still
   * happened, so activity totals include them.
   *
   * @param schema A city schema to read instead of the current one.
   * @return       A subquery for a FROM or JOIN clause.
   */
  def voidedVotesCast(schema: Option[String] = None): String =
    s"""(
         SELECT voided_label_validation.*
         FROM ${table(schema, "voided_label_validation")} AS voided_label_validation
         WHERE ${userCounts(schema, "voided_label_validation.user_id", Contributors.NotExcluded)}
       ) AS voided_label_validation"""
}
