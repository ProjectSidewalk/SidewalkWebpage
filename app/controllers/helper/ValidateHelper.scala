package controllers.helper

import models.label.LabelTypeEnum

object ValidateHelper {
  case class ValidateParams(
      adminVersion: Boolean,
      labelType: Option[LabelTypeEnum.Base] = None,
      userIds: Option[Seq[String]] = None,
      neighborhoodIds: Option[Seq[Int]] = None,
      unvalidatedOnly: Boolean = false
  ) {
    require(labelType.isEmpty || adminVersion, "labelType can only be set if adminVersion is true")
    require(userIds.isEmpty || adminVersion, "userIds can only be set if adminVersion is true")
  }
}
