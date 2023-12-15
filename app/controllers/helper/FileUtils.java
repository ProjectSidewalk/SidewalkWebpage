package controllers.helper;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Base64;

public class FileUtils {

    public static String readFileToBase64String(String filePath) throws Exception {

//        System.out.println("filePath: " + filePath);
//        System.out.println(System.getProperty("user.dir"));

        byte[] fileBytes = Files.readAllBytes(Paths.get(filePath));
        return Base64.getEncoder().encodeToString(fileBytes);
    }


}
