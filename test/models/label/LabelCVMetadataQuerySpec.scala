package models.label

import models.utils.MyPostgresProfile.api.given
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec}

/**
 * Checks each CV metadata row against its pano's record: the query fills its columns by position, so two text
 * columns swapped (the credit and the license) would still compile.
 */
class LabelCVMetadataQuerySpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val labelTable = app.injector.instanceOf[LabelTable]

  "getLabelCVMetadata" should {
    "give each label the source, credit and license its pano has on record" in {
      val onRecord = run(
        sql"""SELECT label.label_id, pano_data.source::text, pano_data.copyright, pano_data.license
              FROM label
              INNER JOIN pano_data ON label.pano_id = pano_data.pano_id"""
          .as[(Int, String, Option[String], Option[String])]
      ).map { case (labelId, source, copyright, license) => labelId -> (source, copyright, license) }.toMap

      run(labelTable.getLabelCVMetadata).foreach { row =>
        withClue(s"label ${row.labelId}: ") {
          (row.source.name, row.copyright, row.license) mustBe onRecord(row.labelId)
        }
      }
    }
  }
}
