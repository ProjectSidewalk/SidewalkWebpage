package controllers.helper

object ValidateHelper {
  case class AdminValidateParams(adminVersion: Boolean, labelTypeId: Option[Int]=None, userIds: Option[List[String]]=None, neighborhoodIds: Option[List[Int]]=None) {
    require(labelTypeId.isEmpty || adminVersion, "labelTypeId can only be set if adminVersion is true")
    require(userIds.isEmpty || adminVersion, "userIds can only be set if adminVersion is true")
    require(neighborhoodIds.isEmpty || adminVersion, "neighborhoodIds can only be set if adminVersion is true")
  }
}