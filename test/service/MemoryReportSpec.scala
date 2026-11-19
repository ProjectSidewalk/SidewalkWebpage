package service

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/** The `/proc` parsing behind `GET /health/memory` (#6022), and that a reading works on the machine running it. */
class MemoryReportSpec extends AnyFunSuite with Matchers {

  test("parseKbFields keeps the kB lines and skips every other shape") {
    val lines = Seq(
      "Name:\tjava", "VmRSS:\t 3850704 kB", "Threads:\t236",
      "64d522f10000-7ffc1dde2000 ---p 00000000 00:00 0                          [rollup]", "AnonHugePages:     40960 kB"
    )
    MemoryReport.parseKbFields(lines) shouldBe Map("VmRSS" -> 3850704L, "AnonHugePages" -> 40960L)
  }

  test("read reports a heap within its limit and the pools outside it") {
    val status = MemoryReport.read("test-city")
    status.cityId shouldBe "test-city"
    status.heapUsedMb should be <= status.heapCommittedMb
    status.heapCommittedMb should be <= status.heapMaxMb
    status.nonHeapPoolsMb.keys should contain("Metaspace")
  }
}
