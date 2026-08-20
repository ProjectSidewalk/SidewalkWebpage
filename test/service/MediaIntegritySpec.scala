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

  private val storyDir = persistentDirs.find(_.irreplaceable).value

  // The permission branches can't be provoked through the filesystem from a suite that runs as root — which CI and
  // the dev container both do, and where chmod 000 still reads and writes fine — so they are pinned on the rules
  // themselves.
  "dirStatus" should {
    "call a directory this process cannot read bad, since nothing in it can be verified" in {
      val probe  = MediaIntegrity.DirProbe(exists = true, readable = false, writable = true)
      val status = MediaIntegrity.dirStatus(storyDir, "/srv/media", probe, None, enforced = true)
      status.status mustBe "not_readable"
      status.severity mustBe "bad"
      status.detail.value must include(storyDir.envVar)
    }

    "call a directory this process cannot write to bad, since uploads will fail against it" in {
      val probe  = MediaIntegrity.DirProbe(exists = true, readable = true, writable = false)
      val status = MediaIntegrity.dirStatus(storyDir, "/srv/media", probe, None, enforced = true)
      status.status mustBe "not_writable"
      status.severity mustBe "bad"
    }

    "report an unsafe directory before either permission, since a deploy deleting it outranks both" in {
      val probe  = MediaIntegrity.DirProbe(exists = true, readable = false, writable = false)
      val status = MediaIntegrity.dirStatus(storyDir, "/srv/media", probe, Some("in the wipe zone"), enforced = true)
      status.status mustBe "unsafe"
    }
  }

  private val configuredCities = Map("sidewalk_chicago" -> "chicago-il", "sidewalk_seattle" -> "seattle-wa")

  /** The reason a schema has no directory, failing the test if it turned out to have one. */
  private def unlocatableReason(target: ScanTarget): String = target match {
    case ScanTarget.Unlocatable(reason) => reason
    case ScanTarget.Dir(cityId)         => fail(s"expected no directory for this schema, got $cityId")
  }

  "scanTargets" should {
    "use the configured city for every schema when nothing disagrees" in {
      MediaIntegrity.scanTargets(
        Seq("sidewalk_chicago", "sidewalk_seattle"),
        "sidewalk_chicago",
        "chicago-il",
        configuredCities
      ) mustBe Map(
        "sidewalk_chicago" -> ScanTarget.Dir("chicago-il"),
        "sidewalk_seattle" -> ScanTarget.Dir("seattle-wa")
      )
    }

    "follow this instance's own city-id, since that is what the write path builds its path from" in {
      // A dev container left with city-id and the connection's schema disagreeing writes media under the city-id.
      val targets = MediaIntegrity.scanTargets(
        Seq("sidewalk_chicago", "sidewalk_seattle"),
        "sidewalk_chicago",
        "seattle-wa",
        configuredCities
      )
      targets("sidewalk_chicago") mustBe ScanTarget.Dir("seattle-wa")
    }

    "not let a second schema claim a directory this instance already writes to" in {
      // Otherwise the other schema lists the same files and reports every one of them as an orphan.
      val targets = MediaIntegrity.scanTargets(
        Seq("sidewalk_chicago", "sidewalk_seattle"),
        "sidewalk_chicago",
        "seattle-wa",
        configuredCities
      )
      // And it has to say which of the two reasons applies: the operator staring at this row on a misconfigured
      // container needs to know the city is configured and its directory was taken, not go hunting for a config gap.
      val reason = unlocatableReason(targets("sidewalk_seattle"))
      reason must include("sidewalk_chicago")
      reason must include("seattle-wa")
    }

    "say plainly when no city on the stage names a schema, rather than guessing at its directory" in {
      val targets =
        MediaIntegrity.scanTargets(Seq("sidewalk_elsewhere"), "sidewalk_chicago", "chicago-il", configuredCities)
      unlocatableReason(targets("sidewalk_elsewhere")) must include("sidewalk_elsewhere")
    }
  }

  "compareCity" should {
    "report a city whose rows all have files as clean" in {
      val result = MediaIntegrity.compareCity(
        "chicago-il",
        "sidewalk_chicago",
        Seq(1, 2),
        DirListing.Listed(Seq("story_1.jpg", "story_2.jpg"))
      )
      result.missing mustBe 0
      result.orphans mustBe 0
      result.rows mustBe 2
      result.scanned mustBe true
    }

    "report a row with no file as missing — the #4925 loss" in {
      val result =
        MediaIntegrity.compareCity("chicago-il", "sidewalk_chicago", Seq(1, 2), DirListing.Listed(Seq("story_1.jpg")))
      result.missing mustBe 1
      result.missingIds mustBe Seq(2)
      result.orphans mustBe 0
    }

    "report a file with no row as orphaned — a retraction whose file delete didn't land" in {
      val result = MediaIntegrity.compareCity(
        "chicago-il",
        "sidewalk_chicago",
        Seq(1),
        DirListing.Listed(Seq("story_1.jpg", "story_7.jpg"))
      )
      result.orphans mustBe 1
      result.orphanIds mustBe Seq(7)
      result.missing mustBe 0
    }

    "count both directions at once, which a row-count comparison alone would call clean" in {
      val result =
        MediaIntegrity.compareCity("chicago-il", "sidewalk_chicago", Seq(1), DirListing.Listed(Seq("story_9.jpg")))
      result.missing mustBe 1
      result.orphans mustBe 1
    }

    "ignore files that aren't story media, so a stray README isn't reported as an orphan" in {
      val result = MediaIntegrity.compareCity(
        "chicago-il",
        "sidewalk_chicago",
        Seq(1),
        DirListing.Listed(Seq("story_1.jpg", "README.txt", "story_1.jpg.bak", "story_.jpg"))
      )
      result.orphans mustBe 0
      result.missing mustBe 0
    }

    "treat an absent city directory as loss, since the write path creates it and never removes it" in {
      val result = MediaIntegrity.compareCity("chicago-il", "sidewalk_chicago", Seq(1, 2), DirListing.Absent)
      result.missing mustBe 2
      result.scanned mustBe true
    }

    "report a city with no rows and no directory as clean rather than as a fault" in {
      val result = MediaIntegrity.compareCity("chicago-il", "sidewalk_chicago", Seq.empty, DirListing.Absent)
      result.missing mustBe 0
      result.orphans mustBe 0
      result.scanned mustBe true
    }

    "decline to call an unreadable directory data loss, and say why it declined" in {
      // A directory this process may not read holds exactly the same photos it held a moment ago. Counting all of
      // them as destroyed would put the fleet's whole story archive on the panel as lost over a permissions change,
      // and a monitor that does that once gets ignored forever after.
      val result = MediaIntegrity.compareCity("chicago-il", "sidewalk_chicago", Seq(1, 2), DirListing.Unreadable)
      result.scanned mustBe false
      result.missing mustBe 0
      result.rows mustBe 2
      result.unscannedReason.value must include("not readable")
    }
  }

  "unscannedCity" should {
    "still report the rows it knows about, so the city doesn't read as empty" in {
      val result = MediaIntegrity.unscannedCity(None, "sidewalk_somewhere", Seq(1, 2), "no city names this schema")
      result.scanned mustBe false
      result.rows mustBe 2
      result.missing mustBe 0
      result.unscannedReason.value mustBe "no city names this schema"
    }
  }

  "listing" should {
    "read a directory's contents" in {
      MediaIntegrity.listing(dirContaining("story_3.jpg")) mustBe DirListing.Listed(Seq("story_3.jpg"))
    }

    "call a path with nothing at it absent, which for a city directory means no upload has landed" in {
      MediaIntegrity.listing(new File("/srv/sidewalk-media/no-such-directory")) mustBe DirListing.Absent
    }

    "call something that is there but won't list unreadable rather than absent" in {
      // `File.list` answers null for both, and the two are opposite verdicts: nothing was ever written here, versus
      // this process cannot see what is here. A regular file is the case a root-running suite can actually provoke.
      val notADirectory = new File(dirContaining("story_3.jpg"), "story_3.jpg")
      MediaIntegrity.listing(notADirectory) mustBe DirListing.Unreadable
    }
  }
}
