package modules

import modules.PersistentMediaDirCheck.{persistentDirs, unsafeDirs}
import org.scalatestplus.play.PlaySpec
import play.api.{Configuration, Environment, Mode}

import java.io.File

/**
 * The deployment contract behind the media directories: anything a user uploads has to land outside the application
 * directory, because a deploy rebuilds that directory and deletes everything under it (#4925).
 *
 * Nothing else can catch a violation. The configuration that lost a story photo was correct in dev, correct in CI,
 * and destructive in production, and the damage only appeared across a redeploy — which no test spans. So the
 * detection lives in a boot-time check, and this pins the check itself.
 *
 * Pure logic — no app boot and no database.
 */
class PersistentMediaDirCheckSpec extends PlaySpec {

  private val appRoot = new File("/srv/app/stage")

  /** A config assigning every persistent media directory the same path, to isolate what the check does with it. */
  private def configWithAllDirsAt(path: String): Configuration =
    Configuration.from(persistentDirs.map(_.key -> path).toMap)

  "unsafeDirs" should {
    "flag a relative path, which resolves inside the application directory on a deployed stage" in {
      val flagged = unsafeDirs(configWithAllDirsAt(".story-media"), appRoot)
      flagged.map(_.dir.key) must contain theSameElementsAs persistentDirs.map(_.key)
      flagged.foreach(_.resolved.getPath mustBe "/srv/app/stage/.story-media")
    }

    "flag an absolute path that still points inside the application directory" in {
      unsafeDirs(configWithAllDirsAt("/srv/app/stage/media"), appRoot) must not be empty
    }

    "accept an absolute path on separate storage" in {
      unsafeDirs(configWithAllDirsAt("/srv/sidewalk/images"), appRoot) mustBe empty
    }

    "accept a relative path that climbs out of the application directory" in {
      unsafeDirs(configWithAllDirsAt("../media"), appRoot) mustBe empty
    }
  }

  "the fatal set" should {
    // Refusing to boot is only justified for content no rebuild can recreate. Crops, panoramas and share previews
    // are derived data: losing them costs rebuild time, not a user's photo, so they must stay warn-only.
    "be exactly the directories holding user uploads" in {
      persistentDirs.filter(_.holdsUserUploads).map(_.key) mustBe Seq("story.media.directory")
    }

    "name the environment variable that fixes each one, since that is what the operator has to set" in {
      persistentDirs.foreach(dir => dir.envVar must startWith("SIDEWALK_"))
    }
  }

  // Every stage in the deployment runs this at boot, so a mistake here takes cities offline. These pin which
  // configurations are allowed to stop a stage from starting and, just as importantly, which are not.
  "the boot check" should {
    "refuse to start a deployed stage whose story media would land in the application directory" in {
      val thrown = the[IllegalStateException] thrownBy runCheck("prod", safeDirs ++ storyMediaAt(".story-media"))
      thrown.getMessage must include("SIDEWALK_STORY_MEDIA_DIR")
    }

    "let a deployed stage start when only derived content is misplaced, since a rebuild can recreate it" in {
      noException must be thrownBy runCheck(
        "prod",
        persistentDirs.map(_.key -> ".crops").toMap ++ storyMediaAt("/srv/sidewalk/story-media")
      )
    }

    "let a deployed stage start when every directory is on separate storage" in {
      noException must be thrownBy runCheck("test", safeDirs)
    }

    "stay out of the way locally, where the application directory is the repo checkout" in {
      noException must be thrownBy runCheck("local", persistentDirs.map(_.key -> ".story-media").toMap)
    }
  }

  private val safeDirs: Map[String, String] = persistentDirs.map(_.key -> "/srv/sidewalk/images").toMap

  private def storyMediaAt(path: String): Map[String, String] = Map("story.media.directory" -> path)

  private def runCheck(envType: String, dirs: Map[String, String]): Unit = {
    val config = Configuration.from(dirs + ("environment-type" -> envType))
    val _      = new PersistentMediaDirCheck(config, Environment(appRoot, getClass.getClassLoader, Mode.Test))
  }
}
