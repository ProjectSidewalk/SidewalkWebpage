package service

/**
 * Per-page SEO metadata passed into views.common.main (issue #4237).
 *
 * The all-defaults instance keeps existing callers source-compatible; pages opt in by overriding individual fields.
 *
 * @param description      Already-localized meta/OG description. None falls back to the site-wide default for the city.
 * @param canonicalPath    Path to canonicalize to (e.g. "/label/123"). None derives it from the request path.
 * @param customSocialMeta True when the page injects its own OG/Twitter block via extraHead (e.g. shared-label pages),
 *                         which suppresses the layout's default description/OG/Twitter tags to avoid duplicates.
 */
case class PageMeta(
    description: Option[String] = None,
    canonicalPath: Option[String] = None,
    customSocialMeta: Boolean = false
)
