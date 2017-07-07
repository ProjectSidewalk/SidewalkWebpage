package models.user

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import java.util.UUID

case class UserRole(userRoleId: Int, userId: String, roleId: Int)

class UserRoleTable(tag: Tag) extends Table[UserRole](tag, Some("sidewalk"), "user_role") {
  def userRoleId = column[Int]("user_role_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id", O.NotNull)
  def roleId = column[Int]("role_id", O.NotNull)


  def * = (userRoleId, userId, roleId) <> ((UserRole.apply _).tupled, UserRole.unapply)
}

object UserRoleTable {
  val db = play.api.db.slick.DB
  val userRoles = TableQuery[UserRoleTable]
  val roles = TableQuery[RoleTable]

  val roleMapping = Map("User" -> 1, "Administrator" -> 2)

  /**
    * Returns a list of researcher ids
    * TODO once there is a role in the role table for researchers, use queries instead of this list
    *
    * @return
    */
  def researcherIds: List[String] = List("49787727-e427-4835-a153-9af6a83d1ed1", "25b85b51-574b-436e-a9c4-339eef879e78",
    "9efaca05-53bb-492e-83ab-2b47219ee863", "5473abc6-38fc-4807-a515-e44cdfb92ca2", "0c6cb637-05b7-4759-afb2-b0a25b615597",
    "9c828571-eb9d-4723-9e8d-2c00289a6f6a", "6acde11f-d9a2-4415-b73e-137f28eaa4ab", "0082be2e-c664-4c05-9881-447924880e2e",
    "ae8fc440-b465-4a45-ab49-1964a7f1dcee", "c4ba8834-4722-4ee1-8f71-4e3fe9af38eb", "41804389-8f0e-46b1-882c-477e060dbe95",
    "d8862038-e4dd-48a4-a6d0-69042d9e247a", "43bd82ab-bc7d-4be7-a637-99c92f566ba5", "0bfed786-ce24-43f9-9c58-084ae82ad175",
    "b65c0864-7c3a-4ba7-953b-50743a2634f6", "b6049113-7e7a-4421-a966-887266200d72", "395abc5a-14ea-443c-92f8-85e87fa002be",
    "a6611125-51d0-41d1-9868-befcf523e131", "1dc2f78e-f722-4450-b14e-b21b232ecdef", "ee570f03-7bca-471e-a0dc-e7924dac95a4",
    "23fce322-9f64-4e95-90fc-7141f755b2a1", "c846ef76-39c1-4a53-841c-6588edaac09b", "74b56671-c9b0-4052-956e-02083cbb5091",
    "fe724938-797a-48af-84e9-66b6b86b6245")

  def addUserRole(userId: UUID): Int = db.withTransaction { implicit session =>
    val userRole = UserRole(0, userId.toString, roleMapping("User"))
    val userRoleId: Int =
      (userRoles returning userRoles.map(_.userRoleId)) += userRole
    userRoleId
  }

  def getRoles(userId: UUID): Seq[String] = db.withSession { implicit session =>
    val _roles = for {
      (_userRoles, _roles) <- userRoles.innerJoin(roles).on(_.roleId === _.roleId) if _userRoles.userId === userId.toString
    } yield _roles
    _roles.list.map(_.role)
  }

}