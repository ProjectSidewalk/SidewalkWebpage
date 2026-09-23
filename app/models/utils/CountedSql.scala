package models.utils

/**
 * Which contributors' work a [[CountedSql]] fragment keeps.
 *
 * Excluding a user also marks them low quality, so `HighQualityOnly` drops excluded users too.
 */
sealed trait Contributors

object Contributors {

  /** Everyone an admin hasn't excluded. The default everywhere. */
  case object NotExcluded extends Contributors

  /** Only high-quality users, for the public API's `filterLowQuality` option. */
  case object HighQualityOnly extends Contributors

  /** Everyone, excluded users included, e.g. for a page about an excluded user or a count of excluded users. */
  case object Everyone extends Contributors
}

/**
 * The rules for which labels, audits and votes count, written once for raw SQL queries (#5287).
 *
 * Hand-typed copies of these filters drift apart, so raw queries use these instead. Each fragment is a subquery named
 * after the table it stands in for, so a query swaps `FROM label` for `FROM #${CountedSql.labels()}` and keeps reading
 * `label.*` columns as before.
 *
 * Users are checked with EXISTS rather than a join, so a fragment never repeats a row, and a user with no `user_stat`
 * row counts as not excluded. `CountedSqlSpec` checks each fragment against its Slick twin.
 */
object CountedSql {

  private def table(schema: Option[String], name: String): String = schema.fold(name)(s => s""""$s".$name""")

  /**
   * The check on whose work counts, for any query with a `user_stat` row in scope.
   *
   * @param userStat The name `user_stat` goes by in the query.
   * @return         A boolean SQL expression.
   */
  def contributorFilter(contributors: Contributors, userStat: String = "user_stat"): String = contributors match {
    case Contributors.NotExcluded     => s"NOT $userStat.excluded"
    case Contributors.HighQualityOnly => s"$userStat.high_quality"
    case Contributors.Everyone        => "TRUE"
  }

  /** Whether a user's work counts, looked up by id so the query needs no `user_stat` join of its own. */
  private def userCounts(schema: Option[String], userIdColumn: String, contributors: Contributors): String =
    contributors match {
      case Contributors.NotExcluded =>
        s"NOT EXISTS (SELECT 1 FROM ${table(schema, "user_stat")} AS user_stat " +
          s"WHERE user_stat.user_id = $userIdColumn AND user_stat.excluded)"
      case Contributors.HighQualityOnly =>
        s"EXISTS (SELECT 1 FROM ${table(schema, "user_stat")} AS user_stat " +
          s"WHERE user_stat.user_id = $userIdColumn AND user_stat.high_quality)"
      case Contributors.Everyone => "TRUE"
    }

  /**
   * Labels that count: not deleted, not from the tutorial, not by an excluded user, and not on the tutorial street.
   * The raw SQL twin of `LabelTable.labels`.
   *
   * The tutorial street is checked on both the label and its audit task, since a label placed during a tutorial walk
   * can be filed under a nearby real street.
   *
   * @param schema A city schema to read instead of the current one.
   * @param as     The name the rows go by in the query.
   * @return       A subquery for a FROM or JOIN clause.
   */
  def labels(
      schema: Option[String] = None,
      contributors: Contributors = Contributors.NotExcluded,
      as: String = "label"
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
       ) AS $as"""
  }

  /**
   * Completed audits by users who count. The raw SQL twin of `StreetEdgeTable.completedAuditTasks`, minus its street
   * filter: callers pick which streets they report on.
   *
   * @param schema A city schema to read instead of the current one.
   * @param as     The name the rows go by in the query.
   * @return       A subquery for a FROM or JOIN clause.
   */
  def completedAudits(
      schema: Option[String] = None,
      contributors: Contributors = Contributors.NotExcluded,
      as: String = "audit_task"
  ): String =
    s"""(
         SELECT audit_task.*
         FROM ${table(schema, "audit_task")} AS audit_task
         WHERE audit_task.completed = TRUE
             AND ${userCounts(schema, "audit_task.user_id", contributors)}
       ) AS $as"""

  /**
   * Votes that count toward a label's verdict: cast on the label's current type, not by the label's own author, and
   * not by an excluded user. The same rule `ValidationService` uses to keep each label's agree/disagree counts.
   *
   * @param schema       A city schema to read instead of the current one.
   * @param voteTypeKnown False for a city schema from before evolution 395, whose votes don't record the type they
   *                      judged; the type check is then skipped.
   * @param as           The name the rows go by in the query.
   * @return             A subquery for a FROM or JOIN clause.
   */
  def verdictVotes(
      schema: Option[String] = None,
      voteTypeKnown: Boolean = true,
      as: String = "label_validation"
  ): String = {
    val typeCheck = if (voteTypeKnown) "AND label_validation.label_type = label.label_type" else ""
    s"""(
         SELECT label_validation.*
         FROM ${table(schema, "label_validation")} AS label_validation
         INNER JOIN ${table(schema, "label")} AS label ON label_validation.label_id = label.label_id
         WHERE label_validation.user_id <> label.user_id
             $typeCheck
             AND ${userCounts(schema, "label_validation.user_id", Contributors.NotExcluded)}
       ) AS $as"""
  }

  /**
   * Every vote cast by a user who counts, on any label. For work-credit totals ("how many validations happened"),
   * which count a vote even if the label was later deleted or retyped.
   *
   * @param schema A city schema to read instead of the current one.
   * @param as     The name the rows go by in the query.
   * @return       A subquery for a FROM or JOIN clause.
   */
  def votesCast(
      schema: Option[String] = None,
      contributors: Contributors = Contributors.NotExcluded,
      as: String = "label_validation"
  ): String =
    s"""(
         SELECT label_validation.*
         FROM ${table(schema, "label_validation")} AS label_validation
         WHERE ${userCounts(schema, "label_validation.user_id", contributors)}
       ) AS $as"""
}
