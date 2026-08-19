package service

import modules.PersistentMediaDirCheck.persistentDirs
import org.scalatestplus.play.PlaySpec
import play.api.{Configuration, Environment, Mode}

import java.io.File
import java.nio.file.Files

/**
 * The media-storage panel's judgment calls (#4926): which of them mean data has been lost, and — just as important —
 * which of them don't.
 *
 * A monitor that reports loss when a directory is merely absent, or on a dev checkout where the relative defaults are
 * the intended behavior, gets ignored, and an ignored monitor is worth nothing. So the false-alarm cases are pinned
 * here as tightly as the real ones.
 *
 * Pure logic — no app boot and no database; the only filesystem it touches is a temp directory it creates itself.
 */
class MediaIntegritySpec extends PlaySpec {

  private val appRoot = new File("/srv/sidewalk/target/universal/stage")

  private def env(mode: Mode): Environment = Environment(appRoot, getClass.getClassLoader, mode)

  private def config(path: String): Configuration =
    Configuration.from(persistentDirs.map(_.key -> path).toMap)

  private def statusFor(path: String, mode: Mode): MediaDirStatus =
    MediaIntegrity.directoryStatuses(config(path), env(mode)).head

  /** A temp directory holding the given file names, cleaned up by the JVM's temp handling. */
  private def dirContaining(names: String*): File = {
    val dir = Files.createTempDirectory("media-integrity-spec").toFile
    dir.deleteOnExit()
    names.foreach { name =>
      val f = new File(dir, name)
      f.createNewFile()
      f.deleteOnExit()
    }
    dir
  }

  "directoryStatuses" should {
    "cover every directory the boot check guards, so the page can't quietly omit one" in {
      MediaIntegrity.directoryStatuses(config("/srv/media"), env(Mode.Prod)).map(_.key) mustBe persistentDirs.map(_.key)
    }

    "flag a directory a deploy would delete as bad when it holds irreplaceable content" in {
      val prod = MediaIntegrity.directoryStatuses(config(".story-media"), env(Mode.Prod))
      prod.filter(_.irreplaceable).foreach { d =>
        d.status mustBe "unsafe"
        d.severity mustBe "bad"
      }
      prod.filterNot(_.irreplaceable).foreach(_.severity mustBe "warn")
    }

    "not alarm on the same directory in dev, where the relative defaults are supposed to land in the checkout" in {
      MediaIntegrity.directoryStatuses(config(".story-media"), env(Mode.Dev)).foreach { d =>
        d.status mustBe "unsafe"
        d.severity mustBe "ok"
      }
    }

    "report a directory that doesn't exist yet as normal, since the write paths create it on first upload" in {
      val status = statusFor("/srv/sidewalk-media/nothing-here-yet", Mode.Prod)
      status.status mustBe "absent"
      status.severity mustBe "ok"
    }

    "report a usable directory as ok" in {
      val status = statusFor(dirContaining().getAbsolutePath, Mode.Prod)
      status.status mustBe "ok"
      status.severity mustBe "good"
    }

    "surface a blank value rather than resolving it, since it would target the filesystem root" in {
      val status = statusFor("", Mode.Prod)
      status.status mustBe "unresolved"
      status.severity mustBe "bad"
      status.detail.value must include("set but empty")
    }

    "name the environment variable that fixes each directory" in {
      MediaIntegrity.directoryStatuses(config(".story-media"), env(Mode.Prod)).map(_.envVar) mustBe
        persistentDirs.map(_.envVar)
    }
  }

  private val configuredCities = Map("sidewalk_chicago" -> "chicago-il", "sidewalk_seattle" -> "seattle-wa")

