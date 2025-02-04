package controllers.helper

import models.label.{LabelTable, LabelTypeValidationsLeft}
import models.label.LabelTable.getAvailableValidationLabelsByType
import java.util.UUID
import scala.util.Random

object ValidateHelper {
  case class AdminValidateParams(adminVersion: Boolean, labelTypeId: Option[Int]=None, userIds: Option[List[String]]=None, neighborhoodIds: Option[List[Int]]=None) {
    require(labelTypeId.isEmpty || adminVersion, "labelTypeId can only be set if adminVersion is true")
    require(userIds.isEmpty || adminVersion, "userIds can only be set if adminVersion is true")
  }

  /**
   * Get the label_type_id to validate. Label types with fewer labels with validations have higher priority.
   *
   * We get the number of labels available to validate for each label type and the number of those that have no
   * validations (or have agree=disagree). We then filter out label types with fewer than missionLength labels available
   * to validate (the size of a Validate mission), and prioritize label types more labels w/ no validations.
   *
   * @param userId               User ID of the current user.
   * @param missionLength        Number of labels for this mission.
   * @param currentLabelTypeId   Label ID of the current mission
   */
  def getLabelTypeIdToValidate(userId: UUID, missionLength: Int, requiredLabelType: Option[Int]): Option[Int] = {
    val availTypes: List[LabelTypeValidationsLeft] = getAvailableValidationLabelsByType(userId)
      .filter(_.validationsAvailable >= missionLength)
      .filter(x => requiredLabelType.isEmpty || x.labelTypeId == requiredLabelType.get)
      .filter(x => LabelTable.valLabelTypeIds.contains(x.labelTypeId))

    // Unless NoSidewalk (7) is the only available label type, remove it from the list of available types.
    val typesFiltered: List[LabelTypeValidationsLeft] = availTypes.filter(_.labelTypeId != 7 || availTypes.length == 1)

    if (typesFiltered.length < 2) {
      typesFiltered.map(_.labelTypeId).headOption
    } else {
      // Each label type has at least a 3% chance of being selected. Remaining probability is divvied up proportionally
      // based on the number of remaining labels requiring a validation for each label type.
      val typeProbabilities: List[(Int, Double)] = if (typesFiltered.map(_.validationsNeeded).sum > 0) {
        typesFiltered.map { t =>
          (t.labelTypeId, 0.03 + (1 - typesFiltered.length * 0.03) * (t.validationsNeeded.toDouble / typesFiltered.map(_.validationsNeeded).sum))
        }
      } else {
        typesFiltered.map(x => (x.labelTypeId, 1D / typesFiltered.length))
      }

      // Get cumulative probabilities.
      val cumulativeProbabilities: Seq[Double] = typeProbabilities.scanLeft(0.0) { case (acc, (_, prob)) => acc + prob }.tail

      // Choose a label type proportionally based on the calculated probabilities.
      val random = new Random()
      val labelTypeId: Int = typeProbabilities(cumulativeProbabilities.indexWhere(_ > random.nextDouble()))._1
      Some(labelTypeId)
    }
  }
}
