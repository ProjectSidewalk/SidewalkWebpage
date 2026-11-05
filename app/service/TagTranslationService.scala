package service

import play.api.i18n.{Lang, Langs}
import play.api.libs.json.{JsObject, JsString, Json}
import play.api.{Environment, Logger}

import java.io.InputStream
import javax.inject.{Inject, Singleton}
import scala.collection.concurrent.TrieMap
import scala.util.Using

/**
 * Translates label tag names for server-rendered text (#4445), reading the same `public/locales/<lang>/common.json`
 * tag map that i18next uses in the browser.
 *
 * Tags are stored in the DB as English strings and translated only client-side, so anything the server renders itself
 * (the share page's `og:description`, which crawlers read without running JS) would otherwise print English tags inside
 * a localized sentence. Reading the i18next files keeps one source of truth for tag translations rather than copying
 * ~80 tags into every `conf/messages` file.
 *
 * Resolution mirrors `AppManager._setupI18next` so a tag reads the same on both sides:
 *   - the key is `tag.<name>` with `:` replaced by `-` (i18next reads `:` as a namespace separator);
 *   - languages are tried in i18next's order: the requested one, its bare language if that is also offered (`en-US`
 *     → `en`), then `en`; plain `pt` is never tried for `pt-BR` because the site doesn't offer it;
 *   - in each language a country overlay (`common-india.json`, `common-zurich.json`) wins over `common.json`;
 *   - a value's `$t(common:tag.<other>)` nesting is expanded in the same language chain.
 * A tag with no translation anywhere comes back as its raw English name.
 *
 * Files are read once per language and cached for the life of the process: assets never change under a running app.
 *
 * Usage:
 * {{{
 *   tagTranslationService.translate("bumpy", Lang("es"), countryId = "mexico") // "textura irregular"
 * }}}
 */
@Singleton
class TagTranslationService @Inject() (environment: Environment, langs: Langs) {
  private val logger = Logger(this.getClass)

  // (language code, file name) -> that file's `tag` object; an absent or unreadable file caches as empty.
  private val tagMaps = TrieMap.empty[(String, String), Map[String, String]]

  private val supportedCodes: Set[String] = langs.availables.map(_.code).toSet

  // Matches the nesting i18next expands, e.g. `$t(common:tag.parked car)`. Only tag references occur in tag values.
  private val NestingPattern = """\$t\((?:common:)?tag\.([^)]*)\)""".r

  /**
   * Translates one tag name into the reader's language.
   *
   * @param tag       The tag as stored in the DB, e.g. "bumpy" or "cycle lane: parked car".
   * @param lang      The request's language.
   * @param countryId The deployment's country id (`CityInfo.countryId`), which selects the client's country overlay.
   * @return The translated tag name, or `tag` itself when no translation exists.
   */
  def translate(tag: String, lang: Lang, countryId: String): String =
    resolve(tag, languageChain(lang), overlayFor(countryId), depth = 0)

  /**
   * The languages i18next consults for `lang`, most specific first, always ending in English.
   *
   * @param lang The request's language.
   * @return Language codes to try in order, e.g. `Seq("en-US", "en")`.
   */
  private[service] def languageChain(lang: Lang): Seq[String] =
    (Seq(lang.code, lang.language).filter(supportedCodes.contains) :+ "en").distinct

  /**
   * The suffix of the country overlay namespace. Duplicates the country -> overlay mapping in
   * `frontend/js/common/AppManager.js` (`_setupI18next`, both the namespace list and the merge): a new overlay must be
   * added there and here, or the share page and the browser will name the same tag differently.
   */
  private def overlayFor(countryId: String): Option[String] = countryId match {
    case "india"       => Some("india")
    case "switzerland" => Some("zurich")
    case _             => None
  }

  /** First translation of `tag` along `chain`, with nested `$t(...)` references expanded; depth guards a cycle. */
  private def resolve(tag: String, chain: Seq[String], overlay: Option[String], depth: Int): String = {
    val key: String = tag.replace(':', '-')
    chain.iterator.flatMap(code => lookup(code, key, overlay)).nextOption() match {
      case Some(value) if depth < 5 =>
        NestingPattern.replaceAllIn(
          value,
          m => scala.util.matching.Regex.quoteReplacement(resolve(m.group(1), chain, overlay, depth + 1))
        )
      case Some(value) => value
      case None        => tag
    }
  }

  /** One language's translation of a tag key, the country overlay taking precedence as the client merges it. */
  private def lookup(code: String, key: String, overlay: Option[String]): Option[String] =
    overlay.flatMap(o => tagMap(code, s"common-$o").get(key)).orElse(tagMap(code, "common").get(key))

  /** The `tag` object of `public/locales/<code>/<file>.json`, read once and cached. */
  private def tagMap(code: String, file: String): Map[String, String] =
    tagMaps.getOrElseUpdate((code, file), readTagMap(s"public/locales/$code/$file.json"))

  /**
   * Reads a locale file's `tag` object. Tries the classpath first, which is where a staged build packages `public/`
   * (the assets jar Play's own Assets controller serves from), then the file on disk for a dev checkout.
   */
  private def readTagMap(path: String): Map[String, String] = {
    val stream: Option[InputStream] = environment
      .resourceAsStream(path)
      .orElse(environment.getExistingFile(path).map(f => java.nio.file.Files.newInputStream(f.toPath)))
    stream match {
      case None     => Map.empty // Most country overlays exist only in English; a missing file is normal.
      case Some(in) =>
        Using(in)(s => Json.parse(s)).fold(
          e => {
            logger.warn(s"Could not parse $path; tags in that language fall back. ${e.getMessage}")
            Map.empty
          },
          // An overlay such as en-US holds only the keys that differ, so a file with no tag object is normal too.
          json =>
            (json \ "tag")
              .asOpt[JsObject]
              .map(_.fields.collect { case (k, JsString(v)) => k -> v }.toMap)
              .getOrElse(Map.empty)
        )
    }
  }
}
