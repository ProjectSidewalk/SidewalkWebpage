package controllers.helper

import models.label.LabelTypeEnum
import models.validation.ValidationQueuePolicy.ValidationQueue

object ValidateHelper {
  case class ValidateParams(
      adminVersion: Boolean,
      labelType: Option[LabelTypeEnum.Base] = None,
      userIds: Option[Seq[String]] = None,
      neighborhoodIds: Option[Seq[Int]] = None,
      unvalidatedOnly: Boolean = false,
      triage: Boolean = false
  ) {
    require(labelType.isEmpty || adminVersion, "labelType can only be set if adminVersion is true")
    require(userIds.isEmpty || adminVersion, "userIds can only be set if adminVersion is true")
    require(!triage || adminVersion, "triage can only be set if adminVersion is true")

    /**
     * Queues this page draws labels from, in order (#4715).
     *
     * Triage mode puts what the crowd could not finish first, then falls back to the crowd's own queue and finally to
     * everything, so an expert is never left without labels.
     */
    def queueCascade: Seq[ValidationQueue] =
      if (triage) ValidationQueue.expertCascade else ValidationQueue.crowdCascade
  }
}
