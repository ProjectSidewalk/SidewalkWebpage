package models.attribute

//import models.label.{Label, LabelTable}
import com.google.inject.ImplementedBy
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current
import play.api.db.slick

import javax.inject.{Inject, Singleton}
import scala.language.postfixOps

case class UserAttributeLabel(userAttributeLabelId: Int, userAttributeId: Int, labelId: Int)

class UserAttributeLabelTableDef(tag: Tag) extends Table[UserAttributeLabel](tag, "user_attribute_label") {
  def userAttributeLabelId: Rep[Int] = column[Int]("user_attribute_label_id", O.PrimaryKey, O.AutoInc)
  def userAttributeId: Rep[Int] = column[Int]("user_attribute_id")
  def labelId: Rep[Int] = column[Int]("label_id")

  def * = (userAttributeLabelId, userAttributeId, labelId) <>
    ((UserAttributeLabel.apply _).tupled, UserAttributeLabel.unapply)

//  def userAttribute: ForeignKeyQuery[UserAttributeTable, UserAttribute] =
//    foreignKey("user_attribute_label_user_attribute_id_fkey", userAttributeId, TableQuery[UserAttributeTableDef])(_.userAttributeId)
//
//  def label: ForeignKeyQuery[LabelTable, Label] =
//    foreignKey("user_attribute_label_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
}

@ImplementedBy(classOf[UserAttributeLabelTable])
trait UserAttributeLabelTableRepository {
}

@Singleton
class UserAttributeLabelTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends UserAttributeLabelTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val userAttributeLabels: TableQuery[UserAttributeLabelTableDef] = TableQuery[UserAttributeLabelTableDef]

//  def countUserAttributeLabels: Int = {
//    userAttributeLabels.size.run
//  }
//
//  def save(newSess: UserAttributeLabel): Int = {
//    val newId: Int = (userAttributeLabels returning userAttributeLabels.map(_.userAttributeLabelId)) += newSess
//    newId
//  }
}