  "cityDirsBySchema" should {
    "use the configured city for every schema when nothing disagrees" in {
      MediaIntegrity.cityDirsBySchema(
        Seq("sidewalk_chicago", "sidewalk_seattle"),
        "sidewalk_chicago",
        "chicago-il",
        configuredCities
      ) mustBe configuredCities
    }

    "follow this instance's own city-id, since that is what the write path builds its path from" in {
      // A dev container left with city-id and the connection's schema disagreeing writes media under the city-id.
      val dirs = MediaIntegrity.cityDirsBySchema(
        Seq("sidewalk_chicago", "sidewalk_seattle"),
        "sidewalk_chicago",
        "seattle-wa",
        configuredCities
      )
      dirs.get("sidewalk_chicago") mustBe Some("seattle-wa")
    }

    "not let a second schema claim a directory this instance already writes to" in {
      // Otherwise the other schema lists the same files and reports every one of them as an orphan.
      val dirs = MediaIntegrity.cityDirsBySchema(
        Seq("sidewalk_chicago", "sidewalk_seattle"),
        "sidewalk_chicago",
        "seattle-wa",
        configuredCities
      )
      dirs.get("sidewalk_seattle") mustBe None
    }

    "leave out a schema no configured city names, so it is reported unscanned rather than guessed at" in {
      MediaIntegrity.cityDirsBySchema(
        Seq("sidewalk_elsewhere"),
        "sidewalk_chicago",
        "chicago-il",
        configuredCities
      ) mustBe
        Map.empty
    }
  }

  "compareCity" should {
    "report a city whose rows all have files as clean" in {
      val result = MediaIntegrity.compareCity(
        Some("chicago-il"),
        "sidewalk_chicago",
        Seq(1, 2),
        Some(Seq("story_1.jpg", "story_2.jpg"))
      )
      result.missing mustBe 0
      result.orphans mustBe 0
      result.rows mustBe 2
      result.scanned mustBe true
    }

    "report a row with no file as missing — the #4925 loss" in {
      val result =
        MediaIntegrity.compareCity(Some("chicago-il"), "sidewalk_chicago", Seq(1, 2), Some(Seq("story_1.jpg")))
      result.missing mustBe 1
      result.missingIds mustBe Seq(2)
      result.orphans mustBe 0
    }

    "report a file with no row as orphaned — a retraction whose file delete didn't land" in {
      val result = MediaIntegrity.compareCity(
        Some("chicago-il"),
        "sidewalk_chicago",
        Seq(1),
        Some(Seq("story_1.jpg", "story_7.jpg"))
      )
      result.orphans mustBe 1
      result.orphanIds mustBe Seq(7)
      result.missing mustBe 0
    }

    "count both directions at once, which a row-count comparison alone would call clean" in {
      val result = MediaIntegrity.compareCity(Some("chicago-il"), "sidewalk_chicago", Seq(1), Some(Seq("story_9.jpg")))
      result.missing mustBe 1
      result.orphans mustBe 1
    }

    "ignore files that aren't story media, so a stray README isn't reported as an orphan" in {
      val result = MediaIntegrity.compareCity(
        Some("chicago-il"),
        "sidewalk_chicago",
        Seq(1),
        Some(Seq("story_1.jpg", "README.txt", "story_1.jpg.bak", "story_.jpg"))
      )
      result.orphans mustBe 0
      result.missing mustBe 0
    }

    "treat an absent city directory under a readable base as loss, not as an unknown" in {
      val result = MediaIntegrity.compareCity(Some("chicago-il"), "sidewalk_chicago", Seq(1, 2), None)
      result.missing mustBe 2
      result.scanned mustBe true
    }

    "report a city with no rows and no directory as clean rather than as a fault" in {
      val result = MediaIntegrity.compareCity(Some("chicago-il"), "sidewalk_chicago", Seq.empty, None)
      result.missing mustBe 0
      result.orphans mustBe 0
      result.scanned mustBe true
    }

    "decline to guess when a schema maps to no configured city, since its directory can't be located" in {
      val result = MediaIntegrity.compareCity(None, "sidewalk_somewhere", Seq(1, 2), None)
      result.scanned mustBe false
      result.missing mustBe 0
      result.rows mustBe 2
    }
  }

  "listFileNames" should {
    "read a directory's contents" in {
      MediaIntegrity.listFileNames(dirContaining("story_3.jpg")).value must contain("story_3.jpg")
    }

    "return nothing for a path that isn't a readable directory, so the caller can tell it apart from an empty one" in {
      MediaIntegrity.listFileNames(new File("/srv/sidewalk-media/no-such-directory")) mustBe None
    }
  }
}
