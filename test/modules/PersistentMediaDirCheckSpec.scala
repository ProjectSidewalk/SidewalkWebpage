package modules

import modules.PersistentMediaDirCheck.{persistentDirs, unsafeDirs}
import org.scalatestplus.play.PlaySpec
import play.api.{Configuration, Environment, Mode}

import java.io.File
import scala.io.Source
import scala.util.Using

/**
 * The deployment contract behind the media directories: anything irreplaceable — user uploads, imagery that cannot
 * be re-fetched — has to land outside the build output tree, because a deploy deletes that whole tree
 * (`sbt clean`) and rebuilds it (#4925).
 *
 * Nothing else can catch a violation. The configuration that lost a story photo was correct in dev, correct in CI,
 * and destructive in production, and the damage only appeared across a redeploy — which no test spans. So the
 * detection lives in a boot-time check, and this pins the check itself.
 *
 * Pure logic — no app boot and no database.
 */
class PersistentMediaDirCheckSpec extends PlaySpec {

  // The shape a staged deploy actually runs from: the app root is `target/universal/stage`, and the deploy's
  // `sbt clean` deletes everything under `target/`.
  private val appRoot = new File("/srv/sidewalk/target/universal/stage")

  private def env(mode: Mode = Mode.Test): Environment = Environment(appRoot, getClass.getClassLoader, mode)

  /** Every persistent media directory assigned the same path, to isolate what the check does with that path. */
  private def allDirsAt(path: String): Map[String, String] = persistentDirs.map(_.key -> path).toMap

  private def flaggedKeys(dirs: Map[String, String]): Seq[String] =
    unsafeDirs(Configuration.from(dirs), env()).map(_.dir.key)

  "unsafeDirs" should {
    "flag a relative path, which resolves inside the stage directory on a deployed stage" in {
      val flagged = unsafeDirs(Configuration.from(allDirsAt(".story-media")), env())
      flagged.map(_.dir.key) must contain theSameElementsAs persistentDirs.map(_.key)
      flagged.foreach(_.reason must include("/srv/sidewalk/target/universal/stage/.story-media"))
    }

    "flag an absolute path inside the stage directory" in {
      flaggedKeys(allDirsAt("/srv/sidewalk/target/universal/stage/media")) must not be empty
    }

    "flag a relative path that climbs out of stage/ but not out of the build tree, which sbt clean still deletes" in {
      flaggedKeys(allDirsAt("../media")) must not be empty
    }

    "flag an absolute path elsewhere in the build tree" in {
      flaggedKeys(allDirsAt("/srv/sidewalk/target/media")) must not be empty
    }

    "flag a value that is set but empty, which a deployment template with a blank env var line produces" in {
      val flagged = unsafeDirs(Configuration.from(allDirsAt("")), env())
      flagged.map(_.dir.key) must contain theSameElementsAs persistentDirs.map(_.key)
      flagged.foreach(_.reason must include("set but empty"))
    }

    "accept an absolute path on separate storage" in {
      flaggedKeys(allDirsAt("/srv/sidewalk-media")) mustBe empty
    }

    "accept a relative path that climbs out of the build tree entirely" in {
      flaggedKeys(allDirsAt("../../../../media")) mustBe empty // resolves to /srv/media
    }

    "treat the application root as the danger zone when it is not inside a build tree" in {
      val bareRoot = Environment(new File("/srv/app"), getClass.getClassLoader, Mode.Test)
      unsafeDirs(Configuration.from(allDirsAt(".story-media")), bareRoot) must not be empty
      unsafeDirs(Configuration.from(allDirsAt("../media")), bareRoot) mustBe empty
    }
  }

  "the fatal set" should {
    // Refusing to boot is only justified for bytes no rebuild can recreate: the story photos users gave us, imagery
    // the providers no longer serve, and the label crops, each captured once in a labeler's browser. Cached share
    // previews rebuild on demand, so that one must stay warn-only.
    "be exactly the irreplaceable directories" in {
      persistentDirs.filter(_.irreplaceable).map(_.key) mustBe
        Seq("cropped.image.directory", "pano.images.directory", "story.media.directory")
    }

    // The failure message tells the operator which variable to set. If this mapping drifts from application.conf,
    // it directs them — during an outage — to set a variable the config never reads.
    "name each directory's real config key and env var, as bound in application.conf" in {
      val conf = Using.resource(Source.fromFile("conf/application.conf"))(_.mkString)
      persistentDirs.foreach { dir =>
        withClue(s"${dir.key} <- ${dir.envVar}: ") {
          conf must include(s"${dir.key} = $${?${dir.envVar}}")
        }
      }
    }
  }

  // Every stage runs this at boot, so a mistake here takes cities offline. These pin which configurations are
  // allowed to stop a stage from starting and, just as importantly, which are not.
  "the boot check" should {
    "refuse to start a prod-mode app whose story media would land in the build tree" in {
      val thrown = the[IllegalStateException] thrownBy
        runCheck(Mode.Prod, safeDirs ++ Map("story.media.directory" -> ".story-media"))
      thrown.getMessage must include("SIDEWALK_STORY_MEDIA_DIR")
    }

    "refuse to start a prod-mode app whose pano store would land in the build tree" in {
      val thrown = the[IllegalStateException] thrownBy
        runCheck(Mode.Prod, safeDirs ++ Map("pano.images.directory" -> ".panos"))
      thrown.getMessage must include("SIDEWALK_PANO_DIR")
    }

    "arm on the run mode alone, so an env file that also forgot ENV_TYPE cannot disarm it" in {
      an[IllegalStateException] must be thrownBy
        runCheck(Mode.Prod, safeDirs ++ Map("story.media.directory" -> ".story-media", "environment-type" -> "local"))
    }

    "let a prod-mode app start when only derived content is misplaced, since a rebuild can recreate it" in {
      noException must be thrownBy runCheck(
        Mode.Prod,
        allDirsAt(".crops") ++ allDirsAt("/srv/sidewalk-media").view.filterKeys(fatalKeys.contains).toMap
      )
    }

    "let a prod-mode app start when every directory is on separate storage" in {
      noException must be thrownBy runCheck(Mode.Prod, safeDirs)
    }

    "stay out of the way in dev and test runs, where the application root is the repo checkout" in {
      Seq(Mode.Dev, Mode.Test).foreach { mode => noException must be thrownBy runCheck(mode, allDirsAt(".panos")) }
    }
  }

  private val safeDirs: Map[String, String] = allDirsAt("/srv/sidewalk-media")

  private val fatalKeys: Set[String] = persistentDirs.filter(_.irreplaceable).map(_.key).toSet

  private def runCheck(mode: Mode, dirs: Map[String, String]): Unit = {
    val _ = new PersistentMediaDirCheck(Configuration.from(dirs), Environment(appRoot, getClass.getClassLoader, mode))
  }
}
