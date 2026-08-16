package modules

import modules.PersistentMediaDirCheck.{unsafeDirs, MediaDir}
import play.api.{Configuration, Environment, Logger}

import java.io.File
import javax.inject.{Inject, Singleton}

/**
 * Boot-time check that the directories holding data which must outlive a deploy actually sit outside the application
 * directory.
 *
 * A deployed app runs from the directory the deploy rebuilds, so a media path that resolves inside it is deleted by
 * the next release along with whatever users put there — silently, since the database rows survive and the missing
 * bytes only ever surface as a 404. A story photo was lost exactly that way (#4925), and nothing but a comment in
 * `application.conf` was guarding against it.
 *
 * Only a deployed stage can be misconfigured this way, so the check is skipped for `environment-type = local`: in dev
 * the application directory is the hand-managed repo checkout, where the relative defaults are the point.
 *
 * A directory holding irreplaceable user uploads is **fatal** — refusing to boot is far cheaper than accepting
 * uploads we already know will be destroyed, and the test stage redeploys on every push to `develop` while prod waits
 * for a release tag, so a missing variable surfaces on test long before it can reach prod. The rest are derived or
 * cached data whose loss costs rebuild time rather than user content, so they log and let the app run.
 */
@Singleton
class PersistentMediaDirCheck @Inject() (config: Configuration, environment: Environment) {
  private val logger = Logger(this.getClass)

  if (config.get[String]("environment-type") != "local") {
    val unsafe = unsafeDirs(config, environment.rootPath)
    unsafe.foreach { case MediaDir(dir, resolved) =>
      logger.error(
        s"${dir.key} resolves to $resolved, inside the application directory. A deploy rebuilds that directory " +
          s"from scratch, so everything stored there is destroyed by the next release. Point it at storage " +
          s"outside the application directory — see docs/deployment-and-stages.md."
      )
    }

    val holdingUserUploads = unsafe.map(_.dir).filter(_.holdsUserUploads)
    if (holdingUserUploads.nonEmpty) {
      throw new IllegalStateException(
        s"Refusing to start: ${holdingUserUploads.map(_.key).mkString(", ")} would store user uploads in the " +
          s"application directory, which the next deploy deletes. Set " +
          s"${holdingUserUploads.map(_.envVar).mkString(", ")} to a path outside it."
      )
    }
  }
}

object PersistentMediaDirCheck {

  /**
   * A directory whose contents a deploy must not take with it.
   *
   * @param key             Config key naming the directory.
   * @param envVar          Environment variable a deployment sets it with, named in the failure message so the fix
   *                        doesn't require reading the config.
   * @param holdsUserUploads Whether it holds content a user gave us, which no rebuild can recreate.
   */
  case class PersistentDir(key: String, envVar: String, holdsUserUploads: Boolean)

  /** A configured directory paired with where it actually resolved. */
  case class MediaDir(dir: PersistentDir, resolved: File)

  val persistentDirs: Seq[PersistentDir] = Seq(
    PersistentDir("cropped.image.directory", "SIDEWALK_IMAGES_DIR", holdsUserUploads = false),
    PersistentDir("pano.images.directory", "SIDEWALK_PANO_DIR", holdsUserUploads = false),
    PersistentDir("share.image.directory", "SIDEWALK_SHARE_IMAGES_DIR", holdsUserUploads = false),
    PersistentDir("story.media.directory", "SIDEWALK_STORY_MEDIA_DIR", holdsUserUploads = true)
  )

  /**
   * The persistent directories that resolve inside the application directory, and so will be destroyed by the next
   * deploy. A relative path is resolved against the application directory, which is also the working directory a
   * staged app runs from — so this is where `java.io.File` would put it.
   *
   * @param config  Application configuration.
   * @param appRoot The application directory (`Environment.rootPath`).
   * @return        One entry per unsafe directory, in config-key order; empty when every directory is safe.
   */
  def unsafeDirs(config: Configuration, appRoot: File): Seq[MediaDir] = {
    val root = appRoot.getCanonicalFile
    persistentDirs.flatMap { dir =>
      val configured = new File(config.get[String](dir.key))
      val resolved   = (if (configured.isAbsolute) configured else new File(root, configured.getPath)).getCanonicalFile
      Option.when(resolved.toPath.startsWith(root.toPath))(MediaDir(dir, resolved))
    }
  }
}
