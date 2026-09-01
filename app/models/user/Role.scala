package models.user

/**
 * Enumeration of the roles a user account can hold, backing the `role` Postgres enum type.
 *
 * NOTE: if changing these values, update the `role` Postgres enum type as well (see 371.sql). The string values are
 * emitted directly in admin JSON and in the `role` field of several API responses.
 */
object Role extends Enumeration {
  type Role = Value
  val Registered: Value    = Value("Registered")
  val Turker: Value        = Value("Turker")
  val Researcher: Value    = Value("Researcher")
  val Administrator: Value = Value("Administrator")
  val Owner: Value         = Value("Owner")
  val Anonymous: Value     = Value("Anonymous")
  val Ai: Value            = Value("AI")

  /** Roles that can be credited on SciStarter, which has no concept of an anonymous or machine contributor. */
  val SCISTARTER_ROLES: Set[Value] = Set(Registered, Researcher, Administrator, Owner)

  /** Roles that grant access to admin-only pages and data. */
  val ADMIN_ROLES: Set[Value] = Set(Administrator, Owner)

  /** Roles an admin may move a user into or out of. Owner is fixed, and Anonymous/AI are system-assigned. */
  val ADMIN_ASSIGNABLE_ROLES: Seq[Value] = Seq(Registered, Turker, Researcher, Administrator)

  /** The roles the admin user table's role filter offers, with the admin-ish roles collapsed into Researcher. */
  val ROLES_RESEARCHER_COLLAPSED: Seq[Value] = Seq(Registered, Turker, Researcher, Anonymous, Ai)

  /**
   * Roles whose members are ranked on the leaderboards (per-city, global, and the "your standing" slice).
   *
   * Every board must agree on who counts as a contributor, so they all splice this rather than repeating the literal
   * set; a change here moves the boards and the "of N" denominator together.
   */
  val LEADERBOARD_ROLES: Seq[Value] = Seq(Registered, Administrator, Researcher)

  /** [[LEADERBOARD_ROLES]] as a quoted, comma-separated list for splicing into a raw-SQL `IN (...)`. */
  val LEADERBOARD_ROLES_SQL: String = LEADERBOARD_ROLES.map(role => s"'$role'").mkString(", ")

  /** Parses a string into a role, returning None if it doesn't match a known value. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}
