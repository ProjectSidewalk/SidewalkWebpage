package service

import play.api.{Configuration, Environment}

import java.io.File

/**
 * The one resolver for the persistent media directories (`story.media.directory`, `pano.images.directory`,
 * `cropped.image.directory`, `share.image.directory`).
 *
 * Every consumer that reads or writes media must resolve its configured path through here, and so does
 * `PersistentMediaDirCheck`: the boot check's verdict is only meaningful while it models the exact resolution the
 * write paths use, and a second hand-rolled resolver would drift from it silently (#4925). A relative path resolves
 * against the application root rather than the process working directory — the two coincide in every run mode we
 * use, but only the root is an anchor Play defines.
 */
object MediaDirs {

  /**
   * The base directory a media config key points at, before any per-city subdirectory.
   *
   * @param config      Application configuration.
   * @param environment Play environment supplying the application root that relative paths resolve against.
   * @param key         Config key naming the directory.
   * @return            The configured directory: absolute as-is, relative resolved against the application root.
   */
  def baseDir(config: Configuration, environment: Environment, key: String): File = {
    val configured = config.get[String](key).trim
    // A blank value usually means a deployment template emitted `SOME_VAR=` with nothing after it, which the
    // `${?VAR}` substitution swallows the default for. Resolving "" would target the filesystem root once a city id
    // is appended, so fail loudly instead.
    if (configured.isEmpty) {
      throw new IllegalArgumentException(s"$key is set but empty — set its env var to a real path, or unset it.")
    }
    val file = new File(configured)
    if (file.isAbsolute) file else new File(environment.rootPath, configured)
  }

  /** The per-city directory under a media config key: `<baseDir>/<city-id>`. */
  def cityDir(config: Configuration, environment: Environment, key: String): File =
    new File(baseDir(config, environment, key), config.get[String]("city-id"))
}
