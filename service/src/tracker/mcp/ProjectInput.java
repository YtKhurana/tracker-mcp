package tracker.mcp;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.*;

/** Data-only import. Never passes project XML or archives to OSP loaders. GPL-3. */
final class ProjectInput implements AutoCloseable {
  static final long MEDIA_LIMIT=512L*1024*1024;
  static final int XML_LIMIT=16*1024*1024, MAX_FRAMES=100000;
  final Path staging;
  Path media;
  String kind, lengthUnit="m", massUnit="kg";
  int start=0, step=1, count=-1;
  double startTime=0, dt=Double.NaN;
  double ox=0, oy=0, angle=0, sx=1, sy=1;
  boolean project;
  final List<Mass> masses=new ArrayList<>();
  record Mark(int frame,double x,double y) {}
  record Mass(String name,double mass,List<Mark> marks) {}
  ProjectInput() throws IOException { staging=Files.createTempDirectory("tracker-input-"); }
  static ProjectInput read(String name) throws Exception {
    Path source=Path.of(name);
    if(!source.isAbsolute())throw Failure.invalid("path must be absolute");
    if(!Files.isRegularFile(source))throw new Failure("NOT_FOUND","Input file not found");
    ProjectInput input=new ProjectInput();
    try {
      String extension=extension(source.toString()); input.kind=extension;
      if(extension.equals("trz"))input.archive(source);
      else if(extension.equals("trk")) {
        if(Files.size(source)>XML_LIMIT)throw Failure.invalid("Project exceeds XML limit");
        byte[] xml;try(InputStream in=Files.newInputStream(source)){xml=bounded(in,XML_LIMIT);}
        String video=input.parse(xml);
        Path relative=safeRelative(video);
        Path base=source.toRealPath().getParent(); Path resolved=base.resolve(relative).toRealPath();
        if(!resolved.startsWith(base))throw Failure.invalid("Video must remain within the project directory");
        input.stageMedia(resolved);
      } else input.stageMedia(source.toRealPath());
      return input;
    } catch(Exception ex) { input.close(); throw ex; }
  }
  private void archive(Path source) throws Exception {
    if(Files.size(source)>MEDIA_LIMIT)throw Failure.invalid("Archive too large");
    try(ZipFile zip=new ZipFile(source.toFile())) {
      Map<String,ZipEntry> entries=new HashMap<>(); String trk=null; long total=0;
      Enumeration<? extends ZipEntry> items=zip.entries();
      while(items.hasMoreElements()) {
        ZipEntry entry=items.nextElement(); String name=entry.getName(); safeRelative(name);
        if(entries.put(name,entry)!=null || entries.size()>512)throw Failure.invalid("Duplicate or excessive zip entries");
        if(entry.getSize()<0 || entry.getSize()>MEDIA_LIMIT)throw Failure.invalid("Invalid zip entry size");
        total+=entry.getSize(); if(total>MEDIA_LIMIT)throw Failure.invalid("Archive expansion exceeds limit");
        if(extension(name).equals("trk")) { if(trk!=null)throw new Failure("UNSUPPORTED_TYPE","Multi-project archives are unsupported"); trk=name; }
      }
      if(trk==null)throw new Failure("PARSE_FAILED","Archive contains no project");
      byte[] xml;
      try(InputStream in=zip.getInputStream(entries.get(trk))) { xml=bounded(in,XML_LIMIT); }
      String mediaName=parse(xml);
      Path resolved=Path.of(trk).getParent(); resolved=(resolved==null?Path.of(""):resolved).resolve(safeRelative(mediaName)).normalize();
      ZipEntry entry=entries.get(resolved.toString().replace(File.separatorChar,'/'));
      if(entry==null || entry.isDirectory())throw new Failure("NOT_FOUND","Project video is absent from archive");
      media=staging.resolve("video."+mediaExtension(mediaName));
      try(InputStream in=zip.getInputStream(entry); OutputStream out=Files.newOutputStream(media,StandardOpenOption.CREATE_NEW)) { copyBounded(in,out,MEDIA_LIMIT); }
      verifyMedia(media);
    }
  }
  private void stageMedia(Path source) throws IOException {
    String ext=mediaExtension(source.toString());
    if(!Files.isRegularFile(source)||Files.size(source)>MEDIA_LIMIT)throw Failure.invalid("Video missing or too large");
    media=staging.resolve("video."+ext);
    try(InputStream in=Files.newInputStream(source); OutputStream out=Files.newOutputStream(media,StandardOpenOption.CREATE_NEW)) { copyBounded(in,out,MEDIA_LIMIT); }
    verifyMedia(media);
  }
  private static void verifyMedia(Path file) throws IOException {
    byte[] b; try(InputStream in=Files.newInputStream(file)){b=in.readNBytes(16);}
    String ext=extension(file.toString());
    boolean iso=b.length>=12 && new String(b,4,4,java.nio.charset.StandardCharsets.US_ASCII).equals("ftyp");
    boolean avi=b.length>=12 && new String(b,0,4,java.nio.charset.StandardCharsets.US_ASCII).equals("RIFF") && new String(b,8,4,java.nio.charset.StandardCharsets.US_ASCII).equals("AVI ");
    if(!(ext.equals("avi")?avi:iso))throw new Failure("VIDEO_DECODE","Unsupported or invalid encoded video signature");
  }
  static String extension(String path) { int dot=path.lastIndexOf('.'); return dot<0?"":path.substring(dot+1).toLowerCase(Locale.ROOT); }
  private static String mediaExtension(String path) { String ext=extension(path); if(!Set.of("mp4","mov","avi").contains(ext))throw new Failure("UNSUPPORTED_TYPE","Supported video formats: MP4, MOV, AVI"); return ext; }
  static Path safeRelative(String name) {
    if(name.isBlank() || name.contains("\\") || name.contains(":") || name.contains("\0"))throw Failure.invalid("Unsafe project resource path");
    Path path=Path.of(name); if(path.isAbsolute())throw Failure.invalid("Project resources must be relative");
    for(Path part:path)if(part.toString().equals(".."))throw Failure.invalid("Parent traversal in resource path");
    return path.normalize();
  }
  static byte[] bounded(InputStream in,int limit) throws IOException { ByteArrayOutputStream out=new ByteArrayOutputStream(); copyBounded(in,out,limit); return out.toByteArray(); }
  static void copyBounded(InputStream in,OutputStream out,long limit) throws IOException { byte[] b=new byte[65536]; long total=0; int n; while((n=in.read(b))!=-1) { total+=n; if(total>limit)throw Failure.invalid("Resource exceeds size limit"); out.write(b,0,n); } }
  String parse(byte[] xml) throws Exception {
    if(xml.length>XML_LIMIT)throw Failure.invalid("Project exceeds XML limit");
    DocumentBuilderFactory factory=DocumentBuilderFactory.newInstance();
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);
    factory.setFeature("http://xml.org/sax/features/external-general-entities",false);
    factory.setFeature("http://xml.org/sax/features/external-parameter-entities",false);
    factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD,""); factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA,"");
    factory.setAttribute("http://www.oracle.com/xml/jaxp/properties/maxElementDepth",64);
    factory.setXIncludeAware(false); factory.setExpandEntityReferences(false);
    Element root=factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml)).getDocumentElement();
    expectClass(root,"org.opensourcephysics.cabrillo.tracker.TrackerPanel");
    allowed(root,"semantic_version width height magnification center_x center_y videoclip clipcontrol coords time_unit length_unit mass_unit radians units_visible tracks dividers selected_view_types selected_track_views toolbar views selectedtrack description hide_description metadata number_formats configuration");
    // Reject stored derived-analysis settings rather than silently changing physics.
    if(prop(root,"number_formats")!=null || prop(root,"configuration")!=null)throw unsupported("Custom project configuration");
    Element clip=object(propRequired(root,"videoclip")); expectClass(clip,"org.opensourcephysics.media.core.VideoClip");
    allowed(clip,"video video_framecount startframe stepsize stepcount starttime readout playallsteps");
    Element video=object(propRequired(clip,"video")); expectClass(video,"org.opensourcephysics.media.xuggle.XuggleVideo");
    allowed(video,"path start_times duration frame_count frame_rate platform");
    start=integer(clip,"startframe",0); step=integer(clip,"stepsize",1); count=integer(clip,"stepcount",-1);
    if(start<0 || step<1 || count<1 || (long)start+(long)step*(count-1)>=MAX_FRAMES)throw Failure.invalid("Invalid clip bounds");
    startTime=number(clip,"starttime",0);
    Element cc=object(propRequired(root,"clipcontrol"));
    if(!Set.of("org.opensourcephysics.media.core.StepperClipControl","org.opensourcephysics.media.core.VideoClipControl").contains(cc.getAttribute("class")))throw unsupported("Clip control");
    allowed(cc,"rate delta_t frame"); dt=number(cc,"delta_t",Double.NaN); if(!Double.isFinite(dt)||dt<1e-9)throw Failure.invalid("Invalid clip frame duration");
    Element coords=object(propRequired(root,"coords")); expectClass(coords,"org.opensourcephysics.media.core.ImageCoordSystem");
    allowed(coords,"fixedorigin fixedangle fixedscale locked framedata");
    for(String field:List.of("fixedorigin","fixedangle","fixedscale"))if(!"true".equals(value(coords,field,"false")))throw unsupported("Variable coordinate system");
    List<Element> frames=properties(propRequired(coords,"framedata"));
    if(frames.size()!=1 || !frames.get(0).getAttribute("name").equals("[0]"))throw unsupported("Multiple coordinate frames");
    Element fd=object(frames.get(0)); expectClass(fd,"org.opensourcephysics.media.core.ImageCoordSystem$FrameData"); allowed(fd,"xorigin yorigin angle xscale yscale");
    ox=number(fd,"xorigin",0); oy=number(fd,"yorigin",0); angle=Math.toRadians(number(fd,"angle",0)); sx=number(fd,"xscale",1); sy=number(fd,"yscale",1);
    if(sx<1e-9||sy<1e-9)throw Failure.invalid("Coordinate scale must be at least 1e-9");
    lengthUnit=value(root,"length_unit","m"); massUnit=value(root,"mass_unit","kg");
    if(!value(root,"time_unit","s").equals("s"))throw unsupported("Non-second time units");
    lengthUnit=unit(lengthUnit);massUnit=unit(massUnit);
    Set<String> names=new HashSet<>();
    Element tracks=prop(root,"tracks");
    if(tracks!=null)for(Element entry:properties(tracks)) {
      Element track=object(entry); String cls=track.getAttribute("class");
      if(cls.equals("org.opensourcephysics.cabrillo.tracker.CoordAxes"))continue;
      expectClass(track,"org.opensourcephysics.cabrillo.tracker.PointMass");
      allowed(track,"name mass color footprint visible trail framedata keyFrames locked description");
      String name=value(track,"name",""); double mass=number(track,"mass",1);
      if(name.isBlank()||name.length()>128||!names.add(name)||mass<1e-30||masses.size()>=100)throw Failure.invalid("Invalid or duplicate point mass (mass must be at least 1e-30)");
      List<Mark> marks=new ArrayList<>(); Set<Integer> seen=new HashSet<>(); Element data=prop(track,"framedata");
      if(data!=null)for(Element frame:properties(data)) {
        String index=frame.getAttribute("name"); if(!index.matches("\\[\\d{1,6}\\]"))throw Failure.invalid("Invalid mark index");
        int n=Integer.parseInt(index.substring(1,index.length()-1)); if(n>=MAX_FRAMES||!seen.add(n))throw Failure.invalid("Invalid mark frame");
        Element point=object(frame); expectClass(point,"org.opensourcephysics.cabrillo.tracker.PointMass$FrameData"); allowed(point,"x y");
        marks.add(new Mark(n,number(point,"x",Double.NaN),number(point,"y",Double.NaN)));
      }
      masses.add(new Mass(name,mass,marks));
    }
    project=true; return value(video,"path","");
  }
  private static Failure unsupported(String what) { return new Failure("UNSUPPORTED_TYPE",what+" is unsupported by the safe point-mass importer"); }
  static String unit(String value) {String unit=value.trim();if(unit.isEmpty()||unit.length()>64||unit.chars().anyMatch(c->Character.isDigit(c)||Character.isISOControl(c)))throw Failure.invalid("Units must contain 1–64 characters without digits or controls");return unit;}
  private static void expectClass(Element element,String cls) { if(!element.getTagName().equals("object") || !element.getAttribute("class").equals(cls))throw unsupported(element.getAttribute("class")); }
  private static void allowed(Element object,String fields) { Set<String> allowed=Set.of(fields.split(" ")); Set<String> seen=new HashSet<>(); for(Element p:properties(object))if(!allowed.contains(p.getAttribute("name"))||!seen.add(p.getAttribute("name")))throw unsupported("Property "+p.getAttribute("name")); }
  private static List<Element> properties(Element element) { List<Element> out=new ArrayList<>(); NodeList nodes=element.getChildNodes(); for(int i=0;i<nodes.getLength();i++)if(nodes.item(i) instanceof Element e) { if(!e.getTagName().equals("property"))throw new Failure("PARSE_FAILED","Expected property"); out.add(e); } return out; }
  private static Element prop(Element object,String name) { Element found=null; for(Element p:properties(object))if(p.getAttribute("name").equals(name)){if(found!=null)throw new Failure("PARSE_FAILED","Duplicate property");found=p;} return found; }
  private static Element propRequired(Element object,String name) { Element p=prop(object,name); if(p==null)throw new Failure("PARSE_FAILED","Missing "+name);return p; }
  private static Element object(Element property) { Element out=null; for(Node n=property.getFirstChild();n!=null;n=n.getNextSibling())if(n instanceof Element e) { if(out!=null)throw new Failure("PARSE_FAILED","Multiple object values");out=e; } if(out==null)throw new Failure("PARSE_FAILED","Missing object");return out; }
  private static String value(Element element,String field,String fallback) { Element p=prop(element,field);if(p==null)return fallback; for(Node n=p.getFirstChild();n!=null;n=n.getNextSibling())if(n instanceof Element)throw new Failure("PARSE_FAILED","Expected scalar"); return p.getTextContent(); }
  private static double number(Element e,String field,double fallback) { try { double n=Double.parseDouble(value(e,field,Double.toString(fallback))); if(!Double.isFinite(n)||Math.abs(n)>1e12)throw new NumberFormatException(); return n; } catch(NumberFormatException ex) { throw new Failure("PARSE_FAILED","Invalid number: "+field); } }
  private static int integer(Element e,String field,int fallback) { double n=number(e,field,fallback);if(n!=Math.rint(n)||n<Integer.MIN_VALUE||n>Integer.MAX_VALUE)throw Failure.invalid("Invalid integer"); return (int)n; }
  public void close() throws IOException { try(var files=Files.list(staging)) { for(Path file:files.toList())Files.deleteIfExists(file); } Files.deleteIfExists(staging); }
}
