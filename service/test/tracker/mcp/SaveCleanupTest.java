package tracker.mcp;

import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.file.*;
import java.util.ArrayList;
import java.util.List;

/** Fault-injection checks around real hard-link publication and rollback. GPL-3. */
public final class SaveCleanupTest {
  public static void main(String[] args) throws Exception {
    collisionPreservesAlias(false);
    collisionPreservesAlias(true);
    failsAfterSecondLink();
    System.out.println("SaveCleanupTest passed");
  }

  private static void collisionPreservesAlias(boolean symbolic) throws Exception {
    Path root=Files.createTempDirectory("tracker-save-alias-");Path staging=Files.createDirectory(root.resolve("staging"));
    Path sourceOne=Files.writeString(staging.resolve("one"),"one"),sourceTwo=Files.writeString(staging.resolve("two"),"two");
    Path destinationOne=root.resolve("published-one"),unrelated=root.resolve("published-two");
    if(symbolic)Files.createSymbolicLink(unrelated,sourceTwo);else Files.createLink(unrelated,sourceTwo);
    TrackerService service=new TrackerService();setDirty(service,true);
    List<TrackerService.Publication> publications=List.of(new TrackerService.Publication(sourceOne,destinationOne),new TrackerService.Publication(sourceTwo,unrelated));
    try{service.publishSaveArtifacts(publications);throw new AssertionError("publication unexpectedly succeeded");}
    catch(FileAlreadyExistsException primary){if(!primary.getFile().equals(unrelated.toString()))throw new AssertionError("primary failure was masked",primary);}
    if(Files.exists(destinationOne))throw new AssertionError("partial output survived rollback");
    if(!Files.exists(unrelated,LinkOption.NOFOLLOW_LINKS)||!Files.readString(unrelated).equals("two"))throw new AssertionError("preexisting alias was changed");
    if(!dirty(service))throw new AssertionError("failed save cleared dirty state");
    TrackerService.cleanupStaging(staging);if(Files.exists(staging))throw new AssertionError("staging survived cleanup");
    if(!Files.exists(unrelated,LinkOption.NOFOLLOW_LINKS))throw new AssertionError("preexisting alias was removed during cleanup");
    Files.delete(unrelated);Files.delete(root);
  }

  private static void failsAfterSecondLink() throws Exception {
    Path root=Files.createTempDirectory("tracker-save-after-link-");Path staging=Files.createDirectory(root.resolve("staging"));
    Path sourceOne=Files.writeString(staging.resolve("one"),"one"),sourceTwo=Files.writeString(staging.resolve("two"),"two");
    Path blocked=Files.createDirectory(staging.resolve("blocked"));Files.writeString(blocked.resolve("child"),"exercises recursive cleanup");
    Path destinationOne=root.resolve("published-one"),destinationTwo=root.resolve("published-two"),unrelated=Files.writeString(root.resolve("unrelated"),"keep");
    IOException primary=new IOException("injected after hard link");
    TrackerService service=new TrackerService((publication,completed)->{if(completed==2)throw primary;});setDirty(service,true);
    List<TrackerService.Publication> publications=new ArrayList<>();publications.add(new TrackerService.Publication(sourceOne,destinationOne));publications.add(new TrackerService.Publication(sourceTwo,destinationTwo));
    try{try{service.publishSaveArtifacts(publications);throw new AssertionError("publication unexpectedly succeeded");}finally{TrackerService.cleanupStaging(staging);}}
    catch(IOException failure){if(failure!=primary)throw new AssertionError("primary failure was masked",failure);}
    if(Files.exists(destinationOne)||Files.exists(destinationTwo))throw new AssertionError("linked partial output survived rollback");
    if(!Files.readString(unrelated).equals("keep"))throw new AssertionError("unrelated file was changed");
    if(!dirty(service))throw new AssertionError("failed save cleared dirty state");
    if(Files.exists(staging)||Files.exists(blocked))throw new AssertionError("recursive staging cleanup failed");
    Files.delete(unrelated);Files.delete(root);
  }

  private static void setDirty(TrackerService service,boolean value) throws Exception {Field field=TrackerService.class.getDeclaredField("dirty");field.setAccessible(true);field.setBoolean(service,value);}
  private static boolean dirty(TrackerService service) throws Exception {Field field=TrackerService.class.getDeclaredField("dirty");field.setAccessible(true);return field.getBoolean(service);}
}
