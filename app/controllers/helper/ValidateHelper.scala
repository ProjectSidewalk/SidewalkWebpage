package controllers.helper

import models.pano.PanoSource.PanoSource

object ValidateHelper {
  case class ValidateParams(
      adminVersion: Boolean,
      viewer: PanoSource,
      labelTypeId: Option[Int] = None,
      userIds: Option[Seq[String]] = None,
      neighborhoodIds: Option[Seq[Int]] = None,
      unvalidatedOnly: Boolean = false
  ) {
    require(labelTypeId.isEmpty || adminVersion, "labelTypeId can only be set if adminVersion is true")
    require(userIds.isEmpty || adminVersion, "userIds can only be set if adminVersion is true")
  }
}
