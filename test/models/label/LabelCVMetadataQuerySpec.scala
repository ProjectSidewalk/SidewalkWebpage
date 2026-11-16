package models.label

import models.utils.MyPostgresProfile.api.given
import models.validation.ValidationResultCounts
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import slick.jdbc.TransactionIsolation
import util.{RolledBackDb, SidewalkSpec}

/**
 * Checks each CV metadata row against the tables it is read from: the query fills its columns by position, so two
 * same-typed neighbours swapped (pano x/y with canvas x/y, the credit with the license) would still compile.
 */
class LabelCVMetadataQuerySpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val labelTable = app.injector.instanceOf[LabelTable]

  private type Stored =
    (Int, Int, Int, Int, Int, Int, Int, Int, Int, Int, Double, Double, Double, String, Option[String], Option[String])

  private val storedQuery =
    sql"""SELECT label.label_id, label.agree_count, label.disagree_count, label.unsure_count,
                 label_point.pano_x, label_point.pano_y, label_point.canvas_width, label_point.canvas_height,
                 label_point.canvas_x, label_point.canvas_y, label_point.heading, label_point.pitch, label_point.zoom,
                 pano_data.source::text, pano_data.copyright, pano_data.license
          FROM label
          INNER JOIN label_point ON label.label_id = label_point.label_id
          INNER JOIN pano_data ON label.pano_id = pano_data.pano_id""".as[Stored]

  "getLabelCVMetadata" should {
    "give each label the values its own label, point and pano rows hold" in {
      // One snapshot for both reads, so a label saved in between can't show up in only one of them.
      val (rows, stored) = run(
        labelTable.getLabelCVMetadata
          .zip(storedQuery)
          .transactionally
          .withTransactionIsolation(TransactionIsolation.RepeatableRead)
      )
      assume(rows.nonEmpty, "no labels with pano data in this database")
      val storedById = stored.map(row => row._1 -> row).toMap

      rows.foreach { row =>
        withClue(s"label ${row.labelId}: ") {
          val (_, agree, disagree, unsure, panoX, panoY, canvasWidth, canvasHeight, canvasX, canvasY, heading, pitch,
            zoom, source, copyright, license) = storedById(row.labelId)
          row.validationCounts mustBe ValidationResultCounts(agree, disagree, unsure)
          row.panoXY mustBe LocationXY(panoX, panoY)
          row.canvasSize mustBe Dimensions(canvasWidth, canvasHeight)
          row.canvasXY mustBe LocationXY(canvasX, canvasY)
          row.pov mustBe POV(heading, pitch, zoom)
          (row.source.name, row.copyright, row.license) mustBe (source, copyright, license)
        }
      }
    }
  }
}
