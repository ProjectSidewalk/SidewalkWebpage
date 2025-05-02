package models.attribute

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

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
trait UserAttributeLabelTableRepository { }

@Singleton
class UserAttributeLabelTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)
  extends UserAttributeLabelTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  val userAttributeLabels: TableQuery[UserAttributeLabelTableDef] = TableQuery[UserAttributeLabelTableDef]

  def countUserAttributeLabels: DBIO[Int] = {
    userAttributeLabels.length.result
  }

  def insert(newSess: UserAttributeLabel): DBIO[Int] = {
    (userAttributeLabels returning userAttributeLabels.map(_.userAttributeLabelId)) += newSess
  }

  def insertMultiple(labels: Seq[UserAttributeLabel]): DBIO[Seq[Int]] = {
    (userAttributeLabels returning userAttributeLabels.map(_.userAttributeLabelId)) ++= labels
  }
}
