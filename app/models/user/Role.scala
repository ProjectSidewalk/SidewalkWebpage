package models.user

import models.utils.{NamedEnum, PgEnumCompanion}

/**
 * Enumeration of the roles a user account can hold, backing the `role` Postgres enum type.
 *
 * NOTE: if changing these values, update the `role` Postgres enum type as well (see 372.sql). The string values are
 * emitted directly in admin JSON and in the `role` field of several API responses.
 */
enum Role(val name: String) extends NamedEnum {
  case Registered    extends Role("Registered")
  case Turker        extends Role("Turker")
  case Researcher    extends Role("Researcher")
  case Administrator extends Role("Administrator")
  case Owner         extends Role("Owner")
  case Anonymous     extends Role("Anonymous")
  case Ai            extends Role("AI")
}

object Role extends PgEnumCompanion[Role]("role") {

  /** Roles that can be credited on SciStarter, which has no concept of an anonymous or machine contributor. */
  val SCISTARTER_ROLES: Set[Role] = Set(Registered, Researcher, Administrator, Owner)

  /** Roles that grant access to admin-only pages and data. */
  val ADMIN_ROLES: Set[Role] = Set(Administrator, Owner)

  /** Roles an admin may move a user into or out of. Owner is fixed, and Anonymous/AI are system-assigned. */
  val ADMIN_ASSIGNABLE_ROLES: Seq[Role] = Seq(Registered, Turker, Researcher, Administrator)

  /** The roles the admin user table's role filter offers, with the admin-ish roles collapsed into Researcher. */
  val ROLES_RESEARCHER_COLLAPSED: Seq[Role] = Seq(Registered, Turker, Researcher, Anonymous, Ai)

  /**
   * Roles whose members are ranked on the leaderboards (per-city, global, and the "your standing" slice).
   *
   * Every board must agree on who counts as a contributor, so they all splice this rather than repeating the literal
   * set; a change here moves the boards and the "of N" denominator together.
   */
  val LEADERBOARD_ROLES: Seq[Role] = Seq(Registered, Administrator, Researcher)

  /** [[LEADERBOARD_ROLES]] as a quoted, comma-separated list for splicing into a raw-SQL `IN (...)`. */
  val LEADERBOARD_ROLES_SQL: String = LEADERBOARD_ROLES.map(role => s"'${role.name}'").mkString(", ")
}
