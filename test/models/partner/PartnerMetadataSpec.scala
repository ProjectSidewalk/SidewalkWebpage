package models.partner

import util.SidewalkSpec

import java.time.OffsetDateTime

/**
 * Pins how the /about page's logo grid (#5980) collapses the shared partner table, which holds one row per
 * organization per city, into one logo per organization.
 */
class PartnerMetadataSpec extends SidewalkSpec {

  private def row(id: Int, cityId: Option[String], name: String, displayOrder: Int = 0) =
    PartnerMetadata(id, cityId, name, None, None, displayOrder, 800, 200, OffsetDateTime.now)

  "PartnerMetadata.groupForAbout" should {
    "show an organization once, ignoring case and spacing (no-break spaces too), with its lowest-id row" in {
      val (projectWide, others) = PartnerMetadata.groupForAbout(
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

    "treat an organization with a project-wide row as project-wide, showing that row's logo" in {
      val (projectWide, others) = PartnerMetadata.groupForAbout(
        Seq(row(1, Some("seattle"), "SciStarter"), row(9, None, "scistarter"), row(4, Some("chicago"), "Easterseals"))
      )
      projectWide.map(_.partnerId) mustBe Seq(9)
      others.map(_.partnerId) mustBe Seq(4)
    }

    "keep the lowest-id row when an organization has two project-wide rows" in {
      val (projectWide, _) = PartnerMetadata.groupForAbout(Seq(row(8, None, "SciStarter"), row(6, None, "SciStarter")))
      projectWide.map(_.partnerId) mustBe Seq(6)
    }

    "order project-wide partners as the admins did and the rest alphabetically, ignoring case" in {
      val (projectWide, others) = PartnerMetadata.groupForAbout(
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

    "return two empty groups for an empty table" in {
      PartnerMetadata.groupForAbout(Seq.empty) mustBe ((Seq.empty, Seq.empty))
    }
  }
}
