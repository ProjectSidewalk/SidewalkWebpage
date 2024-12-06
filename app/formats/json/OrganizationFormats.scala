package formats.json

import models.user._
import play.api.libs.json._
import play.api.libs.functional.syntax._

// https://github.com/datalek/silhouette-rest-seed/blob/master/app/formatters/json/UserFormats.scala
object OrganizationFormats {
  implicit val organizationWrites: Writes[Organization] = (
    (JsPath \ "orgId").write[Int] and
      (JsPath \ "orgName").write[String] and
      (JsPath \ "orgDescription").write[String] and
      (JsPath \ "isOpen").write[Boolean] and 
      (JsPath \ "isVisible").write[Boolean]
    )(unlift(Organization.unapply _))
}
