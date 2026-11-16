package models.partner

import util.SidewalkSpec

import java.time.OffsetDateTime

/**
 * Pins how the /about page's logo grid (#5980) collapses the shared partner table, which holds one row per
 * organization per city, into one logo per organization.
 */
class PartnerMetadataSpec extends SidewalkSpec {

  private def row(
      id: Int,
      cityId: Option[String],
      name: String,
      displayOrder: Int = 0,
      url: Option[String] = None,
      altText: Option[String] = None
  ) = PartnerMetadata(id, cityId, name, url, altText, displayOrder, 800, 200, OffsetDateTime.now)

  private def group(rows: Seq[PartnerMetadata]) = PartnerMetadata.groupForAbout(rows)

  "PartnerMetadata.groupForAbout" should {
    "show an organization once, ignoring case and spacing (no-break spaces too), with its lowest-id row" in {
      val (projectWide, others) = group(
        Seq(
          row(7, Some("seattle"), "Public Nudge"),
          row(3, Some("chicago"), " public  nudge"),
          row(5, Some("newberg"), "PUBLIC NUDGE"),
          row(6, Some("cdmx"), "Public\u00a0Nudge")
        )
      )
      projectWide mustBe empty
      others.map(_.partnerId) mustBe Seq(3)
    }

    "list an organization with project-wide and city rows in both groups, each with its own row's logo" in {
      val (projectWide, others) = group(
        Seq(row(1, Some("seattle"), "SciStarter"), row(9, None, "scistarter"), row(4, Some("chicago"), "Easterseals"))
      )
      projectWide.map(_.partnerId) mustBe Seq(9)
      others.map(_.partnerId) mustBe Seq(4, 1)
    }

    "keep an organization with only project-wide rows out of the city group" in {
      val (projectWide, others) = group(Seq(row(9, None, "SciStarter"), row(4, Some("chicago"), "Easterseals")))
      projectWide.map(_.partnerId) mustBe Seq(9)
      others.map(_.partnerId) mustBe Seq(4)
    }

    "keep the lowest-id row when an organization has two project-wide rows" in {
      val (projectWide, _) = group(Seq(row(8, None, "SciStarter"), row(6, None, "SciStarter")))
      projectWide.map(_.partnerId) mustBe Seq(6)
    }

    "order project-wide partners as the admins did and the rest alphabetically, ignoring case" in {
      val (projectWide, others) = group(
        Seq(
          row(1, None, "Zeta Foundation", displayOrder = 0),
          row(2, None, "Alpha Fund", displayOrder = 1),
          row(3, Some("seattle"), "walkable Seattle"),
          row(4, Some("chicago"), "Active Transportation Alliance"),
          row(5, Some("cdmx"), "Liga Peatonal")
        )
      )
      projectWide.map(_.name) mustBe Seq("Zeta Foundation", "Alpha Fund")
      others.map(_.name) mustBe Seq("Active Transportation Alliance", "Liga Peatonal", "walkable Seattle")
    }

    "include every city's partners, whatever the city's status" in {
      val (projectWide, others) = group(
        Seq(row(1, Some("taipei"), "Public Nudge"), row(2, Some("zurich"), "iNovitas"), row(5, None, "SciStarter"))
      )
      projectWide.map(_.partnerId) mustBe Seq(5)
      others.map(_.partnerId) mustBe Seq(2, 1)
    }

    "take a missing URL or alt text from a sibling row, lowest id first" in {
      val (projectWide, others) = group(
        Seq(
          row(3, Some("seattle"), "Public Nudge"),
          row(4, Some("taipei"), "Public Nudge", url = Some("https://publicnudge.org/")),
          row(7, Some("chicago"), "Public Nudge", url = Some("https://other.example/"), altText = Some("PN")),
          row(9, Some("cdmx"), "Public Nudge", url = Some("https://later.example/"), altText = Some("Later")),
          row(10, None, "SciStarter"),
          row(2, Some("seattle"), "scistarter", url = Some("https://scistarter.org/"))
        )
      )
      others.map(p => (p.partnerId, p.url, p.altText)) mustBe
        Seq((3, Some("https://publicnudge.org/"), Some("PN")), (2, Some("https://scistarter.org/"), None))
      projectWide.map(p => (p.partnerId, p.url)) mustBe Seq((10, Some("https://scistarter.org/")))
    }

    "keep a row's own URL and alt text over its siblings'" in {
      val (_, others) = group(
        Seq(
          row(3, Some("seattle"), "Public Nudge", url = Some("https://own.example/"), altText = Some("Own")),
          row(7, Some("chicago"), "Public Nudge", url = Some("https://other.example/"), altText = Some("Other"))
        )
      )
      others.map(p => (p.url, p.altText)) mustBe Seq((Some("https://own.example/"), Some("Own")))
    }

    "sort accented and capitalized initials with their base letter, not after Z" in {
      val (_, others) = group(
        Seq(
          row(1, Some("cdmx"), "Zócalo Peatonal"),
          row(2, Some("cdmx"), "Área Metropolitana"),
          row(3, Some("seattle"), "Walkable Seattle"),
          row(4, Some("chicago"), "Österreich Walks"),
          row(5, Some("chicago"), "active Transportation Alliance")
        )
      )
      others.map(_.name) mustBe
        Seq("active Transportation Alliance", "Área Metropolitana", "Österreich Walks", "Walkable Seattle",
          "Zócalo Peatonal")
    }

    "return two empty groups for an empty table" in {
      group(Seq.empty) mustBe ((Seq.empty, Seq.empty))
    }
  }
}
