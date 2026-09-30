package models.mission

import models.utils.{NamedEnum, PgEnumCompanion}

/**
 * Enumeration of the types of mission we assign to users, backing the `mission_type` Postgres enum type.
 *
 * NOTE: if changing these values, update the `mission_type` Postgres enum type as well (see 342.sql). The string
 * values are emitted directly in mission JSON sent to the frontend and echoed back in its mission-progress payloads.
 */
enum MissionType(val name: String) extends NamedEnum {
  case AuditOnboarding      extends MissionType("auditOnboarding")
  case Audit                extends MissionType("audit")
  case ValidationOnboarding extends MissionType("validationOnboarding")
  case Validation           extends MissionType("validation")
  case CvGroundTruth        extends MissionType("cvGroundTruth")
  case LabelmapValidation   extends MissionType("labelmapValidation")
  case AiValidation         extends MissionType("aiValidation")
  case ExploreAddress       extends MissionType("exploreAddress")
}

object MissionType extends PgEnumCompanion[MissionType]("mission_type") {

  /** The tutorial mission types, which don't represent real contribution activity. */
  val onboardingTypes: Set[MissionType] = Set(AuditOnboarding, ValidationOnboarding)
}
