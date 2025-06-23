package models.label

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class Tag(tagId: Int, labelTypeId: Int, tag: String, mutuallyExclusiveWith: Option[String])

class TagTableDef(tagParam: slick.lifted.Tag) extends Table[Tag](tagParam, "tag") {
  def tagId: Rep[Int]                            = column[Int]("tag_id", O.PrimaryKey, O.AutoInc)
  def labelTypeId: Rep[Int]                      = column[Int]("label_type_id")
  def tag: Rep[String]                           = column[String]("tag")
  def mutuallyExclusiveWith: Rep[Option[String]] = column[Option[String]]("mutually_exclusive_with")

  def * = (tagId, labelTypeId, tag, mutuallyExclusiveWith) <> ((Tag.apply _).tupled, Tag.unapply)

//  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
//    foreignKey("tag_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTableDef])(_.labelTypeId)
//
//  def labelTypeTagUnique: Index = index("tag_label_type_id_tag_unique", (labelTypeId, tag), unique = true)
}

@ImplementedBy(classOf[TagTable])
trait TagTableRepository {}

@Singleton
class TagTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends TagTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val tagTable = TableQuery[TagTableDef]

  def selectAllTags: DBIO[Seq[models.label.Tag]] = tagTable.result
}
