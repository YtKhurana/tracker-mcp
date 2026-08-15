import { writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "./bundle.js";

export const MINIMAL_TRK = `<?xml version="1.0" encoding="UTF-8"?>
<object class="org.opensourcephysics.cabrillo.tracker.TrackerPanel">
  <property name="semantic_version" type="string">5.1.2</property>
  <property name="videoclip" type="object">
    <object class="org.opensourcephysics.media.core.VideoClip">
      <property name="video" type="object">
        <object class="org.opensourcephysics.media.core.ImageVideo">
          <property name="path" type="string">videos/clip00.jpg</property>
          <property name="delta_t" type="double">4.0</property>
        </object>
      </property>
      <property name="video_framecount" type="int">3</property>
      <property name="startframe" type="int">0</property>
      <property name="stepsize" type="int">1</property>
      <property name="stepcount" type="int">3</property>
      <property name="starttime" type="double">0.0</property>
    </object>
  </property>
  <property name="clipcontrol" type="object">
    <object class="org.opensourcephysics.media.core.StepperClipControl">
      <property name="delta_t" type="double">4.0</property>
    </object>
  </property>
  <property name="coords" type="object">
    <object class="org.opensourcephysics.media.core.ImageCoordSystem">
      <property name="fixedorigin" type="boolean">true</property>
      <property name="fixedangle" type="boolean">true</property>
      <property name="fixedscale" type="boolean">true</property>
      <property name="framedata" type="array" class="[Lorg.opensourcephysics.media.core.ImageCoordSystem$FrameData;">
        <property name="[0]" type="object">
          <object class="org.opensourcephysics.media.core.ImageCoordSystem$FrameData">
            <property name="xorigin" type="double">10.0</property>
            <property name="yorigin" type="double">20.0</property>
            <property name="angle" type="double">0.0</property>
            <property name="xscale" type="double">1.0</property>
            <property name="yscale" type="double">1.0</property>
          </object>
        </property>
      </property>
    </object>
  </property>
  <property name="length_unit" type="string">m</property>
  <property name="mass_unit" type="string">kg</property>
  <property name="tracks" type="collection" class="java.util.ArrayList">
    <property name="item" type="object">
      <object class="org.opensourcephysics.cabrillo.tracker.CoordAxes">
        <property name="name" type="string">axes</property>
      </object>
    </property>
    <property name="item" type="object">
      <object class="org.opensourcephysics.cabrillo.tracker.PointMass">
        <property name="name" type="string">mass A</property>
        <property name="framedata" type="array" class="[Lorg.opensourcephysics.cabrillo.tracker.PointMass$FrameData;">
          <property name="[0]" type="object">
            <object class="org.opensourcephysics.cabrillo.tracker.PointMass$FrameData">
              <property name="x" type="double">1.0</property>
              <property name="y" type="double">2.0</property>
            </object>
          </property>
          <property name="[2]" type="object">
            <object class="org.opensourcephysics.cabrillo.tracker.PointMass$FrameData">
              <property name="x" type="double">3.0</property>
              <property name="y" type="double">4.0</property>
            </object>
          </property>
        </property>
      </object>
    </property>
  </property>
</object>
`;

export const CLIP_ONLY_TRK = `<?xml version="1.0" encoding="UTF-8"?>
<object class="org.opensourcephysics.cabrillo.tracker.TrackerPanel">
  <property name="semantic_version" type="string">5.1.2</property>
  <property name="videoclip" type="object">
    <object class="org.opensourcephysics.media.core.VideoClip">
      <property name="startframe" type="int">0</property>
      <property name="stepsize" type="int">1</property>
      <property name="stepcount" type="int">100</property>
      <property name="starttime" type="double">0.0</property>
    </object>
  </property>
  <property name="clipcontrol" type="object">
    <object class="org.opensourcephysics.media.core.StepperClipControl">
      <property name="delta_t" type="double">33.333333333333336</property>
    </object>
  </property>
</object>
`;

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function writeStoreZip(filePath, entries) {
  const locals = [];
  const chunks = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, data);
    locals.push({ name, data, crc, offset });
    offset += 30 + name.length + data.length;
  }
  const cenStart = offset;
  for (const local of locals) {
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(local.crc, 16);
    cen.writeUInt32LE(local.data.length, 20);
    cen.writeUInt32LE(local.data.length, 24);
    cen.writeUInt16LE(local.name.length, 28);
    cen.writeUInt32LE(local.offset, 42);
    chunks.push(cen, local.name);
    offset += 46 + local.name.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(locals.length, 8);
  eocd.writeUInt16LE(locals.length, 10);
  eocd.writeUInt32LE(offset - cenStart, 12);
  eocd.writeUInt32LE(cenStart, 16);
  chunks.push(eocd);
  writeFileSync(filePath, Buffer.concat(chunks));
}

export function writeTempTrk(xml = MINIMAL_TRK, name = "sample.trk") {
  const dir = makeTempDir("tracker-mcp-trk-");
  const file = path.join(dir, name);
  writeFileSync(file, xml);
  return file;
}

export function writeTempTrz(xml = MINIMAL_TRK, zipName = "sample.trz", trkName = "sample.trk") {
  const dir = makeTempDir("tracker-mcp-trz-");
  const file = path.join(dir, zipName);
  writeStoreZip(file, [{ name: trkName, data: xml }]);
  return file;
}
