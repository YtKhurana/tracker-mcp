package tracker.mcp;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.*;
import javax.imageio.ImageIO;
import javax.swing.SwingUtilities;
import org.opensourcephysics.cabrillo.tracker.*;
import org.opensourcephysics.controls.*;
import org.opensourcephysics.display.*;
import org.opensourcephysics.media.core.*;

/** GPL-3. Authenticated local numeric Tracker service. All Tracker calls use EDT. */
public final class TrackerService {
  @FunctionalInterface interface PublicationHook { void afterLink(Publication publication,int completed) throws IOException; }
  record Publication(Path source,Path destination) {}
  private volatile boolean poisoned, stopped;
  private volatile Socket active;
  private TFrame frame;
  private TrackerPanel panel;
  private ProjectInput input;
  private String session;
  private boolean dirty;
  private final AtomicBoolean busy=new AtomicBoolean();
  private final PublicationHook publicationHook;
  TrackerService() { this((publication,completed)->{}); }
  TrackerService(PublicationHook publicationHook) { this.publicationHook=Objects.requireNonNull(publicationHook); }
  private static Map<String,Object> map(Object... pairs) { Map<String,Object> out=new LinkedHashMap<>(); for(int i=0;i<pairs.length;i+=2)out.put((String)pairs[i],pairs[i+1]); return out; }
  private static Map<String,Object> ok(Object... pairs) { Map<String,Object> out=map(pairs);out.put("ok",true);out.put("visible_windows",Arrays.stream(java.awt.Window.getWindows()).filter(java.awt.Window::isVisible).count());return out; }
  private static Map<String,Object> error(String code,String message) { return map("ok",false,"error",map("code",code,"message",message,"details",map())); }
  public static void main(String[] args) throws Exception {
    PrintStream readiness=System.out; System.setOut(System.err);
    InputStream owner=System.in;
    String token=readLine(owner,65);
    if(token==null||!token.matches("[0-9a-fA-F]{64}"))throw new IllegalArgumentException("Owner token must be 64 hex characters");
    TrackerService service=new TrackerService();
    Thread.setDefaultUncaughtExceptionHandler((thread,failure)->{service.poisoned=true;System.err.println("Tracker asynchronous failure: "+failure.getClass().getSimpleName());});
    try(ServerSocket server=new ServerSocket()) {
      server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"),0),8);
      Thread eof=new Thread(()->{try {while(owner.read()!=-1){} } catch(IOException failure) {System.err.println("Owner input closed");} finally {
        service.stopped=true; try{server.close(); Socket socket=service.active;if(socket!=null)socket.close();}catch(IOException failure){System.err.println("Socket cleanup failed");}
      }},"owner-lifetime"); eof.setDaemon(true);eof.start();
      readiness.println(Json.stringify(map("ready",true,"port",server.getLocalPort(),"pid",ProcessHandle.current().pid())));readiness.flush();
      while(!service.stopped) {
        try(Socket socket=server.accept()) {
          service.active=socket;
          String line=readSocketLine(socket,Json.MAX,3000); if(line==null)continue;
          Object id=null; Map<String,Object> response;
          try {
            Map<String,Object> request=object(Json.parse(line));
            id=request.get("id");
            if(!(id instanceof Long) || ((Long)id)<0 || ((Long)id)>9007199254740991L)throw Failure.invalid("id must be a nonnegative safe integer");
            Object credential=request.get("token");
            if(!(credential instanceof String supplied)||!MessageDigest.isEqual(token.getBytes(StandardCharsets.US_ASCII),supplied.getBytes(StandardCharsets.US_ASCII)))throw new Failure("SERVICE_UNAVAILABLE","Authentication failed");
            fields(request,"jsonrpc id token method params"); if(!"2.0".equals(request.get("jsonrpc")))throw Failure.invalid("jsonrpc must be 2.0");
            response=service.dispatch(string(request,"method"),object(request.get("params")));
          } catch(Failure failure) { response=error(failure.code,failure.getMessage()); }
          catch(IllegalArgumentException failure) { response=error("INVALID_ARGUMENT",failure.getMessage()); }
          catch(Exception failure) { System.err.println("Request failed: "+failure);response=error("SERVICE_UNAVAILABLE","Service operation failed"); }
          String encoded=Json.stringify(map("jsonrpc","2.0","id",id,"result",response))+"\n";
          socket.getOutputStream().write(encoded.getBytes(StandardCharsets.UTF_8));socket.getOutputStream().flush();
        } catch(IOException failure) { if(!service.stopped)System.err.println("Local connection closed: "+failure.getClass().getSimpleName()); }
        finally {service.active=null;}
      }
    } finally {
      service.stopped=true;
      try {service.edtCleanup();}catch(Exception failure){System.err.println("Tracker shutdown cleanup failed: "+failure);}
    }
  }
  private static String readLine(InputStream in,int limit) throws IOException {
    ByteArrayOutputStream bytes=new ByteArrayOutputStream(); int b;
    while((b=in.read())!=-1) {if(b=='\n')break;if(bytes.size()>=limit)throw new IOException("Request line exceeds limit");bytes.write(b);}
    if(b==-1&&bytes.size()==0)return null;
    try{return StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes.toByteArray())).toString();}
    catch(java.nio.charset.CharacterCodingException failure){throw new IOException("Invalid UTF-8",failure);}
  }
  /** One absolute pre-auth deadline, independent of how often a peer drips bytes. */
  private static String readSocketLine(Socket socket,int limit,int timeoutMs) throws IOException {
    long deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(timeoutMs);
    ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] chunk=new byte[8192];InputStream in=socket.getInputStream();
    while(true) {
      long remaining=deadline-System.nanoTime();if(remaining<=0)throw new SocketTimeoutException("Request line deadline exceeded");
      socket.setSoTimeout((int)Math.max(1,TimeUnit.NANOSECONDS.toMillis(remaining)));
      int count=in.read(chunk);if(count<0){if(bytes.size()==0)return null;break;}
      int end=0;while(end<count&&chunk[end]!='\n')end++;
      if(bytes.size()+end>limit)throw new IOException("Request line exceeds limit");bytes.write(chunk,0,end);
      if(end<count)break;
    }
    if(System.nanoTime()>deadline)throw new SocketTimeoutException("Request line deadline exceeded");
    try{return StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes.toByteArray())).toString();}
    catch(java.nio.charset.CharacterCodingException failure){throw new IOException("Invalid UTF-8",failure);}
  }
  private Map<String,Object> dispatch(String method,Map<String,Object> p) throws Exception {
    if(poisoned||stopped)throw new Failure("SERVICE_UNAVAILABLE","Service requires restart after timeout or native failure");
    if(!busy.compareAndSet(false,true))throw new Failure("SESSION_BUSY","Session is busy");
    try {
      if(method.equals("status")) {fields(p,"");return edt(()->session==null?ok("session",null):ok("session",status()),10000);}
      if(method.equals("open")) {
        fields(p,"path timeout_ms"); String path=string(p,"path");int timeout=integer(p,"timeout_ms",60000,1,120000);
        if(session!=null||input!=null)throw new Failure("SESSION_BUSY","A session is already open");
        ProjectInput prepared;
        try{prepared=ProjectInput.read(path);}catch(Failure failure){throw failure;}catch(NoSuchFileException failure){throw new Failure("NOT_FOUND","Project media is absent");}catch(Exception failure){throw new Failure("PARSE_FAILED","Cannot parse project: "+failure.getClass().getSimpleName());}
        input=prepared;
        try{return open(timeout);}catch(Exception failure){if(!poisoned)edtCleanup();throw failure;}
      }
      return edt(()->{
        requireSession(p);
        return switch(method) {
          case "control" -> control(p); case "coords" -> coords(p); case "track" -> track(p);
          case "mark" -> mark(p); case "export" -> export(p); case "frame" -> frame(p);
          default -> throw Failure.invalid("Unknown method");
        };
      },60000);
    } finally {busy.set(false);}
  }
  private Map<String,Object> open(int timeout) throws Exception {
    return edt(()->{
      Video video=null;boolean attached=false;
      try {
        OSPRuntime.autoAddLibrary=false;ServicePreferences.configure();VideoIO.loadIncrementally=true;
        // XuggleMovieVideoType.java:getVideo catches IOException and returns null.
        // Unlike TrackerIO.openURL, it never routes decoder failures into a modal.
        video=new org.opensourcephysics.media.xuggle.XuggleMovieVideoType().getVideo(input.media.toString(),null,null);
        if(video==null)throw new Failure("VIDEO_DECODE","Video could not be decoded");
        if(video instanceof org.opensourcephysics.media.xuggle.XuggleVideo xuggle) {
          while(xuggle.loadMoreFrames(500)) {
            if(poisoned||stopped)throw new Failure("TIMEOUT","Video load cancelled");
            if(xuggle.getLoadedFrameCount()>ProjectInput.MAX_FRAMES)throw new Failure("VIDEO_DECODE","Video exceeds frame limit");
          }
        }
        if(poisoned||stopped)throw new Failure("TIMEOUT","Video load cancelled");
        int frames=video.getFrameCount();if(frames<1||frames>ProjectInput.MAX_FRAMES||video.getImage()==null)throw new Failure("VIDEO_DECODE","Video has no supported frames");
        frame=new TFrame();frame.setVisible(false);panel=new TrackerPanel(frame);frame.addTab(panel,TFrame.ADD_SELECT|TFrame.ADD_NOREFRESH,null);panel.setVideo(video);attached=true;
        if(input.project)restore();
        session=UUID.randomUUID().toString();dirty=false;
        return ok("session_id",session,"opened",map("kind",input.kind,"video_path",input.media.toString(),"framecount",frames,"tracks",tracks()));
      }catch(IOException failure){throw new Failure("VIDEO_DECODE","Video decoding failed");}
      finally{if(video!=null&&!attached)video.dispose();}
    },timeout);
  }
  private void restore() {
    int frames=panel.getVideo().getFrameCount();
    if((long)input.start+(long)input.step*(input.count-1)>=frames)throw Failure.invalid("Project clip extends beyond decoded video");
    for(ProjectInput.Mass mass:input.masses)for(ProjectInput.Mark mark:mass.marks())if(mark.frame()>=frames)throw Failure.invalid("Project mark extends beyond video");
    // OSP signatures are grounded in workspace cdn_cores/tracker6.1.6/core_tracker.z.js,
    // VideoClip and ClipControl methods, and TrackerPanel source call sites.
    VideoClip clip=panel.getPlayer().getVideoClip();clip.setStartFrameNumber(input.start);clip.setStepSize(input.step);clip.setStepCount(input.count);clip.setStartTime(input.startTime);
    panel.getPlayer().getClipControl().setFrameDuration(input.dt);
    if(clip.getStartFrameNumber()!=input.start||clip.getStepSize()!=input.step||clip.getStepCount()!=input.count)throw Failure.invalid("Tracker rejected clip bounds");
    ImageCoordSystem c=panel.getCoords();c.setLocked(false);c.setFixedOrigin(true);c.setFixedAngle(true);c.setFixedScale(true);
    c.setOriginXY(0,input.ox,input.oy);c.setAngle(0,input.angle);c.setScaleXY(0,input.sx,input.sy);
    panel.setLengthUnit(input.lengthUnit,false);panel.setMassUnit(input.massUnit,false);
    for(ProjectInput.Mass record:input.masses) {PointMass mass=new PointMass();mass.setName(record.name());mass.setMass(record.mass());panel.addTrack(mass);mass.setLocked(false);
      for(ProjectInput.Mark mark:record.marks())if(mass.createStep(mark.frame(),mark.x(),mark.y())==null)throw new Failure("PARSE_FAILED","Tracker rejected project mark");
    }
  }
  private void requireSession(Map<String,Object> p) {String id=string(p,"session_id");if(session==null||!session.equals(id))throw new Failure("NO_SESSION","No matching session");}
  private Map<String,Object> control(Map<String,Object> p) throws Exception {
    fields(p,"session_id action path");String action=string(p,"action");
    if(!action.equals("save")&&p.containsKey("path"))throw Failure.invalid("path is only valid for save");
    return switch(action) {case "status"->status();case "save"->save(string(p,"path"));case "close"->{cleanup();yield ok("closed",true);}default->throw Failure.invalid("Unknown session action");};
  }
  private Map<String,Object> status() {return ok("session_id",session,"dirty",dirty,"video_path",input.media.toString(),"coords",coordinateState(),"tracks",tracks());}
  private Map<String,Object> coordinateState() {ImageCoordSystem c=panel.getCoords();return map("origin_x",c.getOriginX(0),"origin_y",c.getOriginY(0),"angle_rad",c.getAngle(0),"scale",c.getScaleX(0),"length_unit",panel.getLengthUnit());}
  private List<Object> tracks() {List<Object> out=new ArrayList<>();for(TTrack t:panel.getTracks())if(t instanceof PointMass mass)out.add(map("name",mass.getName(),"type","point_mass","mass",mass.getMass(),"mark_count",markCount(mass)));return out;}
  private int markCount(PointMass mass) {int count=0;for(int n=0;n<panel.getVideo().getFrameCount();n++)if(mass.getStep(n)!=null)count++;return count;}
  private PointMass mass(String name) {TTrack track=panel.getTrack(name);if(!(track instanceof PointMass m))throw new Failure("NOT_FOUND","Point mass not found");return m;}
  private int frameNumber(Map<String,Object> p) {return integer(p,"frame",-1,0,panel.getVideo().getFrameCount()-1);}
  private Map<String,Object> coords(Map<String,Object> p) {
    fields(p,"session_id frame origin_x origin_y angle_rad scale length_unit");int n=integer(p,"frame",0,0,panel.getVideo().getFrameCount()-1);
    ImageCoordSystem c=panel.getCoords();double x=number(p,"origin_x",c.getOriginX(n)),y=number(p,"origin_y",c.getOriginY(n)),angle=number(p,"angle_rad",c.getAngle(n)),scale=number(p,"scale",c.getScaleX(n));
    double scaleY=p.containsKey("scale")?scale:c.getScaleY(n);
    if(scale<1e-9)throw Failure.invalid("scale must be at least 1e-9 pixels per world unit");String unit=ProjectInput.unit(p.containsKey("length_unit")?string(p,"length_unit"):panel.getLengthUnit());
    c.setLocked(false);c.setFixedOrigin(true);c.setFixedAngle(true);c.setFixedScale(true);c.setOriginXY(n,x,y);c.setAngle(n,angle);c.setScaleXY(n,scale,scaleY);panel.setLengthUnit(unit,false);dirty=true;return ok("coords",coordinateState());
  }
  private Map<String,Object> track(Map<String,Object> p) {
    fields(p,"session_id name type mass");String name=string(p,"name");if(name.length()>128||panel.getTrack(name)!=null)throw Failure.invalid("Track name is duplicate or too long");
    if(p.containsKey("type")&&!string(p,"type").equals("point_mass"))throw new Failure("UNSUPPORTED_TYPE","Only point_mass is supported");
    double value=number(p,"mass",1);if(value<1e-30)throw Failure.invalid("mass must be at least 1e-30");if(tracks().size()>=100)throw Failure.invalid("Track limit exceeded");
    PointMass mass=new PointMass();mass.setName(name);mass.setMass(value);panel.addTrack(mass);mass.setLocked(false);dirty=true;return ok("name",name,"type","point_mass","mass",mass.getMass());
  }
  private Map<String,Object> mark(Map<String,Object> p) {
    fields(p,"session_id track clear marks");PointMass mass=mass(string(p,"track"));boolean clear=bool(p,"clear",false);
    if(!(p.get("marks") instanceof List<?> list)||list.size()>ProjectInput.MAX_FRAMES)throw Failure.invalid("marks must be a bounded array");
    List<ProjectInput.Mark> marks=new ArrayList<>();Set<Integer> seen=new HashSet<>();
    for(Object entry:list) {Map<String,Object> mark=object(entry);fields(mark,"frame x y");int n=frameNumber(mark);if(!seen.add(n))throw Failure.invalid("Duplicate mark frame");
      if(clear&&(mark.containsKey("x")||mark.containsKey("y")))throw Failure.invalid("Clear marks must contain only frame");
      marks.add(new ProjectInput.Mark(n,clear?0:requiredNumber(mark,"x"),clear?0:requiredNumber(mark,"y")));
    }
    for(ProjectInput.Mark mark:marks) {if(clear)mass.deleteStep(mark.frame());else if(mass.createStep(mark.frame(),mark.x(),mark.y())==null){poisoned=true;throw new Failure("SERVICE_UNAVAILABLE","Tracker rejected mark; session requires restart");}}
    dirty=true;return ok("track",mass.getName(),"mark_count",markCount(mass));
  }
  private Map<String,Object> export(Map<String,Object> p) throws Exception {
    fields(p,"session_id track path columns format");PointMass mass=mass(string(p,"track"));String format=p.containsKey("format")?string(p,"format"):"csv";if(!Set.of("csv","json").contains(format))throw Failure.invalid("Unknown export format");
    List<String> names=new ArrayList<>();Object columns=p.getOrDefault("columns",List.of("t","x","y","vx","vy"));
    if(!(columns instanceof List<?> list)||list.isEmpty()||list.size()>5)throw Failure.invalid("Invalid export columns");
    for(Object col:list){if(!(col instanceof String name)||!Set.of("t","x","y","vx","vy").contains(name)||names.contains(name))throw Failure.invalid("Unsupported or duplicate export column");names.add(name);}
    Path path=p.containsKey("path")?output(string(p,"path"),format):null;
    Map<String,double[]> data=new HashMap<>();for(Dataset dataset:mass.getData(panel).getDatasets()){data.putIfAbsent(dataset.getXColumnName(),dataset.getXPoints());data.put(dataset.getYColumnName(),dataset.getYPoints());}
    List<double[]> selected=new ArrayList<>();int size=-1;
    for(String name:names){double[] values=data.get(name.equals("vx")?"v_{x}":name.equals("vy")?"v_{y}":name);if(values==null)throw new Failure("EXPORT_EMPTY","Required Tracker dataset is absent");if(size>=0&&size!=values.length)throw new Failure("EXPORT_EMPTY","Tracker datasets are not aligned");size=values.length;selected.add(values);}
    if(size<=0)throw new Failure("EXPORT_EMPTY","Track has no data");
    List<Object> rows=new ArrayList<>();StringBuilder csv=new StringBuilder(String.join(",",names)+"\n");
    for(int row=0;row<size;row++){List<Object> values=new ArrayList<>();for(int col=0;col<selected.size();col++){double v=selected.get(col)[row];if(Double.isInfinite(v)||(!Double.isFinite(v)&&Set.of("t","x","y").contains(names.get(col))))throw new Failure("EXPORT_EMPTY","Nonfinite Tracker position or time dataset");Object value=Double.isFinite(v)?v:null;values.add(value);if(col>0)csv.append(',');if(value!=null)csv.append(v);}csv.append('\n');rows.add(values);}
    String content=format.equals("csv")?csv.toString():Json.stringify(map("columns",names,"rows",rows));
    if(path!=null){writeAtomic(path,content.getBytes(StandardCharsets.UTF_8));return ok("columns",names,"row_count",size,"path",path.toString(),"format",format);}
    Map<String,Object> result=ok("columns",names,"rows",rows,"path",null,"format",format);if(format.equals("csv"))result.put("csv",content);
    if(Json.stringify(result).getBytes(StandardCharsets.UTF_8).length>Json.MAX-1024)throw Failure.invalid("Inline export exceeds limit; provide an output path");return result;
  }
  private Map<String,Object> frame(Map<String,Object> p) throws Exception {
    fields(p,"session_id frame path");int n=frameNumber(p);Path path=p.containsKey("path")?output(string(p,"path"),"png"):Files.createTempDirectory("tracker-output-").resolve("frame-"+n+".png");
    Video video=panel.getVideo();video.setFrameNumber(n);java.awt.image.BufferedImage image=video.getImage();if(image==null||video.getFrameNumber()!=n)throw new Failure("VIDEO_DECODE","Frame seek failed");
    ByteArrayOutputStream bytes=new ByteArrayOutputStream();if(!ImageIO.write(image,"png",bytes))throw new Failure("SAVE_FAILED","PNG encoder unavailable");writeAtomic(path,bytes.toByteArray());return ok("path",path.toString(),"frame",n,"width",image.getWidth(),"height",image.getHeight());
  }
  private Map<String,Object> save(String name) throws Exception {
    String ext=ProjectInput.extension(name);if(!Set.of("trk","trz").contains(ext))throw Failure.invalid("Save path must end in .trk or .trz");
    Path target=output(name,ext),parent=target.getParent();String base=safeSaveBase(target);
    Path trk=parent.resolve(base+".trk"),trz=parent.resolve(base+".trz");
    if(Files.exists(trk,LinkOption.NOFOLLOW_LINKS)||Files.exists(trz,LinkOption.NOFOLLOW_LINKS))throw new Failure("SAVE_FAILED","Output already exists");
    String mediaName=base+"-"+UUID.randomUUID()+"."+ProjectInput.extension(input.media.toString());Path mediaOut=parent.resolve(mediaName);
    Path staging=Files.createTempDirectory(parent,".tracker-save-");
    try {
      Path standalone=Files.createDirectory(staging.resolve("standalone")),archive=Files.createDirectory(staging.resolve("archive"));
      Path stagedMedia=standalone.resolve(mediaName);Files.copy(input.media,stagedMedia);
      XMLControlElement control=new XMLControlElement(panel);XMLControl video=control.getChildControl("videoclip").getChildControl("video");if(video==null)throw new IOException("Video serialization absent");
      // Resource normalization only. The standalone project resolves its adjacent companion.
      video.setValue("path",mediaName);video.setValue("paths",null);
      Path stagedTrk=standalone.resolve(trk.getFileName());if(control.write(stagedTrk.toString())==null||Files.size(stagedTrk)==0)throw new IOException("Tracker serialization failed");
      // Tracker's project exporter stores archive media under videos/. Serialize a distinct
      // archive control through Tracker rather than editing XML text; marks are never hand-edited.
      String archiveProject="project.trk",archiveMedia="videos/media."+ProjectInput.extension(input.media.toString());video.setValue("path",archiveMedia);
      Path archiveTrk=archive.resolve("project.trk");if(control.write(archiveTrk.toString())==null||Files.size(archiveTrk)==0)throw new IOException("Tracker archive serialization failed");
      Path stagedTrz=archive.resolve("project.trz");
      try(ZipOutputStream zip=new ZipOutputStream(Files.newOutputStream(stagedTrz,StandardOpenOption.CREATE_NEW))){
        ZipEntry projectEntry=new ZipEntry(archiveProject);projectEntry.setTime(0);zip.putNextEntry(projectEntry);Files.copy(archiveTrk,zip);zip.closeEntry();
        ZipEntry mediaEntry=new ZipEntry(archiveMedia);mediaEntry.setTime(0);zip.putNextEntry(mediaEntry);Files.copy(stagedMedia,zip);zip.closeEntry();
      }
      publishSaveArtifacts(List.of(new Publication(stagedMedia,mediaOut),new Publication(stagedTrk,trk),new Publication(stagedTrz,trz)));
      return ok("trk_path",trk.toString(),"trz_path",trz.toString());
    }catch(Exception failure){if(failure instanceof Failure f)throw f;throw new Failure("SAVE_FAILED","Project could not be saved: "+failure.getClass().getSimpleName());}
    finally{cleanupStaging(staging);}
  }
  void publishSaveArtifacts(List<Publication> artifacts) throws IOException {
    List<Publication> created=new ArrayList<>();
    try {
      for(Publication artifact:artifacts){publish(artifact.source(),artifact.destination());created.add(artifact);publicationHook.afterLink(artifact,created.size());}
      dirty=false;
    }catch(IOException|RuntimeException failure){rollbackPublished(created);throw failure;}
  }
  static void rollbackPublished(List<Publication> created) {
    for(int i=created.size()-1;i>=0;i--){Publication artifact=created.get(i);try{Path file=artifact.destination(),source=artifact.source();if(Files.exists(file,LinkOption.NOFOLLOW_LINKS)&&Files.exists(source,LinkOption.NOFOLLOW_LINKS)&&Files.isSameFile(file,source))Files.delete(file);}catch(IOException failure){System.err.println("Save rollback cleanup failed: "+failure.getClass().getSimpleName());}}
  }
  static void cleanupStaging(Path staging) {
    try(var files=Files.walk(staging)){for(Path file:files.sorted(Comparator.reverseOrder()).toList())try{Files.deleteIfExists(file);}catch(IOException failure){System.err.println("Save staging cleanup failed: "+failure.getClass().getSimpleName());}}
    catch(IOException failure){System.err.println("Save staging listing failed: "+failure.getClass().getSimpleName());}
  }
  private static Path output(String name,String extension) throws IOException {
    try {
      Path path=Path.of(name);if(!path.isAbsolute()||!ProjectInput.extension(name).equals(extension))throw Failure.invalid("Output must be an absolute ."+extension+" path");
      Path parent=path.getParent().toRealPath();path=parent.resolve(path.getFileName());if(Files.exists(path,LinkOption.NOFOLLOW_LINKS))throw new Failure("SAVE_FAILED","Output already exists");return path;
    }catch(InvalidPathException failure){throw Failure.invalid("Invalid output path");}catch(IOException failure){throw new Failure("SAVE_FAILED","Output directory is unavailable");}
  }
  private static String safeSaveBase(Path target) {
    String filename=target.getFileName().toString(),base=filename.substring(0,filename.length()-4);
    if(!base.matches("[A-Za-z0-9](?:[A-Za-z0-9._ -]{0,126}[A-Za-z0-9])?"))throw Failure.invalid("Save filename stem must use 1-128 portable characters");
    return base;
  }
  private void publish(Path staging,Path destination) throws IOException {if(poisoned||stopped)throw new Failure("TIMEOUT","Operation cancelled before publication");Files.createLink(destination,staging);}
  private void writeAtomic(Path destination,byte[] bytes) throws IOException {
    Path staging=Files.createTempFile(destination.getParent(),".tracker-output-",".tmp");try{Files.write(staging,bytes);publish(staging,destination);}catch(IOException failure){throw new Failure("SAVE_FAILED","Output could not be written");}finally{Files.deleteIfExists(staging);}
  }
  private <T> T edt(Callable<T> action,int timeout) throws Exception {CompletableFuture<T> future=new CompletableFuture<>();SwingUtilities.invokeLater(()->{if(poisoned||stopped){future.completeExceptionally(new Failure("SERVICE_UNAVAILABLE","Service stopped"));return;}try{future.complete(action.call());}catch(Throwable failure){if(!(failure instanceof Failure))poisoned=true;future.completeExceptionally(failure);}});return await(future,timeout);}
  private <T> T await(CompletableFuture<T> future,int timeout) throws Exception {
    try{return future.get(timeout,TimeUnit.MILLISECONDS);}catch(TimeoutException failure){poisoned=true;throw new Failure("TIMEOUT","Tracker timed out; restart service before further operations");}
    catch(ExecutionException failure){Throwable cause=failure.getCause();if(cause instanceof Exception ex)throw ex;poisoned=true;throw new Failure("SERVICE_UNAVAILABLE","Native Tracker failure");}
  }
  private void edtCleanup() throws Exception {CompletableFuture<Void> done=new CompletableFuture<>();SwingUtilities.invokeLater(()->{try{cleanup();done.complete(null);}catch(Throwable failure){done.completeExceptionally(failure);}});done.get(5000,TimeUnit.MILLISECONDS);}
  private void cleanup() throws Exception {
    if(frame!=null){frame.dispose();while(frame.getTabCount()>0)frame.removeTabSynchronously(frame.getTrackerPanelForTab(0));}
    frame=null;panel=null;session=null;dirty=false;if(input!=null){input.close();input=null;}
  }
  @SuppressWarnings("unchecked") private static Map<String,Object> object(Object value) {if(!(value instanceof Map<?,?> map))throw Failure.invalid("Expected object");return (Map<String,Object>)map;}
  private static void fields(Map<String,Object> p,String allowed) {Set<String> names=allowed.isEmpty()?Set.of():Set.of(allowed.split(" "));for(String key:p.keySet())if(!names.contains(key))throw Failure.invalid("Unknown field: "+key);}
  private static String string(Map<String,Object> p,String key) {Object value=p.get(key);if(!(value instanceof String s)||s.isBlank()||s.indexOf('\0')>=0)throw Failure.invalid(key+" must be a nonempty string");return s;}
  private static double number(Map<String,Object> p,String key,double fallback) {if(!p.containsKey(key))return fallback;return requiredNumber(p,key);}
  private static double requiredNumber(Map<String,Object> p,String key) {Object value=p.get(key);if(!(value instanceof Number n)||!Double.isFinite(n.doubleValue())||Math.abs(n.doubleValue())>1e12)throw Failure.invalid(key+" must be a finite bounded number");return n.doubleValue();}
  private static int integer(Map<String,Object> p,String key,int fallback,int min,int max) {double n=number(p,key,fallback);if(n!=Math.rint(n)||n<min||n>max)throw Failure.invalid(key+" must be an integer in ["+min+","+max+"]");return (int)n;}
  private static boolean bool(Map<String,Object> p,String key,boolean fallback) {if(!p.containsKey(key))return fallback;if(!(p.get(key) instanceof Boolean value))throw Failure.invalid(key+" must be boolean");return value;}
}
