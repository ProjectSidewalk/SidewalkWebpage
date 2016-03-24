# Setup
* Set up JDK, Scala, and Postgres. See [the instruction page.](https://github.com/ProjectSidewalk/Instructions)

# Upload
1. Use Play's dist tool to create jar files of the project (i,e., `activator dist`): https://www.playframework.com/documentation/2.3.x/ProductionDist
2. Upload the zip file to the web server
3. SSH into the server and unarchive the zip file (e.g., `unzip filename`).
4. Run `nohup bin/sidewalk-webpage-[version] -Dconfig.resource=application-prod.conf -Dhttp.port=9000 &` ([reference](http://alvinalexander.com/scala/play-framework-deploying-application-production-server)). Sometimes the application tells you that port 9000 (i.e., default port for a Play app) is taken. To kill an application that is occupying the port, first identify pid with the netstat command `netstat -tulpn | grep :9000` and then use the `kill` command.