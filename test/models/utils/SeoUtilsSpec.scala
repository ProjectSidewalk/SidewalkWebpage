package models.utils

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pure (no DB, no app boot) tests for the SEO URL helpers behind seoHead, robots.txt, and the sitemap (#4237).
 */
class SeoUtilsSpec extends AnyFunSuite with Matchers {

  private val prodUrl = "https://sidewalk-sea.cs.washington.edu"

  test("canonicalPathFor collapses every duplicate route alias to its canonical path") {
    SeoUtils.canonicalPathFor("/home") shouldBe "/"
    SeoUtils.canonicalPathFor("/developer") shouldBe "/api"
    SeoUtils.canonicalPathFor("/v3/api-docs") shouldBe "/api"
    SeoUtils.canonicalPathFor("/citiesDashboard") shouldBe "/cities"
    SeoUtils.canonicalPathFor("/labelmap") shouldBe "/labelMap"
    SeoUtils.canonicalPathFor("/labelingguide") shouldBe "/labelingGuide"
    SeoUtils.canonicalPathFor("/audit") shouldBe "/explore"
    SeoUtils.canonicalPathFor("/adminValidate") shouldBe "/expertValidate"
  }

  test("canonicalPathFor passes non-alias paths through unchanged") {
    SeoUtils.canonicalPathFor("/explore") shouldBe "/explore"
    SeoUtils.canonicalPathFor("/v3/api-docs/rawLabels") shouldBe "/v3/api-docs/rawLabels"
    SeoUtils.canonicalPathFor("/") shouldBe "/"
  }

  test("canonicalUrl joins the prod base and canonical path without doubled or trailing slashes") {
    SeoUtils.canonicalUrl(prodUrl, "/explore") shouldBe s"$prodUrl/explore"
    SeoUtils.canonicalUrl(s"$prodUrl/", "/explore") shouldBe s"$prodUrl/explore"
    SeoUtils.canonicalUrl(prodUrl, "/home") shouldBe s"$prodUrl/"
    // The root keeps its trailing slash — the one canonical spelling of the landing page, shared with the sitemap.
    SeoUtils.canonicalUrl(prodUrl, "/") shouldBe s"$prodUrl/"
  }

  test("robotsDisallowedAliases covers the alias set except /v3/api-docs (a prefix of canonical doc pages)") {
    SeoUtils.robotsDisallowedAliases should not contain "/v3/api-docs"
    SeoUtils.robotsDisallowedAliases should contain allOf ("/home", "/developer", "/citiesDashboard", "/labelmap",
      "/labelingguide", "/audit", "/adminValidate")
    // Every disallowed alias must actually be an alias (canonicalize to something other than itself).
    SeoUtils.robotsDisallowedAliases.foreach { alias => SeoUtils.canonicalPathFor(alias) should not be alias }
  }

  test("apiDocsTitle appends the shared API-docs brand suffix") {
    SeoUtils.apiDocsTitle("Raw Labels API") shouldBe "Raw Labels API — Project Sidewalk API Docs"
  }
}
