package controllers.helper

object ValidateHelper {
  case class AdminValidateParams(
      adminVersion: Boolean,
      labelTypeId: Option[Int] = None,
      userIds: Option[Seq[String]] = None,
      neighborhoodIds: Option[Seq[Int]] = None
  ) {
    require(labelTypeId.isEmpty || adminVersion, "labelTypeId can only be set if adminVersion is true")
    require(userIds.isEmpty || adminVersion, "userIds can only be set if adminVersion is true")
  }
}
