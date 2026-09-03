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
   * 344's backfill relies on — its dedupe suffix uses '--' so backfilled slugs can't collide with runtime ones.
   *
   * @param name     The raw name (any script, any punctuation).
   * @param fallback What to return when nothing usable remains (e.g. all punctuation).
   * @return The slug, capped at MaxSlugLength; `fallback` if nothing usable remains.
   */
  def slugify(name: String, fallback: String = "route"): String = {
    val slug: String = foldToSlugChars(name)
      .replaceAll("-+", "-") // Collapse separator runs, the invariant above.
      .replaceAll("^-+|-+$", "")
      .take(MaxSlugLength)
      .replaceAll("-+$", "") // The length cap can leave a trailing dash behind.
    if (slug.isEmpty) fallback else slug
  }

  /**
   * Canonicalizes a slug taken from a /r/<slug> URL so a retyped share link still resolves.
   *
   * People retype share links from the route's name, which reintroduces the capitals and spaces slugify removed
   * ("/r/Demo-for-Yochai", "/r/Demo for Yochai"), so lookups fold the URL rather than matching it byte for byte.
   * Deliberately does NOT collapse separator runs or apply the length cap, both of which would corrupt real
   * slugs: evolution 344's backfill deduped with a '--<route_id>' suffix, and the uniquifier's "-2" suffix can
   * push a slug past MaxSlugLength. The result is still an equality lookup, so it uses the unique index on
   * route.slug rather than scanning, and callers try it only after the literal slug — the backfill kept
   * diacritics that this fold strips, so a slug predating 344 must get its byte-for-byte chance first.
   *
   * @param slug The slug as it arrived in the URL (Play has already percent-decoded it).
   * @return The canonical form to match stored slugs against; empty if nothing usable remains.
   */
  def canonicalizeForLookup(slug: String): String = {
    foldToSlugChars(slug).replaceAll("^-+|-+$", "")
  }

  /** Lowercases, strips Latin diacritics, and turns every other non-alphanumeric character into a dash. */
  private def foldToSlugChars(text: String): String = {
    Normalizer
      .normalize(text, Normalizer.Form.NFD)
      .replaceAll("\\p{M}", "") // Drop the combining marks NFD split off, turning é into e.
      .toLowerCase(Locale.ROOT)
      .replaceAll("[^\\p{L}\\p{N}]", "-")
  }
}
