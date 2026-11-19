package service

import formats.json.HealthFormats.MemoryStatus

import java.lang.management.{BufferPoolMXBean, ManagementFactory, MemoryType}
import java.nio.file.{Files, Paths}
import java.time.{OffsetDateTime, ZoneOffset}
import scala.jdk.CollectionConverters.*
import scala.util.Try

/**
 * This app's own memory use, split into what Java accounts for and what it doesn't (#6022). The app has to report
 * this itself: on the servers it runs as another user, so nothing outside it can read the breakdown without root.
 */
object MemoryReport {
  private val BytesPerMb = 1024L * 1024L

  /** @return the value in kB of each "Name:   123 kB" line of a `/proc/<pid>/status`-style file; others are skipped */
  def parseKbFields(lines: Seq[String]): Map[String, Long] = {
    val field = """^(\w+):\s+(\d+) kB$""".r
    lines.collect { case field(name, kb) => name -> kb.toLong }.toMap
  }

  /** @return the kB fields of a `/proc/self` file, or nothing where it can't be read (anything but Linux) */
  private def procKbFields(file: String): Map[String, Long] =
    Try(parseKbFields(Files.readAllLines(Paths.get("/proc/self", file)).asScala.toSeq)).getOrElse(Map.empty)

  // Reading smaps_rollup takes ~10 ms per GB of app memory and briefly locks the app's memory map, so a caller
  // looping on this public endpoint must not be able to trigger it each time.
  private val CacheSeconds = 10L

  @volatile private var cached: Option[MemoryStatus] = None

  /** @return this process's reading, at most `CacheSeconds` old */
  def read(cityId: String, appStartedAt: OffsetDateTime): MemoryStatus = {
    val now     = OffsetDateTime.now(ZoneOffset.UTC)
    val reading = cached.filter(_.readAt.plusSeconds(CacheSeconds).isAfter(now)).getOrElse {
      val fresh = measure(cityId, appStartedAt, now)
      cached = Some(fresh)
      fresh
    }
    reading.copy(cityId = cityId, appStartedAt = appStartedAt)
  }

  /** @return a fresh reading for this process */
  private def measure(cityId: String, appStartedAt: OffsetDateTime, now: OffsetDateTime): MemoryStatus = {
    val status = procKbFields("status")
    val rollup = procKbFields("smaps_rollup")

    def kbToMb(fields: Map[String, Long], name: String): Option[Long] = fields.get(name).map(_ / 1024)

    val heap         = ManagementFactory.getMemoryMXBean.getHeapMemoryUsage
    val nonHeapPools = ManagementFactory.getMemoryPoolMXBeans.asScala.toSeq
      .filter(_.getType == MemoryType.NON_HEAP)
      .map(pool => pool.getName -> pool.getUsage.getCommitted / BytesPerMb)
      .toMap
    val buffers = ManagementFactory.getPlatformMXBeans(classOf[BufferPoolMXBean]).asScala.toSeq

    def bufferMb(name: String): Long = buffers.filter(_.getName == name).map(_.getMemoryUsed).sum / BytesPerMb

    val heapCommittedMb = heap.getCommitted / BytesPerMb
    val directMb        = bufferMb("direct")
    val rssMb           = kbToMb(status, "VmRSS")
    val swapMb          = kbToMb(status, "VmSwap")
    // A lower bound: Java's figures are memory it has claimed, not all of it in use.
    // The "Metaspace" pool already includes the class space, so that pool is listed but not summed.
    val nonHeapMb     = (nonHeapPools - "Compressed Class Space").values.sum
    val unaccountedMb =
      for {
        rss  <- rssMb
        swap <- swapMb
      } yield rss + swap - heapCommittedMb - nonHeapMb - directMb

    MemoryStatus(
      cityId = cityId,
      appStartedAt = appStartedAt,
      readAt = now,
      rssMb = rssMb,
      swapMb = swapMb,
      virtualMb = kbToMb(status, "VmSize"),
      anonHugePagesMb = kbToMb(rollup, "AnonHugePages"),
      heapUsedMb = heap.getUsed / BytesPerMb,
      heapCommittedMb = heapCommittedMb,
      heapMaxMb = heap.getMax / BytesPerMb,
      nonHeapPoolsMb = nonHeapPools,
      directBuffersMb = directMb,
      mappedBuffersMb = bufferMb("mapped"),
      threads = ManagementFactory.getThreadMXBean.getThreadCount,
      unaccountedMb = unaccountedMb
    )
  }
}
