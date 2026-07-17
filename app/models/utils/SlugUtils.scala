package models.utils

import java.text.Normalizer
import java.util.Locale

/**
 * Generates URL-friendly slugs from user-supplied names (e.g. route names for /r/<slug> share links).
 *
 * Latin diacritics are stripped ("Café" -> "cafe") but other Unicode letters/digits are kept, so names in
 * non-Latin scripts (e.g. zh-TW) still produce meaningful slugs; browsers percent-encode them transparently.
 */
object SlugUtils {

  /** Maximum slug length, excluding any uniqueness suffix appended by callers. */
  val MaxSlugLength: Int = 60

  /**
   * Converts a name to a lowercase, dash-separated slug.
   *
   * Invariant: the output never contains consecutive dashes (separator runs collapse to one), which evolution
   * 337's backfill relies on — its dedupe suffix uses '--' so backfilled slugs can't collide with runtime ones.
   *
   * @param name The raw name (any script, any punctuation).
   * @return The slug, capped at MaxSlugLength; "route" if nothing usable remains (e.g. all punctuation).
   */
  def slugify(name: String): String = {
    val slug: String = Normalizer
      .normalize(name, Normalizer.Form.NFD)
      .replaceAll("\\p{M}", "") // Drop the combining marks NFD split off, turning é into e.
      .toLowerCase(Locale.ROOT)
      .replaceAll("[^\\p{L}\\p{N}]+", "-")
      .replaceAll("^-+|-+$", "")
      .take(MaxSlugLength)
      .replaceAll("-+$", "") // The length cap can leave a trailing dash behind.
    if (slug.isEmpty) "route" else slug
  }
}
