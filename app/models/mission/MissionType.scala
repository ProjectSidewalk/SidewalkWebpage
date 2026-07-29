package models.mission

/**
 * Enumeration of the types of mission we assign to users, backing the `mission_type` Postgres enum type.
 *
 * NOTE: if changing these values, update the `mission_type` Postgres enum type as well (see 342.sql). The string
 * values are emitted directly in mission JSON sent to the frontend and echoed back in its mission-progress payloads.
 */
object MissionType extends Enumeration {
  type MissionType = Value
  val AuditOnboarding: Value      = Value("auditOnboarding")
  val Audit: Value                = Value("audit")
  val ValidationOnboarding: Value = Value("validationOnboarding")
  val Validation: Value           = Value("validation")
  val CvGroundTruth: Value        = Value("cvGroundTruth")
  val LabelmapValidation: Value   = Value("labelmapValidation")
  val AiValidation: Value         = Value("aiValidation")
  val ExploreAddress: Value       = Value("exploreAddress")

  /** The tutorial mission types, which don't represent real contribution activity. */
  val onboardingTypes: Set[Value] = Set(AuditOnboarding, ValidationOnboarding)

  /** Parses a string into a mission type, returning None if it doesn't match a known value. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}
