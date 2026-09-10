package models.api

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.{JsNumber, JsObject}

import java.time.{LocalDate, OffsetDateTime}

/**
 * Contract tests for the field lists every record-shaped endpoint's JSON and CSV are built from.
 *
 * The per-endpoint specs check what each one emits; these check the two properties that hold for all of them, and
 * that the shared machinery refuses a field list it would serialize wrongly.
 */
class ApiFieldsSpec extends AnyFunSuite with Matchers {
  import ApiFields.field

  private case class Sample(a: Int, b: Int)

  private val sampleDailyStat = DailyStatRecord(LocalDate.parse("2025-01-15"), "CurbRamp", 1, 2, 3, 4, 5, 6, 7, 8)

  private val sampleCvMetadata = LabelCVMetadata(
    labelId = 1, panoId = "pano-1", labelType = "CurbRamp", agreeCount = 3, disagreeCount = 1, unsureCount = 0,
    panoWidth = None, panoHeight = Some(8192), panoX = 100, panoY = 200, canvasWidth = 720, canvasHeight = 480,
    canvasX = 50, canvasY = 60, zoom = 1.0, heading = 90.0, pitch = -10.0, cameraHeading = 95.0, cameraPitch = 0.0,
    cameraRoll = None
  )

  private val sampleRawLabel = RawLabelInClusterDataForApi(
    labelId = 8, userId = "u1", panoId = "abc123", panoSource = None, severity = Some(2),
    timeCreated = OffsetDateTime.parse("2023-08-16T23:47:25Z"), latitude = 47.6, longitude = -122.3,
    correct = Some(true), imageCaptureDate = None
  )

  /** These three map one constructor parameter to one field, so arity catches a parameter the list forgot. */
  test("each field list covers every parameter of the case class it serializes") {
    withClue("DailyStatRecord: ")(DailyStatRecord.fields.size shouldBe sampleDailyStat.productArity)
    withClue("LabelCVMetadata: ")(LabelCVMetadata.fields.size shouldBe sampleCvMetadata.productArity)
    withClue("RawLabelInClusterDataForApi: ")(RawLabelFields.fields.size shouldBe sampleRawLabel.productArity)
  }

  test("a geometry-backed model's CSV carries its own columns on top of the shared fields") {
    StreetDataForApi.csvFields.size shouldBe StreetDataForApi.fields.size + 2
    StreetDataForApi.csvHeader should endWith("start_point,end_point")
    StreetDataForApi.fields.map(_.name) should not contain "start_point"
  }

  test("dotted names become nested JSON, and the CSV keeps them as flat dotted columns") {
    object Nested extends ApiFields[Sample] {
      override val fields: Seq[ApiField[Sample]] =
        Seq(field("a")(_.a), field("group.x")(_.a), field("group.y")(_.b))
    }

    Nested.csvHeader shouldBe "a,group.x,group.y"
    Nested.toJson(Sample(1, 2)) shouldBe JsObject(
      Seq("a" -> JsNumber(1), "group" -> JsObject(Seq("x" -> JsNumber(1), "y" -> JsNumber(2))))
    )
  }

  test("a name used as both a value and an object is rejected rather than silently dropping the object") {
    object Collides extends ApiFields[Sample] {
      override val fields: Seq[ApiField[Sample]] = Seq(field("score")(_.a), field("score.CurbRamp")(_.b))
    }

    the[IllegalArgumentException] thrownBy Collides.toJson(Sample(1, 2)) should have message
      "requirement failed: field is both a value and an object: List(score)"
  }

  test("a duplicated field name is rejected") {
    object Duplicated extends ApiFields[Sample] {
      override val fields: Seq[ApiField[Sample]] = Seq(field("a")(_.a), field("a")(_.b))
    }

    an[IllegalArgumentException] should be thrownBy Duplicated.toJson(Sample(1, 2))
  }
}
