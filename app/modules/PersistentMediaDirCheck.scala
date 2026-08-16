package modules

import modules.PersistentMediaDirCheck.unsafeDirs
import play.api.{Configuration, Environment, Logger, Mode}
import service.MediaDirs

import java.io.File
import java.nio.file.Path
import javax.inject.{Inject, Singleton}
import scala.util.{Failure, Success, Try}

/**
 * Boot-time check that the directories holding data which must outlive a deploy actually sit outside the tree the
 * deploy destroys.
 *
 * A deploy rebuilds the build output tree from scratch (`sbt clean stage`) and the staged app runs from inside it,
 * so a media path that resolves within that tree is deleted by the next release along with whatever users put
 * there — silently, since the database rows survive and the missing bytes only ever surface as a 404. A story photo
 * was lost exactly that way (#4925), and nothing but a comment in `application.conf` was guarding against it.
 *
 * The check arms in prod mode — what every staged binary runs in, deployed or not — rather than on
 * `environment-type`: ENV_TYPE arrives through the same hand-maintained env file as the media variables, so an
 * incomplete file (the #4925 failure) would disarm the guard exactly when it is needed. Dev and test runs skip it;
 * there the application root is the hand-managed repo checkout, where the relative defaults are the point.
 *
 * A directory holding irreplaceable bytes — user uploads, or our only copies of provider-expired imagery — is
 * **fatal**: refusing to boot is far cheaper than accepting content we already know will be destroyed, and the test
 * stage redeploys on every push to `develop` while prod waits for a release tag, so a missing variable surfaces on
 * test long before it can reach prod. The rest is derived data whose loss costs rebuild time, so it logs and lets
 * the app run.
 */
@Singleton
class PersistentMediaDirCheck @Inject() (config: Configuration, environment: Environment) {
  private val logger = Logger(this.getClass)

  if (environment.mode == Mode.Prod) {
    val unsafe = unsafeDirs(config, environment)
    unsafe.foreach(u => logger.error(u.reason))

    val fatal = unsafe.map(_.dir).filter(_.irreplaceable)
    if (fatal.nonEmpty) {
      throw new IllegalStateException(
        s"Refusing to start: ${fatal.map(_.key).mkString(", ")} cannot safely hold irreplaceable content (see " +
          s"errors above). Set ${fatal.map(_.envVar).mkString(", ")} to a path outside the build output tree."
      )
    }
  }
}

/**
 * The check's pure logic, split from the boot wiring so `PersistentMediaDirCheckSpec` can pin it — which
 * configurations may stop a stage from starting, and which must not — without booting an application.
 */
object PersistentMediaDirCheck {

  /**
   * A directory whose contents a deploy must not take with it.
   *
   * @param key           Config key naming the directory.
   * @param envVar        Environment variable a deployment sets it with, named in the failure message so the fix
   *                      doesn't require reading the config.
   * @param irreplaceable Whether it holds bytes no rebuild can recreate — user uploads, or the only surviving copy
   *                      of provider-expired imagery. These form the fatal tier; the rest only log.
   */
  case class PersistentDir(key: String, envVar: String, irreplaceable: Boolean)

  /** A persistent directory that failed the check, with the loggable reason. */
  case class UnsafeDir(dir: PersistentDir, reason: String)

  val persistentDirs: Seq[PersistentDir] = Seq(
    // Crops and share previews are derived: a crop can be re-cut from pano imagery and a share preview rebuilds on
    // demand, so losing them costs rebuild time, not content.
    PersistentDir("cropped.image.directory", "SIDEWALK_IMAGES_DIR", irreplaceable = false),
    PersistentDir("share.image.directory", "SIDEWALK_SHARE_IMAGES_DIR", irreplaceable = false),
    // The self-hosted pano store backs up GSV imagery Google has already expired (pano_data.has_backup) — for those
    // panos it is the only copy left anywhere, as unrecoverable as a user upload.
    PersistentDir("pano.images.directory", "SIDEWALK_PANO_DIR", irreplaceable = true),
    PersistentDir("story.media.directory", "SIDEWALK_STORY_MEDIA_DIR", irreplaceable = true)
  )

  /**
   * The persistent directories a deploy would destroy — or whose configured value is unusable — with a loggable
   * reason each.
   *
   * The danger zone is the whole build output tree, not just the stage directory the app runs from: the deploy's
   * `sbt clean` deletes all of `target/`, so a path that merely climbs out of `stage/` (e.g. `../media`, which lands
   * in `target/universal/`) is still destroyed. When the application root has no `target/` ancestor — dev checkouts,
   * unzipped dists — the root itself is the danger zone.
   *
   * @param config      Application configuration.
   * @param environment Play environment supplying the application root, the anchor `MediaDirs` resolves against.
   * @return            One entry per unsafe directory, in `persistentDirs` order; empty when every directory is safe.
   */
  def unsafeDirs(config: Configuration, environment: Environment): Seq[UnsafeDir] = {
    val wipeZone = canonicalize(wipeZoneFor(environment.rootPath))
    persistentDirs.flatMap { dir =>
      Try(MediaDirs.baseDir(config, environment, dir.key)) match {
        // An unusable value (e.g. set but blank): the write paths would throw the same error at runtime, so surface
        // it here, where the message reaches the operator before any upload is attempted.
        case Failure(e)        => Some(UnsafeDir(dir, e.getMessage))
        case Success(resolved) =>
          Option.when(canonicalize(resolved).startsWith(wipeZone))(
            UnsafeDir(
              dir,
              s"${dir.key} resolves to $resolved, inside the build output tree that a deploy deletes and rebuilds " +
                s"(`sbt clean stage`) — everything stored there is destroyed by the next release. Point it at " +
                s"storage outside the application; see docs/deployment-and-stages.md."
            )
          )
      }
    }
  }

  /** The tree the deploy destroys: the enclosing `target/` build tree when the app runs from one, else the root. */
  private def wipeZoneFor(appRoot: File): File =
    Iterator
      .iterate(appRoot.getAbsoluteFile)(_.getParentFile)
      .takeWhile(_ != null)
      .find(_.getName == "target")
      .getOrElse(appRoot)

  /**
   * Canonicalizes best-effort, as a `Path` for prefix testing. Canonicalization does disk I/O (existing path
   * components get resolved on the filesystem), so a broken mount can make it throw — and a guard against data loss
   * must never itself take a healthy city down over an unreadable path. The fallback normalizes lexically, which
   * yields the same containment verdicts whenever no symlink is involved — which is every deployment we run.
   */
  private def canonicalize(file: File): Path =
    Try(file.getCanonicalFile.toPath).getOrElse(file.toPath.toAbsolutePath.normalize)
}
