package tracker.mcp;

import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.*;

/** Data-only importer security and reconstruction tests. GPL-3. */
public final class ProjectInputTest {
  public static void main(String[] args) throws Exception {
    Path fixture=Path.of(args[0]).toAbsolutePath();
    try(ProjectInput input=ProjectInput.read(fixture.toString())) {
      if(!input.project||input.masses.size()!=1||input.masses.get(0).marks().size()!=12)throw new AssertionError("fixture data missing");
      if(Math.abs(input.angle-Math.PI/6)>1e-12||input.dt!=100||input.count!=12)throw new AssertionError("coords/timing changed");
      if(!Files.isRegularFile(input.media)||!input.media.startsWith(input.staging))throw new AssertionError("unstaged media");
    }
    byte[] xml;
    try(ZipFile zip=new ZipFile(fixture.toFile())) {var entry=zip.stream().filter(e->e.getName().endsWith(".trk")).findFirst().orElseThrow();try(var in=zip.getInputStream(entry)){xml=in.readAllBytes();}}
    String valid=new String(xml,StandardCharsets.UTF_8);
    String[] codes={"SAX", "UNSUPPORTED_TYPE", "UNSUPPORTED_TYPE", "INVALID_ARGUMENT", "INVALID_ARGUMENT", "PARSE_FAILED", "UNSUPPORTED_TYPE", "INVALID_ARGUMENT"};
    int caseIndex=0;
    for(String bad:new String[]{
      "<!DOCTYPE object [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><object>&x;</object>",
      valid.replace("org.opensourcephysics.cabrillo.tracker.PointMass\"","java.lang.Runtime\""),
      valid.replace("name=\"fixedorigin\" type=\"boolean\">true","name=\"fixedorigin\" type=\"boolean\">false"),
      valid.replace("name=\"xscale\" type=\"double\">40.0","name=\"xscale\" type=\"double\">1e-300"),
      valid.replace("name=\"delta_t\" type=\"double\">100.0","name=\"delta_t\" type=\"double\">1e-300"),
      valid.replace("name=\"mass\" type=\"double\">1.0","name=\"mass\" type=\"double\">Infinity"),
      valid.replace("name=\"framedata\" type=\"array\" class=\"[Lorg.opensourcephysics.cabrillo.tracker.PointMass$FrameData;\"","name=\"functions\" type=\"array\" class=\"[Lorg.opensourcephysics.cabrillo.tracker.PointMass$FrameData;\""),
      valid.replace("name=\"mass\" type=\"double\">1.0","name=\"mass\" type=\"double\">1e-40")
    }) {
      if(bad.equals(valid))throw new AssertionError("adversarial substitution did not apply");
      String code=codes[caseIndex++];
      try(ProjectInput input=new ProjectInput()) {try{input.parse(bad.getBytes(StandardCharsets.UTF_8));throw new AssertionError("unsafe input accepted: "+code);}catch(Failure expected){if(!expected.code.equals(code))throw new AssertionError("Expected "+code+", got "+expected.code);}catch(org.xml.sax.SAXException expected){if(!code.equals("SAX"))throw new AssertionError("Unexpected XML parse failure",expected);}}
    }
    for(String bad:new String[]{"../outside","/tmp/outside","http://localhost/a.mp4","videos/../../escape","C:\\x.mp4"}) {try{ProjectInput.safeRelative(bad);throw new AssertionError("unsafe path accepted");}catch(Failure expected){if(!expected.code.equals("INVALID_ARGUMENT"))throw new AssertionError("Wrong path error: "+expected.code);}}
    try {ProjectInput.bounded(new java.io.ByteArrayInputStream(new byte[1025]),1024);throw new AssertionError("Read exceeded stream limit");}catch(Failure expected){if(!expected.code.equals("INVALID_ARGUMENT"))throw new AssertionError("Wrong size error");}
    System.out.println("ProjectInputTest passed");
  }
}
