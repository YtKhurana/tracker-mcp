import { childObjects, parseXml, property, textOf, type XmlNode } from "./xml.js";

const PANEL = "org.opensourcephysics.cabrillo.tracker.TrackerPanel";
const FRAME_DATA = "org.opensourcephysics.cabrillo.tracker.PointMass$FrameData";
const COORD_FRAME = "org.opensourcephysics.media.core.ImageCoordSystem$FrameData";

export type InspectVideo = {
  class: string | null;
  path: string | null;
  framecount: number | null;
  startframe: number | null;
  stepsize: number | null;
  stepcount: number | null;
  starttime: number | null;
  delta_t: number | null;
};

export type CoordFrame = {
  n: number;
  xorigin: number;
  yorigin: number;
  angle: number;
  xscale: number;
  yscale: number;
};

export type InspectCoords = {
  fixedorigin: boolean | null;
  fixedangle: boolean | null;
  fixedscale: boolean | null;
  frames: CoordFrame[];
};

export type InspectTrack = {
  name: string | null;
  class: string;
  mark_count: number;
};

export type InspectPayload = {
  semantic_version: string | null;
  video: InspectVideo;
  coords: InspectCoords;
  tracks: InspectTrack[];
  units: { length: string | null; mass: string | null };
};

function boolProp(node: XmlNode, name: string): boolean | null {
  const value = textOf(property(node, name));
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

function numProp(node: XmlNode, name: string): number | null {
  const value = textOf(property(node, name));
  if (value === null) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function strProp(node: XmlNode, name: string): string | null {
  return textOf(property(node, name));
}

function objectProp(node: XmlNode, name: string): XmlNode | undefined {
  const prop = property(node, name);
  return prop ? childObjects(prop)[0] : undefined;
}

function emptyVideo(): InspectVideo {
  return {
    class: null,
    path: null,
    framecount: null,
    startframe: null,
    stepsize: null,
    stepcount: null,
    starttime: null,
    delta_t: null,
  };
}

function parseVideo(panel: XmlNode): InspectVideo {
  const video: InspectVideo = emptyVideo();
  const clip = objectProp(panel, "videoclip");
  if (clip) {
    video.startframe = numProp(clip, "startframe");
    video.stepsize = numProp(clip, "stepsize");
    video.stepcount = numProp(clip, "stepcount");
    video.starttime = numProp(clip, "starttime");
    video.framecount = numProp(clip, "video_framecount");
    const inner = objectProp(clip, "video");
    if (inner) {
      video.class = inner.attrs.class ?? null;
      video.path = strProp(inner, "path");
      video.delta_t = numProp(inner, "delta_t");
    }
  }
  if (video.delta_t === null) {
    const control = objectProp(panel, "clipcontrol");
    if (control) {
      video.delta_t = numProp(control, "delta_t");
    }
  }
  return video;
}

function parseCoords(panel: XmlNode): InspectCoords {
  const coordsObj = objectProp(panel, "coords");
  if (!coordsObj) {
    return { fixedorigin: null, fixedangle: null, fixedscale: null, frames: [] };
  }
  const framedata = property(coordsObj, "framedata");
  const frames: CoordFrame[] = [];
  if (framedata) {
    for (const slot of framedata.children.filter((child) => child.name === "property")) {
      const index = /^\[(\d+)\]$/.exec(slot.attrs.name ?? "");
      const frame = childObjects(slot)[0];
      if (!index || !frame || frame.attrs.class !== COORD_FRAME) {
        throw new Error("bad_trk");
      }
      const xorigin = numProp(frame, "xorigin");
      const yorigin = numProp(frame, "yorigin");
      const angle = numProp(frame, "angle");
      const xscale = numProp(frame, "xscale");
      const yscale = numProp(frame, "yscale");
      if (xorigin === null || yorigin === null || angle === null || xscale === null || yscale === null) {
        throw new Error("bad_trk");
      }
      frames.push({ n: Number(index[1]), xorigin, yorigin, angle, xscale, yscale });
    }
  }
  return {
    fixedorigin: boolProp(coordsObj, "fixedorigin"),
    fixedangle: boolProp(coordsObj, "fixedangle"),
    fixedscale: boolProp(coordsObj, "fixedscale"),
    frames,
  };
}

function markCount(track: XmlNode): number {
  const framedata = property(track, "framedata");
  if (!framedata) {
    return 0;
  }
  let count = 0;
  for (const slot of framedata.children.filter((child) => child.name === "property")) {
    const frame = childObjects(slot)[0];
    if (frame?.attrs.class === FRAME_DATA) {
      count += 1;
    }
  }
  return count;
}

function parseTracks(panel: XmlNode): InspectTrack[] {
  const tracks = property(panel, "tracks");
  if (!tracks) {
    return [];
  }
  const result: InspectTrack[] = [];
  for (const item of tracks.children.filter((child) => child.name === "property" && child.attrs.name === "item")) {
    const track = childObjects(item)[0];
    if (!track?.attrs.class) {
      continue;
    }
    result.push({
      name: strProp(track, "name"),
      class: track.attrs.class,
      mark_count: markCount(track),
    });
  }
  return result;
}

export function parseTrackerPanelXml(xml: string): InspectPayload {
  const root = parseXml(xml);
  if (root.name !== "object" || root.attrs.class !== PANEL) {
    throw new Error("bad_trk");
  }
  return {
    semantic_version: strProp(root, "semantic_version"),
    video: parseVideo(root),
    coords: parseCoords(root),
    tracks: parseTracks(root),
    units: {
      length: strProp(root, "length_unit"),
      mass: strProp(root, "mass_unit"),
    },
  };
}
