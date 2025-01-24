package models.label

import com.google.inject.ImplementedBy
import models.utils.{ConfigTableDef, MyPostgresDriver}
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Logger
import play.api.Play.current
import play.api.cache.Cache

import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.DurationInt

case class Tag(tagId: Int, labelTypeId: Int, tag: String, mutuallyExclusiveWith: Option[String])

class TagTableDef(tagParam: slick.lifted.Tag) extends Table[Tag](tagParam, "tag") {
  def tagId: Rep[Int] = column[Int]("tag_id", O.PrimaryKey, O.AutoInc)
  def labelTypeId: Rep[Int] = column[Int]("label_type_id")
  def tag: Rep[String] = column[String]("tag")
  def mutuallyExclusiveWith: Rep[Option[String]] = column[Option[String]]("mutually_exclusive_with")

  def * = (tagId, labelTypeId, tag, mutuallyExclusiveWith) <> ((Tag.apply _).tupled, Tag.unapply)

//  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
//    foreignKey("tag_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTableDef])(_.labelTypeId)
//
//  def labelTypeTagUnique: Index = index("tag_label_type_id_tag_unique", (labelTypeId, tag), unique = true)
}

@ImplementedBy(classOf[TagTable])
trait TagTableRepository {
  def selectAllTags: DBIO[Seq[models.label.Tag]]
}

@Singleton
class TagTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends TagTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val tagTable = TableQuery[TagTableDef]

  def selectAllTags: DBIO[Seq[models.label.Tag]] = tagTable.result
}
