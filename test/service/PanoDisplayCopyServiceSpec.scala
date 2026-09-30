package service

import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.SidewalkSpec

import java.io.File
import java.nio.file.Files
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * The three answers `PanoDisplayCopyService.displayCopy` can give (#5561): a copy, "the native file already fits",
 * and "no copy can be produced" — the last of which the `/backupImage` route turns into a refusal rather than the
 * native file, because a device that asked for a bound cannot take more than it asked for.
 *
 * The copy store is pointed at a temp dir so nothing lands in the real one. Boots the app for the service's wiring
 * only; requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class PanoDisplayCopyServiceSpec extends SidewalkSpec with GuiceOneAppPerSuite {
  private val mediaRoot = Files.createTempDirectory("pano-display-copy-spec").toFile

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .configure("cropped.image.directory" -> new File(mediaRoot, "crops").getPath)
      .build()

  private lazy val service = app.injector.instanceOf[PanoDisplayCopyService]

  private val pano = new File("test/resources/crops/synthetic-pano.png") // 1024x512

  private def copyOf(panoId: String, maxWidth: Int): DisplayCopy =
    Await.result(service.displayCopy(panoId, pano, maxWidth), 30.seconds)

  "PanoDisplayCopyService.displayCopy" should {
    "answer NativeFits, without cutting, for a pano already no wider than the bound" in {
      copyOf("spec-fits", 8192) mustBe DisplayCopy.NativeFits
      service.displayCopyFile("spec-fits", 8192).isFile mustBe false
    }

    "cut a copy at the bound, and serve the same file again without cutting" in {
      val first = copyOf("spec-cut", 512)
      first match {
        case DisplayCopy.Ready(file) =>
          file mustBe service.displayCopyFile("spec-cut", 512)
          file.isFile mustBe true
        case other => fail(s"expected a copy, got $other")
      }
      val modified = service.displayCopyFile("spec-cut", 512).lastModified()
      copyOf("spec-cut", 512) mustBe first
      service.displayCopyFile("spec-cut", 512).lastModified() mustBe modified
    }

    "answer Unavailable for a native file it cannot read, never the native file" in {
      val corrupt = new File(mediaRoot, "not-an-image.jpg") // Under the spec's own temp dir, gone with it.
      Files.write(corrupt.toPath, "definitely not a JPEG".getBytes)
      Await.result(service.displayCopy("spec-corrupt", corrupt, 512), 30.seconds) mustBe DisplayCopy.Unavailable
    }
  }
}
