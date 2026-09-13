package models.label

import com.google.inject.ImplementedBy
import models.label.CropSource.CropSource
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{Json, Writes}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

// NOTE need to update crop_source enum in postgres as well if changing this Enumeration.
object CropSource extends Enumeration {
  type CropSource = Value

  /** The browser's snapshot of the Explore canvas at labeling time, where the label is at the canvas fraction. */
  val ExploreFrame = Value("explore_frame")

  /** The window the crop job cuts around the label from the self-hosted pano (#4865). */
  val PanoWindow = Value("pano_window")
}

/** Where the label is in its crop, as fractions of the image (`0` to `1`), so it places the marker at any scale. */
case class CropMarker(x: Double, y: Double)

object CropMarker {
  implicit val writes: Writes[CropMarker] = Json.writes[CropMarker]
}

/**
 * The provenance of one label's crop (#2660): which writer produced it and where the label is in it.
 *
 * @param source          Which kind of image the crop is.
 * @param markerX         The label's x as a fraction of the stored width.
 * @param markerY         The label's y as a fraction of the stored height.
 * @param width           The stored file's width when the row was written.
 * @param height          The stored file's height when the row was written.
 * @param cropRuleVersion `CropSizingRule.Version` for a `PanoWindow` crop; `None` for an `ExploreFrame` one.
 */
case class LabelCrop(
    labelId: Int,
    source: CropSource,
    markerX: Double,
    markerY: Double,
    width: Int,
    height: Int,
    cropRuleVersion: Option[String],
    timeCreated: OffsetDateTime
) {
  def marker: CropMarker = CropMarker(markerX, markerY)
}

class LabelCropTableDef(tag: slick.lifted.Tag) extends Table[LabelCrop](tag, "label_crop") {
  def labelId: Rep[Int]       = column[Int]("label_id", O.PrimaryKey)
  def source: Rep[CropSource] = column[CropSource]("source")
  def markerX: Rep[Double]    = column[Double]("marker_x") // CHECK (marker_x >= 0 AND marker_x <= 1) in the DB.
  def markerY: Rep[Double]    = column[Double]("marker_y") // CHECK (marker_y >= 0 AND marker_y <= 1) in the DB.
  def width: Rep[Int]         = column[Int]("width")       // CHECK (width > 0) in the DB.
  def height: Rep[Int]        = column[Int]("height")      // CHECK (height > 0) in the DB.
  // CHECK ((crop_rule_version IS NOT NULL) = (source = 'pano_window')) in the DB.
  def cropRuleVersion: Rep[Option[String]] = column[Option[String]]("crop_rule_version")
  // DEFAULT now() in the DB (O.Default holds a value, not an expression).
  def timeCreated: Rep[OffsetDateTime] = column[OffsetDateTime]("time_created")

  def * = (labelId, source, markerX, markerY, width, height, cropRuleVersion, timeCreated) <>
    ((LabelCrop.apply _).tupled, LabelCrop.unapply)

  def label = foreignKey("label_crop_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
}

@ImplementedBy(classOf[LabelCropTable])
trait LabelCropTableRepository {}

@Singleton
class LabelCropTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
    extends LabelCropTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val labelCrops = TableQuery[LabelCropTableDef]

  /** Rows per statement when a run writes many at once; each row is one upsert, so this bounds the transaction. */
  val UpsertBatchSize: Int = 1000

  def get(labelId: Int): DBIO[Option[LabelCrop]] = labelCrops.filter(_.labelId === labelId).result.headOption

  /** The rows for the given labels, keyed by label id; a label with no row is absent. */
  def getMany(labelIds: Seq[Int]): DBIO[Map[Int, LabelCrop]] =
    if (labelIds.isEmpty) DBIO.successful(Map.empty)
    else labelCrops.filter(_.labelId inSet labelIds).result.map(_.map(c => c.labelId -> c).toMap)

  def upsert(crop: LabelCrop): DBIO[Int] = labelCrops.insertOrUpdate(crop)

  /**
   * Writes or replaces many rows, [[UpsertBatchSize]] to a transaction. An upsert per row rather than one bulk insert
   * because a concurrent `POST /saveImage` can land a label's row between a run reading the table and writing to it,
   * and a bulk insert would then fail the whole batch on that one key.
   */
  def upsertAll(crops: Seq[LabelCrop]): DBIO[Int] =
    DBIO
      .sequence(crops.grouped(UpsertBatchSize).toSeq.map { batch =>
        DBIO.sequence(batch.map(upsert)).transactionally.map(_.sum)
      })
      .map(_.sum)
}
